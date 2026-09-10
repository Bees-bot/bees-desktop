import { freezeMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const TOOL_PREVIEW_CHARS = 2_000;
export const TOOL_RECEIPT_CHARS = 256;
export const TOOL_READ_CHARS = 1_500;
const installed = new WeakSet();
const pendingFlush = new WeakSet();

const textLength = (blocks) => blocks.reduce((sum, block) =>
  sum + (block.type === "text" ? Array.from(block.text).length : 0), 0);

function originalResults(session) {
  const originals = new Map();
  for (const event of session.snapshotEvents()) {
    if (event.type !== "tool/result") continue;
    const id = event.data.message.source.callId;
    if (!originals.has(id)) originals.set(id, event);
  }
  return originals;
}

/** Keep rich blocks in order and a head/tail excerpt, with an explicit recall pointer. */
function previewContent(blocks, budget, callId) {
  const total = textLength(blocks);
  const marker = `\n[Text shortened from ${total} chars. Full result: bees_read_tool_result({"call_id":${JSON.stringify(callId)}})]\n`;
  // Provider call IDs are normally short. Never sever a longer ID just to meet a receipt budget.
  const available = Math.max(0, budget - Array.from(marker).length);
  const head = Math.ceil(available * 0.75);
  const tail = total - (available - head);
  let consumed = 0;
  let marked = false;
  return blocks.flatMap((block) => {
    if (block.type !== "text") return [block];
    const points = Array.from(block.text);
    const start = consumed;
    consumed += points.length;
    const insert = !marked && consumed > head && start < tail;
    if (insert) marked = true;
    const text = points.slice(0, Math.max(0, head - start)).join("") +
      (insert ? marker : "") + points.slice(Math.max(0, tail - start)).join("");
    return text ? [{ ...block, text }] : [];
  });
}

/** Rewrite the DSH surface, never a provider request or the immutable original event. */
export function pruneToolResults(session, tokenMeter) {
  const originals = originalResults(session);
  let laterResponses = 0;
  let pruned = 0;
  let charsRemoved = 0;
  for (const seq of [...session.surface.nodes].reverse()) {
    const event = session.eventAt(seq);
    if (event.type === "assistant/message") { laterResponses++; continue; }
    if (event.type !== "tool/result") continue;
    // The latest two result batches remain readable; older observations become receipts.
    const budget = laterResponses >= 2 ? TOOL_RECEIPT_CHARS : TOOL_PREVIEW_CHARS;
    const result = event.data.message.content[0];
    const before = textLength(result.content);
    if (before <= budget) continue;
    const callId = event.data.message.source.callId;
    const original = originals.get(callId).data.message.content[0];
    const content = previewContent(original.content, budget, callId);
    const after = textLength(content);
    if (after >= before) continue;
    const message = freezeMessage({
      ...event.data.message, content: [{ ...result, content }]
    });
    session.append("compaction/prune", {
      shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq],
      shadowedTokenCount: tokenMeter.estimateMessage(event.data.message)
    });
    session.append("tool/result", { ...event.data, message }, {
      surfaceOp: { op: "replace", start: seq, end: seq }, sourceEventSeqs: [seq]
    });
    pruned++;
    charsRemoved += before - after;
  }
  return { pruned, charsRemoved };
}

/** Read only this session's original tool text. Offsets count Unicode code points. */
export function readToolResult(session, { call_id, offset = 0, find = "" }) {
  if (typeof call_id !== "string" || !call_id || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof find !== "string" || Array.from(find).length > 200)
    throw new Error("Supply a call_id, nonnegative integer offset, and optional find text (up to 200 characters).");
  const event = originalResults(session).get(call_id);
  if (!event) throw new Error("No tool result with that call_id exists in this session.");
  const result = event.data.message.content[0];
  const points = Array.from(result.content.filter((block) => block.type === "text")
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
    call_id, is_error: Boolean(result.isError), total_chars: points.length,
    offset, next_offset: end < points.length ? end : null, text: points.slice(offset, end).join("")
  };
}

/** Installed on each managed agent, including discussion participants and resumed agents.
 *  The meter comes from the plugin context: an agent context may only read what it injects. */
export function installContextPolicy(agentCtx, tokenMeter) {
  if (typeof agentCtx.on !== "function") return;
  if (installed.has(agentCtx)) return;
  installed.add(agentCtx);
  agentCtx.tools.register(defineTool({
    name: "bees_read_tool_result",
    description: "Read original text shortened in this session's tool history. Returns up to 1500 characters; use find for an exact phrase or next_offset for another page.",
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
  agentCtx.on("agent/pre-step", async ({ agent, signal }, next) => {
    if (agent !== agentCtx.agent || signal.aborted) return next();
    const { pruned } = pruneToolResults(agent.session, tokenMeter);
    if (pruned) pendingFlush.add(agent.session);
    if (pendingFlush.has(agent.session)) {
      await agentCtx.sessions.flush(agent.session);
      pendingFlush.delete(agent.session);
    }
    return next();
  }, { prepend: true });
}
