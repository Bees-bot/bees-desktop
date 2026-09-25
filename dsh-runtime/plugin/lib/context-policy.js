import { defineTool } from "@deepseek-ai/dsh-tools";

export const TOOL_READ_CHARS = 6_000;
const installed = new WeakSet();

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
  if (!event) throw new Error("No tool result with that call_id exists in this session.");
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
