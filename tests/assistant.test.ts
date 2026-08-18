import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  applyActions,
  assistantInstanceId,
  AUTO_MODEL_CHOICE,
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
import { DEFAULT_CODEX_MODEL_ID, type LocalModelView } from "../src/local-models.js";
import { NodeDatabase } from "./node-database.js";

const agentSource = readFileSync(
  fileURLToPath(new URL("../flue-runtime/project/.flue/agents/bees-assistant.ts", import.meta.url)),
  "utf8"
);
const appActionsSource = readFileSync(
  fileURLToPath(new URL("../src/app-actions.ts", import.meta.url)),
  "utf8"
);

describe("assistant contract", () => {
  it("resolves Overview Auto selection before submitting to Flue", () => {
    expect(appActionsSource).toContain(
      "await pickAssistantModel(preferredModelChoice(host.assistant.assistantCatalog))"
    );
    expect(appActionsSource).not.toContain("rememberModelChoice(AUTO_MODEL_CHOICE)");
  });

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

  it("resolves Auto to an available model before encoding the instance id", () => {
    const catalog = modelCatalog({
      local: [],
      connections: [
        { id: "available", provider: "anthropic", label: "Available", createdAt: "", secretRef: "s" }
      ],
      cliInstalled: {},
      extras: []
    });
    const id = assistantInstanceId("team", AUTO_MODEL_CHOICE, catalog);
    const hex = id.split("--")[1]!;
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe("anthropic/claude-opus-5");
  });
});

describe("parsing a turn", () => {
  it("reads actions out of a fenced, chatty answer", () => {
    const turn = parseTurn(
      'Sure! Here you go:\n```json\n{"reply":"Made it.","actions":[{"type":"create_process","name":"Onboarding","description":"New hires","stages":["Draft","Review","Done"]}]}\n```\nHope that helps.'
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
        '{"reply":"I can do that in Bees.","actions":[{"type":"operate_bees","goal":"Create a private workspace called Acme"}]}'
      ).actions
    ).toEqual([{ type: "operate_bees", goal: "Create a private workspace called Acme" }]);
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

    const moved: Array<[string, string]> = [];
    const { applied, errors } = await applyActions(resolved, {
      repository,
      teamId: local.teamId,
      moveWorkItem: async (itemId, stageId) => { moved.push([itemId, stageId]); },
      operateBees: async () => {
        throw new Error("no Bees operation expected");
      },
      saveAgent: async () => {
        throw new Error("no agent expected");
      }
    });
    expect(errors).toEqual([]);
    expect(applied).toBe(1);
    expect(moved.map(([itemId]) => itemId).sort()).toEqual(
      resolved[0]!.items.map(({ id }) => id).sort()
    );
    expect(moved.every(([, stageId]) => stageId === resolved[0]!.targetStageId)).toBe(true);
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
      cliInstalled: { claude: { enabled: true } },
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

  it("prefers connected Codex and offers explicitly configured Claude", () => {
    const local = [
      localModel("small", "ready", "Small 3B"),
      localModel("large", "ready", "Large 70B")
    ];
    const catalog = (cliInstalled: Record<string, { enabled: boolean }>) =>
      modelCatalog({
        local,
        connections: [{
          id: "codex",
          provider: "openai-codex",
          label: "Codex",
          createdAt: "",
          secretRef: "oauth"
        }],
        cliInstalled,
        extras: []
      });

    expect(preferredModelChoice(catalog({ claude: { enabled: true } }))).toMatchObject({
      provider: "openai-codex"
    });
    expect(catalog({ claude: { enabled: true } }).some(
      ({ choice }) => choice.provider === "claude-cli"
    )).toBe(true);
    expect(catalog({ claude: { enabled: false } }).some(
      ({ choice }) => choice.provider === "claude-cli"
    )).toBe(false);
  });

  it("keeps connected remote models available beside connected Codex", () => {
    const catalog = modelCatalog({
      local: [],
      connections: [
        { id: "0", provider: "openai-codex", label: "Codex", createdAt: "", secretRef: "oauth" },
        { id: "1", provider: "anthropic", label: "Anthropic", createdAt: "", secretRef: "s" }
      ],
      cliInstalled: {},
      extras: []
    });
    expect(catalog.some(({ choice }) =>
      choice.provider === "anthropic" && choice.model === "claude-opus-5"
    )).toBe(true);
    expect(preferredModelChoice(catalog)).toMatchObject({
      provider: "openai-codex"
    });
    expect(preferredModelChoice(catalog.filter(({ choice }) => choice.provider !== "openai-codex"))).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5"
    });
  });

  it("resolves an Auto stage against this machine, not against the global choice", () => {
    const latest = { provider: "anthropic", model: "claude-sonnet-5" };
    const catalog = modelCatalog({
      local: [localModel("large", "ready", "Large 70B")],
      connections: [],
      cliInstalled: { claude: { enabled: true } },
      extras: []
    });
    expect(resolveModelChoice(AUTO_MODEL_CHOICE, latest, catalog)).toMatchObject({
      provider: "claude-cli",
      model: "default"
    });
    // Nothing installed yet: Auto has nothing to pick from, so the global choice still applies.
    expect(resolveModelChoice(AUTO_MODEL_CHOICE, latest, [])).toBe(latest);
    expect(
      effectiveAgentEligibility(
        { name: "Auto agent", config: { prompt: "Work.", ...AUTO_MODEL_CHOICE } },
        latest,
        true,
        { localModelIds: [], connectedProviders: [], cliProviders: ["claude-cli"] },
        catalog
      )
    ).toMatchObject({ active: true, model: { provider: "claude-cli" } });
  });

  it("resolves active through the latest choice but leaves named models pinned", () => {
    const latest = { provider: "openai-codex", model: "gpt-5.4" };
    expect(resolveModelChoice({ provider: "bees-local", model: "active" }, latest)).toBe(latest);
    expect(resolveModelChoice({}, latest)).toBe(latest);
    expect(
      resolveModelChoice({ provider: "anthropic", model: "claude-sonnet-5" }, latest)
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("keeps agents saved with the retired Codex CLI provider runnable", () => {
    const latest = { provider: "bees-local", model: "active" };
    expect(resolveModelChoice({ provider: "codex-cli", model: "default" }, latest)).toEqual({
      provider: "openai-codex",
      model: DEFAULT_CODEX_MODEL_ID
    });
    expect(
      effectiveAgentEligibility(
        { name: "Old Codex agent", config: { prompt: "Work.", provider: "codex-cli", model: "default" } },
        latest,
        true,
        { localModelIds: [], connectedProviders: [], cliProviders: [] }
      )
    ).toMatchObject({ active: false, reason: "Connect Codex (ChatGPT) on this machine" });
  });

  it("combines the local switch with model availability", () => {
    const videoAgent = {
      name: "Video agent",
      config: { prompt: "Make video.", provider: "openai", model: "video-1" }
    };
    const availability = {
      localModelIds: ["local-1"],
      connectedProviders: ["openai"],
      cliProviders: []
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
