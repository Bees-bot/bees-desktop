import { latestCodexModel } from "./agent-runtime.js";

// Explicitly invoked by the user; never send a paid probe in a polling loop.
export async function testOnboardingModel(ctx) {
  const selection = ctx.agentDefaultModel.currentSelection();
  if (!selection?.provider || !selection?.model) throw new Error("Choose a system default model first.");
  let model = selection.model;
  const channel = /^__bees_latest_(sol|terra|luna)__$/.exec(model);
  if (channel && selection.provider === "openai-codex") {
    model = latestCodexModel(await ctx.llm.listModels(selection.provider), channel[1])?.id;
    if (!model) throw new Error("The selected Codex model is unavailable.");
  }
  const signal = AbortSignal.timeout(60_000);
  let text = false;
  let finished = false;
  for await (const chunk of ctx.llm.stream({ ...selection, model, signal, maxTokens: 128,
    messages: [{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Reply with a short hello." }] }],
    tools: [] })) {
    signal.throwIfAborted();
    if (chunk.type === "text-delta" && chunk.text.trim()) text = true;
    if (chunk.type === "block-end" && chunk.block?.type === "text" && chunk.block.text.trim()) text = true;
    if (chunk.type === "finish") {
      if (["error", "aborted"].includes(chunk.reason.kind)) throw new Error(chunk.reason.failure?.message || "AI connection failed.");
      finished = true;
    }
  }
  signal.throwIfAborted();
  if (!finished || !text) throw new Error("The model did not return a greeting. Try again or choose another model.");
  return { provider: selection.provider, model: selection.model };
}
