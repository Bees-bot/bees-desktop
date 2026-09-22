import { resolveRunModel } from "./agent-runtime.js";
import { optionalModelRoute, optionalReasoningEffort } from "./product-database.js";

// Explicitly invoked by the user; never send a paid probe in a polling loop.
export async function testOnboardingModel(ctx, model = null) {
  const selection = await resolveRunModel(ctx, { model: optionalModelRoute(model) });
  return probeModel(ctx, selection);
}

export async function testPlanningModels(ctx, { plannerModel = null, reviewerModel = null,
  plannerReasoningEffort = null, reviewerReasoningEffort = null } = {}) {
  const planner = await resolveRunModel(ctx, { model: optionalModelRoute(plannerModel), reasoningEffort: optionalReasoningEffort(plannerReasoningEffort) });
  await probeModel(ctx, planner);
  try {
    const reviewer = await resolveRunModel(ctx, { model: optionalModelRoute(reviewerModel), reasoningEffort: optionalReasoningEffort(reviewerReasoningEffort) });
    // An alias and an explicit route can select the same model. Probe that model only once.
    if (reviewer.resolvedModel !== planner.resolvedModel) await probeModel(ctx, reviewer);
    return { plannerModel: planner.resolvedModel, reviewerModel: reviewer.resolvedModel, fallback: false };
  } catch {
    return { plannerModel: planner.resolvedModel, reviewerModel: planner.resolvedModel, fallback: true };
  }
}

// The provider SDKs report a dead socket as the bare "Connection error.", which names neither the
// model that failed nor anything a person can do about it.
const vague = (text) => !String(text ?? "").trim() || /^connection error\.?$/i.test(String(text).trim());

async function probeModel(ctx, { resolvedModel, resolvedReasoningEffort }) {
  const separator = resolvedModel.indexOf("/");
  const selection = { provider: resolvedModel.slice(0, separator), model: resolvedModel.slice(separator + 1) };
  const where = resolvedModel;
  const signal = AbortSignal.timeout(60_000);
  let text = false;
  let finished = false;
  // a reasoning model spends the first few hundred tokens thinking, so a tight cap returns no text at all
  for await (const chunk of ctx.llm.stream({ ...selection, signal, maxTokens: 1024,
    ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
    messages: [{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Reply with a short hello." }] }],
    tools: [] })) {
    signal.throwIfAborted();
    if (chunk.type === "text-delta" && chunk.text.trim()) text = true;
    if (chunk.type === "block-end" && chunk.block?.type === "text" && chunk.block.text.trim()) text = true;
    if (chunk.type === "finish") {
      if (["error", "aborted"].includes(chunk.reason.kind)) {
        const cause = chunk.reason.failure?.message;
        throw new Error(vague(cause)
          ? `${where} did not answer. Check this connection under Settings → AI connections, then run the test again.`
          : `${where} did not answer: ${cause}`);
      }
      finished = true;
    }
  }
  signal.throwIfAborted();
  if (!finished || !text) throw new Error(`${where} did not return a greeting. Try again or choose another model.`);
  return selection;
}
