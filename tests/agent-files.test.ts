import { describe, expect, it } from "vitest";
import { AgentFileStore, newAgent, type AgentFilePort } from "../src/agent-files.js";

function port(): AgentFilePort {
  return {
    list: async () => [],
    write: async () => undefined,
    remove: async () => undefined,
    writeSkill: async () => "",
    archiveSkill: async () => ""
  };
}

describe("agent files", () => {
  const agent = newAgent({ name: "Researcher", purpose: "Researches games" });

  it("requires instructions when an agent is saved", async () => {
    await expect(new AgentFileStore(port()).save("/team", agent)).rejects.toThrow(
      "Agent instructions are required"
    );
  });

  it("allows an incomplete agent only while it is first created", async () => {
    await expect(new AgentFileStore(port()).save("/team", agent, true)).resolves.toMatchObject({
      config: { prompt: "" }
    });
  });
});
