import { h, React, useEffect, useRef, useState } from "./runtime.js";
import { ask, confirmAction, Button, Empty, McpCard, request, useSubmit, PageHead, usePreference } from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";
import { inheritedInputs, ResourceFields } from "./location-fields.js";
import { CatalogReview } from "./skills.js";
import { ArrowLeftIcon } from "./icons.js";
import { modelLabel } from "../lib/model-label.js";
const AGENTS_LAYOUT = [
  { kind: "agents", x: 0, y: 0, w: 7, h: 10 },
  { kind: "presets", x: 7, y: 0, w: 5, h: 10 }
];

const CODEX_CHANNELS = [
  ["__bees_latest_sol__", "sol", "Sol"],
  ["__bees_latest_terra__", "terra", "Terra"],
  ["__bees_latest_luna__", "luna", "Luna"]
];

function latestCodexModel(models, family) {
  const pattern = new RegExp(`^gpt-\\d+(?:\\.\\d+)*-${family}$`, "i");
  return models.filter(({ id }) => pattern.test(id))
    .sort((left, right) => right.id.localeCompare(left.id, undefined, { numeric: true }))[0];
}

function agentModelLabel(group, model) {
  if (group.id === "local-openai" || group.id.startsWith("local-openai-"))
    return modelLabel(`${group.id}/${model.id}`, model.name);
  if (group.id === "claude-code") {
    if (model.id === "default") return "CLI default (auto-updates)";
    if (["sonnet", "opus", "haiku"].includes(model.id))
      return `Latest ${model.id[0].toUpperCase()}${model.id.slice(1)} (auto-updates)`;
  }
  return !model.name || model.name === model.id ? model.id : `${model.name} (${model.id})`;
}

export function AgentModelSelect({ ctx, value = "", effort = "", systemDefault, allowSystemDefault = true, refreshKey = 0, productCatalog }) {
  const [catalog, setCatalog] = useState({ groups: [], failures: [], loading: true, error: "" });
  const [route, setRoute] = useState(value);
  const [reasoningEffort, setReasoningEffort] = useState(effort);
  useEffect(() => {
    if (productCatalog) { setCatalog({ groups: productCatalog, failures: [], loading: false, error: "" }); return; }
    let mounted = true;
    void request("/bees-api/llm-models").then((catalog) => {
      if (mounted) setCatalog({ ...catalog, loading: false, error: "" });
    }).catch((reason) => {
      if (mounted) setCatalog({ groups: [], failures: [], loading: false,
        error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { mounted = false; };
  }, [ctx, refreshKey, productCatalog]);
  const groups = [...catalog.groups].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const codex = groups.find(({ id }) => id === "openai-codex");
  const channels = CODEX_CHANNELS.flatMap(([id, family, name]) => {
    const model = latestCodexModel(codex?.models ?? [], family);
    return model ? [{ id, name, model, route: `openai-codex/${id}` }] : [];
  });
  const routes = new Set(groups.flatMap((group) => group.models.map((model) => `${group.id}/${model.id}`)));
  for (const channel of channels) routes.add(channel.route);
  const preserveCurrent = route && (catalog.loading || catalog.error || !routes.has(route));
  const selectedModel = channels.find((channel) => channel.route === route)?.model ?? groups.flatMap(({ id, models }) =>
    models.map((model) => ({ ...model, route: `${id}/${model.id}` }))).find((model) => model.route === route);
  const efforts = selectedModel?.reasoning?.efforts ?? [];
  const effortIds = new Set(efforts.map(({ id }) => id));
  const preserveEffort = reasoningEffort && !effortIds.has(reasoningEffort);
  const defaultEffort = selectedModel?.reasoning?.defaultEffort;
  const defaultEffortName = efforts.find(({ id }) => id === defaultEffort)?.name ?? defaultEffort;
  const defaultGroup = groups.find(({ id }) => id === systemDefault?.provider);
  const defaultModel = defaultGroup?.models.find(({ id }) => id === systemDefault?.model);
  const systemDefaultLabel = systemDefault?.provider && systemDefault?.model
    ? `System default — ${modelLabel(`${systemDefault.provider}/${systemDefault.model}`, defaultModel?.name, defaultGroup?.name)}${systemDefault.reasoningEffort ? ` · ${systemDefault.reasoningEffort} effort` : ""}`
    : "System default (auto-updates)";
  return h(React.Fragment, null,
    h("label", { className: "bees-process-name", style: { display: "grid", gap: "5px" } }, "Model",
    h("select", { className: "bees-select", name: "model", value: route, required: !allowSystemDefault, onChange: (event) => {
      setRoute(event.target.value); setReasoningEffort("");
    } },
      allowSystemDefault ? h("option", { value: "" }, catalog.loading ? `${systemDefaultLabel} (loading available models…)` : systemDefaultLabel)
        : !route ? h("option", { value: "", disabled: true }, catalog.loading ? "Loading available models…" : "Choose a model") : null,
      preserveCurrent ? h("option", { value: route }, catalog.loading ? `Current: ${modelLabel(route)}`
        : catalog.error ? `Current: ${modelLabel(route)} (catalog unavailable)` : `Current: ${modelLabel(route)} (unavailable)`) : null,
      ...groups.map((group) => h("optgroup", { label: group.name, key: group.id },
        ...(group.id === "openai-codex" ? channels.map((channel) => h("option", {
          value: channel.route, key: `channel:${channel.id}`
        }, `Latest ${channel.name} (${channel.model.id}, auto-updates)`)) : []),
        ...group.models.map((model) => h("option", { value: `${group.id}/${model.id}`, key: model.id },
          productCatalog && group.id === "local-openai" ? "Active local model on each device" : agentModelLabel(group, model)))))),
    catalog.error ? h("span", { className: "bees-muted", role: "status" }, `Could not load available models: ${catalog.error}`)
      : catalog.failures.length ? h("span", { className: "bees-muted", role: "status" },
        `Some providers could not load: ${catalog.failures.map(({ name }) => name).join(", ")}`) : null),
    h("label", { className: "bees-process-name", style: { display: "grid", gap: "5px" } }, "Reasoning effort",
      h("select", { className: "bees-select", name: "reasoningEffort", value: reasoningEffort,
        disabled: !selectedModel?.reasoning && !reasoningEffort,
        onChange: (event) => setReasoningEffort(event.target.value) },
        h("option", { value: "" }, defaultEffortName ? `Model default (${defaultEffortName})` : "Model default (recommended)"),
        preserveEffort ? h("option", { value: reasoningEffort }, `Current: ${reasoningEffort} (unavailable)`) : null,
        ...efforts.map((level) => h("option", { value: level.id, key: level.id }, level.name))),
      !route ? h("span", { className: "bees-muted" }, "Choose a model to override its reasoning effort.") : null));
}

export function SystemDefaultSettings({ ctx, modelSettings, systemDefault, reload, modelsChanged = 0, saveDefault, catalogModels, defaultModelLists }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeModelSettings = usePreference(modelSettings);
  const productCatalog = React.useMemo(() => catalogModels ? [
    ...catalogModels.map((m) => ({ id: `local-openai-${m.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, name: "Local", models: [{ id: "active", name: m.name }] })),
    ...Object.entries(activeModelSettings.providers ?? {}).map(([id, config]) => ({ id, name: config.displayName ?? id, models: config.models ?? [] })),
    ...(!activeModelSettings.providers?.["openai-codex"] && defaultModelLists?.codex?.length
      ? [{ id: "openai-codex", name: "Codex", models: defaultModelLists.codex }] : []),
    { id: "claude-code", name: "Claude Code", models: (defaultModelLists?.claude ?? []).map((id) => ({ id, name: id })) }
  ] : undefined, [catalogModels, activeModelSettings, defaultModelLists]);
  const route = systemDefault?.provider && systemDefault?.model
    ? `${systemDefault.provider}/${systemDefault.model}` : "";
  const save = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const modelRoute = String(form.get("model") ?? "");
    const separator = modelRoute.indexOf("/");
    if (separator < 1 || separator === modelRoute.length - 1) return setMessage("Choose a model.");
    setBusy(true); setMessage("");
    try {
      const selection = {
        provider: modelRoute.slice(0, separator), model: modelRoute.slice(separator + 1),
        reasoningEffort: String(form.get("reasoningEffort") ?? "")
      };
      if (saveDefault) await saveDefault(selection);
      else { await request("/bees-api/system-default-model", { method: "POST", body: JSON.stringify(selection) }); await reload(); }
      setMessage("System default updated.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("section", { className: "bees-box bees-system-default" },
    h("h2", null, "System default"),
    h("p", { className: "bees-muted" }, "New agents use this model unless you choose a different one. Choose another default before turning this connection off."),
    h("form", { key: `${route}:${systemDefault?.reasoningEffort ?? ""}`, className: "bees-form-row", onSubmit: save },
      h(AgentModelSelect, { ctx, value: route, effort: systemDefault?.reasoningEffort, allowSystemDefault: false, productCatalog, refreshKey: `${modelsChanged}:${JSON.stringify(activeModelSettings)}` }),
      h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save default")),
    message ? h("div", { className: message.endsWith("updated.") ? "bees-muted" : "bees-error", role: "status" }, message) : null);
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which MCP servers this agent may use. Shared by the create and edit forms. */
export function McpAccess({ ctx, servers = [], tools = [], catalog = [], access, chosen, onServerAction, onChange, scope = "agent" }) {
  // "all" stays "all" until a server is unpicked, or saving turns it into this computer's list for the whole team
  const [mode, setMode] = useState(access ?? "all");
  const [picked, setPicked] = useState(chosen ?? []);
  const current = mode === "all" ? servers.filter(({ enabled }) => enabled).map(({ serverName }) => serverName) : picked;
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState("");
  // ponytail: linear scans keep this picker small; index tools by server if catalogs grow large.
  const needle = query.trim().toLocaleLowerCase();
  const matching = servers.filter((server) => {
    const serverTools = tools.filter(({ serverName }) => serverName === server.serverName);
    return !needle || [server.label, server.serverName, ...serverTools.map(({ name }) => name)]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(needle));
  }).sort((left, right) => Number(current.includes(right.serverName)) - Number(current.includes(left.serverName)));
  const available = catalog.filter(({ installedAs, label, serverName, summary, publisher }) => !installedAs
    && (!needle || [label, serverName, summary, publisher].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle))));
  const entry = catalog.find(({ id }) => id === reviewing);
  // Grants travel between computers; a name this one never installed is shown so it can be added here.
  const missing = picked.filter((name) => !servers.some((server) => server.serverName === name));
  const change = (nextPicked, nextMode = "listed") => {
    setMode(nextMode); setPicked(nextPicked);
    void onChange?.({ mcpAccess: nextMode, mcpServers: nextMode === "listed" ? nextPicked : [] });
  };

  return h("section", { className: "bees-mcp-access" },
    h("input", { type: "hidden", name: "mcpAccess", value: mode }),
    entry ? h(CatalogReview, { ctx, entry, onCancel: () => setReviewing(""),
      // a Google sign-in lands later, so that server shows up to add once it is connected
      onDone: ({ serverName }) => { if (serverName && mode !== "all" && !picked.includes(serverName)) change([...picked, serverName]); setReviewing(""); } }) : h(React.Fragment, null,
      ...(mode === "listed" ? picked : []).map((name) => h("input", { key: name, type: "hidden", name: "mcpServers", value: name })),
      mode === "all" ? h("div", { className: "bees-muted" }, "Uses every add-on, including ones added later")
        : h(Button, { onClick: () => change([], "all") }, "Use all add-ons"),
      h("input", { className: "bees-input", value: query, placeholder: "Search add-ons or tools", "aria-label": "Search add-ons or tools",
        onChange: (event) => setQuery(event.target.value) }),
      missing.length ? h("div", { className: "bees-mcp-grid" }, ...missing.map((name) => {
        const item = catalog.find((one) => one.serverName === name && !one.installedAs);
        return h(McpCard, { name: item?.label ?? name, status: "Unavailable", tone: "warning", key: `missing:${name}`, icon: item?.icon },
          h("div", { className: "bees-muted" }, item
            ? `${item.summary} · runs here fail until it is added`
            : UUID.test(name)
              ? `This add-on was set up on another computer. Take it off and pick the one this ${scope} should use.`
              : `${name} is set up on another computer. Add it under Add-ons, or remove it from this ${scope}.`),
          h("div", { className: "bees-detail-actions" },
            item ? h(Button, { className: "primary", disabled: !onServerAction, onClick: () => setReviewing(item.id) }, "Add") : null,
            h(Button, { onClick: () => change(picked.filter((one) => one !== name)) }, "Remove")));
      })) : null,
      h("div", { className: "bees-mcp-grid" },
        ...matching.map((server) => {
          const added = server.enabled && current.includes(server.serverName);
          const serverTools = tools.filter(({ serverName }) => serverName === server.serverName);
          const catEntry = server.catalogId ? catalog.find(c => c.id === server.catalogId) : null;
          return h(McpCard, { name: server.label, status: added ? "Added" : server.enabled ? "Available" : "Turned off",
            icon: catEntry?.icon,
            meta: `${server.toolCount ?? serverTools.length} tool${(server.toolCount ?? serverTools.length) === 1 ? "" : "s"}`,
            tone: added ? "added" : server.enabled ? "" : "warning", key: server.id,
            actionLabel: added ? `Unselect ${server.label}` : server.enabled ? `Select ${server.label}` : `Turn on and select ${server.label}`,
            actionIcon: added ? "✓" : "+",
            onOpen: async () => {
              if (!server.enabled) {
                if (!onServerAction) return;
                await onServerAction({ action: "set_mcp_server_enabled", serverId: server.id, enabled: true });
              }
              if (mode !== "all" || added) change(added ? current.filter((name) => name !== server.serverName) : [...picked, server.serverName]);
            } });
        }),
        ...available.map((item) => h(McpCard, { name: item.label, status: "Not added", key: `catalog:${item.id}`,
          icon: item.icon, onOpen: () => setReviewing(item.id) })),
      matching.length || available.length || missing.length ? null : h("div", { className: "bees-empty" }, "No add-on or tool matches that search"))));
}

function AgentDialog({ onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return h("dialog", { ref, className: "bees-agent-dialog", "aria-label": "Agent configuration",
    closedby: "any",
    onClick: (event) => {
      if (event.target !== ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (!(rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width)) {
        onClose();
      }
    },
    onCancel: (event) => { event.preventDefault(); onClose(); } }, children);
}

/** Servers an agent lists that are not usable here, so its stage is refused here. */
function missingServers(agent, servers, process) {
  // same rule as mcpGrantFor and canStartItem, or a run passes this check and then sits at ready with no reason
  if (agent?.mcpAccess === "all" || process?.mcpAccess === "all") return [];
  const names = [agent, process].flatMap((row) => row?.mcpAccess === "listed" ? row.mcpServers ?? [] : []);
  return [...new Set(names)].filter((name) => !servers.some((server) => (server.serverName === name || server.id === name)
    && ["connected", "per run", "off"].includes(server.status)));
}

/** A one-line warning under an agent's name, wherever its stage is shown. */
export function needsNote(agent, servers) {
  const missing = missingServers(agent, servers);
  if (!missing.length) return null;
  const named = missing.filter((name) => !UUID.test(name));
  return h("div", { className: "bees-error", style: { fontSize: "12px", marginTop: "2px" } },
    named.length
      ? `Needs ${named.join(", ")}, not connected on this computer. Runs stop here until you add or fix ${named.length === 1 ? "it" : "them"}.`
      : "Lists add-ons this computer cannot identify. Runs stop here until you pick its add-ons again under Configure.");
}

/** Agents a run of these stages would use here: the ones routed to a stage, or the automatic stand-in. */
export function runAgents(stages, agents) {
  return [...new Set(stages.filter((stage) => !["manual", "terminal"].includes(stage.driver)).flatMap((stage) =>
    stage.agentIds?.length ? stage.agentIds
      : agents.filter((agent) => agent.enabled && agent.systemRole === (stage.driver === "review" ? "reviewer" : "worker")).map(({ id }) => id)))]
    .map((id) => agents.find((agent) => agent.id === id)).filter(Boolean);
}

function McpPreflight({ ctx, data, blockers, servers, tools, catalog, act, onServerAction, onCancel, onStart }) {
  const [reviewing, setReviewing] = useState("");
  const [editing, setEditing] = useState("");
  const entry = catalog.find(({ id }) => id === reviewing);
  const agent = blockers.find((blocker) => blocker.agent.id === editing)?.agent;
  if (entry) return h(AgentDialog, { onClose: onCancel },
    h(CatalogReview, { ctx, entry, onCancel: () => setReviewing(""), onDone: () => setReviewing("") }));
  if (agent) return h(AgentEditForm, { key: agent.id, ctx, data, servers, tools, catalog, onServerAction,
    selected: agent, act, dialog: true, onCancel: () => setEditing(""), onSaved: () => setEditing("") });
  return h(AgentDialog, { onClose: onCancel },
    h("section", { className: "bees-box" },
      h("h2", null, blockers.length ? "Add what this run needs" : "Everything this run needs is here"),
      ...blockers.flatMap(({ agent: blocked, missing }) => [
        h("div", { className: "bees-row", key: blocked.id },
          h("strong", { className: "bees-row-main" }, `${blocked.name} needs add-ons that are not connected on this computer`),
          h(Button, { onClick: () => setEditing(blocked.id) }, "Choose add-ons")),
        ...missing.map((name) => {
          const item = catalog.find((one) => one.serverName === name && !one.installedAs);
          return h("div", { className: "bees-row", key: `${blocked.id}:${name}`, style: { paddingLeft: "16px" } },
            h("div", { className: "bees-row-main" }, item?.label ?? (UUID.test(name) ? "A server set up on another computer" : name)),
            item ? h(Button, { className: "primary", disabled: !onServerAction, onClick: () => setReviewing(item.id) }, "Add") : null);
        })
      ]),
      h("div", { className: "bees-detail-actions" },
        h(Button, { className: "primary", onClick: onStart }, blockers.length ? "Start anyway" : "Start run"),
        h(Button, { onClick: onCancel }, "Cancel"))));
}

/** `if (!await guard(processId)) return;` holds a run behind the returned dialog while its agents miss MCP servers here. */
export function useMcpPreflight({ ctx, data, workspaceId, capabilities, act }) {
  const [pending, setPending] = useState(null);
  const { servers = [], tools = [], catalog = [] } = capabilities?.data ?? {};
  const blockers = (processId) => runAgents(data.stages.filter((row) => row.processId === processId),
    data.assignments.filter((row) => row.workspaceId === workspaceId))
    .map((agent) => ({ agent, missing: missingServers(agent, servers, data.processes.find(({ id }) => id === processId)) }))
    .filter(({ missing }) => missing.length);
  const guard = async (processId) => !blockers(processId).length || new Promise((go) => setPending({ processId, go }));
  const close = (start) => { pending.go(start); setPending(null); };
  return [guard, pending && h(McpPreflight, { ctx, data, servers, tools, catalog, act, onServerAction: capabilities?.act,
    blockers: blockers(pending.processId), onCancel: () => close(false), onStart: () => close(true) })];
}

export function AgentCreateForm({ ctx, data, servers, tools, catalog, onServerAction, workspaceId, act: pageAct, onCancel, onCreated, setPageHeader, inline = false, dialog = false, processId = null }) {
  const presets = data.presets.filter(({ broken }) => !broken);
  const [inputLocationIds, setInputLocationIds] = useState([]);
  const [error, setError] = useState("");
  const act = (command, context) => { setError(""); return pageAct(command, context, setError); };
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;

  if (!workspaceId) return h(Empty, null, "Choose a team before creating an agent.");
  
  const [busy, onSubmit] = useSubmit(async (event) => {
    const form = new FormData(event.currentTarget);
    const created = await act({
      action: "add_agent_assignment", workspaceId,
      name: String(form.get("name") ?? ""), presetId: String(form.get("presetId") ?? ""),
      description: String(form.get("description") ?? ""), instructions: String(form.get("instructions") ?? ""),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""),
      capabilities: String(form.get("capabilities") ?? "").split(","),
      inputLocationIds,
      mcpAccess: String(form.get("mcpAccess") ?? "all"), mcpServers: form.getAll("mcpServers").map(String),
      enabled: form.get("enabled") === "on", maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
    });
    if (created?.id) await onCreated(created.id);
  });
  const form = h("form", { className: `bees-form bees-process-form${dialog ? " bees-modal" : ""}`, onSubmit },
    inline || dialog
      ? h("div", { className: "bees-page-head" }, h("h2", null, "New agent"))
      : h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, h(ArrowLeftIcon), " Back"),
        h("div", null, h("h2", null, "New agent"), h("p", { className: "bees-muted" }, "Create a specialized AI agent to handle specific tasks."))),
    h("label", { className: "bees-process-name" }, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Research agent" })),
    h("label", { className: "bees-process-name" }, "Preset",
      h("select", { className: "bees-select", name: "presetId", required: true,
        defaultValue: presets.find(({ id }) => id === "standard")?.id ?? presets[0]?.id },
        ...presets.map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name)))),
    h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel }),
    h("label", { className: "bees-process-name" }, "Runs at once (0 means no limit)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: 0 })),
    h("label", { className: "bees-process-name" }, "Capabilities", h("input", { className: "bees-input", name: "capabilities", placeholder: "research, writing" })),
    h("label", { className: "bees-process-name bees-agent-toggle", style: { display: "flex", alignItems: "center", gap: "10px" } }, h("input", { name: "enabled", type: "checkbox", defaultChecked: true }), "Available for routing"),
    h("div", { className: "bees-process-name" }, h(McpAccess, { ctx, servers, tools, catalog, onServerAction })),
    h("div", { className: "bees-process-name" }, h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, allowOutput: false, inherited: inheritedInputs(data, processId) })),
    h("label", { className: "bees-process-name bees-process-description" }, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", placeholder: "How should this agent complete work?" })),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-detail-actions bees-process-actions", style: { justifyContent: "flex-end" } },
      h(Button, { onClick: onCancel }, "Cancel"),
      h("button", { className: "bees-btn primary", disabled: busy || !presets.length }, busy ? "Creating…" : "Create agent"))
  );
  return dialog ? h(AgentDialog, { onClose: onCancel }, form) : form;
}

export function AgentEditForm({ ctx, data, servers, tools, catalog, onServerAction, selected, act: pageAct, onCancel, onSaved, cancelLabel = h(React.Fragment, null, h(ArrowLeftIcon), " Back"), dialog = false, processId = null, setPageHeader }) {
  const [inputLocationIds, setInputLocationIds] = useState(() =>
    data.agentAttachments.filter(({ agentAssignmentId }) => agentAssignmentId === selected.id).map(({ locationId }) => locationId));
  const [error, setError] = useState("");
  const act = (command, context) => { setError(""); return pageAct(command, context, setError); };
  const teamId = data.workspaces.find(({ id }) => id === selected.workspaceId)?.teamId;
  useEffect(() => setInputLocationIds(
    data.agentAttachments.filter(({ agentAssignmentId }) => agentAssignmentId === selected.id).map(({ locationId }) => locationId)
  ), [selected.id]);

  // keyed on what the model select seeds itself from, or an editor left open keeps showing the
  // old model and saving it back over whoever changed it.
  const key = `${selected.id}:${selected.model ?? ""}:${selected.reasoningEffort ?? ""}`;
  const form = h("form", { className: `bees-form bees-process-form${dialog ? " bees-modal" : ""}`, key, onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const saved = await act({
      action: "edit_agent_assignment", agentAssignmentId: selected.id,
      name: String(form.get("name") ?? selected.name), presetId: String(form.get("presetId") ?? selected.presetId),
      description: selected.description ?? "", instructions: String(form.get("instructions") ?? ""),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""),
      capabilities: String(form.get("capabilities") ?? "").split(","),
      inputLocationIds,
      mcpAccess: String(form.get("mcpAccess") ?? "all"), mcpServers: form.getAll("mcpServers").map(String),
      enabled: form.get("enabled") === "on", maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
    });
    if (saved) onSaved();
  } },
    dialog ? h("div", { className: "bees-row" }, h("h2", null, selected.name), h("div", { className: "bees-grow" }), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null) :
      h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, cancelLabel), h("div", null, h("h2", null, selected.name), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null)),
    h("label", { className: "bees-process-name" }, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selected.name, disabled: Boolean(selected.systemRole) })),
    h("label", { className: "bees-process-name" }, "Preset",
      h("select", { className: "bees-select", name: "presetId", defaultValue: selected.presetId },
        ...data.presets.filter(({ broken }) => !broken).map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name)))),
    h(AgentModelSelect, { ctx, value: selected.model ?? "", effort: selected.reasoningEffort ?? "", systemDefault: data.systemDefaultModel }),
    h("label", { className: "bees-process-name" }, "Runs at once (0 means no limit)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: selected.maxConcurrency })),
    h("label", { className: "bees-process-name" }, "Capabilities", h("input", { className: "bees-input", name: "capabilities", defaultValue: (selected.capabilities ?? []).join(", "), placeholder: "research, writing" })),
    h("label", { className: "bees-process-name bees-agent-toggle", style: { display: "flex", alignItems: "center", gap: "10px" } }, h("input", { name: "enabled", type: "checkbox", defaultChecked: selected.enabled }), "Available for routing"),
    h("div", { className: "bees-process-name" }, h(McpAccess, { ctx, servers, tools, catalog, onServerAction, access: selected.mcpAccess, chosen: selected.mcpServers,
      onChange: ({ mcpAccess, mcpServers }) => act({ action: "edit_agent_assignment", agentAssignmentId: selected.id, mcpAccess, mcpServers }) })),
    h("div", { className: "bees-process-name" }, h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, allowOutput: false, inherited: inheritedInputs(data, processId) })),
    h("label", { className: "bees-process-name bees-process-description" }, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", defaultValue: selected.instructions, placeholder: selected.systemRole === "reviewer" ? "How this team should review work" : "How this agent should complete work" })),
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    h("div", { className: "bees-detail-actions bees-process-actions", style: { justifyContent: "flex-end" } },
      dialog ? h(Button, { onClick: onCancel }, "Cancel") : null,
      h("button", { className: "bees-btn primary" }, "Save agent"))
  );
  return dialog ? h(AgentDialog, { onClose: onCancel }, form) : form;
}

export function AgentListActions({ agent, act }) {
  const [error, setError] = useState("");
  const [busy, submit] = useSubmit(async (_event, action) => {
    setError("");
    try {
      const input = { action, agentAssignmentId: agent.id };
      if (action === "copy_agent_assignment") {
        const name = await ask("New agent name", `${agent.name} Copy`);
        if (!name?.trim()) return;
        input.name = name.trim();
      }
      if (action === "archive_agent_assignment" && !await confirmAction(`Archive agent “${agent.name}”? It will stop receiving new work. Its history will be preserved.`)) return;
      await act(input);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  });
  return h("div", null,
    h("div", { className: "bees-detail-actions", style: { marginTop: 0 }, role: "group", "aria-label": `Actions for ${agent.name}` },
      agent.archivedAt ? h(Button, { disabled: busy, onClick: (event) => submit(event, "restore_agent_assignment") }, "Restore")
        : h(React.Fragment, null,
          h(Button, { disabled: busy, onClick: (event) => submit(event, "copy_agent_assignment") }, "Duplicate"),
          agent.systemRole ? null : h(Button, { className: "danger", disabled: busy, onClick: (event) => submit(event, "archive_agent_assignment") }, "Archive"))),
    error ? h("p", { className: "bees-error", role: "alert" }, error) : null);
}

export function AgentsPage({ ctx, data, servers = [], tools = [], catalog = [], onServerAction, workspaceIds, workspaceId, creating, setCreating, act, openDshSettings, preference, preferences, setPageActions, setPageHeader }) {
  const [agentStatus, setAgentStatus] = useState("active");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId) && Boolean(row.archivedAt) === (agentStatus === "archived")
    && (!needle || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(needle)));
  const [selectedId, setSelectedId] = useState("");
  const selected = data.assignments.find((row) => row.id === selectedId && !row.archivedAt && workspaceIds.includes(row.workspaceId));

  if (creating === "agent") return h("div", { className: "bees-flex-page bees-stack" }, h(AgentCreateForm, { ctx, data, servers, tools, catalog, onServerAction, workspaceId, act, dialog: false, setPageHeader,
    onCancel: () => setCreating(""), onCreated: (id) => { setCreating(""); setSelectedId(id); } }));

  if (selected) return h("div", { className: "bees-flex-page bees-stack" }, h(AgentEditForm, { ctx, data, servers, tools, catalog, onServerAction, selected, act, dialog: false, setPageHeader,
    onCancel: () => setSelectedId(""), onSaved: () => setSelectedId("") }));

  const agents = h("div", null,
      ...(assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.enabled ? agent.presetId : "Unavailable"}${agent.model ? ` · ${agent.model}` : " · default model"}${agent.reasoningEffort ? ` · ${agent.reasoningEffort} effort` : ""}${agent.capabilities?.length ? ` · ${agent.capabilities.join(", ")}` : ""} · ${agent.description || "Agent preset assignment"}`)), agent.systemRole ? h("span", { className: "bees-badge" }, `Bees ${agent.systemRole}`) : null, agent.archivedAt ? null : h(Button, { onClick: () => setSelectedId(agent.id) }, "Configure"), h(AgentListActions, { agent, act }))) : [h(Empty, { key: "empty" }, needle ? "No agents match your search" : agentStatus === "archived" ? "No archived agents" : "No agents assigned to this scope") ]));
  const presets = h("div", null,
      h("div", { className: "bees-row" }, h("div", { className: "bees-row-main bees-muted" }, "Toolboxes available to agents."),
        h(Button, { onClick: openDshSettings }, "Manage presets & skills")),
      ...(data.presets.length ? data.presets.map((preset) => h("div", { className: "bees-row", key: preset.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, preset.name),
          h("div", { className: "bees-muted" }, preset.broken || preset.description || "Agent preset")))) : [h(Empty, { key: "empty" }, "No agent presets are available")]));
  return h("div", { className: "bees-flex-page bees-stack" },
    h("div", { className: "bees-search" },
      h("input", { className: "bees-input bees-grow", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search agents", "aria-label": "Search agents by name" }),
      h("select", { className: "bees-select", value: agentStatus, "aria-label": "Agent status", onChange: (event) => setAgentStatus(event.target.value) },
        h("option", { value: "active" }, "Active"), h("option", { value: "archived" }, "Archived")),
      h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("agent") }, "New agent")
    ),
    h(GridStackPage, {
      layoutId: "agents", defaults: AGENTS_LAYOUT, preference, preferences, setPageActions,
      panels: {
        agents: { label: "Agents", minW: 4, minH: 4, content: agents },
        presets: { label: "Agent presets", minW: 4, minH: 3, content: presets }
      }
    }));
}
