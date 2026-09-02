import { h, useState, React } from "./runtime.js";
import { ask, Button, confirmAction, Empty, useSubmit, PageHead} from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";
import { AgentCreateForm, AgentEditForm } from "./agents.js";
import { AttachedResourceFields, ResourceFields } from "./location-fields.js";

const PROCESSES_LAYOUT = [{ kind: "processes", x: 0, y: 0, w: 12, h: 12 }];
const TEMPLATES_LAYOUT = [
  { kind: "about", x: 0, y: 0, w: 12, h: 2 },
  { kind: "templates", x: 0, y: 2, w: 12, h: 10 }
];
const PROCESS_DETAIL_LAYOUT = [
  { kind: "routing", x: 0, y: 0, w: 12, h: 7 },
  { kind: "agent", x: 0, y: 7, w: 12, h: 10 },
  { kind: "archive", x: 0, y: 17, w: 12, h: 3 }
];

function ProcessForm({ ctx, data, kind, draft, workspaceId, teamId, act, onCancel, onCreated, setPageHeader }) {
  const template = kind === "template";
  const initialStages = (draft?.stages ?? ["Plan", "Doing", "Done"]).map((stage) => stage?.name ?? stage);
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
    h("div", { className: "bees-muted", id: "process-stage-help" }, "Use 2–12 unique stages. A stage named Review gets an independent reviewer; the last stage completes the work."),
    template ? null : h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, outputId: outputLocationId, onOutputId: setOutputLocationId }),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : template ? "Create template" : "Create process template"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

export function ProcessesPage({ ctx, data, servers = [], route, workspaceIds, workspaceId, teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions, setPageHeader }) {
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
      const processPools = data.pools.filter(({ workspaceId }) => workspaceId === process.workspaceId);
      
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

      const setStageRoute = async (stage, value) => {
        const separator = value.indexOf(":");
        await act({
          action: "set_stage_route", stageId: stage.id,
          targetType: separator < 0 ? null : value.slice(0, separator),
          targetId: separator < 0 ? null : value.slice(separator + 1),
          requiredCapabilities: stage.requiredCapabilities
        });
      };
      const setRequirements = async (stage) => {
        const value = await ask("Required capabilities, comma separated", stage.requiredCapabilities.join(", "));
        if (value === null) return;
        await act({
          action: "set_stage_route", stageId: stage.id,
          targetType: stage.routeType, targetId: stage.routeTargetId,
          requiredCapabilities: value.split(",").map((entry) => entry.trim()).filter(Boolean)
        });
      };
      const archiveProcess = async () => {
        if (!await confirmAction(`Archive process template “${process.name}”? Its process runs and history will be preserved.`)) return;
        if (await act({ action: "archive_process", processId: process.id })) setProcessId("");
      };
      const selectedAgent = processAgents.find(({ id }) => id === selectedAgentId);
      const creatingStage = processStages.find(({ id }) => id === creatingStageId);
      
      const routingBoard = h("div", { className: "bees-cockpit-board bees-routing-board" }, ...processStages.map((stage) => {
          const agent = stage.routeType === "agent" ? processAgents.find(({ id }) => id === stage.routeTargetId) : null;
          const pool = stage.routeType === "pool" ? processPools.find(({ id }) => id === stage.routeTargetId) : null;
          
          let card;
          if (stage.driver === "terminal") {
            card = h("div", { className: "bees-hierarchy-card", style: { cursor: "default" } }, h("span", { className: "bees-badge" }, "Terminal"), h("p", { className: "bees-muted", style: { marginTop: "8px" } }, "Work completes here."));
          } else if (agent) {
            card = h("button", { type: "button", className: `bees-hierarchy-card ${selectedAgentId === agent.id ? "active" : ""}`,
              onClick: () => { setCreatingStageId(""); setSelectedAgentId(agent.id); } },
              h("h3", null, agent.name), h("div", { className: "bees-muted" }, [agent.presetId, agent.description].filter(Boolean).join(" · ")));
          } else if (pool) {
            card = h("button", { type: "button", className: "bees-hierarchy-card" }, h("h3", null, pool.name), h("div", { className: "bees-muted" }, "Agent pool"));
          } else {
            card = null;
          }

          const controls = stage.driver === "terminal" ? null : h("div", { className: "bees-form", style: { marginTop: "8px" } },
            h("div", { className: "bees-card-actions", style: { display: "flex", gap: "6px" } },
              h("select", {
                className: "bees-select", style: { flex: 1, fontSize: "13px", padding: "8px" }, value: stage.routeType ? `${stage.routeType}:${stage.routeTargetId}` : "",
                "aria-label": `${stage.name} agent route`, onChange: (event) => {
                  if (event.target.value === "create_new") {
                    event.target.value = "";
                    setSelectedAgentId(""); setCreatingStageId(stage.id);
                  } else {
                    void setStageRoute(stage, event.target.value);
                  }
                }
              },
                h("option", { value: "" }, agent || pool ? "Remove (Use team default)" : "+ Add or Create Agent"),
                h("option", { value: "create_new" }, "+ Create new agent"),
                h("optgroup", { label: "Agents" }, ...processAgents.map((row) =>
                  h("option", { value: `agent:${row.id}`, key: row.id, disabled: !row.enabled }, row.name))),
                h("optgroup", { label: "Pools" }, ...processPools.map((row) =>
                  h("option", { value: `pool:${row.id}`, key: row.id }, row.name))))
            )
          );

          return h("section", { className: "bees-column", key: stage.id },
            h("header", { className: "bees-column-head" }, stage.name),
            h("div", { className: "bees-cards" }, card, controls));
        }));

      const agentForm = creatingStage ? h("div", null,
          
          h(AgentCreateForm, { ctx, data, servers, workspaceId: process.workspaceId, act, inline: true, processId: process.id,
            onCancel: () => setCreatingStageId(""), onCreated: async (id) => {
              await setStageRoute(creatingStage, `agent:${id}`); setCreatingStageId(""); setSelectedAgentId(id);
            } }))
        : selectedAgent ? h("div", null,
          
          h(AgentEditForm, { ctx, data, servers, selected: selectedAgent, act, cancelLabel: "Close", processId: process.id,
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
          h("div", { className: "bees-muted" }, [template.description,
            template.stages.map((stage) => stage?.name ?? stage).join(" → ")].filter(Boolean).join(" · "))),
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
      return h("div", { className: "bees-row", style: { cursor: "pointer" }, key: process.id, onClick: () => setProcessId(process.id) },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, [process.description, stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))));
    }) : [h(Empty, { key: "empty" }, "No process templates yet")]));
  return h(GridStackPage, {
    layoutId: "processes", defaults: PROCESSES_LAYOUT, preference, preferences, setPageActions,
    panels: { processes: { label: "Process Templates", actions: h(Button, { className: "primary", disabled: !workspaceId,
      onClick: () => { setProcessDraft(null); setCreating("process"); } }, "New process template"), minW: 6, minH: 4, content: processList } }
  });
}
