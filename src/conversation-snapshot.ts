import { object } from "./model-json.js";
import type { RuntimeEvent } from "./runtime.js";

/**
 * The one conversation shape the UI renders. Flue SDK message parts reduce into it as a
 * receipt and offline search projection. It is never model context or fed back into Flue.
 */
export interface BeesConversationSnapshotV1 {
  version: 1;
  capturedAt: string;
  messages: SnapshotMessage[];
}

export interface SnapshotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  timestamp?: string;
  parts: SnapshotPart[];
}

export type SnapshotPart =
  | { kind: "text" | "reasoning" | "error"; text: string }
  | {
      kind: "tool";
      name: string;
      state: ToolState;
      /** Pairs a result with its call; results arrive in a later chunk, sometimes a later message. */
      toolCallId?: string;
      input?: unknown;
      output?: unknown;
    }
  | { kind: "file"; name: string; receiptAttachmentId?: string; mimeType?: string }
  | { kind: "data"; name: string; value: unknown };

export type ToolState = "input-available" | "output-available" | "output-error";

const ROLES = ["user", "assistant", "system"];


function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Last thing the agent said — the summary a reviewer needs before approving. */
export function lastAssistantText(snapshot: BeesConversationSnapshotV1 | null): string {
  for (const message of [...(snapshot?.messages ?? [])].reverse()) {
    if (message.role !== "assistant") continue;
    const value = message.parts
      .flatMap((part) => part.kind === "text" ? [part.text] : [])
      .join("\n")
      .trim();
    if (value) return value;
  }
  return "";
}

/**
 * Normalise a settled receipt. Rust writes the raw Flue conversation
 * (`{ v: 1, messages, settlements }`); the UI reduces it without needing the sidecar.
 */
export function storedConversation(value: unknown): BeesConversationSnapshotV1 | null {
  if (isSnapshot(value)) return value;
  const raw = object(value);
  if (raw.v !== 1 || !Array.isArray(raw.messages)) return null;
  return conversationToSnapshotV1([
    { type: "history", timestamp: new Date().toISOString(), offset: null, data: raw }
  ]);
}

/** Guard for snapshot JSON read back out of SQLite, which may predate any field. */
export function isSnapshot(value: unknown): value is BeesConversationSnapshotV1 {
  const raw = object(value);
  return raw.version === 1 && Array.isArray(raw.messages);
}

function snapshotPart(value: unknown): SnapshotPart | null {
  const part = object(value);
  if (part.type === "text" || part.type === "reasoning") {
    return { kind: part.type, text: text(part.text) };
  }
  if (part.type === "dynamic-tool" || part.type === "tool") {
    return {
      kind: "tool",
      name: text(part.toolName) || text(part.name) || "tool",
      state: toolState(part.state),
      ...(part.input === undefined ? {} : { input: part.input }),
      ...(part.output === undefined ? {} : { output: part.output })
    };
  }
  if (part.type === "file") {
    return {
      kind: "file",
      name: text(part.filename) || text(part.name) || "file",
      ...(part.mediaType ? { mimeType: text(part.mediaType) } : {})
    };
  }
  if (part.type === "data" || part.type === "data-part") {
    return { kind: "data", name: text(part.name) || "data", value: part.value ?? part.data };
  }
  return null;
}

function toolState(value: unknown): ToolState {
  return value === "output-available" || value === "output-error" ? value : "input-available";
}

function snapshotMessage(value: unknown, index: number): SnapshotMessage | null {
  const raw = object(value);
  if (raw.role === "signal") {
    return {
      id: text(raw.id) || `signal-${index}`,
      role: "system",
      parts: [
        {
          kind: "data",
          name: text(raw.type) || "runtime notice",
          value: text(raw.content) || raw
        }
      ],
      ...(typeof raw.timestamp === "string" ? { timestamp: raw.timestamp } : {})
    };
  }
  if (!ROLES.includes(String(raw.role))) return null;
  const timestamp = text(object(raw.metadata).timestamp) || text(raw.timestamp);
  return {
    id: text(raw.id) || `${String(raw.role)}-${index}`,
    role: raw.role as SnapshotMessage["role"],
    parts: (Array.isArray(raw.parts) ? raw.parts : [])
      .map(snapshotPart)
      .filter((part): part is SnapshotPart => Boolean(part)),
    ...(timestamp ? { timestamp } : {})
  };
}

function snapshotMessages(value: unknown): SnapshotMessage[] | null {
  const raw = object(value);
  if (!Array.isArray(raw.messages)) return null;
  return raw.messages
    .map(snapshotMessage)
    .filter((message): message is SnapshotMessage => Boolean(message));
}

/**
 * A run of same-kind streaming deltas coalesces into one part; a kind change starts another.
 */
function appendDelta(message: SnapshotMessage, kind: "text" | "reasoning", delta: string): void {
  const last = message.parts.at(-1);
  if (last?.kind === kind) last.text += delta;
  else message.parts.push({ kind, text: delta });
}

function assistantMessage(
  messages: SnapshotMessage[],
  id: string,
  timestamp: unknown
): SnapshotMessage {
  const existing = messages.find((message) => message.id === id);
  if (existing) return existing;
  const message: SnapshotMessage = {
    id,
    role: "assistant",
    parts: [],
    ...(text(timestamp) ? { timestamp: text(timestamp) } : {})
  };
  messages.push(message);
  return message;
}

/** Pairs a tool result with its call. `toolCallId` is the only reliable link across messages. */
function settleTool(
  messages: SnapshotMessage[],
  toolCallId: unknown,
  settle: (part: Extract<SnapshotPart, { kind: "tool" }>) => void
): void {
  const id = text(toolCallId);
  for (const message of [...messages].reverse()) {
    const part = message.parts.find(
      (candidate): candidate is Extract<SnapshotPart, { kind: "tool" }> =>
        candidate.kind === "tool" && candidate.toolCallId === id
    );
    if (part) return settle(part);
  }
}

function applyChunk(messages: SnapshotMessage[], value: unknown): SnapshotMessage[] {
  const chunk = object(value);
  if (chunk.type === "conversation-reset") {
    return snapshotMessages(object(chunk.snapshot)) ?? messages;
  }
  if (chunk.type === "message-appended") {
    const message = snapshotMessage(chunk.message, messages.length);
    if (!message) return messages;
    const index = messages.findIndex(({ id }) => id === message.id);
    if (index < 0) messages.push(message);
    else messages[index] = message;
    return messages;
  }
  const messageId = text(chunk.messageId);
  if (chunk.type === "message-started" && messageId) {
    assistantMessage(messages, messageId, chunk.timestamp);
  } else if (chunk.type === "message-delta" && messageId && typeof chunk.delta === "string") {
    appendDelta(
      assistantMessage(messages, messageId, chunk.timestamp),
      chunk.kind === "reasoning" ? "reasoning" : "text",
      chunk.delta
    );
  } else if (chunk.type === "tool-input" && messageId) {
    const message = assistantMessage(messages, messageId, chunk.timestamp);
    message.parts.push({
      kind: "tool",
      name: text(chunk.toolName) || "tool",
      state: "input-available",
      toolCallId: text(chunk.toolCallId),
      ...(chunk.input === undefined ? {} : { input: chunk.input })
    });
  } else if (chunk.type === "tool-output") {
    settleTool(messages, chunk.toolCallId, (part) => {
      part.output = chunk.output;
      part.state = "output-available";
    });
  } else if (chunk.type === "tool-output-error") {
    settleTool(messages, chunk.toolCallId, (part) => {
      part.output = text(chunk.errorText);
      part.state = "output-error";
    });
  } else if (chunk.type === "data-part" && messageId) {
    // Flue 2 `useDataWriter` output: typed progress the run page renders as cards.
    assistantMessage(messages, messageId, chunk.timestamp).parts.push({
      kind: "data",
      name: text(chunk.name) || "data",
      value: chunk.data
    });
  } else if (chunk.type === "submission-settled" && chunk.outcome !== "completed") {
    // The terminal advisory: render a failed or aborted turn structurally rather than
    // leaving the conversation looking like it simply stopped.
    const message = assistantMessage(messages, `settlement-${text(chunk.submissionId)}`, chunk.timestamp);
    message.parts.push({
      kind: "error",
      text:
        text(object(chunk.error).message) ||
        (chunk.outcome === "aborted" ? "The run was stopped." : "The run failed.")
    });
  } else if (chunk.type === "error") {
    const message = assistantMessage(messages, messageId || `error-${messages.length}`, chunk.timestamp);
    message.parts.push({ kind: "error", text: text(chunk.errorText) || text(chunk.message) });
  }
  return messages;
}

/**
 * Reduces Flue 2 `ConversationStreamChunk` events and `history()` snapshots into a receipt.
 */
export function conversationToSnapshotV1(
  events: RuntimeEvent[],
  capturedAt = new Date().toISOString()
): BeesConversationSnapshotV1 {
  let messages: SnapshotMessage[] = [];
  for (const event of events) {
    if (event.type === "history") {
      messages = snapshotMessages(event.data) ?? messages;
      continue;
    }
    for (const chunk of Array.isArray(event.data) ? event.data : [event.data]) {
      messages = applyChunk(messages, chunk);
    }
  }
  return { version: 1, capturedAt, messages };
}

/**
 * The searchable/exportable projection. Deliberately lossy: hidden reasoning, tool arguments
 * and results, local paths, and attachment bytes stay out of it — a run's plain text is
 * indexed and exported, its internals are not.
 */
export function snapshotText(snapshot: BeesConversationSnapshotV1): string {
  return snapshot.messages
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.kind === "text" || part.kind === "error") return part.text.trim() || [];
        if (part.kind === "tool") return `[tool: ${part.name}]`;
        return [];
      })
    )
    .join("\n")
    .trim();
}
