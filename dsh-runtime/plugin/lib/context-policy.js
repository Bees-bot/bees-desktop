import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

export const TOOL_READ_CHARS = 6_000;
const installed = new WeakSet();

/** Keep one complete runtime snapshot on the request surface; retain originals in the audit log. */
function retireRuntimeContexts(session, messages) {
  const snapshot = (message) => message?.source?.kind === "runtime-context" && message.source.form === "snapshot";
  const previous = session.surface.nodes.map((seq) => session.eventAt(seq))
    .filter((event) => event?.type === "user/message" && snapshot(event.data));
  const obsolete = messages.some(snapshot) ? previous : previous.slice(0, -1);
  for (const event of obsolete) session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "[Earlier runtime context superseded by the latest snapshot.]" }],
    source: { kind: "bees-context-retention" }
  }), { surfaceOp: { op: "replace", startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });

  // Full context reads and repeated waits from cursor zero contain snapshots.
  // Keep the latest of each; leave paged discussion/memory reads alone.
  const reads = new Map();
  for (const event of session.snapshotEvents()) if (event.type === "tool/call" &&
      ["bees_read_context", "bees_wait_for_peers"].includes(event.data.name)) {
    try {
      const args = typeof event.data.arguments === "string" ? JSON.parse(event.data.arguments) : event.data.arguments;
      if (!args.after && args.include_memories !== true) reads.set(event.data.callId, event.data.name);
    } catch { /* An invalid call is not a full context snapshot. */ }
  }
  const results = session.surface.nodes.map((seq) => session.eventAt(seq)).filter((event) =>
    event?.type === "tool/result" && !event.data.message.isError && reads.has(event.data.message.source.callId) &&
    !event.data.message.content[0]?.text?.startsWith("[Earlier shared-context read superseded."));
  const latest = new Map(results.map((event) => [reads.get(event.data.message.source.callId), event]));
  for (const event of results.filter((event) => latest.get(reads.get(event.data.message.source.callId)) !== event)) session.append("tool/result", {
    ...event.data, message: { ...event.data.message, content: [{ type: "text",
      text: `[Earlier shared-context read superseded. Original available via bees_read_tool_result with call_id ${event.data.message.source.callId}.]` }] }
  }, { surfaceOp: { op: "replace", startSeq: event.seq, endSeq: event.seq }, sourceEventSeqs: [event.seq] });
}

function originalResults(session) {
  const originals = new Map();
  for (const event of session.snapshotEvents()) {
    if (event.type !== "tool/result") continue;
    const id = event.data.message.source.callId;
    if (!originals.has(id)) originals.set(id, event);
  }
  return originals;
}

/** Read only this session's original tool text. Offsets count Unicode code points. */
export function readToolResult(session, args, visited = new Set()) {
  let { call_id, offset = 0, find = "" } = args;
  if (Object.keys(args).some((key) => !["call_id", "offset", "find"].includes(key)))
    throw new Error("Use call_id, character offset and optional find only. Continue with next_offset; there is no line limit.");
  if (typeof call_id !== "string" || !call_id || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof find !== "string" || Array.from(find).length > 200)
    throw new Error("Supply a call_id, nonnegative integer offset, and optional find text (up to 200 characters).");
  if (visited.has(call_id)) throw new Error("Circular tool result reference");
  visited.add(call_id);
  const events = session.snapshotEvents();
  // Resolve old receipts pointing to recall pages back to the underlying source.
  const call = events.find((event) => event.type === "tool/call" && event.data.callId === call_id)?.data;
  if (call?.name === "bees_read_tool_result") {
    let source;
    try { source = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments; } catch {}
    if (!source?.call_id) throw new Error(`Call ${call_id} did not record which result it read; ask for the original call_id.`);
    const prior = readToolResult(session, { call_id: source.call_id, offset: source.offset, find: source.find }, visited);
    if (prior.found === false) return prior;
    return readToolResult(session, { call_id: prior.call_id, offset: prior.offset + offset, find });
  }
  const event = originalResults(session).get(call_id);
  if (!event) throw new Error("No tool result with that call_id exists in this session. A shortened result names the file that holds its full text; open that path with read or grep instead.");
  const { content, isError } = event.data.message;
  const points = Array.from(content.filter((block) => block.type === "text")
    .map((block) => block.text).join(""));
  if (offset > points.length) throw new Error(`offset exceeds the result's ${points.length} characters.`);
  if (find) {
    const rest = points.slice(offset).join("");
    const found = rest.indexOf(find);
    if (found < 0) return { call_id, total_chars: points.length, found: false, next_offset: null, text: "" };
    offset += Array.from(rest.slice(0, found)).length;
  }
  const end = Math.min(points.length, offset + TOOL_READ_CHARS);
  return {
    call_id, is_error: Boolean(isError), total_chars: points.length,
    offset, next_offset: end < points.length ? end : null, text: points.slice(offset, end).join("")
  };
}

/** Keep recall available for pre-RC2 receipts. Native retention owns new output. */
export function installContextPolicy(agentCtx) {
  if (typeof agentCtx.on !== "function") return;
  if (installed.has(agentCtx)) return;
  installed.add(agentCtx);
  agentCtx.on("agent/pre-step", async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === "enter") {
      signal.throwIfAborted();
      retireRuntimeContexts(agent.session, decision.messages);
    }
    return decision;
  });
  agentCtx.tools.register(defineTool({
    name: "bees_read_tool_result",
    description: `Read original text shortened in this session's tool history. Returns up to ${TOOL_READ_CHARS} characters; use find for an exact phrase or the returned call_id and next_offset for another page. Reuse a returned page while checking it; offsets count characters, not lines.`,
    parameters: {
      call_id: { type: "string", required: true, description: "Call id in the shortened result." },
      offset: { type: "integer", description: "Character offset; defaults to zero." },
      find: { type: "string", description: "Optional exact phrase to locate at or after offset (max 200 characters)." }
    },
    output: {
      schema: { type: "object", additionalProperties: false,
        properties: { result_json: { type: "string", required: true } } },
      render: (_args, value) => {
        const { text, ...metadata } = JSON.parse(value.result_json);
        return [{ type: "text", text: `${JSON.stringify(metadata)}\n${text}` }];
      }
    },
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error("Tool history requires an agent session.");
      return { result_json: JSON.stringify(readToolResult(exec.agent.session, args)) };
    }
  }));
}
