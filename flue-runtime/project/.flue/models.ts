// The context and reasoning facts about Bees-owned models, in one place because two
// consumers need them and must not disagree: `app.ts` registers the pi-ai models, and the
// agents derive their compaction settings from the same windows.

import { createAssistantMessageEventStream, createProvider } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Model,
  ProviderStreams,
  ThinkingLevelMap
} from "@earendil-works/pi-ai";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { setProvider } from "@flue/runtime";
import type { CompactionConfig } from "@flue/runtime";
import { CLI_PROVIDERS, type CliProvider } from "./cli-provider.ts";
import { aiConnectionSecret } from "./credentials.ts";

const selfUrl = process.env.BEES_SELF_URL ?? "http://127.0.0.1:1";
export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";
export const OPENAI_CODEX_PROVIDER = "openai-codex";

function failedMessage(model: Model<Api>, error: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now()
  };
}

function expiredAuthentication(event: AssistantMessageEvent): boolean {
  return event.type === "error"
    && /authentication token is expired/i.test(event.error.errorMessage ?? "");
}

/** Retry one pre-stream Codex auth rejection with a freshly exchanged token. */
export function recoverCodexAuthentication(
  api: ProviderStreams,
  refresh: () => Promise<string>
): ProviderStreams {
  const recover = (
    model: Model<Api>,
    start: (apiKey?: string) => AssistantMessageEventStream
  ): AssistantMessageEventStream => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let source = start();
      let emitted = false;
      for await (const event of source) {
        if (!emitted && expiredAuthentication(event)) {
          source = start(await refresh());
          for await (const retry of source) output.push(retry);
          output.end(await source.result());
          return;
        }
        emitted = true;
        output.push(event);
      }
      output.end(await source.result());
    })().catch((error) => {
      const failure = failedMessage(model, error);
      output.push({ type: "error", reason: "error", error: failure });
    });
    return output;
  };
  return {
    stream: (model, context, options) => recover(
      model,
      (apiKey) => api.stream(model, context, apiKey ? { ...options, apiKey } : options)
    ),
    streamSimple: (model, context, options) => recover(
      model,
      (apiKey) => api.streamSimple(model, context, apiKey ? { ...options, apiKey } : options)
    )
  };
}

/**
 * Used when a local model is not in the map below — it started outside this runtime's view,
 * or the desktop passed nothing. Small on purpose: under-declaring a window costs some early
 * compaction, over-declaring costs hard overflow errors mid-run.
 */
const FALLBACK_LOCAL_WINDOW = 8192;

/**
 * The window each llama-server was actually started with, keyed by model id (plus `active`),
 * as the desktop derived it from that model's own GGUF header and this machine's memory —
 * see `context_size_for_model` in local_models.rs. A 3B and a 235B are not the same size and
 * do not get the same window, so this is a map rather than a number.
 */
const LOCAL_WINDOWS: Record<string, number> = parseWindows(process.env.BEES_LOCAL_CTX);

function parseWindows(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(raw) as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0
      )
    );
  } catch {
    return {};
  }
}

/**
 * Window Claude Code really has. It matters more than it looks: the shim re-sends the
 * whole transcript on every turn (there is no CLI-side session to absorb growth), so this
 * number is the only thing deciding when Bees compacts.
 *
 * `maxTokens` caps the compaction reserve, and the CLI bills the user's own subscription,
 * so these are the published output limits rather than anything Bees enforces.
 */
const CLI_MODELS: Record<CliProvider, { contextWindow: number; maxTokens: number; thinking: ThinkingLevelMap }> = {
  // `claude --effort` takes low|medium|high|xhigh|max — no "off" and no "minimal", so the
  // two levels below its floor land on "low". Bees always sends one: with no flag the CLI
  // falls back to its own configuration and the agent's setting would silently do nothing.
  "claude-cli": {
    contextWindow: 200_000,
    maxTokens: 64_000,
    thinking: {
      off: "low",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max"
    }
  },
};

function isCliProvider(provider: string): provider is CliProvider {
  return (CLI_PROVIDERS as readonly string[]).includes(provider);
}

export const LOCAL_PROVIDER = "bees-local";

/**
 * A local model's limits. `maxTokens` is a share of the window rather than a constant, so a
 * 200k-window model is not held to the same output cap as an 8k one — it also sets the
 * ceiling on the headroom compaction reserves.
 */
function localLimits(modelId: string): { contextWindow: number; maxTokens: number } {
  const contextWindow = LOCAL_WINDOWS[modelId] ?? FALLBACK_LOCAL_WINDOW;
  return {
    contextWindow,
    maxTokens: Math.max(1024, Math.min(32_000, Math.floor(contextWindow / 8)))
  };
}

/** Context window and output cap for a Bees-owned model, or undefined for a cloud one. */
function limitsFor(provider: string, modelId: string): { contextWindow: number; maxTokens: number } | undefined {
  if (isCliProvider(provider)) return CLI_MODELS[provider];
  return provider === LOCAL_PROVIDER ? localLimits(modelId) : undefined;
}

/**
 * pi-ai wants a static model list per provider, and every Bees-owned model is an
 * OpenAI-completions endpoint served by this same process. Cost is zero because nothing
 * here is billed: local llama-server, or a CLI the user already pays for.
 */
export function loopbackModel(
  provider: typeof LOCAL_PROVIDER | CliProvider,
  id: string
): Model<"openai-completions"> {
  const local = provider === LOCAL_PROVIDER;
  const route = local ? "local-model" : `cli/${provider}`;
  const { contextWindow, maxTokens } = local ? localLimits(id) : CLI_MODELS[provider];
  return {
    id,
    name: `${provider}/${id}`,
    api: "openai-completions",
    provider,
    baseUrl: `${selfUrl}/${route}/v1`,
    // Reasoning reaches these endpoints by different roads — a chat-template kwarg for
    // llama-server, a CLI flag for the shims — but in both cases the agent's thinkingLevel
    // has to survive the trip, and it only does when the model claims to support it.
    reasoning: true,
    // Nanbeige and Qwen3 gate thinking through their chat template rather than a request
    // field, which is pi-ai's `qwen-chat-template` format: it sends
    // `chat_template_kwargs: { enable_thinking, preserve_thinking: true }`, and
    // `preserve_thinking` is what keeps earlier turns' reasoning in the prompt instead of
    // blanking it. A model whose template ignores those kwargs renders as it did before.
    ...(local
      ? { compat: { thinkingFormat: "qwen-chat-template" as const } }
      : { thinkingLevelMap: CLI_MODELS[provider].thinking }),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens
  };
}

/**
 * Model ids each CLI provider has declared to the runtime, `default` plus one per run.
 *
 * Flue resolves a model specifier against the ids its provider declared and throws on any
 * other, so the catch-all entry the CLI shim was designed around does not exist: Bees names
 * the model `default@<execution>` — the only channel an OpenAI request has for saying which
 * run's workspace the CLI must work in — and every one of those ids has to be declared
 * before the run resolves it.
 *
 * ponytail: one short string per run, never pruned. The runtime restarts often enough that
 * it does not matter; prune by last use if a single session ever holds thousands.
 */
const declaredCliModels = new Map<CliProvider, Set<string>>(
  CLI_PROVIDERS.map((provider) => [provider, new Set(["default"])])
);

const declaredCompatibleModels = new Set<string>();

/** pi-ai resolves auth per request; these endpoints are loopback, so the key is a constant. */
function loopbackAuth(name: string) {
  const key = process.env.BEES_FLUE_TOKEN ?? "";
  return { apiKey: { name, resolve: async () => ({ auth: { apiKey: key }, source: name }) } };
}

function registerCliProvider(provider: CliProvider): void {
  setProvider(
    createProvider({
      id: provider,
      name: provider,
      auth: loopbackAuth(provider),
      models: [...declaredCliModels.get(provider)!].map((id) => loopbackModel(provider, id)),
      api: openAICompletionsApi()
    })
  );
}

/** Register the CLI-backed providers with their baseline model. Called once, from `app.ts`. */
export function registerCliProviders(): void {
  for (const provider of CLI_PROVIDERS) registerCliProvider(provider);
}

function compatibleModel(id: string): Model<"openai-completions"> {
  return {
    id,
    name: `${OPENAI_COMPATIBLE_PROVIDER}/${id}`,
    api: "openai-completions",
    provider: OPENAI_COMPATIBLE_PROVIDER,
    baseUrl: process.env.BEES_OPENAI_COMPATIBLE_BASE_URL ?? "http://127.0.0.1:1/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // A generic endpoint cannot advertise capabilities. Conservative limits compact early
    // instead of overflowing a smaller server; a future endpoint discovery API can replace them.
    contextWindow: 32_768,
    maxTokens: 8_192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    }
  };
}

/** Register a configurable OpenAI-compatible endpoint without adding another transport. */
export function registerOpenAICompatibleProvider(): void {
  const apiKey = process.env.BEES_OPENAI_COMPATIBLE_API_KEY ?? "";
  const baseUrl = process.env.BEES_OPENAI_COMPATIBLE_BASE_URL ?? "";
  if (!apiKey || !/^https?:\/\//.test(baseUrl)) return;
  setProvider(
    createProvider({
      id: OPENAI_COMPATIBLE_PROVIDER,
      name: "OpenAI-compatible",
      baseUrl,
      auth: {
        apiKey: {
          name: "OpenAI-compatible API key",
          resolve: async () => ({ auth: { apiKey }, source: "Bees credential vault" })
        }
      },
      models: [...declaredCompatibleModels].map(compatibleModel),
      api: openAICompletionsApi()
    })
  );
}

/** Replace Flue's in-memory OAuth store with Bees' OS-vault credential resolver. */
export function registerOpenAICodexProvider(): void {
  const secretRef = process.env.BEES_OPENAI_CODEX_SECRET_REF ?? "";
  const organizationId = process.env.BEES_OPENAI_CODEX_ORGANIZATION_ID ?? "";
  const connectionId = process.env.BEES_OPENAI_CODEX_CONNECTION_ID ?? "";
  if (!secretRef || !organizationId || !connectionId) return;
  setProvider(createProvider({
    id: OPENAI_CODEX_PROVIDER,
    name: "OpenAI Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    auth: {
      apiKey: {
        name: "OpenAI (ChatGPT Plus/Pro)",
        resolve: async () => ({
          auth: { apiKey: await aiConnectionSecret(secretRef, organizationId, connectionId) },
          source: "ChatGPT OAuth"
        })
      }
    },
    models: Object.values(OPENAI_CODEX_MODELS),
    api: recoverCodexAuthentication(
      openAICodexResponsesApi(),
      () => aiConnectionSecret(secretRef, organizationId, connectionId, true)
    )
  }));
}

/**
 * Declare a `provider/model` reference before an agent runs on it, and return it unchanged.
 * Only the CLI providers need this — every other model id is static and already declared.
 */
export function declareModel(ref: string): string {
  const slash = ref.indexOf("/");
  const provider = slash === -1 ? "" : ref.slice(0, slash);
  if (provider === OPENAI_COMPATIBLE_PROVIDER) {
    const id = ref.slice(slash + 1);
    if (!declaredCompatibleModels.has(id)) {
      declaredCompatibleModels.add(id);
      registerOpenAICompatibleProvider();
    }
    return ref;
  }
  if (!isCliProvider(provider)) return ref;
  const declared = declaredCliModels.get(provider)!;
  const id = ref.slice(slash + 1);
  if (!declared.has(id)) {
    declared.add(id);
    registerCliProvider(provider);
  }
  return ref;
}

/**
 * Compaction settings for a `provider/model` reference, or undefined to leave Flue's
 * defaults alone.
 *
 * Only `keepRecentTokens` needs deriving. Its default is a flat 8000, which is fine
 * against a 200k window and nonsense against a small local one: preserving more recent
 * tokens than the window holds leaves compaction nothing to summarize, so it burns a
 * summarization call per turn and frees almost nothing.
 */
export function compactionFor(modelRef: string): CompactionConfig | undefined {
  const [provider = "", modelId = ""] = modelRef.split("/");
  const limits = limitsFor(provider, modelId);
  if (!limits) return undefined;
  const keepRecentTokens = Math.min(8000, Math.floor(limits.contextWindow / 4));
  return keepRecentTokens < 8000 ? { keepRecentTokens } : undefined;
}

/**
 * Decodes `<agent name>--<hex of provider/model>--<team id>`. Hex rather than base64url, and
 * "--" rather than "-", because both an agent name and a team UUID contain single dashes and
 * the base64url alphabet does too. Neither ever contains a double dash. Anything unparseable
 * falls back to the local model instead of failing the turn.
 *
 * The model rides in the instance id rather than in the agent file because rewriting an agent
 * file restarts the whole runtime, killing every run in flight — far too violent for a dropdown.
 * See `instanceModelId` in src/assistant.ts for the encoder.
 */
export function modelForInstance(id: string): string {
  const hex = id.split("--")[1] ?? "";
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return DEFAULT_INSTANCE_MODEL;
  const ref = Buffer.from(hex, "hex").toString("utf8");
  if (!/^[A-Za-z0-9._-]+\/\S+$/.test(ref)) return DEFAULT_INSTANCE_MODEL;
  if (ref.startsWith(`${OPENAI_COMPATIBLE_PROVIDER}/`)) return declareModel(ref);
  // CLI-backed providers loop back into this runtime and can only tell runs apart by the
  // instance id smuggled onto the model name — same contract a generated agent uses.
  return CLI_PROVIDERS.some((provider) => ref.startsWith(`${provider}/`))
    ? declareModel(`${ref}@${id}`)
    : ref;
}

const DEFAULT_INSTANCE_MODEL = "bees-local/active";
