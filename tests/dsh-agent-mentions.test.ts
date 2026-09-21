import { describe, expect, it } from "vitest";
// @ts-expect-error Client modules are plain JavaScript.
import { agentMentionOptions, agentTag, mentionedRecipient } from "../dsh-runtime/plugin/client/conversation-model.js";

describe("chat agent mentions", () => {
  const options = [{ id: "qa-work", name: "QA Agent", tag: "qa-agent" }];

  it("normalizes names and routes only known leading tags", () => {
    expect(agentTag("QA Agent")).toBe("qa-agent");
    expect(mentionedRecipient("$QA-Agent test offline mode", options)).toEqual({
      recipient: options[0], body: "test offline mode"
    });
    expect(mentionedRecipient("Ask $qa-agent later", options)).toBeNull();
    expect(mentionedRecipient("$unknown keep this in normal chat", options)).toBeNull();
  });

  it("suggests assigned agents before their peer work items exist", () => {
    expect(agentMentionOptions(["qa"], [{ id: "qa", name: "QA Agent" }], [])).toContainEqual({
      id: "qa", targetId: null, name: "QA Agent", tag: "qa-agent", status: "assigned"
    });
    expect(agentMentionOptions(["qa"], [{ id: "qa", name: "QA Agent" }], [
      { id: "qa-work", agentId: "qa", title: "Test offline", status: "running" }
    ])).toContainEqual({ id: "qa", targetId: "qa-work", name: "QA Agent", tag: "qa-agent", status: "running" });
  });
});
