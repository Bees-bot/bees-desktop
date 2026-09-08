import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button, useSubmit } from "./shared.js";
import { AgentCreateForm, AgentEditForm } from "./agents.js";
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
  const [showAllMcps, setShowAllMcps] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
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
  const servers = (capabilities.data?.servers ?? []).filter((server) => server.enabled);
  const skills = capabilities.data?.skills ?? [];
  const defaultOutput = data.locations.find(({ id }) => id === process?.outputLocationId);
  const agentInputs = [...new Set(stages.filter((stage) => !["manual", "terminal"].includes(stage.driver)).flatMap((stage) =>
    stage.agentIds?.length ? stage.agentIds : agents.filter((agent) => agent.systemRole === (stage.driver === "review" ? "reviewer" : "worker")).map(({ id }) => id)))]
    .flatMap((id) => inheritedInputs(data, null, id));

  useEffect(() => heading.current?.focus(), []);

  const [busy, submit] = useSubmit(async () => {
    if (!allowed || !process || selectedAgent || creatingStage || !outcome.trim()) return;
    setError("");
    try {
      const target = process.kind === "goals" ? { workspaceId } : { processId: process.id };
      const result = await act(workFromOutcome(outcome, target, { inputLocationIds, outputLocationId }));
      if (result?.id) onStarted(result.id);
      else setError("Could not start this work. Please try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });

  return h("div", { className: "bees-ask-setup" },
    h("div", null,
      h(Button, { onClick: onBack, disabled: busy }, "← Back to Home"),
      h("header", { className: "bees-ask-heading" },
        h("span", { className: "bees-muted" }, `ASK BEES · ${team?.name ?? "Choose a team"}`),
        h("h1", { ref: heading, tabIndex: -1 }, "Configure advanced"),
        h("p", { className: "bees-muted" }, "Choose a process template, agents, and files for this work.")),
      h("fieldset", { disabled: busy || !allowed, className: "bees-stack", style: { padding: 0, border: "none", margin: 0, minWidth: 0 } },
        h("form", { id: "bees-ask-run", className: "bees-box bees-form", onSubmit: submit },
          h("label", null, "What would you like Bees to do?",
            h("textarea", { className: "bees-textarea", name: "outcome", required: true, value: outcome, rows: 4,
              "aria-describedby": "bees-ask-references", onChange: (event) => onOutcome(event.target.value),
              placeholder: "e.g., Research CRM options and draft a comparison report" })),
          h("p", { id: "bees-ask-references", className: "bees-muted" }, "Reference an existing agent with $agent-name, or use $human:name, $work:title, $template:name, $file:filename, and $process:name. Files must be in a mapped team location. Put file paths with spaces in quotes."),
          h("label", null, "Process template",
            h("select", { className: "bees-select", name: "processId", required: true, value: process?.id ?? "",
              onChange: (event) => { setProcessId(event.target.value); setSelectedAgentId(""); setCreatingStageId(""); } },
              !process ? h("option", { value: "" }, "Choose a process template") : null,
              ...processes.map((row) => h("option", { key: row.id, value: row.id }, row.kind === "goals" ? `${row.name ?? "Goals"} (default)` : row.name))))),
        h("section", { className: "bees-box bees-form" },
          h("h2", null, "Agents for each stage"),
          h("p", { className: "bees-muted" }, "Stage assignments save to the selected process template. Configure an agent to choose its model, MCP connections, and skill preset; agent changes apply wherever it runs."),
          h(ProcessRoutingBoard, { stages, agents, act,
            onOpenAgent: (id) => { setCreatingStageId(""); setSelectedAgentId(id); },
            onCreateAgent: (id) => { setSelectedAgentId(""); setCreatingStageId(id); } })),
        creatingStage ? h(AgentCreateForm, { key: creatingStage.id, ctx, data, servers, workspaceId, act, inline: true, processId: process?.id,
          onCancel: () => setCreatingStageId(""), onCreated: async (id) => {
            const saved = await act({ action: "set_stage_route", stageId: creatingStage.id,
              agentIds: [...(creatingStage.agentIds ?? []), id], requiredCapabilities: creatingStage.requiredCapabilities });
            setCreatingStageId(""); setSelectedAgentId(id);
            if (!saved) setError("Agent created, but its stage assignment could not be saved. Assign it from the stage above.");
          } }) : selectedAgent ? h(AgentEditForm, { key: selectedAgent.id, ctx, data, servers, selected: selectedAgent, act, processId: process?.id,
            cancelLabel: "Close agent settings", onCancel: () => setSelectedAgentId(""), onSaved: () => setSelectedAgentId("") }) : null,
        h("section", { className: "bees-box bees-form", "aria-labelledby": "bees-ask-mcp" },
          h("h2", { id: "bees-ask-mcp" }, `MCP connections (${servers.length})`),
          ...(servers.length ? servers.slice(0, showAllMcps ? undefined : 3).map((server) =>
            h("div", { className: "bees-row", key: server.id },
              h("div", { className: "bees-row-main" }, h("strong", null, server.label)),
              h("span", { className: "bees-badge" }, server.status ?? "Connected")))
            : [h("p", { className: "bees-muted", key: "empty" }, "No MCP connections yet.")]),
          servers.length > 3 ? h(Button, { onClick: () => setShowAllMcps((value) => !value),
            "aria-expanded": showAllMcps }, showAllMcps ? "Show less" : "See more") : null),
        h("section", { className: "bees-box bees-form", "aria-labelledby": "bees-ask-skills" },
          h("h2", { id: "bees-ask-skills" }, "Skills"),
          ...(skills.length ? skills.slice(0, showAllSkills ? undefined : 3).map((skill) =>
            h("div", { className: "bees-row", key: skill.name },
              h("div", { className: "bees-row-main" }, h("strong", null, skill.name),
                skill.description ? h("span", { className: "bees-muted" }, skill.description) : null)))
            : [h("p", { className: "bees-muted", key: "empty" }, "No skills installed yet.")]),
          skills.length > 3 ? h(Button, { onClick: () => setShowAllSkills((value) => !value),
            "aria-expanded": showAllSkills }, showAllSkills ? "Show less" : "See more") : null),
        h("section", { className: "bees-box bees-form" },
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
