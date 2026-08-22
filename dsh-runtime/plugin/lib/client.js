window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;
    const { LocalAiController, LocalAiSettings, ExternalLocalAiSettings } = require("@bees/dsh-local-ai");
    const { FreeAiController, FreeAiSettings } = require("@bees/dsh-free-ai");
    const { CustomAiSettings } = require("@bees/dsh-custom-ai");
    const { SubscriptionSettings } = require("@bees/dsh-subscriptions");

    const NAVIGATION = [
      { id: "home", label: "Home", icon: "⌂", defaultChild: "home", children: [] },
      { id: "work", label: "Work", icon: "✓", defaultChild: "all-work", children: [
        ["all-work", "All work"], ["goals", "Goals"], ["waiting", "Waiting on me"], ["completed", "Completed"]
      ] },
      { id: "processes", label: "Processes", icon: "◇", defaultChild: "all-processes", children: [
        ["all-processes", "All processes"], ["templates", "Templates"]
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
      { id: "settings", label: "Settings", icon: "⚙", defaultChild: "personal-ai", children: [
        ["personal-ai", "AI connections"], ["appearance", "Appearance"],
        ["organizations", "Organizations & invitations"], ["organization-settings", "Organization"],
        ["team-settings", "Team"], ["workspace-settings", "Workspace"],
        ["connections", "Connections"], ["permissions", "Permissions"],
        ["dsh-settings", "DSH settings"]
      ] }
    ];

    const THEMES = [
      ["light", "Light"],
      ["dark", "Dark"],
      ["system", "System"]
    ];

    const css = `
      .bees-app{position:absolute;inset:0;z-index:90;display:grid;grid-template-columns:240px 1fr;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.4 system-ui,-apple-system,sans-serif;pointer-events:auto}
      .bees-app *{box-sizing:border-box}.bees-sidebar{min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);overflow:auto}.bees-brand{display:flex;align-items:center;gap:8px;padding:18px 16px 10px;font-size:19px;font-weight:800}.bees-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#f2b84b;color:#21190b}.bees-context-switcher{position:relative;margin:0 12px 11px}.bees-context-switcher summary{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);cursor:pointer;list-style:none}.bees-context-switcher summary::-webkit-details-marker{display:none}.bees-context-summary{min-width:0;flex:1}.bees-context-primary,.bees-context-secondary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-context-primary{font-weight:750}.bees-context-secondary{color:var(--dsw-alias-label-secondary);font-size:11px}.bees-context-arrow{color:var(--dsw-alias-label-secondary)}.bees-context-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:100%;max-height:430px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-context-search{margin-bottom:7px}.bees-context-section{display:grid;gap:2px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}.bees-context-section:first-of-type{border-top:0}.bees-context-label{padding:2px 7px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.bees-context-option{display:flex;align-items:center;gap:7px;width:100%;padding:7px;border:0;border-radius:7px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-context-option:hover,.bees-context-option.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-context-check{width:14px}.bees-context-add{color:var(--dsw-alias-label-secondary)}
      .bees-nav{display:grid;gap:2px;padding:0 8px 12px}.bees-nav-group{padding:7px 6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-nav-group-head,.bees-nav-menu{display:flex;align-items:center}.bees-nav-group-head .bees-nav-link,.bees-nav-menu .bees-nav-link{min-width:0;flex:1}.bees-nav-link{display:flex;align-items:center;gap:9px;width:100%;border:0;border-radius:8px;padding:7px 9px;color:inherit;background:transparent;text-align:left;font:inherit;cursor:pointer}.bees-nav-link:hover,.bees-nav-link.active{background:var(--dsw-alias-interactive-bg-hover)}.bees-nav-link.active{font-weight:750}.bees-nav-child{padding-left:31px;font-size:12px;color:var(--dsw-alias-label-secondary)}.bees-nav-record{padding-left:31px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bees-nav-pin{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;filter:grayscale(1);opacity:.55}.bees-nav-pin:hover,.bees-nav-pin.active{background:var(--dsw-alias-interactive-bg-hover);filter:none;opacity:1}.bees-nav-standard{margin-top:6px}.bees-sidebar-foot{margin-top:auto;padding:10px 12px}
      .bees-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}.bees-top{height:58px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-title{font-size:17px;font-weight:800}.bees-context{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grow{flex:1}.bees-theme-toggle{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-button-elevated-fill);cursor:pointer}.bees-theme-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-hover)}.bees-theme-toggle svg{width:16px;height:16px}.bees-theme-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.bees-content{min-height:0;flex:1;overflow:auto;padding:22px}.bees-panel{max-width:1050px;margin:0 auto}
      .bees-btn,.bees-select,.bees-input,.bees-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-button-elevated-fill);font:inherit}.bees-btn{padding:7px 11px;cursor:pointer}.bees-btn:hover{background:var(--dsw-alias-button-floating-hover)}.bees-btn.primary{background:#f2b84b;color:#21190b;border-color:#f2b84b;font-weight:700}.bees-btn.danger{color:#d15353}.bees-btn:disabled{opacity:.5;cursor:not-allowed}.bees-select,.bees-input,.bees-textarea{padding:8px 9px}.bees-input,.bees-textarea{width:100%}.bees-textarea{min-height:88px;resize:vertical}
      .bees-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.bees-row-main{min-width:0;flex:1}.bees-row-title{font-weight:700}.bees-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.bees-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.bees-box{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px;background:var(--dsw-specific-sidebar-fill)}.bees-box h2,.bees-box h3{margin:0 0 9px}.bees-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary)}.bees-error{margin:10px 18px 0;padding:9px 12px;border-radius:8px;background:#a9363622;color:#d45d5d}.bees-status{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.bees-running{color:#2e9b61}.bees-failed,.bees-interrupted{color:#cf5b5b}
      .bees-hero{padding:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:linear-gradient(135deg,#f2b84b18,transparent 55%)}.bees-hero h1{font-size:32px;line-height:1.15;margin:0 0 10px}.bees-hero form{display:flex;gap:8px;margin-top:20px}.bees-hero .bees-input{font-size:16px}.bees-proposals{margin-top:18px}.bees-change{margin:7px 0;padding:9px;border-radius:8px;background:var(--dsw-alias-bg-base)}
      .bees-board{display:grid;grid-auto-columns:minmax(250px,1fr);grid-auto-flow:column;gap:12px;overflow-x:auto}.bees-column{min-height:260px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill)}.bees-column-head{display:flex;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:750}.bees-count{margin-left:auto;color:var(--dsw-alias-label-secondary)}.bees-cards{display:grid;gap:8px;padding:9px}.bees-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:11px;background:var(--dsw-alias-bg-base)}.bees-card h3{margin:0 0 4px}.bees-card p{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px}.bees-card-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.bees-card-actions .bees-btn{padding:4px 7px;font-size:11px}
      .bees-create{position:relative}.bees-create[open] summary{background:var(--dsw-alias-interactive-bg-hover)}.bees-create summary{list-style:none}.bees-menu{position:absolute;right:0;top:42px;z-index:5;min-width:190px;display:grid;gap:3px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 35px #0004}.bees-menu .bees-nav-link{padding:8px}.bees-search{display:flex;gap:8px;margin-bottom:16px}
      .bees-prompt{width:min(540px,calc(100vw - 32px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:0;box-shadow:0 18px 60px #0006}.bees-prompt::backdrop{background:#0008}.bees-prompt form{display:grid;gap:14px;padding:20px}.bees-prompt label{white-space:pre-wrap;font-weight:700}.bees-prompt-actions{display:flex;justify-content:flex-end;gap:8px}
      .bees-transcript{display:grid;gap:10px;margin-top:14px}.bees-message{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-specific-sidebar-fill);white-space:pre-wrap}.bees-message strong{display:block;margin-bottom:5px;text-transform:capitalize}.bees-loading{grid-column:1/-1;display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-secondary)}
      .bees-stack{display:grid;gap:12px}.bees-form{display:grid;gap:10px}.bees-form-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap}.bees-form-row label{display:grid;gap:5px;min-width:160px;flex:1}.bees-form-row .bees-btn{flex:0 0 auto}.bees-badge{display:inline-flex;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase}.bees-segmented{display:flex;gap:7px;flex-wrap:wrap}.bees-segmented .active{border-color:#f2b84b;background:#f2b84b22}.bees-section-title{margin:20px 0 8px}.bees-section-title:first-child{margin-top:0}
      @media(max-width:780px){.bees-app{grid-template-columns:76px 1fr}.bees-brand span:last-child,.bees-nav-link span:last-child,.bees-nav-child,.bees-nav-pin{display:none}.bees-brand{justify-content:center;padding-inline:8px}.bees-context-switcher{margin-inline:8px}.bees-context-switcher summary{justify-content:center;padding-inline:6px}.bees-context-summary{display:none}.bees-context-panel{position:fixed;top:54px;left:82px;width:260px}.bees-nav-link{justify-content:center}.bees-content{padding:12px}.bees-hero{padding:20px}.bees-hero form{display:grid}}
    `;

    async function request(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options?.headers ?? {}) }
      });
      const value = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? value.error ?? `Request failed (${response.status})`);
      return value;
    }

    async function openExternal(url) {
      const invoke = window.__TAURI__?.core?.invoke;
      if (invoke) return invoke("open_external_url", { url });
      if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Your browser blocked the website window");
    }

    const collaboration = (action, values = {}) => request("/bees-api/collaboration", action ? {
      method: "POST", body: JSON.stringify({ action, ...values })
    } : undefined);

    function dialogValue(label, initial, confirmOnly = false, inputType = "text") {
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
          input.type = inputType;
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

    const ask = (label, initial = "", inputType = "text") => dialogValue(label, initial, false, inputType);
    const confirmAction = (label) => dialogValue(label, "", true);
    const Button = ({ children, className = "", ...props }) =>
      h("button", { type: "button", className: `bees-btn ${className}`, ...props }, children);

    function ThemeIcon({ theme }) {
      const props = {
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
      };
      if (theme === "light") return h("svg", props,
        h("circle", { cx: 12, cy: 12, r: 3.5 }),
        h("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" })
      );
      if (theme === "dark") return h("svg", props,
        h("path", { d: "M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" })
      );
      return h("svg", props,
        h("rect", { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        h("path", { d: "M8 21h8M12 17v4" })
      );
    }

    function ThemeToggle({ ctx }) {
      const [preference, setPreference] = useState(() => ctx.theme.getTheme().preference);
      useEffect(() => ctx.on("theme/change", ({ preference: next }) => setPreference(next)), [ctx]);
      const currentIndex = Math.max(0, THEMES.findIndex(([theme]) => theme === preference));
      const [currentTheme, currentLabel] = THEMES[currentIndex];
      const [nextTheme, nextLabel] = THEMES[(currentIndex + 1) % THEMES.length];
      const label = `${currentLabel} theme; switch to ${nextLabel}`;
      return h("button", {
        type: "button", className: "bees-theme-toggle", title: label, "aria-label": label,
        onClick: () => ctx.theme.setTheme(nextTheme)
      }, h(ThemeIcon, { theme: currentTheme }));
    }

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
      const team = data.teams.find((row) => row.id === teamId);
      const organizationId = team?.organizationId ?? (kind === "organization" ? id : "");
      const organization = data.organizations.find((row) => row.id === organizationId);
      return { workspaceId: workspace?.id ?? "", teamId, organizationId, workspace, team, organization };
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
      if (route === "waiting") rows = rows.filter((item) =>
        item.runtimePhase === "waiting" || data.runs.some((run) =>
          run.workItemId === item.id && run.status === "waiting_for_approval"));
      return rows.filter(({ completed }) => route === "completed" ? completed : !completed);
    }

    function ItemCard({ item, data, stages, run, teamId, act }) {
      const index = stages.findIndex(({ id }) => id === item.stageId);
      const automatic = stages.length > 0 && stages.every(({ driver }) => ["agent", "review", "terminal"].includes(driver));
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
        const model = await ask("Model route (provider/model), or blank for the default", "");
        if (model === null) return;
        await act({ action: "run_item", itemId: item.id, model: model || null });
      };
      return h("article", { className: "bees-card", draggable: !automatic, onDragStart: (event) => {
        if (!automatic) event.dataTransfer.setData("text/bees-item", item.id);
      } },
        h("h3", null, item.title),
        h("div", { className: "bees-muted" }, [item.kind, automatic ? item.runtimePhase : null, item.owner, assignments.find(({ id }) => id === item.agentAssignmentId)?.name].filter(Boolean).join(" · ")),
        item.description ? h("p", null, item.description) : null,
        item.runtimeError ? h("p", { className: "bees-error" }, item.runtimeError) : null,
        ...data.attachments.filter(({ workItemId }) => workItemId === item.id).map(({ locationId: id, relativePath }) => {
          const location = locations.find((row) => row.id === id);
          return location ? h(Button, { key: `${id}:${relativePath}`, onClick: () => act({ action: "detach_location", itemId: item.id, locationId: id }) }, `$[${location.name}]${relativePath ? `/${relativePath}` : ""} ×`) : null;
        }),
        h("div", { className: "bees-card-actions" },
          automatic ? h("span", { className: `bees-status bees-${item.runtimePhase}` }, item.runtimePhase) :
            run ? h("span", { className: `bees-status bees-${run.status}` }, run.status) : null,
          !automatic && index > 0 ? h(Button, { onClick: () => act({ action: "move_item", itemId: item.id, stageId: stages[index - 1].id }) }, "←") : null,
          !automatic && index < stages.length - 1 ? h(Button, { onClick: () => act({ action: "move_item", itemId: item.id, stageId: stages[index + 1].id }) }, "→") : null,
          h(Button, { onClick: edit }, "Edit"), h(Button, { onClick: attach, disabled: !locations.some(({ id }) => !attached.includes(id)) }, "Files"),
          automatic && ["running", "waiting"].includes(item.runtimePhase)
            ? h(Button, { onClick: () => act({ action: "pause_item", itemId: item.id }) }, "Pause")
            : automatic && item.runtimePhase === "paused"
              ? h(Button, { className: "primary", onClick: () => act({ action: "resume_item", itemId: item.id }) }, "Resume")
              : automatic && item.runtimePhase === "failed"
                ? h(Button, { className: "primary", onClick: () => act({ action: "retry_item", itemId: item.id }) }, "Retry")
                : null,
          automatic && ["running", "waiting", "paused", "failed"].includes(item.runtimePhase)
            ? h(Button, { onClick: () => act({ action: "cancel_item", itemId: item.id }) }, "Cancel")
            : !automatic && (run?.status === "running" || run?.status === "waiting_for_approval")
            ? h(Button, { onClick: () => act({ action: "stop_run", executionId: run.id }) }, "Stop")
            : !automatic && run?.status === "interrupted"
              ? h(Button, { onClick: () => act({ action: "recover_run", executionId: run.id }) }, "Resume")
              : !automatic ? h(Button, { className: "primary", onClick: start }, "Run") : null,
          !automatic && run?.status === "completed" && attached.length ? h(Button, { onClick: async () => {
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
      const automatic = stages.length > 0 && stages.every(({ driver }) => ["agent", "review", "terminal"].includes(driver));
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
        return h("section", { className: "bees-column", key: stage.id, onDragOver: (event) => {
          if (!automatic) event.preventDefault();
        }, onDrop: (event) => {
          if (automatic) return;
          event.preventDefault(); const itemId = event.dataTransfer.getData("text/bees-item");
          if (itemId) void act({ action: "move_item", itemId, stageId: stage.id });
        } },
        h("header", { className: "bees-column-head" }, stage.name, h("span", { className: "bees-count" }, rows.length)),
        h("div", { className: "bees-cards" }, ...(rows.length ? rows.map((item) => h(ItemCard, { key: item.id, item, data, stages, run: latest.get(item.id), teamId, act })) : [h(Empty, { key: "empty" }, automatic ? "No work in this stage" : "Drop work here")]))
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
      const create = async () => {
        const name = await ask("Process name", ""); if (!name) return;
        const description = await ask("Description", "") ?? "";
        const stages = ((await ask("Stages, comma separated", "Plan, Doing, Done")) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await act({ action: "create_process", workspaceId, name, description, stages });
      };
      return h("div", null,
        h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: create }, "New process")),
        ...(processes.length ? processes.map((process) => {
          const stages = data.stages.filter(({ processId }) => processId === process.id);
          return h("div", { className: "bees-row", key: process.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, process.name), h("div", { className: "bees-muted" }, [process.description, stages.map(({ name }) => name).join(" → ")].filter(Boolean).join(" · "))),
            h(Button, { onClick: () => setProcessId(process.id) }, "Board"),
            h(Button, { onClick: () => edit(process) }, "Edit"));
        }) : [h(Empty, { key: "empty" }, "No processes yet")])
      );
    }

    function AgentsPage({ data, route, workspaceIds, workspaceId, act }) {
      const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
      if (route === "skills") return h(Empty, null, "No additional skills are configured for this workspace.");
      const add = async () => {
        const presetName = await ask(`Agent preset:\n${data.presets.filter(({ broken }) => !broken).map(({ name }) => name).join("\n")}`, data.presets.find(({ id }) => id === "standard")?.name ?? "standard");
        const preset = data.presets.find((row) => row.name === presetName || row.id === presetName); if (!preset) return;
        const name = await ask("Agent name", preset.name); if (!name) return;
        await act({ action: "add_agent_assignment", workspaceId, presetId: preset.id, name });
      };
      if (route === "assignments") {
        const rows = data.items.filter((item) => item.agentAssignmentId && assignments.some(({ id }) => id === item.agentAssignmentId));
        return rows.length ? rows.map((item) => h("div", { className: "bees-row", key: item.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, item.title), h("div", { className: "bees-muted" }, assignments.find(({ id }) => id === item.agentAssignmentId)?.name)))) : h(Empty, null, "No work is assigned to an agent yet");
      }
      return h("div", null, h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: add }, "New agent assignment")),
        ...(assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.presetId} · ${agent.description || "Agent preset assignment"}`)))) : [h(Empty, { key: "empty" }, "No agents assigned to this scope")])
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

    function ActivityPage({ data, route, workspaceIds }) {
      const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
      const [events, setEvents] = useState([]);
      const [selected, setSelected] = useState("");
      const [history, setHistory] = useState(null);
      useEffect(() => { if (route === "audit") void request("/bees-api/audit").then((value) => setEvents(value.events)); }, [route]);
      useEffect(() => {
        let active = true;
        if (!selected) { setHistory(null); return () => { active = false; }; }
        request(`/bees-api/run-history?executionId=${encodeURIComponent(selected)}`)
          .then((value) => active && setHistory(value.history))
          .catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
        return () => { active = false; };
      }, [selected]);
      if (route === "evaluations") return h(Empty, null, "Evaluations are not available in the current Bees profile.");
      if (route === "audit") return h("div", null, ...(events.length ? events.map((event) => h("div", { className: "bees-row", key: event.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, event.type), h("div", { className: "bees-muted" }, new Date(event.createdAt).toLocaleString())))) : [h(Empty, { key: "empty" }, "No audit events yet")]));
      const run = runs.find(({ id }) => id === selected);
      if (run) return h("div", null,
        h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelected("") }, "← Runs"), h("strong", null, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Ask Bees"), h("div", { className: "bees-grow" }), h("span", { className: `bees-status bees-${run.status}` }, run.status)),
        run.outputs.length ? h("section", { className: "bees-box" }, h("h3", null, "Outputs"), h("p", null, run.outputs.join(", "))) : null,
        history?.error ? h(Empty, null, history.error) : history ? h("div", { className: "bees-transcript" },
          ...(history.messages?.length ? history.messages.map((message) => h("div", { className: "bees-message", key: message.id },
            h("strong", null, message.role),
            message.parts.map((part, index) => h("div", { key: index }, part.type === "tool" ? `${part.toolName}: ${part.state}` : part.text ?? ""))
          )) : [h(Empty, { key: "empty" }, "No transcript messages yet")])
        ) : h(Empty, null, "Loading transcript…")
      );
      return h("div", null, ...(runs.length ? runs.map((row) => h("button", { className: "bees-row bees-nav-link", key: row.id, onClick: () => setSelected(row.id) },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === row.workItemId)?.title ?? "Ask Bees"), h("div", { className: "bees-muted" }, new Date(row.updatedAt).toLocaleString())),
        h("span", { className: `bees-status bees-${row.status}` }, row.status))) : [h(Empty, { key: "empty" }, "No runs yet")]))
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
        h("p", { className: "bees-muted" }, "Run transcripts are available from Activity → Runs."));
    }

    function AiSettings({ ctx, modelSettings, preferences }) {
      return h("div", { className: "bees-stack" },
        h(SubscriptionSettings, { modelSettings, openExternal, Button }),
        h(FreeAiSettings, { ctx, modelSettings, preferences, ask, confirmAction, openExternal, Button }),
        h(LocalAiSettings, { modelSettings, preferences, ask, confirmAction, Button }),
        h(ExternalLocalAiSettings, { modelSettings, ask, Button }),
        h(CustomAiSettings, { ctx, modelSettings, preferences, ask, confirmAction, openExternal, Button }));
    }

    function AppearanceSettings({ ctx }) {
      const theme = ctx.get("theme");
      const [snapshot, setSnapshot] = useState(() => theme.getTheme());
      useEffect(() => ctx.on("theme/change", setSnapshot), [ctx]);
      return h("section", { className: "bees-box" }, h("h3", null, "Appearance"),
        h("p", { className: "bees-muted" }, "This preference applies across organizations and workspaces on this device."),
        h("div", { className: "bees-segmented" }, ...["system", "light", "dark"].map((id) =>
          h(Button, { key: id, className: snapshot.preference === id ? "active" : "", "aria-pressed": snapshot.preference === id,
            onClick: () => { theme.setTheme(id); setSnapshot(theme.getTheme()); } }, id[0].toUpperCase() + id.slice(1)))));
    }

    function OrganizationsSettings({ reload }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState("");
      const [mode, setMode] = useState("sign_in");
      const [busy, setBusy] = useState(false);
      const refresh = async () => {
        try { setData(await collaboration()); setError(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      useEffect(() => { void refresh(); }, []);
      const auth = async (event) => {
        event.preventDefault(); setBusy(true);
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        try {
          setData(await collaboration(mode, {
            name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? "")
          }));
          setError(""); await reload();
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
      };
      if (!data) return h(Empty, null, error || "Loading account…");
      if (!data.account) return h("div", { className: "bees-stack" },
        h("section", { className: "bees-box" }, h("h3", null, mode === "sign_in" ? "Sign in" : "Create account"),
          h("p", { className: "bees-muted" }, "Sign in to see organization invitations and manage connected organizations."),
          h("div", { className: "bees-segmented" },
            h(Button, { className: mode === "sign_in" ? "active" : "", onClick: () => setMode("sign_in") }, "Sign in"),
            h(Button, { className: mode === "sign_up" ? "active" : "", onClick: () => setMode("sign_up") }, "Create account")),
          h("form", { className: "bees-form", onSubmit: auth },
            mode === "sign_up" ? h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true })) : null,
            h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
            h("label", null, "Password", h("input", { className: "bees-input", name: "password", type: "password", minLength: 8, required: true })),
            h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Connecting…" : mode === "sign_in" ? "Sign in" : "Create account"))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
      const run = async (action, values = {}) => {
        setBusy(true);
        try { setData(await collaboration(action, values)); setError(""); await reload(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
      };
      return h("div", { className: "bees-stack" },
        h("section", { className: "bees-box" }, h("h3", null, data.account.name || data.account.email),
          h("p", { className: "bees-muted" }, data.account.email),
          h("div", { className: "bees-form-row" }, h(Button, { disabled: busy, onClick: () => run("sync") }, "Refresh"),
            h(Button, { className: "danger", disabled: busy, onClick: () => run("sign_out") }, "Sign out"))),
        h("section", { className: "bees-box" }, h("h3", null, "Organizations"),
          ...(data.organizations.length ? data.organizations.map((organization) => h("div", { className: "bees-row", key: organization.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, organization.name), h("div", { className: "bees-muted" }, organization.role))))
            : [h(Empty, { key: "empty" }, "No connected organizations yet")])),
        h("section", { className: "bees-box" }, h("h3", null, "Pending invitations"),
          ...(data.invitations.length ? data.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, invitation.organizationName),
              h("div", { className: "bees-muted" }, `${invitation.role} · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)),
            h(Button, { className: "primary", disabled: busy, onClick: () => run("accept_invitation", { invitationId: invitation.id }) }, "Accept")))
            : [h(Empty, { key: "empty" }, "No pending organization invitations")])),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    function OrganizationSettings({ organization }) {
      const [people, setPeople] = useState(null);
      const [error, setError] = useState("");
      const load = async () => {
        if (!organization?.connected || !["owner", "admin"].includes(organization.role)) return;
        try { setPeople(await collaboration("organization_people", { organizationId: organization.id })); setError(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      useEffect(() => { setPeople(null); setError(""); void load(); }, [organization?.id]);
      if (!organization) return h(Empty, null, "Choose an organization");
      if (!organization.connected) return h("section", { className: "bees-box" }, h("h3", null, organization.name),
        h("p", { className: "bees-muted" }, "This organization is local to this device. Connect an account to invite members."));
      if (!["owner", "admin"].includes(organization.role)) return h("section", { className: "bees-box" }, h("h3", null, organization.name),
        h("p", { className: "bees-muted" }, `Your role is ${organization.role}. Only organization administrators can invite members.`));
      const invite = async (event) => {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        try { setPeople(await collaboration("invite_organization_member", { organizationId: organization.id,
          email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); formElement.reset(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      if (!people) return h(Empty, null, error || "Loading organization members…");
      return h("div", { className: "bees-stack" },
        h("section", { className: "bees-box" }, h("h3", null, `${organization.name} members`),
          ...people.memberships.map((member) => h("div", { className: "bees-row", key: member.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
              h("div", { className: "bees-muted" }, member.status)), h("span", { className: "bees-badge" }, member.role)))),
        h("section", { className: "bees-box" }, h("h3", null, "Invite organization member"),
          h("form", { className: "bees-form-row", onSubmit: invite },
            h("label", null, "Email", h("input", { className: "bees-input", name: "email", type: "email", required: true })),
            h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
            h("button", { className: "bees-btn primary" }, "Send invitation")),
          ...people.invitations.map((invitation) => h("div", { className: "bees-row", key: invitation.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, invitation.email),
              h("div", { className: "bees-muted" }, `Pending · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`)),
            h("span", { className: "bees-badge" }, invitation.role)))),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    function TeamSettings({ team, organization }) {
      const [people, setPeople] = useState(null);
      const [error, setError] = useState("");
      const load = async () => {
        if (!team || !organization?.connected || team.role !== "admin") return;
        try { setPeople(await collaboration("team_people", { teamId: team.id })); setError(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      useEffect(() => { setPeople(null); setError(""); void load(); }, [team?.id]);
      if (!team) return h(Empty, null, "Choose a team");
      if (!organization?.connected) return h("section", { className: "bees-box" }, h("h3", null, team.name),
        h("p", { className: "bees-muted" }, "This team is local to this device."));
      if (team.role !== "admin") return h("section", { className: "bees-box" }, h("h3", null, team.name),
        h("p", { className: "bees-muted" }, "Only team administrators can add organization members to this team."));
      if (!people) return h(Empty, null, error || "Loading team members…");
      const add = async (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        try { setPeople(await collaboration("add_team_member", { teamId: team.id,
          userId: String(form.get("userId") ?? ""), role: String(form.get("role") ?? "member") })); setError(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      };
      return h("div", { className: "bees-stack" },
        h("section", { className: "bees-box" }, h("h3", null, `${team.name} members`),
          ...people.members.map((member) => h("div", { className: "bees-row", key: member.id },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.email || member.userId),
              h("div", { className: "bees-muted" }, "Active organization member")), h("span", { className: "bees-badge" }, member.role)))),
        h("section", { className: "bees-box" }, h("h3", null, "Add organization member"),
          h("p", { className: "bees-muted" }, "Team membership starts immediately; there is no invitation to accept."),
          people.candidates.length ? h("form", { className: "bees-form-row", onSubmit: add },
            h("label", null, "Organization member", h("select", { className: "bees-select", name: "userId" },
              ...people.candidates.map((candidate) => h("option", { value: candidate.userId, key: candidate.userId }, candidate.email || candidate.userId)))),
            h("label", null, "Role", h("select", { className: "bees-select", name: "role" }, h("option", { value: "member" }, "Member"), h("option", { value: "admin" }, "Admin"))),
            h("button", { className: "bees-btn primary" }, "Add member")) : h(Empty, null, "Every active organization member is already on this team")),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null);
    }

    function SettingsPage({ ctx, data, route, workspaceId, teamId, organizationId, modelSettings, preferences, reload }) {
      const workspace = data.workspaces.find(({ id }) => id === workspaceId);
      const team = data.teams.find(({ id }) => id === teamId);
      const organization = data.organizations.find(({ id }) => id === organizationId);
      if (route === "personal-ai") return h(AiSettings, { ctx, modelSettings, preferences });
      if (route === "appearance") return h(AppearanceSettings, { ctx });
      if (route === "organizations") return h(OrganizationsSettings, { reload });
      if (route === "connections") return h(Empty, null, "No external tool connections are configured in this Bees profile.");
      if (route === "workspace-settings") return workspace ? h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, workspace.name), h("p", { className: "bees-muted" }, `${workspace.authority === "local" ? "Private on this device" : "Connected"} · ${workspace.hosting}`), h("p", { className: "bees-muted" }, workspace.dshWorkspaceId ? "Runtime ready" : "Runtime initializing"))) : h(Empty, null, "Choose a workspace to view workspace settings");
      if (route === "team-settings") return h(TeamSettings, { team, organization });
      if (route === "organization-settings") return h(OrganizationSettings, { organization });
      return h("div", { className: "bees-grid" }, h("section", { className: "bees-box" }, h("h3", null, "Organization role"), h("p", null, organization?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Team role"), h("p", null, team?.role ?? "None")), h("section", { className: "bees-box" }, h("h3", null, "Runtime enforcement"), h("p", { className: "bees-muted" }, "Membership and role checks protect domain commands. Bees approval protects publication and protected tools.")));
    }

    function ContextSwitcher({ data, organizationId, teamId, workspaceId, onChange, onCreateOrganization, onCreateTeam, onCreateWorkspace }) {
      const [query, setQuery] = useState("");
      const root = useRef(null);
      useEffect(() => {
        const dismiss = (event) => { if (!root.current?.contains(event.target)) root.current?.removeAttribute("open"); };
        document.addEventListener("pointerdown", dismiss, true);
        return () => document.removeEventListener("pointerdown", dismiss, true);
      }, []);
      const organization = data.organizations.find(({ id }) => id === organizationId);
      const team = data.teams.find(({ id }) => id === teamId);
      const workspace = data.workspaces.find(({ id }) => id === workspaceId);
      const needle = query.trim().toLocaleLowerCase();
      const matches = ({ name }) => !needle || name.toLocaleLowerCase().includes(needle);
      const close = (event) => event.currentTarget.closest("details")?.removeAttribute("open");
      const option = (row, active, select, closeAfter = false) => h("button", {
        className: `bees-context-option ${active ? "active" : ""}`, key: row.id,
        onClick: (event) => { select(); if (closeAfter) close(event); }
      }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, active ? "✓" : ""), row.name);
      const add = (label, action, disabled = false) => h("button", {
        className: "bees-context-option bees-context-add", onClick: action, disabled
      }, h("span", { className: "bees-context-check", "aria-hidden": "true" }, "+"), label);
      const organizations = data.organizations.filter(matches);
      const teams = data.teams.filter((row) => row.organizationId === organizationId && matches(row));
      const workspaces = data.workspaces.filter((row) => row.teamId === teamId && matches(row));
      return h("details", { className: "bees-context-switcher", ref: root },
        h("summary", null,
          h("div", { className: "bees-context-summary" },
            h("div", { className: "bees-context-primary" }, organization?.name ?? "Choose organization"),
            h("div", { className: "bees-context-secondary" }, team ? `${team.name} · ${workspace?.name ?? "All workspaces"}` : "Choose team")),
          h("span", { className: "bees-context-arrow", "aria-hidden": "true" }, "▾")),
        h("div", { className: "bees-context-panel" },
          h("input", { className: "bees-input bees-context-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search contexts", "aria-label": "Search organizations, teams, and workspaces" }),
          h("div", { className: "bees-context-section" },
            h("div", { className: "bees-context-label" }, "Organizations"),
            ...organizations.map((row) => option(row, row.id === organizationId, () => onChange(`organization:${row.id}`))),
            add("New organization", onCreateOrganization)),
          h("div", { className: "bees-context-section" },
            h("div", { className: "bees-context-label" }, organization ? `Teams in ${organization.name}` : "Teams"),
            ...teams.map((row) => option(row, row.id === teamId, () => onChange(`team:${row.id}`))),
            add("New team", onCreateTeam, !organizationId)),
          h("div", { className: "bees-context-section" },
            h("div", { className: "bees-context-label" }, team ? `Workspaces in ${team.name}` : "Workspaces"),
            team && (!needle || "all workspaces".includes(needle)) ? option({ id: `all:${team.id}`, name: "All workspaces" }, !workspaceId, () => onChange(`team:${team.id}`), true) : null,
            ...workspaces.map((row) => option(row, row.id === workspaceId, () => onChange(`workspace:${row.id}`), true)),
            add("New workspace", onCreateWorkspace, !teamId)))
      );
    }

    function BeesApp({ ctx, preferences, modelSettings }) {
      const preference = usePreference(preferences);
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
        const valid = new Set([...data.organizations.map(({ id }) => `organization:${id}`), ...data.teams.map(({ id }) => `team:${id}`), ...data.workspaces.map(({ id }) => `workspace:${id}`)]);
        const preferred = valid.has(preference.lastScope) ? preference.lastScope
          : data.workspaces[0] ? `workspace:${data.workspaces[0].id}` : `organization:${data.organizations[0]?.id ?? ""}`;
        setScopeState((current) => valid.has(current) ? current : preferred);
      }, [data, preference.lastScope]);
      const setScope = (next) => {
        setScopeState(next); setProcessId("");
        void preferences.set("lastScope", next);
      };
      const parts = data ? scopeParts(data, scope) : { workspaceId: "", teamId: "", organizationId: "" };
      const workspaceIds = data ? (parts.workspaceId ? [parts.workspaceId] : data.workspaces.filter(({ teamId }) => teamId === parts.teamId).map(({ id }) => id)) : [];
      const act = async (command) => {
        try { const result = await request("/bees-api/command", { method: "POST", body: JSON.stringify(command) }); await load(); return result; }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
      };
      const askBees = async (outcome) => {
        if (!parts.workspaceId) return null;
        const result = await act({ action: "ask_bees", workspaceId: parts.workspaceId, outcome });
        if (result?.sessionId) setRoute("runs");
        return result;
      };
      const navigate = (id) => {
        if (id === "dsh-settings") {
          document.querySelector('button[aria-haspopup="dialog"][aria-expanded]')?.click();
          return;
        }
        const section = NAVIGATION.find((row) => row.id === id);
        setRoute(section ? section.defaultChild : id); setProcessId("");
      };
      const createOrganization = async () => {
        const name = await ask("Organization name", ""); if (!name) return;
        const result = await act({ action: "create_organization", name });
        if (result?.id) setScope(`organization:${result.id}`);
      };
      const createTeam = async () => {
        const organization = data.organizations.find(({ id }) => id === parts.organizationId); if (!organization) return;
        const name = await ask("Team name", ""); if (!name) return;
        const result = await act({ action: "create_team", organizationId: organization.id, name });
        if (result?.id) setScope(`team:${result.id}`);
      };
      const createWorkspace = async () => {
        let team = data.teams.find(({ id }) => id === parts.teamId);
        const teams = data.teams.filter(({ organizationId }) => organizationId === parts.organizationId);
        if (!team) { const name = await ask(`Team:\n${teams.map(({ name }) => name).join("\n")}`); team = teams.find((row) => row.name === name); }
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
        const presetName = await ask(`Agent preset:\n${data.presets.filter(({ broken }) => !broken).map(({ name }) => name).join("\n")}`, "standard");
        const preset = data.presets.find((row) => row.name === presetName || row.id === presetName); if (!preset) return;
        const name = await ask("Agent name", preset.name); if (name) await act({ action: "add_agent_assignment", workspaceId: parts.workspaceId, presetId: preset.id, name });
      };
      const localAi = h(LocalAiController, { modelSettings, preferences, onError: setError });
      const freeAi = h(FreeAiController, { modelSettings, onError: setError });
      if (!data) return h(React.Fragment, null, localAi, freeAi,
        h("div", { className: "bees-app bees-loading" }, error || "Opening Bees…"));
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
          open: openRoute
        }));
        if (targetRoute === "artifacts") return data.runs.filter((row) => row.workspaceId === parts.workspaceId && row.outputs.length)
          .map((row) => ({ id: row.id, label: data.items.find(({ id }) => id === row.workItemId)?.title ?? "Run", open: openRoute }));
        if (targetRoute === "workspace-settings" && parts.workspace) return [{ id: parts.workspace.id, label: parts.workspace.name, open: openRoute }];
        if (targetRoute === "team-settings") {
          const team = data.teams.find(({ id }) => id === parts.teamId);
          return team ? [{ id: team.id, label: team.name, open: openRoute }] : [];
        }
        if (targetRoute === "organization-settings") {
          const organization = data.organizations.find(({ id }) => id === parts.organizationId);
          return organization ? [{ id: organization.id, label: organization.name, open: openRoute }] : [];
        }
        return [];
      };
      const page = route === "home" ? h(Home, { data, workspaceId: parts.workspaceId, act, askBees })
        : section.id === "work" ? h(WorkPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, act, openProcess })
          : section.id === "processes" ? h(ProcessesPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, teamId: parts.teamId, processId, setProcessId, act })
            : section.id === "agents" ? h(AgentsPage, { data, route, workspaceIds, workspaceId: parts.workspaceId, act })
              : section.id === "files" ? h(FilesPage, { ctx, data, route, teamId: parts.teamId, act })
                : section.id === "activity" ? h(ActivityPage, { data, route, workspaceIds })
                  : section.id === "knowledge" ? h(KnowledgePage, { data, route, workspaceId: parts.workspaceId, teamId: parts.teamId })
                    : h(SettingsPage, { ctx, data, route, workspaceId: parts.workspaceId, teamId: parts.teamId, organizationId: parts.organizationId, modelSettings, preferences, reload: load });
      return h(React.Fragment, null, localAi, freeAi, h("div", { className: "bees-app" },
        h("aside", { className: "bees-sidebar" },
          h("div", { className: "bees-brand" }, h("span", { className: "bees-mark" }, "B"), h("span", null, "Bees")),
          h(ContextSwitcher, { data, organizationId: parts.organizationId, teamId: parts.teamId, workspaceId: parts.workspaceId,
            onChange: setScope, onCreateOrganization: createOrganization, onCreateTeam: createTeam, onCreateWorkspace: createWorkspace }),
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
          )
        ),
        h("section", { className: "bees-main" },
          h("header", { className: "bees-top" }, h("div", { className: "bees-title" }, routeLabel),
            route !== "home" ? h("div", { className: "bees-context" }, parts.workspace?.name ?? parts.team?.name ?? parts.organization?.name ?? "") : null,
            route !== "home" ? h(PinButton, { id: route, label: routeLabel, pins, setPins }) : null,
            h("div", { className: "bees-grow" }),
            h("details", { className: "bees-create" }, h("summary", { className: "bees-btn", title: "Create", role: "button", "aria-label": "Create" }, "+"), h("div", { className: "bees-menu" },
              h("button", { className: "bees-nav-link", onClick: createOrganization }, "New organization"),
              h("button", { className: "bees-nav-link", disabled: !parts.teamId && !data.teams.some(({ organizationId }) => organizationId === parts.organizationId), onClick: createWorkspace }, "New workspace"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createGoal }, "New goal"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createProcess }, "New process"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createRun }, "New one-off run"),
              h("button", { className: "bees-nav-link", disabled: !parts.workspaceId, onClick: createAgent }, "New agent"),
              h("button", { className: "bees-nav-link", disabled: !parts.organizationId, onClick: createTeam }, "New team")
            )),
            h(ThemeToggle, { ctx })),
          error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
          h("main", { className: "bees-content" }, h("div", { className: "bees-panel" }, page))
        )
      ));
    }

    exports.inject = ["slots", "workspaces", "settingsScope", "connection", "theme"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-plugin";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees: styles");
      const preferences = ctx.settingsScope.bind({ namespace: "bees-ui" });
      const modelSettings = ctx.settingsScope.bind({ namespace: "llm-pi-ai" });
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "bees-product", order: -100, label: "Bees",
        inject: () => ({ ctx, preferences, modelSettings })
      }, BeesApp));
    };
    return module.exports;
  }
});
