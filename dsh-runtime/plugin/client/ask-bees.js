import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button } from "./shared.js";
import { AgentCreateForm, AgentEditForm, runAgents } from "./agents.js";
import { ProcessMcpForm, ProcessRoutingBoard } from "./processes.js";
import { inheritedInputs, ResourceFields } from "./location-fields.js";

export function workFromOutcome(outcome, target, resources = {}) {
  const description = outcome.trim();
  return { action: target.processId ? "create_item" : "create_goal", ...target,
    title: description.split("\n")[0], description, ...resources };
}

export function AskBeesSetup({ ctx, data, workspaceId, initial, act, onCancel, onSave, capabilities }) {
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("process");
  const [processId, setProcessId] = useState(initial?.processId ?? "");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [creatingStageId, setCreatingStageId] = useState("");
  const [inputLocationIds, setInputLocationIds] = useState(initial?.inputLocationIds ?? []);
  const [outputLocationId, setOutputLocationId] = useState(initial?.outputLocationId ?? "");
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

  const dialogRef = useRef(null);
  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    heading.current?.focus();
  }, []);

  return h("dialog", {
    ref: dialogRef,
    className: "bees-box bees-modal bees-ask-setup",
    "aria-labelledby": "bees-ask-configure-title",
    closedby: "any",
    onClick: (event) => {
      if (event.target !== dialogRef.current) return;
      const rect = dialogRef.current.getBoundingClientRect();
      if (!(rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width)) {
        onCancel();
      }
    },
    onCancel: (event) => {
      event.preventDefault();
      onCancel();
    },
    onClose: () => onCancel()
  },
      h("header", { className: "bees-ask-heading" },
        h("span", { className: "bees-muted" }, `GOAL SETUP · ${team?.name ?? "Choose a team"}`),
        h("h1", { id: "bees-ask-configure-title", ref: heading, tabIndex: -1 }, "Configure"),
        h("p", { className: "bees-muted" }, "Choose a process, its tools and agents, and input files."),
        h(Button, { className: "bees-ask-close", onClick: onCancel, "aria-label": "Close configuration" }, "×")),
      h("div", { className: "bees-clean-tabs bees-ask-tabs", role: "tablist", "aria-label": "Goal configuration" },
        ...[["process", "Process"], ["mcps", "MCPs"], ["files", "Input & Output"]].map(([id, label]) =>
          h("button", { key: id, type: "button", role: "tab", id: `bees-ask-tab-${id}`,
            className: `bees-clean-tab${activeTab === id ? " active" : ""}`,
            "aria-selected": activeTab === id, "aria-controls": "bees-ask-panel",
            onClick: () => setActiveTab(id) }, label))),
      h("fieldset", { disabled: !allowed, className: "bees-stack", role: "tabpanel", id: "bees-ask-panel",
        "aria-labelledby": `bees-ask-tab-${activeTab}`, style: { padding: 0, border: "none", margin: 0, minWidth: 0 } },
        activeTab === "process" ? h("div", { className: "bees-form" },
          h("label", null, "Process",
            h("select", { className: "bees-select", name: "processId", required: true, value: process?.id ?? "",
              onChange: (event) => { setProcessId(event.target.value); setSelectedAgentId(""); setCreatingStageId(""); } },
              !process ? h("option", { value: "" }, "Choose a process") : null,
              ...processes.map((row) => h("option", { key: row.id, value: row.id }, row.kind === "goals" ? `${row.name ?? "Goals"} (default)` : row.name))))) : null,
        activeTab === "process" && process ? h("section", { className: "bees-form" },
          h("h2", null, "Agents for each stage"),
          h("p", { className: "bees-muted" }, "Assignments save to the selected process and agent changes apply wherever that agent runs."),
          h(ProcessRoutingBoard, { stages, agents, servers, act,
            onOpenAgent: (id) => { setCreatingStageId(""); setSelectedAgentId(id); },
            onCreateAgent: (id) => { setSelectedAgentId(""); setCreatingStageId(id); } })) : null,
        activeTab === "process" && creatingStage ? h(AgentCreateForm, { key: creatingStage.id, ctx, data, servers, tools, catalog, onServerAction: capabilities.act, workspaceId, act, dialog: true, processId: process?.id,
          onCancel: () => setCreatingStageId(""), onCreated: async (id) => {
            const saved = await act({ action: "set_stage_route", stageId: creatingStage.id,
              agentIds: [...(creatingStage.agentIds ?? []), id], requiredCapabilities: creatingStage.requiredCapabilities });
            setCreatingStageId(""); setSelectedAgentId(id);
            if (!saved) setError("Agent created, but its stage assignment could not be saved. Assign it from the stage above.");
          } }) : activeTab === "process" && selectedAgent ? h(AgentEditForm, { key: selectedAgent.id, ctx, data, servers, tools, catalog, onServerAction: capabilities.act, selected: selectedAgent, act, dialog: true, processId: process?.id,
            onCancel: () => setSelectedAgentId(""), onSaved: () => setSelectedAgentId("") }) : null,
        activeTab === "mcps" && process ? h("section", { className: "bees-form" },
          h("h2", null, "Tools for this process"),
          h(ProcessMcpForm, { key: `${process.id}:${process.mcpAccess}:${JSON.stringify(process.mcpServers)}`,
            ctx, process, servers, tools, catalog, onServerAction: capabilities.act, act })) : null,
        activeTab === "mcps" && !process ? h("p", { className: "bees-muted" }, "Choose a process on the Process tab first.") : null,
        activeTab === "files" ? h("section", { className: "bees-form" },
          h("h2", null, "Input files & folders"),
          h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds, onInputIds: setInputLocationIds,
            outputId: outputLocationId, onOutputId: setOutputLocationId,
            inherited: [...inheritedInputs(data, process?.id), ...agentInputs],
            defaultOutputId: process?.outputLocationId, defaultOutputName: defaultOutput?.name })) : null,
        selectedAgent || creatingStage ? h("p", { className: "bees-muted" }, "Save or close the agent settings before saving this configuration.") : null),
      h("footer", { className: "bees-detail-actions bees-ask-actions" },
          error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
          h(Button, { onClick: onCancel }, "Cancel"),
          h(Button, { className: "primary", disabled: !allowed || !process || Boolean(selectedAgent || creatingStage), onClick: () => onSave({ processId: process.id, inputLocationIds, outputLocationId }) }, "Save")));
}
