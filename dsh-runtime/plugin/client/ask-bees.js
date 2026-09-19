import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button, useSubmit } from "./shared.js";
import { AgentCreateForm, AgentEditForm, runAgents, useMcpPreflight } from "./agents.js";
import { ProcessRoutingBoard } from "./processes.js";
import { inheritedInputs, ResourceFields } from "./location-fields.js";

export function workFromOutcome(outcome, target, resources = {}) {
  const description = outcome.trim();
  return { action: target.processId ? "create_item" : "create_goal", ...target,
    title: description.split("\n")[0], description, ...resources };
}

export function AskBeesSetup({ ctx, data, workspaceId, outcome, onOutcome, act, onBack, onStarted,
  capabilities }) {
  const [error, setError] = useState("");
  const [processId, setProcessId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [creatingStageId, setCreatingStageId] = useState("");
  const [inputLocationIds, setInputLocationIds] = useState([]);
  const [outputLocationId, setOutputLocationId] = useState("");
  const heading = useRef(null);
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;
  const team = data.teams.find(({ id }) => id === teamId);
  const allowed = ["admin", "member"].includes(team?.role);
  const processes = data.processes.filter((row) => row.workspaceId === workspaceId && !row.archivedAt);
  const process = processes.find(({ id }) => id === processId) ?? processes.find(({ kind }) => kind === "goals");
  const stages = data.stages.filter((row) => row.processId === process?.id);
  const agents = data.assignments.filter((row) => row.workspaceId === workspaceId);
  const selectedAgent = agents.find(({ id }) => id === selectedAgentId);
  const creatingStage = stages.find(({ id }) => id === creatingStageId);
  const servers = capabilities.data?.servers ?? [];
  const tools = capabilities.data?.tools ?? [];
  const catalog = capabilities.data?.catalog ?? [];
  const defaultOutput = data.locations.find(({ id }) => id === process?.outputLocationId);
  const agentInputs = runAgents(stages, agents).flatMap(({ id }) => inheritedInputs(data, null, id));
  const [guardRun, preflight] = useMcpPreflight({ ctx, data, workspaceId, capabilities });

  useEffect(() => heading.current?.focus(), []);

  const [busy, submit] = useSubmit(async () => {
    if (!allowed || !process || selectedAgent || creatingStage || !outcome.trim()) return;
    setError("");
    const target = process.kind === "goals" ? { workspaceId } : { processId: process.id };
    // the preflight may hold this back and run it once the person has added what is missing
    await guardRun(process.id, async () => {
      try {
        const result = await act(workFromOutcome(outcome, target, { inputLocationIds, outputLocationId }));
        if (result?.id) onStarted(result.id);
        else setError("Could not start this work. Please try again.");
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    });
  });

  return h("div", { className: "bees-ask-setup" },
    preflight,
    h("div", null,
      h(Button, { onClick: onBack, disabled: busy }, "← Back to Home"),
      h("header", { className: "bees-ask-heading" },
        h("span", { className: "bees-muted" }, `ASK BEES · ${team?.name ?? "Choose a team"}`),
        h("h1", { ref: heading, tabIndex: -1 }, "Configure advanced"),
        h("p", { className: "bees-muted" }, "Choose a process, review its agents, and add files.")),
      h("fieldset", { disabled: busy || !allowed, className: "bees-stack", style: { padding: 0, border: "none", margin: 0, minWidth: 0 } },
        h("form", { id: "bees-ask-run", className: "bees-box bees-form", onSubmit: submit },
          h("span", { className: "bees-ask-step" }, "1 · Process"),
          h("label", null, "Process",
            h("select", { className: "bees-select", name: "processId", required: true, value: process?.id ?? "",
              onChange: (event) => { setProcessId(event.target.value); setSelectedAgentId(""); setCreatingStageId(""); } },
              !process ? h("option", { value: "" }, "Choose a process") : null,
              ...processes.map((row) => h("option", { key: row.id, value: row.id }, row.kind === "goals" ? `${row.name ?? "Goals"} (default)` : row.name))))),
        process ? h("section", { className: "bees-box bees-form" },
          h("span", { className: "bees-ask-step" }, "2 · Stage agents"),
          h("h2", null, "Agents for each stage"),
          h("p", { className: "bees-muted" }, "Assignments save to the selected process and agent changes apply wherever that agent runs."),
          h(ProcessRoutingBoard, { stages, agents, servers, act,
            onOpenAgent: (id) => { setCreatingStageId(""); setSelectedAgentId(id); },
            onCreateAgent: (id) => { setSelectedAgentId(""); setCreatingStageId(id); } })) : null,
        creatingStage ? h(AgentCreateForm, { key: creatingStage.id, ctx, data, servers, tools, catalog, onServerAction: capabilities.act, workspaceId, act, dialog: true, processId: process?.id,
          onCancel: () => setCreatingStageId(""), onCreated: async (id) => {
            const saved = await act({ action: "set_stage_route", stageId: creatingStage.id,
              agentIds: [...(creatingStage.agentIds ?? []), id], requiredCapabilities: creatingStage.requiredCapabilities });
            setCreatingStageId(""); setSelectedAgentId(id);
            if (!saved) setError("Agent created, but its stage assignment could not be saved. Assign it from the stage above.");
          } }) : selectedAgent ? h(AgentEditForm, { key: selectedAgent.id, ctx, data, servers, tools, catalog, onServerAction: capabilities.act, selected: selectedAgent, act, dialog: true, processId: process?.id,
            onCancel: () => setSelectedAgentId(""), onSaved: () => setSelectedAgentId("") }) : null,
        h("section", { className: "bees-box bees-form" },
          h("span", { className: "bees-ask-step" }, "3 · Files"),
          h("h2", null, "Input files & folders"),
          h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds, onInputIds: setInputLocationIds,
            outputId: outputLocationId, onOutputId: setOutputLocationId,
            inherited: [...inheritedInputs(data, process?.id), ...agentInputs],
            defaultOutputId: process?.outputLocationId, defaultOutputName: defaultOutput?.name })),
        error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
        h("div", { className: "bees-detail-actions" },
          h("button", { type: "submit", form: "bees-ask-run", className: "bees-btn primary",
            disabled: busy || !process || !outcome.trim() || Boolean(selectedAgent || creatingStage) }, busy ? "Starting…" : "Run process")),
        selectedAgent || creatingStage ? h("p", { className: "bees-muted" }, "Save or close the agent settings before starting.") : null)));
}
