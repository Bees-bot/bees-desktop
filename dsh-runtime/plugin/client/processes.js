import { h, React } from "./runtime.js";
import { ask, Button, confirmAction, Empty, useSubmit } from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";

const PROCESSES_LAYOUT = [{ kind: "processes", x: 0, y: 0, w: 12, h: 8 }];
const TEMPLATES_LAYOUT = [
  { kind: "about", x: 0, y: 0, w: 12, h: 2 },
  { kind: "templates", x: 0, y: 2, w: 12, h: 8 }
];
const PROCESS_DETAIL_LAYOUT = [
  { kind: "routing", x: 0, y: 0, w: 7, h: 7 },
  { kind: "work", x: 7, y: 0, w: 5, h: 7 },
  { kind: "archive", x: 0, y: 7, w: 12, h: 3 }
];

function ProcessForm({ kind, draft, workspaceId, act, onCancel, onCreated }) {
  const template = kind === "template";
  const initialStages = draft?.stages ?? ["Plan", "Doing", "Done"];
  const [busy, onSubmit] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    const stages = String(form.get("stages") ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    const created = await act({
      action: template ? "create_process_template" : "create_process", workspaceId,
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), stages
    });
    if (created?.id) onCreated(created.id);
  });
  if (!workspaceId) return h("div", { className: "bees-stack" },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Processes"), h("h2", null, template ? "New template" : "New process")),
    h(Empty, null, "Choose one workspace before creating a process."));
  return h("form", { className: "bees-box bees-form", onSubmit },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Processes"),
      h("div", null, h("h2", null, template ? "New process template" : draft ? "Create process from template" : "New process"),
        h("div", { className: "bees-muted" }, template
          ? "A template is a reusable blueprint. It does not run work by itself."
          : "Design the whole workflow here. Each line becomes a stage; the final stage is Done."))),
    h("label", null, template ? "Template name" : "Process name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true,
      defaultValue: draft?.name ?? "", placeholder: template ? "Editorial workflow" : "Publish an article" })),
    h("label", null, "Description", h("textarea", { className: "bees-textarea", name: "description", defaultValue: draft?.description ?? "",
      placeholder: "When should someone use this workflow?" })),
    h("label", null, "Stages (one per line)", h("textarea", { className: "bees-textarea", name: "stages", required: true,
      defaultValue: initialStages.join("\n"), "aria-describedby": "process-stage-help" })),
    h("div", { className: "bees-muted", id: "process-stage-help" }, "Use 2–12 unique stages. A stage named Review gets an independent reviewer; the last stage completes the work."),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: busy }, busy ? "Creating…" : template ? "Create template" : "Create process"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

export function ProcessesPage({ data, route, workspaceIds, workspaceId, teamId, processId, setProcessId, openWorkItem, creating, setCreating, processDraft, setProcessDraft, act, preference, preferences, setPageActions }) {
  const processes = data.processes.filter((process) => workspaceIds.includes(process.workspaceId));
  if (["process", "template"].includes(creating)) return h(ProcessForm, {
    kind: creating, draft: processDraft, workspaceId, act,
    onCancel: () => { setCreating(""); setProcessDraft(null); },
    onCreated: (id) => {
      const wasTemplate = creating === "template";
      setCreating(""); setProcessDraft(null);
      if (!wasTemplate) setProcessId(id);
    }
  });
  const edit = async (process) => {
    const name = await ask("Process name", process.name); if (!name) return;
    const description = await ask("Description", process.description) ?? process.description;
    const current = data.stages.filter(({ processId }) => processId === process.id).map(({ name }) => name);
    const listed = await ask("Stages, comma separated", current.join(", ")); if (listed === null) return;
    const stages = listed.split(",").map((value) => value.trim()).filter(Boolean);
    await act({ action: "edit_process", processId: process.id, name, description, stages });
  };
  if (processId) {
    const process = processes.find(({ id }) => id === processId);
    if (process) {
      const attached = data.processAttachments.filter((row) => row.processId === process.id);
      const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
      const processStages = data.stages.filter(({ processId }) => processId === process.id);
      const processAgents = data.assignments.filter(({ workspaceId }) => workspaceId === process.workspaceId);
      const processPools = data.pools.filter(({ workspaceId }) => workspaceId === process.workspaceId);
      const roots = data.items.filter((item) => item.processId === process.id && !item.parentId && !item.archivedAt && item.kind !== "run");
      const attach = async () => {
        const available = locations.filter((location) => !attached.some(({ locationId }) => locationId === location.id));
        const name = await ask(`Team location:\n${available.map(({ name }) => name).join("\n")}`);
        const location = available.find((row) => row.name === name);
        if (!location) return;
        const relativePath = location.kind === "folder"
          ? await ask("Relative file or folder inside this location (optional)", "")
          : "";
        if (relativePath !== null) await act({ action: "attach_location", processId: process.id, locationId: location.id, relativePath });
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
      const saveTemplate = async () => {
        const name = await ask("Template name", process.name); if (!name) return;
        await act({ action: "save_process_template", processId: process.id, name });
      };
      const archiveProcess = async () => {
        if (!await confirmAction(`Archive “${process.name}”? Its work and history will be preserved.`)) return;
        if (await act({ action: "archive_process", processId: process.id })) setProcessId("");
      };
      const routing = h("div", null,
        h("p", { className: "bees-muted" }, "Assign an agent or pool to each stage here—including a stage named Waiting. “Needs you” is a separate queue for blocked work, not an assignable stage. Workspace defaults remain the fallback."),
        ...processStages.map((stage) => h("div", { className: "bees-row", key: stage.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, stage.name),
            h("div", { className: "bees-muted" }, stage.requiredCapabilities.length
              ? `Requires: ${stage.requiredCapabilities.join(", ")}` : stage.driver)),
          stage.driver === "terminal" ? h("span", { className: "bees-badge" }, "Terminal") : h(React.Fragment, null,
            h("select", {
              className: "bees-select", value: stage.routeType ? `${stage.routeType}:${stage.routeTargetId}` : "",
              "aria-label": `${stage.name} agent route`, onChange: (event) => void setStageRoute(stage, event.target.value)
            },
              h("option", { value: "" }, `Workspace ${stage.driver === "review" ? "reviewer" : "worker"}`),
              h("optgroup", { label: "Agents" }, ...processAgents.map((agent) =>
                h("option", { value: `agent:${agent.id}`, key: agent.id, disabled: !agent.enabled }, agent.name))),
              h("optgroup", { label: "Pools" }, ...processPools.map((pool) =>
                h("option", { value: `pool:${pool.id}`, key: pool.id }, pool.name)))),
            h(Button, { onClick: () => setRequirements(stage) }, "Requirements")))));
      const work = h("div", null, ...(roots.length ? roots.map((item) => {
        const stage = data.stages.find(({ id }) => id === item.stageId);
        return h("button", { className: "bees-row bees-nav-link", key: item.id, onClick: () => openWorkItem(item.id) },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, `${stage?.name ?? "Stage"} · ${item.runtimePhase}`)),
          h("span", { className: `bees-status bees-${item.runtimePhase}` }, item.runtimePhase));
      }) : [h(Empty, { key: "empty" }, "No root work items in this process")]));
      const archive = process.kind === "standard" ? h("div", null,
        h("p", { className: "bees-muted" }, "Archive hides this process without breaking work history or database links."),
        h(Button, { className: "danger", onClick: archiveProcess }, "Archive process")) : null;
      return h("div", null,
        h("div", { className: "bees-row" }, h(Button, { onClick: () => setProcessId("") }, "← All processes"), h("strong", null, process.name), h("div", { className: "bees-grow" }),
          ...attached.map(({ locationId, relativePath }) => {
            const location = locations.find(({ id }) => id === locationId);
            return location ? h(Button, { key: `${locationId}:${relativePath}`, onClick: () => act({ action: "detach_location", processId: process.id, locationId }) }, `$[${location.name}]${relativePath ? `/${relativePath}` : ""} ×`) : null;
          }),
          h(Button, { onClick: attach, disabled: !locations.some((location) => !attached.some(({ locationId }) => locationId === location.id)) }, "Add files"),
          process.kind === "standard" ? h(Button, { onClick: saveTemplate }, "Save as template") : null,
          h(Button, { className: "primary", onClick: () => openWorkItem(null, process.id) }, "New work")),
        h(GridStackPage, {
          layoutId: "process-detail", defaults: PROCESS_DETAIL_LAYOUT, preference, preferences, setPageActions,
          panels: {
            routing: { label: "Stage routing", minW: 5, minH: 4, content: routing },
            work: { label: "Work items", minW: 4, minH: 4, content: work },
            ...(archive ? { archive: { label: "Archive process", minW: 4, minH: 2, content: archive } } : {})
          }
        })
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
          h("div", { className: "bees-muted" }, [template.description, template.stages.join(" → ")].filter(Boolean).join(" · "))),
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
      return h("div", { className: "bees-row", key: process.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, [process.description, stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))),
        h(Button, { onClick: () => setProcessId(process.id) }, "Open"),
        h(Button, { onClick: () => edit(process) }, "Edit"));
    }) : [h(Empty, { key: "empty" }, "No processes yet")]));
  return h(GridStackPage, {
    layoutId: "processes", defaults: PROCESSES_LAYOUT, preference, preferences, setPageActions,
    panels: { processes: { label: "Processes", actions: h(Button, { className: "primary", disabled: !workspaceId,
      onClick: () => { setProcessDraft(null); setCreating("process"); } }, "New process"), minW: 6, minH: 4, content: processList } }
  });
}
