import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  ProviderStreams
} from "@earendil-works/pi-ai";

const message = (model: Model<Api>, stopReason: "stop" | "error", errorMessage?: string): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  stopReason,
  ...(errorMessage ? { errorMessage } : {}),
  timestamp: 0
});

function terminalStream(final: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => stream.push(final.stopReason === "error"
    ? { type: "error", reason: "error", error: final }
    : { type: "done", reason: "stop", message: final }));
  return stream;
}

/** models.ts reads the per-model windows out of the environment once, at import. */
async function load(windows?: Record<string, unknown> | string) {
  vi.resetModules();
  if (windows === undefined) delete process.env.BEES_LOCAL_CTX;
  else process.env.BEES_LOCAL_CTX = typeof windows === "string" ? windows : JSON.stringify(windows);
  return await import("../flue-runtime/project/.flue/models.js");
}

afterEach(() => {
  delete process.env.BEES_LOCAL_CTX;
});

describe("Bees-owned model limits", () => {
  it("refreshes and retries once when Codex rejects a nominally unexpired token", async () => {
    const { recoverCodexAuthentication } = await load();
    const model = {
      id: "gpt-test", name: "test", api: "openai-codex-responses", provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1, maxTokens: 1
    } satisfies Model<"openai-codex-responses">;
    const run = vi.fn((_model, _context, options) => terminalStream(
      options?.apiKey === "fresh"
        ? message(model, "stop")
        : message(model, "error", "Provided authentication token is expired.")
    ));
    const api = recoverCodexAuthentication(
      { stream: run, streamSimple: run } as ProviderStreams,
      vi.fn(async () => "fresh")
    );

    const final = await api.stream(model, { messages: [] }, { apiKey: "stale" }).result();

    expect(final.stopReason).toBe("stop");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[2]).toMatchObject({ apiKey: "fresh" });
  });

  // Every local model gets its own llama-server with its own window, because what a token
  // costs is set by the model's layers and KV heads — a 3B and a 235B are not comparable.
  it("declares each model's own window, not one shared number", async () => {
    const { loopbackModel } = await load({ "small-3b": 32_768, "big-235b": 8_192 });
    expect(loopbackModel("bees-local", "small-3b").contextWindow).toBe(32_768);
    expect(loopbackModel("bees-local", "big-235b").contextWindow).toBe(8_192);
    // maxTokens tracks the window rather than a constant, so a wide model is not capped to
    // the output budget of a narrow one.
    expect(loopbackModel("bees-local", "small-3b").maxTokens).toBe(4096);
    expect(loopbackModel("bees-local", "big-235b").maxTokens).toBe(1024);
  });

  it("scales the output budget for a very wide local model", async () => {
    const { loopbackModel } = await load({ huge: 262_144 });
    const model = loopbackModel("bees-local", "huge");
    expect(model.contextWindow).toBe(262_144);
    expect(model.maxTokens).toBe(32_000);
  });

  it("falls back to a small window for a model the desktop did not report", async () => {
    const { loopbackModel } = await load({ known: 32_768 });
    // Under-declaring costs early compaction; over-declaring costs overflow errors mid-run.
    expect(loopbackModel("bees-local", "unknown").contextWindow).toBe(8192);
  });

  it("survives a malformed window map instead of failing every local run", async () => {
    const { loopbackModel } = await load("not json");
    expect(loopbackModel("bees-local", "active").contextWindow).toBe(8192);
  });

  // The default keeps 8000 recent tokens, which is more than a small local window holds:
  // compaction then finds nothing worth summarizing and bills a summarization call anyway.
  it("keeps the preserved tail inside the window it has to fit in", async () => {
    const { compactionFor } = await load({ active: 8192 });
    expect(compactionFor("bees-local/active")).toEqual({ keepRecentTokens: 2048 });
  });

  it("leaves the default alone where it already fits", async () => {
    const { compactionFor } = await load({ active: 32_768 });
    // The 200k CLI window and cloud models are wide enough for the default.
    expect(compactionFor("claude-cli/sonnet")).toBeUndefined();
    expect(compactionFor("anthropic/claude-opus-5")).toBeUndefined();
    // 32768 / 4 is over 8000, so the local model stops needing an override too.
    expect(compactionFor("bees-local/active")).toBeUndefined();
  });

  it("maps thinking levels onto what Claude Code accepts", async () => {
    const { loopbackModel } = await load();
    // Claude cannot switch reasoning off, so "off" lands on its floor rather than
    // silently sending nothing and letting the CLI's own config decide.
    expect(loopbackModel("claude-cli", "default").thinkingLevelMap).toMatchObject({
      off: "low",
      minimal: "low",
      max: "max"
    });
  });

  // The regression this guards: Flue resolves a model specifier against the ids its provider
  // declared, so every CLI run failed with "Unknown model ID default@<execution>" — the id
  // that carries the run's workspace to the shim was never declared.
  it("declares the run-scoped CLI model id before a run resolves it", async () => {
    const { declareModel, registerCliProviders } = await load();
    // The runtime copy models.ts registers into: the project has its own node_modules, so a
    // bare "@flue/runtime/internal" here would read a second, empty provider registry.
    const { resolveModel } = await import(
      "../flue-runtime/node_modules/@flue/runtime/dist/internal.mjs"
    );
    registerCliProviders();
    expect(() => resolveModel("claude-cli/default@run-1")).toThrow(/Unknown model ID/);
    expect(declareModel("claude-cli/default@run-1")).toBe("claude-cli/default@run-1");
    // Declared with the CLI's real limits, not a zero-metadata placeholder: a 0 window would
    // switch compaction off, and the shim re-sends the whole transcript every turn.
    expect(resolveModel("claude-cli/default@run-1").contextWindow).toBe(200_000);
    // The baseline id and other runs keep working — registration accumulates, never replaces.
    expect(declareModel("claude-cli/default@run-2")).toBe("claude-cli/default@run-2");
    expect(resolveModel("claude-cli/default@run-1").id).toBe("default@run-1");
    expect(resolveModel("claude-cli/default").id).toBe("default");
  });

  it("asks the local model for thinking through its chat template", async () => {
    const { loopbackModel } = await load();
    const model = loopbackModel("bees-local", "active");
    expect(model.reasoning).toBe(true);
    // qwen-chat-template sends `enable_thinking` plus `preserve_thinking: true`, which is
    // what carries a turn's reasoning into the next one instead of blanking it.
    expect(model.compat?.thinkingFormat).toBe("qwen-chat-template");
  });
});
