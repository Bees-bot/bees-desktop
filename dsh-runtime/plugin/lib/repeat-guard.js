import { createHash } from "node:crypto";

const FAILURES = 3;
const PROBE = 4;
const TRACKED = 64;

/** A stop, an approval the person turned down and a tool that went missing are not the model
 *  repeating itself, and the last one repeats on its own whenever tool discovery drops a name. */
const NOT_THE_MODEL = new Set(["ABORTED", "ABORTED_BEFORE_DISPATCH", "UNKNOWN_TOOL"]);

/** Almost every stuck loop is a number or a boolean sent as quoted text, so name the arguments that
 *  look like one. Only where the error already mentions the name or the value, so nothing is
 *  invented about an argument the tool was happy with. */
function quotedValues(args, error) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const names = Object.entries(args).filter(([name, value]) => typeof value === "string" &&
    (value === "true" || value === "false" || (value.trim() !== "" && Number.isFinite(Number(value)))) &&
    (error.includes(name) || error.includes(value))).map(([name]) => name);
  if (!names.length) return "";
  return ` ${names.join(", ")} ${names.length > 1 ? "are" : "is"} quoted text; if this tool wants a number or true/false, send it without quotes.`;
}

/** Hashed so one remembered call costs the same whether it wrote a word or a whole file. */
function keyOf(exec) {
  try { return `${exec.name}:${createHash("sha1").update(JSON.stringify(exec.arguments ?? null)).digest("hex")}`; }
  catch { return ""; }
}

/** The repeat reminder that ships with DSH only nags; it never stops anything. A model that keeps
 *  resending one failing call burns a step and the whole history on every attempt, so refuse it
 *  after a few real failures and hand back the error plus the argument most likely at fault. */
export function mountRepeatGuard(agentCtx, owner) {
  if (typeof agentCtx?.on !== "function") return;
  const failed = new Map();
  const reached = new WeakSet();
  // Only a call that reached the tool itself counts. Anything refused before that, our own refusals
  // included, never lands here, so an approval the person turned down cannot read as a broken tool.
  agentCtx.on("tools/execute", (exec, next) => {
    if (exec.agent === owner) reached.add(exec);
    return next();
  });
  agentCtx.on("tools/pre-execute", async (exec, next) => {
    const seen = exec.agent === owner && failed.get(keyOf(exec));
    if (!seen || seen.count < FAILURES) return next();
    // What failed three times may have been a service that was down, and only a call getting
    // through can show it came back. Refusing forever would end the run on a stale verdict.
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
