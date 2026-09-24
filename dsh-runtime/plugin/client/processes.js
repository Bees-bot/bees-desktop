import { h, useEffect, useState, React } from "./runtime.js";
import { accountLabel, ask, Button, confirmAction, Empty, useSubmit, PageHead} from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";
import { AgentCreateForm, AgentEditForm, McpAccess, needsNote } from "./agents.js";
import { AttachedResourceFields, ResourceFields } from "./location-fields.js";

const PROCESSES_LAYOUT = [{ kind: "processes", x: 0, y: 0, w: 12, h: 12 }];
const TEMPLATES_LAYOUT = [
  { kind: "about", x: 0, y: 0, w: 12, h: 2 },
  { kind: "templates", x: 0, y: 2, w: 12, h: 10 }
];
const PROCESS_DETAIL_LAYOUT = [
  { kind: "routing", x: 0, y: 0, w: 12, h: 6 },
  { kind: "files", x: 0, y: 6, w: 6, h: 5 },
  { kind: "mcp", x: 6, y: 6, w: 6, h: 5 }
];

function StageAgentRoute({ stage, agents, servers = [], act, onOpenAgent, onCreateAgent }) {
  const ids = stage.agentIds ?? [];
  const [nextId, setNextId] = useState("");
  useEffect(() => { if (ids.includes(nextId)) setNextId(""); }, [JSON.stringify(ids)]);
  const fallback = !ids.length && agents.find((agent) => agent.systemRole === (stage.driver === "review" ? "reviewer" : "worker"));
  const selected = ids.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean);
  const available = agents.filter((agent) => agent.enabled && !ids.includes(agent.id));
  const leadOptions = agents.filter((agent) => agent.enabled || ids.includes(agent.id));
  const save = (agentIds) => act({
    action: "set_stage_route", stageId: stage.id, agentIds,
    requiredCapabilities: stage.requiredCapabilities
  });
  return h("div", { className: "bees-hierarchy-card bees-route-card", style: { cursor: "default" } },
    h("label", { className: "bees-route-field" }, h("strong", null, stage.driver === "review" ? "Reviewer" : "Lead agent"),
      h("div", { className: "bees-route-control" },
        h("select", { className: "bees-select", value: selected[0]?.id ?? "", onChange: (event) => {
          const id = event.target.value;
          return save(id ? [id, ...(ids.includes(id) ? ids.filter((value) => value !== id) : ids.slice(1))] : []);
        } },
          h("option", { value: "" }, "Automatic assignment"),
          ...leadOptions.map((agent) => h("option", { value: agent.id, key: agent.id }, agent.name))),
        selected[0] ? h(Button, { onClick: () => onOpenAgent(selected[0].id), title: "Edit lead agent", "aria-label": "Edit lead agent" }, "Edit") : null)),
    selected[0] ? needsNote(selected[0], servers) : h("p", { className: "bees-muted", style: { margin: 0 } }, fallback
        ? (stage.driver === "review" ? `${fallback.name} is selected as the independent reviewer.` : `${fallback.name} is the automatic lead. Bees may add specialists when useful.`)
        : (stage.driver === "review" ? "Bees chooses an eligible independent reviewer automatically." : "Bees chooses the best available agent when work reaches this stage.")),
    stage.driver === "review" || !ids.length ? null : h("div", { className: "bees-route-field" },
      h("strong", null, "Participants"),
      ...selected.slice(1).map((agent) => h("div", { className: "bees-route-agent", key: agent.id },
        h("button", { type: "button", className: "bees-route-agent-link", onClick: () => onOpenAgent(agent.id) }, agent.name),
        h(Button, { className: "danger", onClick: () => save(ids.filter((id) => id !== agent.id)), title: `Remove ${agent.name}`, "aria-label": `Remove ${agent.name}` }, "×"))),
      h("div", { className: "bees-route-control" },
        h("select", { className: "bees-select bees-grow", value: nextId, disabled: !available.length,
          "aria-label": `${stage.name} agent to add`, onChange: (event) => setNextId(event.target.value) },
          h("option", { value: "" }, available.length ? "Add a participant" : "No agents available"),
          ...available.map((agent) => h("option", { value: agent.id, key: agent.id }, agent.name))),
        h(Button, { className: "primary", disabled: !nextId, onClick: async () => {
          await save([...ids, nextId]); setNextId("");
        } }, "Add"))),
    h(Button, { onClick: onCreateAgent }, "+ New agent")
  );
}

export function ProcessRoutingBoard({ stages, agents, servers = [], act, onOpenAgent, onCreateAgent }) {
  return h("div", { className: "bees-cockpit-board bees-routing-board" }, ...stages.map((stage, index) =>
    h("section", { className: "bees-column", key: stage.id },
      h("header", { className: "bees-column-head" }, h("span", null, `${index + 1}. ${stage.name}`),
        h("span", { className: "bees-count" }, ["manual", "terminal"].includes(stage.driver)
          ? (stage.driver === "terminal" ? "Finish" : "Human")
          : (stage.agentIds?.length ? `${stage.agentIds.length} agent${stage.agentIds.length === 1 ? "" : "s"}` : "Auto"))),
      h("div", { className: "bees-cards" },
        ["manual", "terminal"].includes(stage.driver)
          ? h("div", { className: "bees-hierarchy-card bees-route-terminal", style: { cursor: "default" } },
            h("span", { className: "bees-badge" }, stage.driver === "terminal" ? "Terminal" : "Human"),
            h("p", { className: "bees-muted", style: { marginTop: "8px" } },
              stage.driver === "terminal" ? "Work completes here." : "A person moves work through this stage."))
          : h(StageAgentRoute, { stage, agents, servers, act, onOpenAgent,
            onCreateAgent: () => onCreateAgent(stage.id) })))));
}

function ProcessForm({ ctx, data, servers, tools, catalog, onServerAction, kind, draft, workspaceId, teamId, act, onCancel, onCreated, setPageHeader }) {
  const template = kind === "template";
  const initialStages = (draft?.stages ?? [{ name: "Plan" }, { name: "Doing" }, { name: "Done" }])
    .map(({ name }) => name);
  const [inputLocationIds, setInputLocationIds] = useState([]);
  const [outputLocationId, setOutputLocationId] = useState("");

  if (!workspaceId) return h("div", { className: "bees-stack" },
    h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← Process Templates"), h("div", { className: "bees-title" }, template ? "New template" : "New process template")),
    h(Empty, null, "Choose a team before creating a process template."));
  const [busy, onSubmit] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    const stages = String(form.get("stages") ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    const created = await act({
      action: template ? "create_process_template" : "create_process", workspaceId,
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), stages,
      inputLocationIds, outputLocationId,
      mcpAccess: String(form.get("mcpAccess") ?? "none"), mcpServers: form.getAll("mcpServers").map(String)
    });
    if (created?.id) onCreated(created.id);
  });

  return h("form", { className: "bees-form bees-process-form", onSubmit },
    h(PageHead, { setPageHeader }, 
      h(Button, { onClick: onCancel }, "← Process Templates"),
      h("div", null,
        h("h2", null, template ? "New process template" : draft ? "Create process template from preset" : "New process template"),
        template ? h("div", { className: "bees-muted" }, "A template is a reusable blueprint. It does not run work by itself.") : null)
    ),
    h("label", { className: "bees-process-name" }, template ? "Template name" : "Process template name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true,
      defaultValue: draft?.name ?? "", placeholder: template ? "Editorial workflow" : "Publish an article" })),
    h("label", { className: "bees-process-description" }, "Description & instructions", h("textarea", { className: "bees-textarea", name: "description", defaultValue: draft?.description ?? "",
      placeholder: "Describe the goal, instructions, and completion criteria." })),
    h("label", { className: "bees-process-stages" }, "Stages (one per line)",
      h("textarea", { className: "bees-textarea", name: "stages", required: true,
        defaultValue: initialStages.join("\n"), "aria-describedby": "process-stage-help" }),
      h("span", { className: "bees-muted", id: "process-stage-help" }, "Use 2–12 unique stages. The final stage completes the work.")),
    template ? null : h("div", { className: "bees-process-files" }, h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, outputId: outputLocationId, onOutputId: setOutputLocationId, compact: true })),
    template ? null : h("div", { className: "bees-process-mcps" },
      h(McpAccess, { ctx, servers, tools, catalog, onServerAction, access: "none", scope: "process" })),
    h("div", { className: "bees-detail-actions bees-process-actions" }, h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : template ? "Create template" : "Create process template"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

export function ProcessMcpForm({ ctx, process, servers, tools, catalog, onServerAction, act, showAll = false, compact = false }) {
  return h("div", { className: "bees-form bees-process-mcp-form", style: { paddingTop: "8px" } },
    compact ? null : h("p", { className: "bees-muted", style: { marginBottom: "16px" } }, "Every agent in this process inherits these MCPs in addition to its own."),
    h(McpAccess, { ctx, servers, tools, catalog, onServerAction, access: process.mcpAccess, chosen: process.mcpServers,
      scope: "process", showAll, onChange: ({ mcpAccess, mcpServers }) =>
        act({ action: "set_process_mcp", processId: process.id, mcpAccess, mcpServers }) }));
}


/** Bees plans the process as a run in Process Runs, where it asks what it needs and proposes the process. */
function ProcessPlanner({ workspaceId, act, onClose, openWorkItem }) {
  const [outcome, setOutcome] = useState("");
  const [busy, submit] = useSubmit(async () => {
    const result = await act({ action: "ask_bees", workspaceId, outcome: outcome.trim(), process: true });
    if (result?.executionId) openWorkItem(result.executionId);
  });
  return h("form", { className: "bees-composer", onSubmit: submit },
    h("textarea", {
      className: "bees-composer-input", value: outcome, disabled: busy, "aria-label": "What should this process do?",
      placeholder: "e.g., Every weekday, find new freelance projects that fit me and draft a proposal for each",
      onChange: (event) => setOutcome(event.target.value)
    }),
    h("div", { className: "bees-composer-foot" },
      h("span", { className: "bees-composer-hint" }, "Bees plans it in Process Runs and asks you what it needs."),
      h("div", { className: "bees-detail-actions" },
        h(Button, { disabled: busy, onClick: onClose }, "Cancel"),
        h("button", { type: "submit", className: "bees-btn primary", disabled: busy || !outcome.trim() }, busy ? "Starting…" : "Build this process"))));
}

export function ProcessListActions({ process, act, openWorkItem }) {
  const [error, setError] = useState("");
  const [busy, submit] = useSubmit(async (_event, action) => {
    setError("");
    try {
      if (action === "restore") {
        await act(process.sourceKind === "template"
          ? { action: "restore_process_template", templateId: process.id }
          : { action: "restore_process", processId: process.id });
        return;
      }
      if (action === "run") { openWorkItem(null, process.id); return; }
      if (action === "copy_process") {
        const name = await ask("New process template name", process.name + " Copy");
        if (name?.trim()) await act({ action, processId: process.id, name: name.trim() });
      } else if (await confirmAction(`Archive process template “${process.name}”? Its process runs and history will be preserved.`)) {
        await act({ action, processId: process.id });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  return h("div", null,
    h("div", { className: "bees-detail-actions", style: { marginTop: 0 }, role: "group", "aria-label": `Actions for ${process.name}` },
      process.archivedAt ? h(Button, { disabled: busy, onClick: (event) => submit(event, "restore") }, "Restore") : h(React.Fragment, null,
      h(Button, { disabled: busy, onClick: (event) => submit(event, "run") }, "Run"),
      h(Button, { disabled: busy, onClick: (event) => submit(event, "copy_process") }, "Duplicate"),
      process.kind === "standard" ? h(Button, { className: "danger", disabled: busy, onClick: (event) => submit(event, "archive_process") }, "Archive")
        : h(Button, { className: "danger", disabled: true, title: "The built-in Goals process cannot be archived" }, "Archive"))),
    error ? h("p", { className: "bees-error", role: "alert" }, error) : null);
}

export function ProcessesPage({ ctx, data, servers = [], tools = [], catalog = [], onServerAction, route, workspaceIds, workspaceId, teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions, setPageHeader }) {
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [creatingStageId, setCreatingStageId] = useState("");
  const [planning, setPlanning] = useState(false);
  const [templateStatus, setTemplateStatus] = useState("active");
  const processes = data.processes.filter((process) => workspaceIds.includes(process.workspaceId));
  if (["process", "template"].includes(creating)) return h(ProcessForm, {
    ctx, data, servers, tools, catalog, onServerAction, kind: creating, draft: processDraft, workspaceId, teamId, act,
    onCancel: () => { setCreating(""); setProcessDraft(null); },
    setPageHeader, onCreated: (id) => {
      const wasTemplate = creating === "template";
      setCreating(""); setProcessDraft(null);
      if (!wasTemplate) setProcessId(id);
    }
  });

  if (processId) {
    const process = processes.find(({ id }) => id === processId);
    if (process) {
      const attached = data.processAttachments.filter((row) => row.processId === process.id);
      const processStages = data.stages.filter(({ processId }) => processId === process.id);
      const processAgents = data.assignments.filter(({ workspaceId }) => workspaceId === process.workspaceId);
      
      const editProcess = async () => {
        const name = await ask("Process template name", process.name); if (!name) return;
        const description = await ask("Description & instructions", process.description, "textarea"); if (description === null) return;
        const current = data.stages.filter(({ processId }) => processId === process.id).map(({ name }) => name);
        const listed = await ask("Stages, comma separated", current.join(", ")); if (listed === null) return;
        const stages = listed.split(",").map((value) => value.trim()).filter(Boolean);
        await act({ action: "edit_process", processId: process.id, name, description, stages });
      };
      
      const copyProcess = async () => {
        const name = await ask("New process template name", process.name + " Copy"); if (!name) return;
        const result = await act({ action: "copy_process", processId: process.id, name });
        if (result?.id) setProcessId(result.id);
      };

      const archiveProcess = async () => {
        if (!await confirmAction(`Archive process template “${process.name}”? Its process runs and history will be preserved.`)) return;
        if (await act({ action: "archive_process", processId: process.id })) setProcessId("");
      };
      const selectedAgent = processAgents.find(({ id }) => id === selectedAgentId);
      const creatingStage = processStages.find(({ id }) => id === creatingStageId);
      
      const routingBoard = h(ProcessRoutingBoard, {
        stages: processStages, agents: processAgents, servers, act,
        onOpenAgent: (id) => { setCreatingStageId(""); setSelectedAgentId(id); },
        onCreateAgent: (id) => { setSelectedAgentId(""); setCreatingStageId(id); }
      });

      const agentForm = creatingStage ? h("div", null,
          
          h(AgentCreateForm, { ctx, data, servers, tools, catalog, onServerAction, workspaceId: process.workspaceId, act, dialog: true, processId: process.id,
            onCancel: () => setCreatingStageId(""), onCreated: async (id) => {
              await act({ action: "set_stage_route", stageId: creatingStage.id,
                agentIds: [...(creatingStage.agentIds ?? []), id], requiredCapabilities: creatingStage.requiredCapabilities });
              setCreatingStageId(""); setSelectedAgentId(id);
            } }))
        : selectedAgent ? h("div", null,
          
          h(AgentEditForm, { ctx, data, servers, tools, catalog, onServerAction, selected: selectedAgent, act, dialog: true, processId: process.id,
            onCancel: () => setSelectedAgentId(""), onSaved: () => setSelectedAgentId("") })) : null;

      const processActions = h("div", { className: "bees-detail-actions", style: { justifyContent: "flex-end", margin: "0 0 16px" }, role: "group", "aria-label": "Process template actions" },
          h(Button, { onClick: editProcess }, "Edit"),
          h(Button, { onClick: copyProcess }, "Duplicate"),
          process.kind === "standard" ? h(Button, { className: "danger", onClick: archiveProcess }, "Archive") : null,
          h(Button, { className: "primary", onClick: () => openWorkItem(null, process.id) }, "Start Process")
      );

      const routingPanel = h("div", null,
        h(PageHead, { setPageHeader },
          h(Button, { onClick: () => setProcessId("") }, "← Process Templates"),
          h("div", { className: "bees-title" }, process.name)
        ),
        h("p", { className: "bees-muted bees-route-guide" }, "Stages move from left to right."),
        routingBoard
      );
      const filesPanel = h("div", null,
        h(AttachedResourceFields, { key: process.id, ctx, data, teamId, act,
          owner: { processId: process.id }, references: attached, outputId: process.outputLocationId ?? "", compact: true }));
      const mcpPanel = h(ProcessMcpForm, { key: `${process.id}:${process.mcpAccess}:${JSON.stringify(process.mcpServers)}`,
        ctx, process, servers, tools, catalog, onServerAction, act, compact: true });

      return h(React.Fragment, null,
        h(GridStackPage, {
          layoutId: "process-detail-v2", defaults: PROCESS_DETAIL_LAYOUT, preference, preferences, setPageActions,
          panels: {
            beforeGrid: processActions,
            routing: { label: "Agent setup", minW: 6, minH: 5, content: routingPanel },
            files: { label: "Files", minW: 4, minH: 3, content: filesPanel },
            mcp: { label: "Process MCPs", minW: 4, minH: 3, content: mcpPanel }
          }
        }),
        agentForm
      );
    }
  }
  if (route === "templates") {
    const templates = (data.templates ?? []).filter((template) => workspaceIds.includes(template.workspaceId));
    const about = h("div", null, "A process runs real work. A template only remembers the name, explanation, and stages so you can create similar processes quickly.");
    const templateList = h("div", null,
      h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
        h(Button, { className: "primary", disabled: !workspaceId, onClick: () => { setProcessDraft(null); setCreating("template"); } }, "New template")),
      ...(templates.length ? templates.map((template) => h("div", { className: "bees-row", key: template.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, template.name),
          h("div", { className: "bees-muted" }, [template.description, template.stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))),
        h(Button, { className: "primary", disabled: template.workspaceId !== workspaceId,
          onClick: () => { setProcessDraft(template); setCreating("process"); } }, "Use template"),
        h(Button, { className: "danger", onClick: async () => (await confirmAction(`Archive template “${template.name}”?`)) &&
          act({ action: "archive_process_template", templateId: template.id }) }, "Archive")))
        : [h(Empty, { key: "empty" }, "No templates yet. Create one here or save an existing process as a template.")]));
    return h(GridStackPage, {
      layoutId: "process-templates", defaults: TEMPLATES_LAYOUT, preference, preferences, setPageActions,
      panels: {
        about: { label: "About templates", minW: 6, minH: 2, content: about },
        templates: { label: "Templates", minW: 6, minH: 4, content: templateList }
      }
    });
  }
  const archived = (data.archivedProcessTemplates ?? []).filter((process) => workspaceIds.includes(process.workspaceId));
  const processList = templateStatus === "archived" ? h("div", null,
    archived.length ? archived.map((process) => h("div", { className: "bees-row", key: process.id },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name),
        h("div", { className: "bees-muted" }, process.description),
        h("div", { className: "bees-muted" }, `Archived ${new Date(process.archivedAt).toLocaleString()}`)),
      h(ProcessListActions, { process, act, openWorkItem })))
      : h(Empty, null, "No archived process templates")) : h("div", null,
    ...(processes.length ? processes.map((process) => {
      const stages = data.stages.filter(({ processId }) => processId === process.id);
      const creator = accountLabel(data, process.accountUserId);
      const subtitle = [process.description, stages.map(({ name }) => name).join(" → "), creator ? `by ${creator}` : null].filter(Boolean).join(" · ");
      return h("div", { className: "bees-row", key: process.id, style: { flexWrap: "wrap" } },
        h("button", { type: "button", className: "bees-row-main", style: { cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit", background: "transparent", border: 0 }, onClick: () => setProcessId(process.id) },
          h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, subtitle)),
        h(ProcessListActions, { process, act, openWorkItem }));
    }) : [h(Empty, { key: "empty" }, "No process templates yet")]));
  return h("div", { className: "bees-stack bees-flex-page" },
    h("div", { className: "bees-search", style: { justifyContent: "flex-end" } },
      h("select", { className: "bees-select", value: templateStatus, "aria-label": "Process template status",
        onChange: (event) => setTemplateStatus(event.target.value) },
        h("option", { value: "active" }, "Active"), h("option", { value: "archived" }, "Archived")),
      h(Button, { disabled: !workspaceId, onClick: () => setPlanning(true) }, "Build with Bees"),
      h(Button, { className: "primary", disabled: !workspaceId,
        onClick: () => { setProcessDraft(null); setCreating("process"); } }, "New process template")
    ),
    h(GridStackPage, {
      layoutId: "processes", defaults: PROCESSES_LAYOUT, preference, preferences, setPageActions,
      panels: {
        processes: {
        label: "Process Templates",
        minW: 6, minH: 4,
        content: h("div", { className: "bees-stack" },
          planning ? h(ProcessPlanner, { workspaceId, act, openWorkItem, onClose: () => setPlanning(false) }) : null,
          processList)
      }
    }
    })
  );
}
