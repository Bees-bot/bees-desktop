import { h, useEffect, useState, React } from "./runtime.js";
import { ask, Button, confirmAction, Empty, ProposalCard, useSubmit, PageHead} from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";
import { AgentCreateForm, AgentEditForm } from "./agents.js";
import { AttachedResourceFields, ResourceFields } from "./location-fields.js";

const PROCESSES_LAYOUT = [{ kind: "planner", x: 0, y: 0, w: 12, h: 4 }, { kind: "processes", x: 0, y: 4, w: 12, h: 8 }];
const TEMPLATES_LAYOUT = [
  { kind: "about", x: 0, y: 0, w: 12, h: 2 },
  { kind: "templates", x: 0, y: 2, w: 12, h: 10 }
];
const PROCESS_DETAIL_LAYOUT = [
  { kind: "routing", x: 0, y: 0, w: 12, h: 7 },
  { kind: "agent", x: 0, y: 7, w: 12, h: 10 },
  { kind: "archive", x: 0, y: 17, w: 12, h: 3 }
];

function StageAgentRoute({ stage, agents, act, onOpenAgent, onCreateAgent }) {
  const ids = stage.agentIds ?? [];
  const [nextId, setNextId] = useState("");
  useEffect(() => { if (ids.includes(nextId)) setNextId(""); }, [JSON.stringify(ids)]);
  const fallback = !ids.length && agents.find((agent) => agent.systemRole === (stage.driver === "review" ? "reviewer" : "worker"));
  const selected = ids.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean);
  const available = agents.filter((agent) => agent.enabled && !ids.includes(agent.id));
  const save = (agentIds) => act({
    action: "set_stage_route", stageId: stage.id, agentIds,
    requiredCapabilities: stage.requiredCapabilities
  });
  const move = (index, offset) => {
    const reordered = [...ids];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    return save(reordered);
  };
  return h("div", { className: "bees-form", style: { marginTop: "8px" } },
    fallback ? h("div", { className: "bees-row" },
      h("div", { className: "bees-row-main" }, h("strong", null, fallback.name),
        h("span", { className: "bees-muted" }, " · Default agent")),
      h(Button, { onClick: () => onOpenAgent(fallback.id) }, "Configure")) : null,
    ...selected.map((agent, index) => h("div", { className: "bees-row", key: agent.id },
      h("div", { className: "bees-row-main" },
        h("strong", null, agent.name),
        h("span", { className: "bees-muted" }, index === 0 ? (ids.length > 1 ? " · Discussion lead" : " · Assigned agent") : " · Participant")),
      h(Button, { onClick: () => onOpenAgent(agent.id) }, "Configure"),
      h(Button, { disabled: index === 0, onClick: () => move(index, -1), title: "Move earlier" }, "↑"),
      h(Button, { disabled: index === ids.length - 1, onClick: () => move(index, 1), title: "Move later" }, "↓"),
      h(Button, { onClick: () => save(ids.filter((id) => id !== agent.id)) }, "Remove"))),
    stage.driver === "review" && ids.length ? null : h("div", { className: "bees-row" },
      h("select", { className: "bees-select bees-grow", value: nextId, disabled: !available.length,
        "aria-label": `${stage.name} agent to add`, onChange: (event) => setNextId(event.target.value) },
        h("option", { value: "" }, available.length ? "Choose an agent" : "No more available agents"),
        ...available.map((agent) => h("option", { value: agent.id, key: agent.id }, agent.name))),
      h(Button, { className: "primary", disabled: !nextId, onClick: async () => {
        await save([...ids, nextId]); setNextId("");
      } }, ids.length ? "Add participant" : "Assign agent")),
    h(Button, { onClick: onCreateAgent }, "+ Create new agent"),
    ids.length > 1 ? h("p", { className: "bees-muted" }, "All assigned agents discuss; the first agent leads and submits the result.") : null
  );
}

export function ProcessRoutingBoard({ stages, agents, act, onOpenAgent, onCreateAgent }) {
  return h("div", { className: "bees-cockpit-board bees-routing-board" }, ...stages.map((stage) =>
    h("section", { className: "bees-column", key: stage.id },
      h("header", { className: "bees-column-head" }, stage.name),
      h("div", { className: "bees-cards" },
        ["manual", "terminal"].includes(stage.driver)
          ? h("div", { className: "bees-hierarchy-card", style: { cursor: "default" } },
            h("span", { className: "bees-badge" }, stage.driver === "terminal" ? "Terminal" : "Human"),
            h("p", { className: "bees-muted", style: { marginTop: "8px" } },
              stage.driver === "terminal" ? "Work completes here." : "A person moves work through this stage."))
          : h(StageAgentRoute, { stage, agents, act, onOpenAgent,
            onCreateAgent: () => onCreateAgent(stage.id) })))));
}

function ProcessForm({ ctx, data, kind, draft, workspaceId, teamId, act, onCancel, onCreated, setPageHeader }) {
  const template = kind === "template";
  const initialStages = (draft?.stages ?? ["Plan", "Doing", "Done"])
    .map((stage) => typeof stage === "string" ? stage : stage.name);
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
      inputLocationIds, outputLocationId
    });
    if (created?.id) onCreated(created.id);
  });

  return h("form", { className: "bees-box bees-form", onSubmit },
    h(PageHead, { setPageHeader }, 
      h(Button, { onClick: onCancel }, "← Process Templates"),
      h("div", { className: "bees-title" }, template ? "New process template" : draft ? "Create process template from preset" : "New process template"),
      h("div", { className: "bees-grow" })
    ),
    h("div", { className: "bees-muted", style: { marginBottom: "16px" } }, template
          ? "A template is a reusable blueprint. It does not run work by itself."
          : "Define the reusable workflow here. Each line becomes a stage; the final stage is Done."),
    h("label", null, template ? "Template name" : "Process template name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true,
      defaultValue: draft?.name ?? "", placeholder: template ? "Editorial workflow" : "Publish an article" })),
    h("label", null, "Description", h("textarea", { className: "bees-textarea", name: "description", defaultValue: draft?.description ?? "",
      placeholder: "When should someone use this workflow?" })),
    h("label", null, "Stages (one per line)", h("textarea", { className: "bees-textarea", name: "stages", required: true,
      defaultValue: initialStages.join("\n"), "aria-describedby": "process-stage-help" })),
    h("div", { className: "bees-muted", id: "process-stage-help" }, "Use 2–12 unique stages. Assign two or more agents to make a discussion; Review uses one independent reviewer; Approval or Sign-off requires human approval; the last stage completes the work."),
    template ? null : h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, outputId: outputLocationId, onOutputId: setOutputLocationId }),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : template ? "Create template" : "Create process template"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}


/** Describe the work once and Bees builds the process, its agents and its schedule to run it again. */
function ProcessPlanner({ data, workspaceId, act }) {
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [busy, submit] = useSubmit(async () => {
    if (!workspaceId || !outcome.trim()) return;
    setError("");
    try {
      const result = await act({ action: "ask_bees", workspaceId, outcome: outcome.trim() });
      if (result?.executionId) setRunId(result.executionId);
      else setError("Bees could not start planning this. Please try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  const run = runId ? data.runs.find(({ id }) => id === runId) : null;
  const planning = run && ["queued", "running"].includes(run.status);
  const asking = run?.status === "waiting_for_input";
  const proposals = data.proposals.filter((row) => row.workspaceId === workspaceId && row.status === "pending");
  return h("div", { className: "bees-stack" },
    h("form", { className: "bees-composer", onSubmit: submit },
      h("textarea", {
        className: "bees-composer-input", value: outcome, disabled: busy || planning || !workspaceId,
        "aria-label": "What should this process do?",
        placeholder: workspaceId ? "e.g., Every weekday, find new freelance projects that fit me and draft a proposal for each" : "Choose a team first",
        onInput: (event) => setOutcome(event.target.value)
      }),
      error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
      h("div", { className: "bees-composer-foot" },
        h("span", { className: "bees-composer-hint" }, asking
          ? "Bees needs an answer before it can finish this plan. It is waiting under Needs your attention on Home."
          : planning ? "Bees is working out the stages, agents, tools and schedule. It takes about a minute."
          : "Bees proposes the stages, agents and schedule. Approve it and the process is yours to run whenever you need it."),
        h("button", { type: "submit", className: "bees-btn primary", disabled: busy || planning || !workspaceId || !outcome.trim() },
          busy || planning ? "Planning…" : "Build this process"))),
    ...proposals.map((proposal) => h(ProposalCard, { key: proposal.id, proposal,
      onApply: async () => { await act({ action: "apply_proposal", proposalId: proposal.id }); setOutcome(""); setRunId(""); },
      onDismiss: () => act({ action: "reject_proposal", proposalId: proposal.id }) })));
}

export function ProcessesPage({ ctx, data, servers = [], tools = [], catalog = [], onServerAction, route, workspaceIds, workspaceId, teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions, setPageHeader }) {
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [creatingStageId, setCreatingStageId] = useState("");
  const processes = data.processes.filter((process) => workspaceIds.includes(process.workspaceId));
  if (["process", "template"].includes(creating)) return h(ProcessForm, {
    ctx, data, kind: creating, draft: processDraft, workspaceId, teamId, act,
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
        const description = await ask("Description", process.description) ?? process.description;
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
        stages: processStages, agents: processAgents, act,
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

      const archive = process.kind === "standard" ? h("div", { className: "bees-box", style: { border: "1px solid #cf5b5b44", background: "#cf5b5b11" } },
        h("h3", { style: { color: "#cf5b5b" } }, "Archive process template"),
        h("p", { className: "bees-muted", style: { margin: "8px 0 16px" } }, "Archive hides this process template without breaking process-run history or database links."),
        h(Button, { className: "danger", onClick: archiveProcess }, "Archive process template")) : null;

      const pageActions = h(React.Fragment, null,
          h(Button, { onClick: editProcess }, "Edit process template"),
          process.kind === "standard" ? h(Button, { onClick: copyProcess }, "Copy process template") : null,
          h(Button, { className: "primary", onClick: () => openWorkItem(null, process.id) }, "Start process run")
      );

      const routingPanel = h("div", null,
        h(PageHead, { setPageHeader },
          h(Button, { onClick: () => setProcessId("") }, "← Process Templates"),
          h("div", { className: "bees-title" }, process.name)
        ),
        h("details", { className: "bees-box", style: { marginBottom: "16px" } },
          h("summary", null, `Files & folders · ${attached.length} inputs`),
          h(AttachedResourceFields, { key: process.id, ctx, data, teamId, act,
            owner: { processId: process.id }, references: attached, outputId: process.outputLocationId ?? "" })),
        routingBoard
      );

      const agentPanel = agentForm || h(Empty, null, "Select an agent to view or edit");

      return h(GridStackPage, {
        layoutId: "process-detail", defaults: PROCESS_DETAIL_LAYOUT, preference, preferences, setPageActions, pageActions,
        panels: {
          routing: { label: "Routing & Files", minW: 6, minH: 4, content: routingPanel },
          agent: { label: "Agent Settings", minW: 6, minH: 4, content: agentPanel },
          archive: archive ? { label: "Archive", minW: 6, minH: 2, content: archive } : undefined
        }
      });
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
          h("div", { className: "bees-muted" }, [template.description, (template.stages ?? []).join(" → ")].filter(Boolean).join(" · "))),
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
  const processList = h("div", null,
    ...(processes.length ? processes.map((process) => {
      const stages = data.stages.filter(({ processId }) => processId === process.id);
      const creator = process.accountUserId
        ? (data.connections?.find((c) => c.accountUserId === process.accountUserId)?.accountName ?? process.accountUserId)
        : null;
      const subtitle = [process.description, stages.map(({ name }) => name).join(" → "), creator ? `by ${creator}` : null].filter(Boolean).join(" · ");
      return h("button", { type: "button", className: "bees-row", style: { cursor: "pointer", width: "100%", textAlign: "left", font: "inherit", color: "inherit", background: "transparent", border: 0 }, key: process.id, onClick: () => setProcessId(process.id) },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, subtitle)));
    }) : [h(Empty, { key: "empty" }, "No process templates yet")]));
  return h(GridStackPage, {
    layoutId: "processes", defaults: PROCESSES_LAYOUT, preference, preferences, setPageActions,
    panels: {
      planner: { label: "Build a process with Bees", minW: 6, minH: 3, content: h(ProcessPlanner, { data, workspaceId, act }) },
      processes: { label: "Process Templates", actions: h(Button, { className: "primary", disabled: !workspaceId,
        onClick: () => { setProcessDraft(null); setCreating("process"); } }, "New process template"), minW: 6, minH: 4, content: processList }
    }
  });
}
