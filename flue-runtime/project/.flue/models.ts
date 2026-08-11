// The context and reasoning facts about Bees-owned models, in one place because two
// consumers need them and must not disagree: `app.ts` registers the pi-ai models, and the
// agents derive their compaction settings from the same windows.

import { createProvider } from "@earendil-works/pi-ai";
import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { setProvider } from "@flue/runtime";
import type { CompactionConfig } from "@flue/runtime";
import { CLI_PROVIDERS, type CliProvider } from "./cli-provider.ts";

const selfUrl = process.env.BEES_SELF_URL ?? "http://127.0.0.1:1";

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
 * Windows the CLIs really have. They matter more than they look: the shim re-sends the
 * whole transcript on every turn (there is no CLI-side session to absorb growth), so this
 * number is the only thing deciding when Bees compacts.
 *
 * `maxTokens` caps the compaction reserve, and the CLIs bill the user's own subscription,
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
  // `codex exec -c model_reasoning_effort=` takes minimal|low|medium|high|xhigh — no "max".
  // Same reason for always sending a value, and a sharper one: codex reads
  // `~/.codex/config.toml` on every exec, so an unset effort means the user's global
  // config quietly overrides whatever the agent asked for.
  "codex-cli": {
    contextWindow: 400_000,
    maxTokens: 128_000,
    thinking: {
      off: "minimal",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "xhigh"
    }
  },
  // opencode fronts many models at once and each one carries its own window, so this is the
  // floor across the curated list rather than any one model's ceiling.
  //
  // Its reasoning knob (`run --variant`) takes names the *model* declares, not a fixed
  // scale, so there is nothing to map a thinkingLevel onto that holds across models: `null`
  // sends no effort at all and leaves the model on its own default. Name the variants here
  // if Bees ever pins opencode to one model.
  "opencode-cli": {
    contextWindow: 200_000,
    maxTokens: 32_000,
    thinking: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: null,
      max: null
    }
  }
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

/**
 * Declare a `provider/model` reference before an agent runs on it, and return it unchanged.
 * Only the CLI providers need this — every other model id is static and already declared.
 */
export function declareModel(ref: string): string {
  const slash = ref.indexOf("/");
  const provider = slash === -1 ? "" : ref.slice(0, slash);
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
  // CLI-backed providers loop back into this runtime and can only tell runs apart by the
  // instance id smuggled onto the model name — same contract a generated agent uses.
  return CLI_PROVIDERS.some((provider) => ref.startsWith(`${provider}/`))
    ? declareModel(`${ref}@${id}`)
    : ref;
}

const DEFAULT_INSTANCE_MODEL = "bees-local/active";
