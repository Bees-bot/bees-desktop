import { afterEach, describe, expect, it, vi } from "vitest";

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
    // 200k and 400k CLI windows, and any cloud model, are all wide enough for the default.
    expect(compactionFor("claude-cli/sonnet")).toBeUndefined();
    expect(compactionFor("codex-cli/default")).toBeUndefined();
    expect(compactionFor("anthropic/claude-opus-5")).toBeUndefined();
    // 32768 / 4 is over 8000, so the local model stops needing an override too.
    expect(compactionFor("bees-local/active")).toBeUndefined();
  });

  it("maps thinking levels onto what each CLI actually accepts", async () => {
    const { loopbackModel } = await load();
    // Neither CLI can switch reasoning off, so "off" lands on its floor rather than
    // silently sending nothing and letting the CLI's own config decide.
    expect(loopbackModel("claude-cli", "default").thinkingLevelMap).toMatchObject({
      off: "low",
      minimal: "low",
      max: "max"
    });
    // codex has no "max"; claude has no "minimal". Neither may be passed through raw.
    expect(loopbackModel("codex-cli", "default").thinkingLevelMap).toMatchObject({
      off: "minimal",
      minimal: "minimal",
      max: "xhigh"
    });
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
