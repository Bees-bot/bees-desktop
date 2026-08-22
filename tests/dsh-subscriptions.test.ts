import { describe, expect, it } from "vitest";
// @ts-expect-error The local DSH plugin is authored as runtime JavaScript.
import { claudeChunks, claudeProtocolMode, claudeResponseSchema } from "../dsh-runtime/plugins/subscriptions/lib/index.js";

describe("Claude Code DSH tool bridge", () => {
  it("requires and emits the automatic stage result as a DSH tool call", () => {
    const tools = [{
      name: "bees_submit_stage_result",
      description: "Finish the stage",
      parameters: { type: "object" }
    }];
    const schema = claudeResponseSchema(tools, "tool") as any;
    expect(schema.properties.tool.enum).toEqual(["bees_submit_stage_result"]);

    const chunks = claudeChunks({
      structured: {
        tool: "bees_submit_stage_result",
        arguments: { outcome: "candidate", summary: "Checks pass" },
        text: ""
      },
      usage: { input_tokens: 10, output_tokens: 4 }
    }, tools) as any[];
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "block-end",
      block: expect.objectContaining({
        type: "tool-call",
        name: "bees_submit_stage_result",
        arguments: JSON.stringify({ outcome: "candidate", summary: "Checks pass" })
      })
    }));
    expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } });

    const mode = claudeProtocolMode({
      tools,
      messages: [
        { role: "assistant", content: [{
          type: "tool-call", id: "call-1", name: "bees_submit_stage_result", arguments: "{}"
        }] },
        { role: "user", content: [{
          type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "ok" }]
        }] }
      ]
    });
    expect(mode).toBe("finish");
    expect((claudeResponseSchema(tools, mode) as any).properties.tool.enum).toEqual([""]);
  });
});
