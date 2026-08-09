import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  applyActions,
  assistantInstanceId,
  contextPrompt,
  effectiveAgentEligibility,
  modelCatalog,
  parseTurn,
  parseBeesUiCommand,
  preferredModelChoice,
  resolveModelChoice,
  resolveActions
} from "../src/assistant.js";
import { LocalRepository } from "../src/repository.js";
import type { LocalModelView } from "../src/local-models.js";
import { NodeDatabase } from "./node-database.js";

const agentSource = readFileSync(
  fileURLToPath(new URL("../flue-runtime/project/.flue/agents/bees-assistant.ts", import.meta.url)),
  "utf8"
);

describe("assistant contract", () => {
  it("keeps the bundled agent's instructions in step with the parser", () => {
    for (const type of ACTION_TYPES) {
      expect(agentSource, `${type} is missing from the agent instructions`).toContain(
        `"type":"${type}"`
      );
    }
    expect(agentSource).toContain('one create_item in the "Goals" process at the "Plan" status');
    expect(agentSource).toContain("Never perform external work from this dashboard assistant");
  });

  // The separator has to survive dashes on both sides of it: "bees-assistant" on the left and a
  // team UUID on the right.
  it("encodes the model into an instance id the agent can split back out", () => {
    const id = assistantInstanceId("2f1c9d0e-6a4b-4f00-9c31-8a1b2c3d4e5f", {
      provider: "anthropic",
      model: "claude-opus-5"
    });
    const hex = id.split("--")[1]!;
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe("anthropic/claude-opus-5");
    expect(id.split("--")[2]).toBe("2f1c9d0e-6a4b-4f00-9c31-8a1b2c3d4e5f");
  });
});

describe("parsing a turn", () => {
  it("reads actions out of a fenced, chatty answer", () => {
    const turn = parseTurn(
      'Sure! Here you go:\n```json\n{"reply":"Made it.","actions":[{"type":"create_process","name":"Onboarding","description":"New hires","stages":["Draft","Review","Done"],"terminalStages":["Done"]}]}\n```\nHope that helps.'
    );
    expect(turn.reply).toBe("Made it.");
    expect(turn.actions).toHaveLength(1);
  });

  it("treats unparseable output as prose rather than failing", () => {
    const turn = parseTurn("I am not going to answer in JSON today.");
    expect(turn.actions).toEqual([]);
    expect(turn.reply).toContain("not going to answer");
  });

  it("drops actions with an unknown type or a missing field", () => {
    const turn = parseTurn(
      '{"reply":"x","actions":[{"type":"delete_everything","process":"P"},{"type":"create_item","process":"P"},{"type":"set_status","process":"P","status":"nope"}]}'
    );
    expect(turn.actions).toEqual([]);
  });

  it("parses generic approved Bees operations and only opaque UI refs", () => {
    expect(
      parseTurn(
        '{"reply":"I can do that in Bees.","actions":[{"type":"operate_bees","goal":"Create a local organization called Acme"}]}'
      ).actions
    ).toEqual([{ type: "operate_bees", goal: "Create a local organization called Acme" }]);
    expect(parseBeesUiCommand('{"command":{"op":"click","ref":"u3"}}')).toEqual({
      op: "click",
      ref: "u3"
    });
    expect(
      parseBeesUiCommand('{"command":{"op":"click","selector":"[data-action=delete-org]"}}')
    ).toBeNull();
  });
});

describe("resolving against real data", () => {
  it("selects the exact items a bulk action would touch and rejects unknown names", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const processId = await repository.createProcess(local.teamId, {
      name: "Content",
      description: "",
      stages: [
        { name: "Draft", isTerminal: false },
        { name: "Review", isTerminal: false },
        { name: "Done", isTerminal: true }
      ]
    });
    const process = (await repository.listProcesses(local.teamId)).find(
      ({ id }) => id === processId
    )!;
    const review = process.stages.find(({ name }) => name === "Review")!;
    const draft = process.stages.find(({ name }) => name === "Draft")!;
    await repository.createWorkItem(processId, { stageId: review.id, title: "Post one" });
    await repository.createWorkItem(processId, { stageId: review.id, title: "Post two" });
    await repository.createWorkItem(processId, { stageId: draft.id, title: "Post three" });
    const items = await repository.listTeamWorkItems(local.teamId);

    const resolved = resolveActions(
      [
        { type: "move_items", process: "content", fromStage: "Review", toStage: "Done" },
        { type: "move_items", process: "Nowhere", fromStage: "Review", toStage: "Done" },
        { type: "move_items", process: "Content", fromStage: "Draft", toStage: "Ghost" }
      ],
      [process],
      items
    );

    // Sorted: items created in the same millisecond tie, so list order is not deterministic.
    expect(resolved[0]!.items.map(({ title }) => title).sort()).toEqual(["Post one", "Post two"]);
    expect(resolved[0]!.error).toBeUndefined();
    expect(resolved[1]!.error).toContain("No process");
    expect(resolved[2]!.error).toContain("Ghost");

    const { applied, errors } = await applyActions(resolved, {
      repository,
      teamId: local.teamId,
      operateBees: async () => {
        throw new Error("no Bees operation expected");
      },
      saveAgent: async () => {
        throw new Error("no agent expected");
      }
    });
    expect(errors).toEqual([]);
    expect(applied).toBe(1);
    const after = await repository.listTeamWorkItems(local.teamId);
    expect(after.filter(({ isTerminal }) => isTerminal).map(({ title }) => title).sort()).toEqual([
      "Post one",
      "Post two"
    ]);
    // The erroring actions changed nothing.
    expect(after.find(({ title }) => title === "Post three")!.stageId).toBe(draft.id);
  });

  it("runs a generic Bees operation only through the approved apply path", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals: string[] = [];
    const resolved = resolveActions(
      [{ type: "operate_bees", goal: "Download the Qwen local model" }],
      [],
      []
    );

    expect(resolved[0]).toMatchObject({
      summary: "Operate Bees: Download the Qwen local model"
    });
    expect(goals).toEqual([]);

    const result = await applyActions(resolved, {
      repository,
      teamId: local.teamId,
      operateBees: async (goal) => {
        goals.push(goal);
      },
      saveAgent: async () => {
        throw new Error("no agent expected");
      }
    });
    expect(result).toEqual({ applied: 1, errors: [] });
    expect(goals).toEqual(["Download the Qwen local model"]);
  });

  it("creates external work in the default Goals plan after approval", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const goals = (await repository.listProcesses(local.teamId)).find(
      ({ name }) => name === "Goals"
    )!;
    const plan = goals.stages.find(({ name }) => name === "Plan")!;
    const resolved = resolveActions(
      [
        {
          type: "create_item",
          process: "Goals",
          stage: "Plan",
          title: "Download latest billing invoice",
          description: "Find and download the latest invoice from the billing portal."
        }
      ],
      [goals],
      []
    );

    const result = await applyActions(resolved, {
      repository,
      teamId: local.teamId,
      operateBees: async () => {
        throw new Error("external work must not run in the dashboard");
      },
      saveAgent: async () => {
        throw new Error("no agent expected");
      }
    });

    expect(result).toEqual({ applied: 1, errors: [] });
    expect(await repository.listWorkItems(goals.id)).toEqual([
      expect.objectContaining({
        stageId: plan.id,
        title: "Download latest billing invoice"
      })
    ]);
  });

  it("never puts work items in the prompt", async () => {
    const repository = new LocalRepository(new NodeDatabase());
    const local = await repository.bootstrap();
    const processId = await repository.createProcess(local.teamId, {
      name: "Content",
      description: "",
      stages: [{ name: "Draft", isTerminal: false }]
    });
    const process = (await repository.listProcesses(local.teamId)).find(
      ({ id }) => id === processId
    )!;
    await repository.createWorkItem(processId, {
      stageId: process.stages[0]!.id,
      title: "Secret item title"
    });
    const prompt = contextPrompt({
      processes: [process],
      items: await repository.listTeamWorkItems(local.teamId),
      agents: []
    });
    expect(prompt).not.toContain("Secret item title");
    expect(prompt).toContain('"Draft"');
    expect(prompt).toContain("1 item");
  });
});

describe("model catalog", () => {
  const localModel = (
    id: string,
    state: LocalModelView["runtime"]["state"],
    name = id
  ): LocalModelView => ({
    id,
    name,
    fileName: `${id}.gguf`,
    bytes: 1,
    runtime: {
      modelId: id,
      state,
      downloadedBytes: 0,
      totalBytes: 1,
      running: state === "running"
    }
  });

  it("lists downloaded local models without starting them", () => {
    const catalog = modelCatalog({
      local: [localModel("ready-one", "ready"), localModel("missing", "not-downloaded")],
      connections: [
        {
          id: "1",
          provider: "anthropic",
          label: "Anthropic",
          createdAt: "",
          secretRef: "secret-1"
        }
      ],
      cliInstalled: { claude: "/usr/local/bin/claude" },
      extras: [{ provider: "openrouter", model: "some/model" }]
    });
    const labels = catalog.map(({ label }) => label);
    expect(labels).toContain("ready-one");
    expect(labels).not.toContain("missing");
    expect(catalog.find(({ label }) => label === "ready-one")?.choice).toMatchObject({
      provider: "bees-local",
      model: "ready-one"
    });
    expect(catalog.find(({ label }) => label === "ready-one")?.note).toBe("not running");
    expect(labels).toContain("claude-opus-5");
    expect(labels).toContain("some/model");
    // No OpenAI key stored, so nothing from OpenAI is offered.
    expect(catalog.some(({ choice }) => choice.provider === "openai")).toBe(false);
  });

  it("defaults to Codex, then Claude, then the largest downloaded local model", () => {
    const local = [
      localModel("small", "ready", "Small 3B"),
      localModel("large", "ready", "Large 70B")
    ];
    const catalog = (cliInstalled: Record<string, string>) =>
      modelCatalog({ local, connections: [], cliInstalled, extras: [] });

    expect(preferredModelChoice(catalog({ codex: "/codex", claude: "/claude" }))).toMatchObject({
      provider: "codex-cli",
      model: "default"
    });
    expect(preferredModelChoice(catalog({ claude: "/claude" }))).toMatchObject({
      provider: "claude-cli",
      model: "default"
    });
    expect(preferredModelChoice(catalog({}))).toMatchObject({ localModelId: "large" });
  });

  it("resolves active through the latest choice but leaves named models pinned", () => {
    const latest = { provider: "codex-cli", model: "default" };
    expect(resolveModelChoice({ provider: "bees-local", model: "active" }, latest)).toBe(latest);
    expect(resolveModelChoice({}, latest)).toBe(latest);
    expect(
      resolveModelChoice({ provider: "anthropic", model: "claude-sonnet-5" }, latest)
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("combines the local switch with model availability", () => {
    const videoAgent = {
      name: "Video agent",
      config: { prompt: "Make video.", provider: "openai", model: "video-1" }
    };
    const availability = {
      localModelIds: ["local-1"],
      connectedProviders: ["openai"],
      cliProviders: ["codex-cli"]
    };

    expect(
      effectiveAgentEligibility(videoAgent, { provider: "openai", model: "video-1" }, false, availability)
    ).toMatchObject({ active: false, reason: "Disabled on this machine" });
    expect(
      effectiveAgentEligibility(videoAgent, { provider: "openai", model: "video-1" }, true, availability)
    ).toMatchObject({ active: true });
    expect(
      effectiveAgentEligibility(videoAgent, { provider: "openai", model: "video-1" }, true, {
        ...availability,
        connectedProviders: []
      }).reason
    ).toContain("Connect OpenAI");
    const localAgent = {
      name: "Local agent",
      config: { prompt: "Work.", provider: "bees-local", model: "local-1" }
    };
    expect(
      effectiveAgentEligibility(localAgent, { provider: "openai", model: "video-1" }, true, availability)
        .active
    ).toBe(true);
    expect(
      effectiveAgentEligibility(localAgent, { provider: "openai", model: "video-1" }, true, {
        ...availability,
        localModelIds: []
      })
    ).toMatchObject({ active: false, reason: 'Local model "local-1" is not running on this machine' });
  });
});
