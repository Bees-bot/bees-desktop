import { createHash } from "node:crypto";

const FAILURES = 3;
const PROBE = 4;
const TRACKED = 64;

/** aborts, denied approvals, and unknown-tool errors (which self-heal via discovery) aren't the model's fault */
const NOT_THE_MODEL = new Set(["ABORTED", "ABORTED_BEFORE_DISPATCH", "UNKNOWN_TOOL"]);

/** flags args that look like a quoted number/boolean, but only ones the error text already names */
function quotedValues(args, error) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const names = Object.entries(args).filter(([name, value]) => typeof value === "string" &&
    (value === "true" || value === "false" || (value.trim() !== "" && Number.isFinite(Number(value)))) &&
    (error.includes(name) || error.includes(value))).map(([name]) => name);
  return !names.length ? "" : ` ${names.join(", ")} ${names.length > 1 ? "are" : "is"} quoted text; if this tool wants a number or true/false, send it without quotes.`;
}

/** Hashed so one remembered call costs the same whether it wrote a word or a whole file. */
function keyOf(exec) {
  try { return `${exec.name}:${createHash("sha1").update(JSON.stringify(exec.arguments ?? null)).digest("hex")}`; }
  catch { return ""; }
}

/** DSH's built-in repeat reminder only nags; refuse a call that keeps failing instead and say why. */
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
    if (!seen || seen.count < FAILURES) return next();
    // probe every 4th refusal in case the failure was transient, so we don't refuse forever
    if (++seen.refused % PROBE === 0) return next();
    return { kind: "deny", reason: `This exact ${exec.name} call already failed ${seen.count} times: ${seen.error}.${quotedValues(exec.arguments, seen.error)} Send different arguments or take another route; repeating it fails the same way.` };
  });
  agentCtx.on("tools/result", (exec, result) => {
    if (exec.agent !== owner || !reached.delete(exec)) return;
    const key = keyOf(exec);
    if (!key) return;
    if (!result.isError) return void failed.delete(key);
    if (NOT_THE_MODEL.has(result.error?.info?.code)) return;
    const prior = failed.get(key);
    const error = (result.error?.message ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    // Re-inserted so the key dropped below is the oldest one, never this one.
    failed.delete(key);
    failed.set(key, { count: (prior?.count ?? 0) + 1, refused: prior?.refused ?? 0, error: error || prior?.error || "no reason given" });
    if (failed.size > TRACKED) failed.delete(failed.keys().next().value);
  });
}
