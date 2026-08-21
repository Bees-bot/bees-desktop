import { describe, expect, it } from "vitest";
import {
  browserPageReference,
  isSnapshot,
  conversationToSnapshotV1,
  snapshotText,
  type BeesConversationSnapshotV1
} from "../src/conversation-snapshot.js";
import type { RuntimeEvent } from "../src/runtime.js";

function updates(...chunks: unknown[]): RuntimeEvent {
  return { type: "updates", timestamp: "2026-07-31T10:00:00.000Z", offset: "1", data: chunks };
}

function history(data: unknown): RuntimeEvent {
  return { type: "history", timestamp: "2026-07-31T10:00:00.000Z", offset: "0", data };
}

describe("conversationToSnapshotV1", () => {
  it("coalesces streaming deltas into one part per kind", () => {
    const snapshot = conversationToSnapshotV1([
      updates(
        { type: "message-started", messageId: "m1" },
        { type: "message-delta", messageId: "m1", delta: "Hello " },
        { type: "message-delta", messageId: "m1", delta: "world" }
      )
    ]);
    expect(snapshot.messages).toEqual([
      { id: "m1", role: "assistant", parts: [{ kind: "text", text: "Hello world" }] }
    ]);
  });

  it("keeps reasoning separate from text and starts a new part when the kind changes", () => {
    const snapshot = conversationToSnapshotV1([
      updates(
        { type: "message-delta", messageId: "m1", kind: "reasoning", delta: "thinking" },
        { type: "message-delta", messageId: "m1", delta: "answer" },
        { type: "message-delta", messageId: "m1", kind: "reasoning", delta: " more" }
      )
    ]);
    expect(snapshot.messages[0]?.parts).toEqual([
      { kind: "reasoning", text: "thinking" },
      { kind: "text", text: "answer" },
      { kind: "reasoning", text: " more" }
    ]);
  });

  it("pairs a tool result with its call by toolCallId", () => {
    const snapshot = conversationToSnapshotV1([
      updates(
        { type: "tool-input", messageId: "m1", toolCallId: "c1", toolName: "read", input: { path: "a" } },
        { type: "tool-input", messageId: "m1", toolCallId: "c2", toolName: "write" }
      ),
      updates({ type: "tool-output", toolCallId: "c1", output: "file body" })
    ]);
    expect(snapshot.messages[0]?.parts).toEqual([
      {
        kind: "tool",
        name: "read",
        state: "output-available",
        toolCallId: "c1",
        input: { path: "a" },
        output: "file body"
      },
      { kind: "tool", name: "write", state: "input-available", toolCallId: "c2" }
    ]);
  });

  it("records a tool error as its output with an error state", () => {
    const snapshot = conversationToSnapshotV1([
      updates(
        { type: "tool-input", messageId: "m1", toolCallId: "c1", toolName: "write" },
        { type: "tool-output-error", toolCallId: "c1", errorText: "permission denied" }
      )
    ]);
    expect(snapshot.messages[0]?.parts[0]).toMatchObject({
      state: "output-error",
      output: "permission denied"
    });
  });

  it("replaces prior state on a conversation reset", () => {
    const snapshot = conversationToSnapshotV1([
      updates({ type: "message-delta", messageId: "m1", delta: "stale" }),
      updates({
        type: "conversation-reset",
        snapshot: {
          messages: [{ id: "m9", role: "user", parts: [{ type: "text", text: "fresh" }] }]
        }
      })
    ]);
    expect(snapshot.messages).toEqual([
      { id: "m9", role: "user", parts: [{ kind: "text", text: "fresh" }] }
    ]);
  });

  it("starts from a history snapshot and keeps its message metadata", () => {
    const snapshot = conversationToSnapshotV1([
      history({
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "do the thing" }],
            metadata: { timestamp: "2026-07-31T09:00:00.000Z" }
          }
        ]
      }),
      updates({ type: "message-delta", messageId: "a1", delta: "done" })
    ]);
    expect(snapshot.messages).toEqual([
      {
        id: "u1",
        role: "user",
        timestamp: "2026-07-31T09:00:00.000Z",
        parts: [{ kind: "text", text: "do the thing" }]
      },
      { id: "a1", role: "assistant", parts: [{ kind: "text", text: "done" }] }
    ]);
  });

  it("renders DSH resource signals such as optional MCP degradation", () => {
    const snapshot = conversationToSnapshotV1([
      history({
        messages: [
          {
            id: "signal-1",
            role: "signal",
            type: "resources",
            content: "Optional MCP connection Tasks is unavailable"
          }
        ]
      })
    ]);
    expect(snapshot.messages[0]).toMatchObject({
      role: "system",
      parts: [
        {
          kind: "data",
          name: "resources",
          value: "Optional MCP connection Tasks is unavailable"
        }
      ]
    });
  });

  it("ignores chunks it does not understand", () => {
    const snapshot = conversationToSnapshotV1([
      updates({ type: "compaction-started" }, null, "nonsense")
    ]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.version).toBe(1);
  });
});

describe("browserPageReference", () => {
  it("appears as soon as a browser tool acquires the run's tab", () => {
    const snapshot = conversationToSnapshotV1([
      updates({
        type: "tool-input",
        messageId: "m1",
        toolCallId: "c1",
        toolName: "browser_navigate",
        input: { url: "https://example.com/start" }
      })
    ]);
    expect(browserPageReference(snapshot)).toEqual({ url: "https://example.com/start" });
    expect(browserPageReference(conversationToSnapshotV1([]))).toBeNull();
  });

  it("uses the latest safe page URL and does not expose unsafe schemes", () => {
    const snapshot = conversationToSnapshotV1([
      updates(
        {
          type: "tool-input",
          messageId: "m1",
          toolCallId: "c1",
          toolName: "browser_navigate",
          input: { url: "javascript:alert(1)" }
        },
        {
          type: "tool-output",
          toolCallId: "c1",
          output: { output: { url: "https://example.com/after" } }
        }
      )
    ]);
    expect(browserPageReference(snapshot)).toEqual({ url: "https://example.com/after" });

    const unsafeOnly = conversationToSnapshotV1([
      updates({
        type: "tool-input",
        messageId: "m1",
        toolCallId: "c1",
        toolName: "browser_navigate",
        input: { url: "data:text/html,secret" }
      })
    ]);
    expect(browserPageReference(unsafeOnly)).toEqual({ url: null });
  });
});

describe("snapshotText", () => {
  const snapshot: BeesConversationSnapshotV1 = {
    version: 1,
    capturedAt: "2026-07-31T10:00:00.000Z",
    messages: [
      { id: "u1", role: "user", parts: [{ kind: "text", text: "summarise the invoice" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "reasoning", text: "SECRET CHAIN OF THOUGHT" },
          { kind: "tool", name: "read", state: "output-available", input: { path: "/Users/x/secret" }, output: "PRIVATE" },
          { kind: "file", name: "summary.md" },
          { kind: "text", text: "The invoice totals £400." },
          { kind: "error", text: "model limit reached" }
        ]
      }
    ]
  };

  it("indexes visible text, tool names, and errors", () => {
    expect(snapshotText(snapshot)).toBe(
      ["summarise the invoice", "[tool: read]", "The invoice totals £400.", "model limit reached"].join("\n")
    );
  });

  it("excludes reasoning, tool arguments, tool results, and local paths", () => {
    const projection = snapshotText(snapshot);
    for (const secret of ["SECRET CHAIN OF THOUGHT", "PRIVATE", "/Users/x/secret"]) {
      expect(projection).not.toContain(secret);
    }
  });
});

describe("isSnapshot", () => {
  it("accepts a stored snapshot and rejects anything else", () => {
    expect(isSnapshot({ version: 1, capturedAt: "", messages: [] })).toBe(true);
    expect(isSnapshot({ version: 2, messages: [] })).toBe(false);
    expect(isSnapshot({ messages: [] })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot("[]")).toBe(false);
  });
});
