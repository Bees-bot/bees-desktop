import { createHash } from "node:crypto";

/** aborts and unknown-tool errors (which self-heal via discovery) aren't the model's fault */
const NOT_THE_MODEL = new Set(["ABORTED", "ABORTED_BEFORE_DISPATCH", "UNKNOWN_TOOL"]);

/** Hashed so one remembered call costs the same whether it wrote a word or a whole file. */
function keyOf(exec) {
  try { return `${exec.name}:${createHash("sha1").update(JSON.stringify(exec.arguments ?? null)).digest("hex")}`; }
  catch { return ""; }
}

/** DSH's built-in repeat reminder only nags; refuse a call that failed 3 times instead and say why. */
export function mountRepeatGuard(agentCtx, owner) {
  if (typeof agentCtx?.on !== "function") return;
  const failed = new Map();
  const reached = new WeakSet();
  // only calls that actually reached the tool count, so a refusal (ours included) never counts as a failure
  agentCtx.on("tools/execute", (exec, next) => {
    if (exec.agent === owner) reached.add(exec);
    return next();
  });
  agentCtx.on("tools/pre-execute", async (exec, next) => {
    const seen = exec.agent === owner && failed.get(keyOf(exec));
    // every 4th refusal goes through in case the failure was transient, so we don't refuse forever
    if (!seen || seen.count < 3 || ++seen.refused % 4 === 0) return next();
    return { kind: "deny", reason: `This exact ${exec.name} call already failed ${seen.count} times: ${seen.error}. Send different arguments or take another route; repeating it fails the same way.` };
  });
  agentCtx.on("tools/result", (exec, result) => {
    const key = exec.agent === owner && reached.delete(exec) && keyOf(exec);
    if (!key) return;
    if (!result.isError) return void failed.delete(key);
    if (NOT_THE_MODEL.has(result.error?.info?.code)) return;
    const prior = failed.get(key);
    const error = (result.error?.message ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    // re-inserted so the key dropped past 64 is the oldest one, never this one
    failed.delete(key);
    failed.set(key, { count: (prior?.count ?? 0) + 1, refused: prior?.refused ?? 0, error: error || prior?.error || "no reason given" });
    if (failed.size > 64) failed.delete(failed.keys().next().value);
  });
}
