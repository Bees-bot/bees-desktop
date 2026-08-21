window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NAVIGATION = [
      { id: "home", label: "Home", icon: "⌂", defaultChild: "home", children: [] },
      { id: "work", label: "Work", icon: "✓", defaultChild: "all-work", children: [
        ["all-work", "All work"], ["goals", "Goals"], ["waiting", "Waiting on me"], ["completed", "Completed"]
      ] },
      { id: "processes", label: "Processes", icon: "◇", defaultChild: "all-processes", children: [
        ["all-processes", "All processes"], ["schedules", "Schedules"], ["templates", "Templates"]
      ] },
      { id: "agents", label: "Agents", icon: "◎", defaultChild: "all-agents", children: [
        ["all-agents", "All agents"], ["assignments", "Assignments"], ["skills", "Skills"]
      ] },
      { id: "files", label: "Files & Folders", icon: "$", defaultChild: "locations", children: [
        ["locations", "Locations"], ["mappings", "My mappings"], ["references", "References"]
      ] },
      { id: "activity", label: "Activity", icon: "◷", defaultChild: "runs", children: [
        ["runs", "Runs"], ["evaluations", "Evaluations"], ["audit", "Audit"]
      ] },
      { id: "knowledge", label: "Knowledge", icon: "⌕", defaultChild: "search", children: [
        ["search", "Search"], ["sources", "Sources"], ["artifacts", "Artifacts"]
      ] },
      { id: "settings", label: "Settings", icon: "⚙", defaultChild: "workspace-settings", children: [
        ["workspace-settings", "Workspace"], ["team-settings", "Team"], ["organization-settings", "Organization"],
        ["models", "Models & providers"], ["connections", "Connections"], ["permissions", "Permissions"]
      ] }
    ];

    const css = `
      .bees-app{position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:240px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 system-ui,-apple-system,sans-serif;pointer-events:auto}
      .bees-app *{box-sizing:border-box}.bees-sidebar{min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);overflow:auto}.bees-brand{display:flex;align-items:center;gap:8px;padding:18px 16px 12px;font-size:19px;font-weight:800}.bees-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}
      .bees-scope{margin:0 12px 12px;width:calc(100% - 24px)}.bees-nav{display:grid;gap:2px;padding:0 8px 12px}.bees-nav-group{padding:7px 6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-nav-group-head,.bees-nav-menu{display:flex;align-items:center}.bees-nav-group-head .bees-nav-link,.bees-nav-menu .bees-nav-link{min-width:0;flex:1}.bees-nav-link{display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:8px;padding:7px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-nav-link:hover,.bees-nav-link.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-link.active{font-weight:750}.bees-nav-child{padding-left:31px;font-size:12px;color:var(--dsw-alias-label-secondary)}.bees-nav-record{padding-left:31px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-nav-pin{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;filter:grayscale(1);opacity:.55}.bees-nav-pin:hover,.bees-nav-pin.active{background:var(--dsw-alias-interactive-bg-hover);filter:none;opacity:1}.bees-nav-standard{margin-top:6px}.bees-sidebar-foot{margin-top:auto;padding:10px 12px}
      .bees-main{min-width:0;display:flex;flex-direction:column}.bees-top{height:58px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-title{font-size:17px;font-weight:800}.bees-context{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grow{flex:1}.bees-content{min-height:0;flex:1;overflow:auto;padding:22px}.bees-panel{max-width:1050px;margin:0 auto}
      .bees-btn,.bees-select,.bees-input,.bees-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-button-elevated-fill);font:inherit}.bees-btn{padding:7px 11px;cursor:pointer}.bees-btn:hover{background:var(--dsw-alias-button-floating-hover)}.bees-btn.primary{background:#f2b84b;color:#21190b;border-color:#f2b84b;font-weight:700}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-select,.bees-input,.bees-textarea{padding:8px 9px}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
      .bees-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-row-main{min-width:0;flex:1}.bees-row-title{font-weight:700}.bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px;background:var(--dsw-specific-sidebar-fill)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary)}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-failed,.bees-interrupted{color:#cf5b5b}
      .bees-hero{padding:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:linear-gradient(135deg,#f2b84b18,transparent 55%)}.bees-hero h1{font-size:32px;line-height:1.15;margin:0 0 10px}.bees-hero form{display:flex;gap:8px;margin-top:20px}.bees-hero .bees-input{font-size:16px}.bees-proposals{margin-top:18px}.bees-change{margin:7px 0;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-base)}
      .bees-board{display:grid;grid-auto-columns:minmax(250px,1fr);grid-auto-flow:column;gap:12px;overflow-x:auto}.bees-column{min-height:260px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}.bees-column-head{display:flex;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:750}.bees-count{margin-left:auto;color:var(--dsw-alias-label-secondary)}.bees-cards{display:grid;gap:8px;padding:9px}.bees-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.bees-card h3{margin:0 0 4px}.bees-card p{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
      .bees-create{position:relative}.bees-create[open] summary{background:var(--dsw-alias-interactive-bg-hover)}.bees-create summary{list-style:none}.bees-menu{position:absolute;right:0;top:42px;z-index:5;min-width:190px;display:grid;gap:3px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-menu .bees-nav-link{padding:8px}.bees-ask{position:fixed;right:22px;bottom:20px;z-index:95;border-radius:999px;box-shadow:0 8px 24px #0004}.bees-search{display:flex;gap:8px;margin-bottom:16px}
      .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
      .bees-open{display:flex;width:100%;justify-content:center}.bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
      @media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand span:last-child,.bees-nav-link span:last-child,.bees-nav-child,.bees-nav-pin,.bees-scope{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-nav-link{justify-content:center}.bees-content{padding:12px}.bees-hero{padding:20px}.bees-hero form{display:grid}}
    `;

    let activeReferenceWorkspaceId = "";

    async function request(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options?.headers ?? {}) }
      });
      const value = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? value.error ?? `Request failed (${response.status})`);
      return value;
    }

    function dialogValue(label, initial, confirmOnly = false) {
      return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.className = "bees-prompt";
        const form = document.createElement("form");
        form.method = "dialog";
        const title = document.createElement("label");
        title.textContent = label;
        form.append(title);
        const input = confirmOnly ? null : document.createElement("input");
        if (input) {
          input.className = "bees-input";
          input.value = initial;
          input.setAttribute("aria-label", label.split("\n")[0]);
          form.append(input);
        }
        const actions = document.createElement("div");
        actions.className = "bees-prompt-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "bees-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => dialog.close("cancel"));
        const submit = document.createElement("button");
        submit.className = "bees-btn primary";
        submit.textContent = confirmOnly ? "Confirm" : "Continue";
        actions.append(cancel, submit);
        form.append(actions);
        dialog.append(form);
        document.body.append(dialog);
        dialog.addEventListener("close", () => {
          const value = dialog.returnValue === "cancel" ? null : input ? input.value.trim() : true;
          dialog.remove();
          resolve(value);
        }, { once: true });
        requestAnimationFrame(() => { dialog.showModal(); input?.focus(); input?.select(); });
      });
    }

    const ask = (label, initial = "") => dialogValue(label, initial);
    const confirmAction = (label) => dialogValue(label, "", true);
    const Button = ({ children, className = "", ...props }) =>
      h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);

    function usePreference(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      return snapshot.value ?? { pins: [], lastScope: "" };
    }

    function sectionFor(child) {
      return NAVIGATION.find((section) => section.id === child || section.children.some(([id]) => id === child)) ?? NAVIGATION[0];
    }

    function navigationItem(id) {
      const section = NAVIGATION.find((item) => item.id === id || item.children.some(([child]) => child === id));
      if (!section) return null;
      const child = section.children.find(([child]) => child === id);
      return { id, label: child?.[1] ?? section.label, icon: section.icon, route: child?.[0] ?? section.defaultChild };
    }

    function scopeParts(data, scope) {
      const [kind, id] = String(scope).split(":");
      const workspace = kind === "workspace" ? data.workspaces.find((row) => row.id === id) : null;
      const teamId = workspace?.teamId ?? (kind === "team" ? id : "");
      return { workspaceId: workspace?.id ?? "", teamId, workspace };
    }

    function Empty({ children }) { return h("div", { className: "bees-empty" }, children); }

    function PinButton({ id, label, pins, setPins }) {
      const pinned = pins.includes(id);
      return h("button", {
        type: "button", className: `bees-nav-pin ${pinned ? "active" : ""}`,
        title: `${pinned ? "Unpin" : "Pin"} ${label}`, "aria-label": `${pinned ? "Unpin" : "Pin"} ${label}`, "aria-pressed": pinned,
        onClick: (event) => {
          event.stopPropagation();
          setPins(pinned ? pins.filter((pin) => pin !== id) : [...pins, id]);
        }
      }, "📌");
    }

    function workItemsFor(data, route, workspaceIds) {
      let rows = data.items.filter((item) => workspaceIds.includes(data.processes.find(({ id }) => id === item.processId)?.workspaceId) && item.kind !== "run" && !item.archivedAt);
      if (route === "goals") rows = rows.filter(({ kind }) => kind === "goal");
      if (route === "waiting") rows = rows.filter((item) => item.owner || item.agentAssignmentId);
      return rows.filter(({ completed }) => route === "completed" ? completed : !completed);
    }

    function ItemCard({ item, data, stages, run, teamId, act }) {
      const index = stages.findIndex(({ id }) => id === item.stageId);
      const assignments = data.assignments.filter(({ workspaceId }) => workspaceId === data.processes.find(({ id }) => id === item.processId)?.workspaceId);
      const attached = data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId }) => locationId);
      const locations = data.locations.filter((location) => location.teamId === teamId && !location.archivedAt);
      const edit = async () => {
        const title = await ask("Work title", item.title); if (!title) return;
        const description = await ask("Description", item.description) ?? item.description;
        const owner = await ask("Person responsible (optional)", item.owner ?? "") ?? "";
        const agentName = await ask(`Agent assignment (optional):\n${assignments.map(({ name }) => name).join("\n")}`, assignments.find(({ id }) => id === item.agentAssignmentId)?.name ?? "") ?? "";
        const assignment = assignments.find(({ name }) => name === agentName);
        await act({ action: "edit_item", itemId: item.id, title, description, owner, priority: item.priority, parentId: item.parentId, agentAssignmentId: assignment?.id ?? null });
      };
      const attach = async () => {
        const available = locations.filter(({ id }) => !attached.includes(id));
        const name = await ask(`Team location:\n${available.map(({ name }) => name).join("\n")}`);
        const location = available.find((row) => row.name === name);
        if (!location) return;
        const relativePath = location.kind === "folder"
          ? await ask("Relative file or folder inside this location (optional)", "")
          : "";
        if (relativePath !== null) await act({ action: "attach_location", itemId: item.id, locationId: location.id, relativePath });
      };
      const start = async () => {
        const model = await ask("Model route (provider/model), or blank for the DSH default", "");
        if (model === null) return;
        await act({ action: "run_item", itemId: item.id, model: model || null });
      };
      const schedule = async () => {
        const name = await ask("Schedule name", `Run ${item.title}`); if (!name) return;
        const recurrence = await ask("Recurrence: hourly, daily, or weekdays", "daily");
        if (!["hourly", "daily", "weekdays"].includes(recurrence)) return;
        const nextRunAt = await ask("First run (ISO date and time)", new Date(Date.now() + 3_600_000).toISOString());
        if (nextRunAt) await act({ action: "upsert_schedule", itemId: item.id, name, recurrence, nextRunAt });
      };
      return h("article", { className: "bees-card", draggable: true, onDragStart: (event) => event.dataTransfer.setData("text/bees-item", item.id) },
        h("h3", null, item.title),
        h("div", { className: "bees-muted" }, [item.kind, item.owner, assignments.find(({ id }) => id === item.agentAssignmentId)?.name].filter(Boolean).join(" · ")),
        item.description ? h("p", null, item.description) : null,
        ...data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId: id, relativePath }) => {
          const location = locations.find((row) => row.id === id);
          return location ? h(Button, { key: `${id}:${relativePath}`, onClick: () => act({ action: "detach_location", itemId: item.id, locationId: id }) }, `$[${location.name}]${relativePath ? `/${relativePath}` : ""} ×`) : null;
        }),
        h("div", { className: "bees-card-actions" },
          run ? h("span", { className: `bees-status bees-${run.status}` }, run.status) : null,
          index > 0 ? h(Button, { onClick: () => act({ action: "move_item", itemId: item.id, stageId: stages[index - 1].id }) }, "←") : null,
          index < stages.length - 1 ? h(Button, { onClick: () => act({ action: "move_item", itemId: item.id, stageId: stages[index + 1].id }) }, "→") : null,
          h(Button, { onClick: edit }, "Edit"), h(Button, { onClick: attach, disabled: !locations.some(({ id }) => !attached.includes(id)) }, "Files"),
          h(Button, { onClick: schedule }, "Schedule"),
          run?.status === "running" || run?.status === "waiting_for_approval"
            ? h(Button, { onClick: () => act({ action: "stop_run", executionId: run.id }) }, "Stop")
            : run?.status === "interrupted"
              ? h(Button, { onClick: () => act({ action: "recover_run", executionId: run.id }) }, "Resume")
              : h(Button, { className: "primary", onClick: start }, "Run"),
          run?.status === "completed" && attached.length ? h(Button, { onClick: async () => {
            const choices = locations.filter(({ id }) => attached.includes(id));
            const name = await ask(`Publish to:\n${choices.map(({ name }) => name).join("\n")}`);
            const location = choices.find((row) => row.name === name);
            if (location) await act({ action: "publish_run", executionId: run.id, locationId: location.id });
          } }, "Publish") : null,
          h(Button, { className: "danger", onClick: async () => (await confirmAction(`Archive “${item.title}”?`)) && act({ action: "archive_item", itemId: item.id }) }, "Archive")
        )
      );
    }

    function Board({ data, processId, teamId, act }) {
      const stages = data.stages.filter((stage) => stage.processId === processId);
      const items = data.items.filter((item) => item.processId === processId && !item.archivedAt && item.kind !== "run");
      const latest = new Map();
      for (const run of data.runs) if (run.workItemId && !latest.has(run.workItemId)) latest.set(run.workItemId, run);
      const create = async () => {
        const title = await ask("Work title", ""); if (!title) return;
        const description = await ask("Description", "") ?? "";
        await act({ action: "create_item", processId, stageId: stages[0]?.id, title, description });
      };
      return h("div", null,
        h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
          h(Button, { className: "primary", disabled: !stages.length, onClick: create }, "New work")),
        h("div", { className: "bees-board" }, ...stages.map((stage) => {
        const rows = items.filter((item) => item.stageId === stage.id);
        return h("section", { className: "bees-column", key: stage.id, onDragOver: (event) => event.preventDefault(), onDrop: (event) => {
          event.preventDefault(); const itemId = event.dataTransfer.getData("text/bees-item");
          if (itemId) void act({ action: "move_item", itemId, stageId: stage.id });
        } },
        h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
        h("div", { className: "bees-cards" }, ...(rows.length ? rows.map((item) => h(ItemCard, { key: item.id, item, data, stages, run: latest.get(item.id), teamId, act })) : [h(Empty, { key: "empty" }, "Drop work here")]))
        );
      })));
    }

    function Home({ data, workspaceId, act, askBees }) {
      const [outcome, setOutcome] = useState("");
      const proposals = data.proposals.filter((row) => row.workspaceId === workspaceId && row.status === "pending");
      return h("div", { className: "bees-panel" },
        h("section", { className: "bees-hero" }, h("h1", null, "What outcome should Bees own?"),
          h("p", { className: "bees-muted" }, "Ask an agent to propose a goal or visible process. Nothing changes until you review and apply it."),
          h("form", { onSubmit: (event) => { event.preventDefault(); if (outcome.trim()) void askBees(outcome).then(() => setOutcome("")); } },
            h("input", { className: "bees-input", value: outcome, disabled: !workspaceId, onChange: (event) => setOutcome(event.target.value), placeholder: workspaceId ? "Launch the new product without missing a handoff" : "Choose a workspace first", "aria-label": "Outcome" }),
            h("button", { className: "bees-btn primary", disabled: !workspaceId || !outcome.trim() }, "Ask Bees")
          )),
        h("div", { className: "bees-proposals" }, h("h2", null, "Proposals"),
          ...(proposals.length ? proposals.map((proposal) => h("article", { className: "bees-box", key: proposal.id },
            h("h3", null, proposal.title), h("p", { className: "bees-muted" }, proposal.summary),
            ...proposal.changes.map((change, index) => h("div", { className: "bees-change", key: index },
              h("strong", null, change.action === "create_goal" ? `Goal: ${change.title}` : `Process: ${change.name}`),
              change.stages ? h("div", { className: "bees-muted" }, change.stages.join(" → ")) : null)),
            h("div", { className: "bees-card-actions" },
              h(Button, { className: "primary", onClick: () => act({ action: "apply_proposal", proposalId: proposal.id }) }, "Apply proposal"),
              h(Button, { onClick: () => act({ action: "reject_proposal", proposalId: proposal.id }) }, "Dismiss")
            ))) : [h(Empty, { key: "empty" }, "No proposals waiting for review")])
        )
      );
    }

    function WorkPage({ data, route, workspaceIds, workspaceId, act, openProcess }) {
      const rows = workItemsFor(data, route, workspaceIds);
      const createGoal = async () => {
        const title = await ask("Goal", ""); if (!title) return;
        const description = await ask("What does success look like?", "") ?? "";
        await act({ action: "create_goal", workspaceId, title, description });
      };
      return h("div", null,
        route === "goals" ? h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: createGoal }, "New goal")) : null,
        ...(rows.length ? rows.map((item) => {
          const process = data.processes.find(({ id }) => id === item.processId);
          const stage = data.stages.find(({ id }) => id === item.stageId);
          return h("button", { className: "bees-row bees-nav-link", key: item.id, onClick: () => openProcess(item.processId) },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, `${process?.name ?? "Process"} · ${stage?.name ?? "Stage"}`)),
            h("span", { className: "bees-status" }, item.kind));
        }) : [h(Empty, { key: "empty" }, route === "goals" ? "No goals yet" : "No work in this view")])
      );
    }

    function ProcessesPage({ data, route, workspaceIds, workspaceId, teamId, processId, setProcessId, act }) {
      const processes = data.processes.filter((process) => workspaceIds.includes(process.workspaceId));
      const edit = async (process) => {
        const name = await ask("Process name", process.name); if (!name) return;
        const description = await ask("Description", process.description) ?? process.description;
        const current = data.stages.filter(({ processId }) => processId === process.id).map(({ name }) => name);
        const stages = ((await ask("Stages, comma separated", current.join(", "))) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await act({ action: "edit_process", processId: process.id, name, description, stages });
      };
      if (processId) {
        const process = processes.find(({ id }) => id === processId);
        if (process) {
          const attached = data.processAttachments.filter((row) => row.processId === process.id);
          const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
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
          return h("div", null,
            h("div", { className: "bees-row" }, h(Button, { onClick: () => setProcessId("") }, "← All processes"), h("strong", null, process.name), h("div", { className: "bees-grow" }),
              ...attached.map(({ locationId, relativePath }) => {
                const location = locations.find(({ id }) => id === locationId);
                return location ? h(Button, { key: `${locationId}:${relativePath}`, onClick: () => act({ action: "detach_location", processId: process.id, locationId }) }, `$[${location.name}]${relativePath ? `/${relativePath}` : ""} ×`) : null;
              }),
              h(Button, { onClick: attach, disabled: !locations.some((location) => !attached.some(({ locationId }) => locationId === location.id)) }, "Add files")),
            h(Board, { data, processId, teamId, act })
          );
        }
      }
      if (route === "templates") return h(Empty, null, "No process templates yet. Save a real process as a template when reuse becomes useful.");
      if (route === "schedules") {
        const schedules = data.schedules.filter((schedule) => workspaceIds.includes(schedule.workspaceId));
        const target = (schedule) => schedule.targetKind === "process"
          ? data.processes.find(({ id }) => id === schedule.processId)?.name
          : data.items.find(({ id }) => id === schedule.workItemId)?.title;
        const command = (schedule) => schedule.targetKind === "process"
          ? { processId: schedule.processId }
          : { itemId: schedule.workItemId };
        return h("div", null,
          ...(schedules.length ? schedules.map((schedule) => h("div", { className: "bees-row", key: schedule.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, schedule.name), h("div", { className: "bees-muted" }, `${target(schedule) ?? "Unavailable target"} · ${schedule.recurrence} · ${schedule.timezone} · next ${new Date(schedule.nextRunAt).toLocaleString()}`)),
            h(Button, { onClick: () => act({ action: "trigger_schedule", ...command(schedule), scheduleId: schedule.id }) }, "Run now"),
            h(Button, { onClick: () => act({ action: "toggle_schedule", ...command(schedule), scheduleId: schedule.id, enabled: !schedule.enabled }) }, schedule.enabled ? "Pause" : "Enable"),
            h(Button, { className: "danger", onClick: async () => (await confirmAction(`Delete schedule “${schedule.name}”?`)) && act({ action: "delete_schedule", ...command(schedule), scheduleId: schedule.id }) }, "Delete")
          )) : [h(Empty, { key: "empty" }, "No schedules yet")])
        );
      }
      const create = async () => {
        const name = await ask("Process name", ""); if (!name) return;
        const description = await ask("Description", "") ?? "";
        const stages = ((await ask("Stages, comma separated", "Plan, Doing, Done")) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await act({ action: "create_process", workspaceId, name, description, stages });
      };
      const schedule = async (process) => {
        const name = await ask("Schedule name", `Run ${process.name}`); if (!name) return;
        const recurrence = await ask("Recurrence: hourly, daily, or weekdays", "daily");
        if (!["hourly", "daily", "weekdays"].includes(recurrence)) return;
        const nextRunAt = await ask("First run (ISO date and time)", new Date(Date.now() + 3_600_000).toISOString());
        if (nextRunAt) await act({ action: "upsert_schedule", processId: process.id, name, recurrence, nextRunAt });
      };
      return h("div", null,
        h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: create }, "New process")),
        ...(processes.length ? processes.map((process) => {
          const stages = data.stages.filter(({ processId }) => processId === process.id);
          return h("div", { className: "bees-row", key: process.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, [process.description, stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))),
            h(Button, { onClick: () => setProcessId(process.id) }, "Board"),
            h(Button, { onClick: () => schedule(process) }, "Schedule"),
            h(Button, { onClick: () => edit(process) }, "Edit"));
        }) : [h(Empty, { key: "empty" }, "No processes yet")])
      );
    }

    function AgentsPage({ data, route, workspaceIds, workspaceId, act, openDsh }) {
      const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
      if (route === "skills") return h(Empty, null, h("span", null, "Skills are owned by DSH. ", h(Button, { onClick: openDsh }, "Open DSH Skills")));
      const add = async () => {
        const presetName = await ask(`DSH preset:\n${data.presets.filter(({ broken }) => !broken).map(({ name }) => name).join("\n")}`, data.presets.find(({ id }) => id === "standard")?.name ?? "standard");
        const preset = data.presets.find((row) => row.name === presetName || row.id === presetName); if (!preset) return;
        const name = await ask("Agent name", preset.name); if (!name) return;
        await act({ action: "add_agent_assignment", workspaceId, presetId: preset.id, name });
      };
      if (route === "assignments") {
        const rows = data.items.filter((item) => item.agentAssignmentId && assignments.some(({ id }) => id === item.agentAssignmentId));
        return rows.length ? rows.map((item) => h("div", { className: "bees-row", key: item.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, assignments.find(({ id }) => id === item.agentAssignmentId)?.name)))) : h(Empty, null, "No work is assigned to an agent yet");
      }
      return h("div", null, h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: add }, "New agent assignment")),
        ...(assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.presetId} · ${agent.description || "DSH preset assignment"}`)))) : [h(Empty, { key: "empty" }, "No agents assigned to this scope")])
      );
    }

    function FilesPage({ ctx, data, route, teamId, act }) {
      const team = data.teams.find(({ id }) => id === teamId);
      const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
      const pickFolder = async () => ctx.workspaces.pickDirectory();
      const addFolder = async () => {
        const path = await pickFolder(); if (!path) return;
        const name = await ask("Team location name", path.split(/[\\/]/).filter(Boolean).pop() ?? "Files");
        if (name) await act({ action: "add_location", teamId, name, kind: "folder", path });
      };
      const addFile = async () => {
        const path = typeof ctx.workspaces.pickFile === "function"
          ? await ctx.workspaces.pickFile()
          : await ask("Absolute path to a file on this device", "");
        if (!path) return;
        const name = await ask("Team file name", path.split(/[\\/]/).filter(Boolean).pop() ?? "File");
        if (name) await act({ action: "add_location", teamId, name, kind: "file", path });
      };
      const pickMapping = async (location) => location.kind === "folder"
        ? pickFolder()
        : ask(`Absolute path for ${location.name} on this device`, location.localPath ?? "");
      if (route === "references") return h("div", { className: "bees-grid" },
        ...locations.map((location) => h("section", { className: "bees-box", key: location.id }, h("h3", null, `$[${location.name}]`), h("p", { className: "bees-muted" }, `Stable logical id ${location.logicalId}. Add /relative/path when referencing a child.`))),
        locations.length ? null : h(Empty, null, "Create a location before using logical references"));
      if (route === "mappings") return h("div", null, ...locations.map((location) => h("div", { className: "bees-row", key: location.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, location.localPath || "Not mapped on this device")),
        h(Button, { onClick: async () => { const path = await pickMapping(location); if (path) await act({ action: "map_location", locationId: location.id, path }); } }, location.mapped ? "Change" : "Map"),
        location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null
      )), locations.length ? null : h(Empty, null, "No team locations to map"));
      return h("div", null,
        h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
          h(Button, { disabled: !teamId || team?.role !== "admin", onClick: addFile }, "Add file"),
          h(Button, { className: "primary", disabled: !teamId || team?.role !== "admin", onClick: addFolder }, "Add folder")),
        ...(locations.length ? locations.map((location) => h("div", { className: "bees-row", key: location.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, `${location.kind} · ${location.mapped ? "mapped on this device" : "mapping needed"}`)),
          h(Button, { className: "danger", disabled: team?.role !== "admin", onClick: async () => (await confirmAction(`Archive “${location.name}”? This will not delete the external folder.`)) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
        )) : [h(Empty, { key: "empty" }, "No shared team locations yet")])
      );
    }

    function ActivityPage({ data, route, workspaceIds, ctx, openDsh }) {
      const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
      const [events, setEvents] = useState([]);
      useEffect(() => { if (route === "audit") void request("/bees-api/audit").then((value) => setEvents(value.events)); }, [route]);
      if (route === "evaluations") return h(Empty, null, "Evaluations are not available in the current DSH/Bees profile.");
      if (route === "audit") return h("div", null, ...(events.length ? events.map((event) => h("div", { className: "bees-row", key: event.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, event.type), h("div", { className: "bees-muted" }, new Date(event.createdAt).toLocaleString())))) : [h(Empty, { key: "empty" }, "No audit events yet")]));
      return h("div", null, ...(runs.length ? runs.map((run) => h("button", { className: "bees-row bees-nav-link", key: run.id, onClick: () => { ctx.sessions.open(run.sessionId); openDsh(); } },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Ask Bees"), h("div", { className: "bees-muted" }, new Date(run.updatedAt).toLocaleString())),
        h("span", { className: `bees-status bees-${run.status}` }, run.status))) : [h(Empty, { key: "empty" }, "No runs yet")]))
      ;
    }

    function KnowledgePage({ data, route, workspaceId, teamId }) {
      const [query, setQuery] = useState("");
      const [results, setResults] = useState([]);
      if (route === "sources") {
        const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
        return locations.length ? locations.map((row) => h("div", { className: "bees-row", key: row.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, row.name), h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")))) : h(Empty, null, "No approved sources in this team");
      }
      if (route === "artifacts") {
        const rows = data.runs.filter((run) => run.workspaceId === workspaceId && run.outputs.length);
        return rows.length ? rows.map((run) => h("div", { className: "bees-row", key: run.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Run"), h("div", { className: "bees-muted" }, run.outputs.join(", "))))) : h(Empty, null, "No run artifacts yet");
      }
      return h("div", null, h("form", { className: "bees-search", onSubmit: async (event) => { event.preventDefault(); setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results); } },
        h("input", { className: "bees-input", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }), h("button", { className: "bees-btn primary", disabled: !workspaceId }, "Search")),
        ...results.map((result) => h("div", { className: "bees-row", key: result.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, result.title), h("div", { className: "bees-muted" }, result.excerpt)))),
        h("p", { className: "bees-muted" }, "DSH owns conversation search; use its workspace sidebar to search transcripts."));
    }

    function SettingsPage({ data, route, workspaceId, teamId, openDsh }) {
      const workspace = data.workspaces.find(({ id }) => id === workspaceId);
      const team = data.teams.find(({ id }) => id === teamId);
      const organization = data.organizations.find(({ id }) => id === team?.organizationId);
      if (route === "models" || route === "connections") return h(Empty, null, h("span", null, `${route === "models" ? "Models and providers" : "MCP connections and credentials"} are owned by DSH. `, h(Button, { onClick: openDsh }, "Open DSH settings")));
      if (route === "workspace-settings") return workspace ? h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, workspace.name), h("p", { className: "bees-muted" }, `${workspace.authority === "local" ? "Private on this device" : "Connected"} · ${workspace.hosting}`), h("p", { className: "bees-muted" }, `DSH workspace ${workspace.dshWorkspaceId || "initializing"}`))) : h(Empty, null, "Choose a workspace to view workspace settings");
      if (route === "team-settings") return team ? h("section", { className: "bees-box" }, h("h3", null, team.name), h("p", { className: "bees-muted" }, `${team.role} · ${data.workspaces.filter((row) => row.teamId === team.id).length} workspaces · ${data.locations.filter((row) => row.teamId === team.id && !row.archivedAt).length} locations`)) : h(Empty, null, "Choose a team");
      if (route === "organization-settings") return organization ? h("section", { className: "bees-box" }, h("h3", null, organization.name), h("p", { className: "bees-muted" }, `${organization.role} · ${organization.personal ? "personal organization" : "organization"}`)) : h(Empty, null, "Choose an organization");
      return h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, "Organization role"), h("p", null, organization?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Team role"), h("p", null, team?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Runtime enforcement"), h("p", { className: "bees-muted" }, "Direct domain commands enforce membership and role checks. DSH approval protects publication and protected tools.")));
    }

    function ScopeSelector({ data, value, onChange }) {
      const simple = data.organizations.length === 1 && data.teams.length === 1;
      return h("select", { className: "bees-select bees-scope", value, onChange: (event) => onChange(event.target.value), "aria-label": "Organization, team, and workspace" },
        ...data.teams.flatMap((team) => {
          const organization = data.organizations.find(({ id }) => id === team.organizationId);
          const options = [h("option", { key: `team:${team.id}`, value: `team:${team.id}` }, simple ? "All workspaces" : `${team.name} — All workspaces`),
            ...data.workspaces.filter(({ teamId }) => teamId === team.id).map((workspace) => h("option", { key: `workspace:${workspace.id}`, value: `workspace:${workspace.id}` }, simple ? workspace.name : `${team.name} — ${workspace.name}`))];
          return simple ? options : [h("optgroup", { key: team.id, label: `${organization?.name ?? "Organization"} / ${team.name}` }, ...options)];
        })
      );
    }

    function BeesApp({ ctx, useSessions, preferences }) {
      const currentSessionId = useSessions((state) => state.current);
      const observedSession = useRef({ ready: false, id: undefined });
      const preference = usePreference(preferences);
      const [open, setOpen] = useState(true);
      const [data, setData] = useState(null);
      const [error, setError] = useState("");
      const [route, setRoute] = useState("home");
      const [scope, setScopeState] = useState("");
      const [processId, setProcessId] = useState("");
      const load = async () => {
        try { const value = await request("/bees-api/snapshot"); setData(value); setError(""); return value; }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
      };
      useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, []);
      useEffect(() => {
        if (!data) return;
        const valid = new Set([...data.teams.map(({ id }) => `team:${id}`), ...data.workspaces.map(({ id }) => `workspace:${id}`)]);
        const preferred = valid.has(preference.lastScope) ? preference.lastScope : `workspace:${data.workspaces[0]?.id ?? ""}`;
        setScopeState((current) => valid.has(current) ? current : preferred);
      }, [data, preference.lastScope]);
      const setScope = (next) => {
        setScopeState(next); setProcessId("");
        void preferences.set("lastScope", next);
      };
      const parts = data ? scopeParts(data, scope) : { workspaceId: "", teamId: "" };
      activeReferenceWorkspaceId = parts.workspaceId;
      const workspaceIds = data ? (parts.workspaceId ? [parts.workspaceId] : data.workspaces.filter(({ teamId }) => teamId === parts.teamId).map(({ id }) => id)) : [];
      useEffect(() => {
        if (!data || (observedSession.current.ready && observedSession.current.id === currentSessionId)) return;
        observedSession.current = { ready: true, id: currentSessionId };
        if (!currentSessionId) return;
        const run = data.runs.find((row) => row.sessionId === currentSessionId || row.previousSessionId === currentSessionId);
        if (!run) return setOpen(false);
        if (run.workItemId) {
          setScope(`workspace:${run.workspaceId}`); setRoute("runs"); setOpen(true);
        } else setOpen(false);
      }, [currentSessionId, data]);
      useEffect(() => {
        const navigate = (event) => { setRoute(event.detail || "home"); setOpen(true); ctx.layout.closeDetails(); };
        window.addEventListener("bees:navigate", navigate);
        return () => window.removeEventListener("bees:navigate", navigate);
      }, [ctx]);
      const act = async (command) => {
        try { const result = await request("/bees-api/command", { method: "POST", body: JSON.stringify(command) }); await load(); return result; }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
      };
      const openDsh = () => { setOpen(false); ctx.layout.closeDetails(); };
      const askBees = async (outcome) => {
        if (!parts.workspaceId) return null;
        const result = await act({ action: "ask_bees", workspaceId: parts.workspaceId, outcome });
        if (result?.sessionId) { ctx.sessions.open(result.sessionId); openDsh(); }
        return result;
      };
      const navigate = (id) => {
        const section = NAVIGATION.find((row) => row.id === id);
        setRoute(section ? section.defaultChild : id); setProcessId("");
      };
      const createTeam = async () => {
        const organizationName = await ask(`Organization:\n${data.organizations.map(({ name }) => name).join("\n")}`, data.organizations[0]?.name ?? "");
        const organization = data.organizations.find(({ name }) => name === organizationName); if (!organization) return;
        const name = await ask("Team name", ""); if (!name) return;
        const result = await act({ action: "create_team", organizationId: organization.id, name });
        if (result?.id) setScope(`team:${result.id}`);
      };
      const createWorkspace = async () => {
        let team = data.teams.find(({ id }) => id === parts.teamId);
        if (!team) { const name = await ask(`Team:\n${data.teams.map(({ name }) => name).join("\n")}`); team = data.teams.find((row) => row.name === name); }
        if (!team) return;
        const name = await ask("Workspace name", ""); if (!name) return;
        const result = await act({ action: "create_workspace", teamId: team.id, name });
        if (result?.id) setScope(`workspace:${result.id}`);
      };
      const createGoal = async () => { const title = await ask("Goal", ""); if (title && parts.workspaceId) await act({ action: "create_goal", workspaceId: parts.workspaceId, title }); };
      const createProcess = async () => {
        if (!parts.workspaceId) return;
        const name = await ask("Process name", ""); if (!name) return;
        const stages = ((await ask("Stages, comma separated", "Plan, Doing, Done")) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await act({ action: "create_process", workspaceId: parts.workspaceId, name, stages });
      };
      const createRun = async () => {
        const processes = data.processes.filter((row) => row.workspaceId === parts.workspaceId && row.kind === "standard");
        const processName = await ask(`Process:\n${processes.map(({ name }) => name).join("\n")}`, processes[0]?.name ?? "");
        const process = processes.find(({ name }) => name === processName); if (!process) return;
        const title = await ask("One-off run name", `New ${process.name} run`); if (!title) return;
        const work = await act({ action: "create_run", processId: process.id, title });
        if (work?.id) await act({ action: "run_item", itemId: work.id });
      };
      const createAgent = async () => {
        if (!parts.workspaceId) return;
        const presetName = await ask(`DSH preset:\n${data.presets.filter(({ broken }) => !broken).map(({ name }) => name).join("\n")}`, "standard");
        const preset = data.presets.find((row) => row.name === presetName || row.id === presetName); if (!preset) return;
        const name = await ask("Agent name", preset.name); if (name) await act({ action: "add_agent_assignment", workspaceId: parts.workspaceId, presetId: preset.id, name });
      };
      if (!open) return null;
      if (!data) return h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…");
      const section = sectionFor(route);
      const routeLabel = section.children.find(([id]) => id === route)?.[1] ?? section.label;
      const pins = (preference.pins ?? []).filter((id) => navigationItem(id));
      const setPins = (next) => preferences.set("pins", next);
      const openProcess = (id) => { setRoute("all-processes"); setProcessId(id); };
      const pinnedRows = (targetRoute) => {
        const target = sectionFor(targetRoute);
        const openRoute = () => navigate(targetRoute);
        if (target.id === "work") return workItemsFor(data, targetRoute, workspaceIds)
          .map((item) => ({ id: item.id, label: item.title, open: () => openProcess(item.processId) }));
        if (target.id === "processes") {
          if (targetRoute === "schedules") return data.schedules.filter((row) => workspaceIds.includes(row.workspaceId))
            .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
          const rows = data.processes.filter((row) => workspaceIds.includes(row.workspaceId) && (targetRoute !== "templates" || row.kind === "template"));
          return rows.map((row) => ({ id: row.id, label: row.name, open: () => { setRoute("all-processes"); setProcessId(row.id); } }));
        }
        if (target.id === "agents") {
          const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
          if (targetRoute === "skills") return [];
          if (targetRoute === "assignments") return data.items.filter((item) => item.agentAssignmentId && assignments.some(({ id }) => id === item.agentAssignmentId))
            .map((item) => ({ id: item.id, label: item.title, open: () => openProcess(item.processId) }));
          return assignments.map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        }
        if (target.id === "files" || targetRoute === "sources") return data.locations.filter((row) => row.teamId === parts.teamId && !row.archivedAt)
          .map((row) => ({ id: row.id, label: row.name, open: openRoute }));
        if (targetRoute === "runs") return data.runs.filter((row) => workspaceIds.includes(row.workspaceId)).map((row) => ({
          id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Ask Bees",
          open: () => { ctx.sessions.open(row.sessionId); openDsh(); }
        }));
        if (targetRoute === "artifacts") return data.runs.filter((row) => row.workspaceId === parts.workspaceId && row.outputs.length)
          .map((row) => ({ id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Run", open: openRoute }));
        if (targetRoute === "workspace-settings" && parts.workspace) return [{ id: parts.workspace.id, label: parts.workspace.name, open: openRoute }];
        if (targetRoute === "team-settings") {
          const team = data.teams.find(({ id }) => id === parts.teamId);
          return team ? [{ id: team.id, label: team.name, open: openRoute }] : [];
        }
        if (targetRoute === "organization-settings") {
          const team = data.teams.find(({ id }) => id === parts.teamId);
          const organization = data.organizations.find(({ id }) => id === team?.organizationId);
          return organization ? [{ id: organization.id, label: organization.name, open: openRoute }] : [];
        }
        return [];
      };
      const page = route === "home" ? h(Home, { data, workspaceId: parts.workspaceId, act, askBees })
        : section.id === "work" ? h(WorkPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, act, openProcess })
          : section.id === "processes" ? h(ProcessesPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, act })
            : section.id === "agents" ? h(AgentsPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, act, openDsh })
              : section.id === "files" ? h(FilesPage, { ctx, data, route, teamId: parts.teamId, act })
                : section.id === "activity" ? h(ActivityPage, { data, route, workspaceIds, ctx, openDsh })
                  : section.id === "knowledge" ? h(KnowledgePage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId })
                    : h(SettingsPage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId, openDsh });
      return h("div", { className: "bees-app" },
        h("aside", { className: "bees-sidebar" },
          h("div", { className: "bees-brand" }, h("span", { className: "bees-mark" }, "B"), h("span", null, "Bees")),
          h(ScopeSelector, { data, value: scope, onChange: setScope }),
          h("nav", { className: "bees-nav", "aria-label": "Bees navigation" },
            ...pins.map((id) => {
              const pinned = navigationItem(id);
              return h("div", { className: "bees-nav-group", key: `pin:${id}` },
                h("div", { className: "bees-nav-group-head" },
                  h("button", { className: `bees-nav-link ${route === pinned.route ? "active" : ""}`, onClick: () => navigate(pinned.route) }, h("span", null, pinned.icon), h("span", null, pinned.label)),
                  h(PinButton, { id: pinned.id, label: pinned.label, pins, setPins })),
                ...pinnedRows(pinned.route).map((row) => h("button", { className: "bees-nav-link bees-nav-record", title: row.label, key: `${pinned.id}:${row.id}`, onClick: row.open }, row.label))
              );
            }),
            h("div", { className: "bees-nav-standard" }, ...NAVIGATION.flatMap((item) => [
              h("div", { className: "bees-nav-menu", key: item.id },
                h("button", { className: `bees-nav-link ${section.id === item.id ? "active" : ""}`, onClick: () => navigate(item.id) }, h("span", null, item.icon), h("span", null, item.label)),
                h(PinButton, { id: item.id, label: item.label, pins, setPins })),
              ...(section.id === item.id ? item.children.map(([child, label]) =>
                h("div", { className: "bees-nav-menu", key: `${item.id}:${child}` },
                  h("button", { className: `bees-nav-link bees-nav-child ${route === child ? "active" : ""}`, onClick: () => navigate(child) }, label),
                  h(PinButton, { id: child, label, pins, setPins }))) : [])
            ]))
          ),
          h("div", { className: "bees-sidebar-foot" }, h(Button, { className: "bees-open", onClick: openDsh }, "DSH"))
        ),
        h("section", { className: "bees-main" },
          h("header", { className: "bees-top" }, h("div", { className: "bees-title" }, routeLabel),
            route !== "home" ? h("div", { className: "bees-context" }, parts.workspaceId ? parts.workspace?.name : "All workspaces in this team") : null,
            route !== "home" ? h(PinButton, { id: route, label: routeLabel, pins, setPins }) : null,
            h("div", { className: "bees-grow" }),
            h("details", { className: "bees-create" }, h("summary", { className: "bees-btn", title: "Create", role: "button", "aria-label": "Create" }, "+"), h("div", { className: "bees-menu" },
              h("button", { className: "bees-nav-link", onClick: createWorkspace }, "New workspace"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createGoal }, "New goal"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createProcess }, "New process"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createRun }, "New one-off run"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createAgent }, "New agent"),
              h("button", { className: "bees-nav-link", onClick: createTeam }, "New team")
            ))),
          error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
          h("main", { className: "bees-content" }, h("div", { className: "bees-panel" }, page)),
          route !== "home" ? h(Button, { className: "primary bees-ask", disabled: !parts.workspaceId, onClick: async () => { const outcome = await ask("What outcome should Bees own?", ""); if (outcome) await askBees(outcome); } }, "Ask Bees") : null
        )
      );
    }

    function SidebarProductNav({ wide }) {
      return h("button", { type: "button", className: "bees-btn bees-open", title: "Open Bees", onClick: () => window.dispatchEvent(new CustomEvent("bees:navigate", { detail: "home" })) }, wide ? "Open Bees" : "B");
    }

    function referenceToken(item) {
      const prefix = item.namespace === "$" ? "$" : "@";
      return `${prefix}[${String(item.label).replace(/[\]\\]/g, "")}](bees:${item.kind}:${item.id})`;
    }

    exports.inject = ["slots", "inputTriggers", "workspaces", "layout", "sessions", "settingsScope"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-plugin";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees: styles");
      const preferences = ctx.settingsScope.bind({ namespace: "bees-ui" });
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "bees-product", order: -100, label: "Bees",
        inject: () => ({ ctx, preferences })
      }, BeesApp));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action", id: "bees-navigation", order: -100, label: "Bees"
      }, SidebarProductNav));
      ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({
        name: "sidebar.brand.name", id: "bees-brand", priority: -100
      }, () => h("span", null, "Bees")));
      ctx.effect(() => {
        const timer = setTimeout(() =>
          window.dispatchEvent(new CustomEvent("bees:navigate", { detail: "home" })), 750);
        return () => clearTimeout(timer);
      }, "bees: open product on startup");
      const cache = new Map();
      const referenceSource = (trigger) => ({
        trigger, name: trigger === "$" ? "bees-files" : "bees", order: -20, showGroupTitle: true,
        async candidates(_session, { query, signal }) {
          if (!activeReferenceWorkspaceId) return [];
          const value = await request(`/bees-api/references?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(activeReferenceWorkspaceId)}`, { signal });
          const rows = (trigger === "$" ? value.dollar ?? [] : value.at ?? [])
            .map((item) => ({ ...item, namespace: trigger }));
          for (const item of rows) cache.set(`${item.kind}:${item.id}`, item);
          return rows.map((item) => ({ name: `${item.namespace}[${item.label}]`, description: item.kind, section: trigger === "$" ? "Files & Folders" : "Bees", value: JSON.stringify(item) }));
        },
        onPick({ candidate }) {
          const item = JSON.parse(candidate.value);
          const token = referenceToken(item);
          return { insert: { source: "bees", ref: token, label: `${item.namespace}[${item.label}]`, clipboardText: token } };
        },
        lexicon: () => [...cache.values()].filter((item) => item.namespace === trigger).map((item) => `${item.namespace}[${item.label}]`),
        codec: { clipboardText: (ref) => ref, serialize: (ref) => Promise.resolve(ref) }
      });
      ctx.effect(() => ctx.inputTriggers.registerSource(referenceSource("@")), "bees: typed @ references");
      ctx.effect(() => ctx.inputTriggers.registerSource(referenceSource("$")), "bees: typed $ references");
    };
    return module.exports;
  }
});
