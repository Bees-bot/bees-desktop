import { h, React, useEffect, useState } from "./runtime.js";
import { Button, Empty, request, useSubmit, PageHead, usePreference } from "./shared.js";
import { GridStackPage } from "./flexible-grid.js";
import { inheritedInputs, ResourceFields } from "./location-fields.js";

const AGENTS_LAYOUT = [
  { kind: "agents", x: 0, y: 0, w: 7, h: 7 },
  { kind: "presets", x: 7, y: 0, w: 5, h: 7 }
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
  if (group.id === "claude-code") {
    if (model.id === "default") return "CLI default (auto-updates)";
    if (["sonnet", "opus", "haiku"].includes(model.id))
      return `Latest ${model.id[0].toUpperCase()}${model.id.slice(1)} (auto-updates)`;
  }
  return model.name === model.id ? model.id : `${model.name} (${model.id})`;
}

export function AgentModelSelect({ ctx, value = "", effort = "", systemDefault, allowSystemDefault = true, refreshKey = 0 }) {
  const [catalog, setCatalog] = useState({ groups: [], failures: [], loading: true, error: "" });
  const [route, setRoute] = useState(value);
  const [reasoningEffort, setReasoningEffort] = useState(effort);
  useEffect(() => {
    let mounted = true;
    void request("/bees-api/llm-models").then((catalog) => {
      if (mounted) setCatalog({ ...catalog, loading: false, error: "" });
    }).catch((reason) => {
      if (mounted) setCatalog({ groups: [], failures: [], loading: false,
        error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { mounted = false; };
  }, [ctx, refreshKey]);
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
  const systemDefaultLabel = systemDefault?.provider && systemDefault?.model
    ? `System default — ${systemDefault.provider}/${systemDefault.model}${systemDefault.reasoningEffort ? ` · ${systemDefault.reasoningEffort} effort` : ""}`
    : "System default (auto-updates)";
  return h(React.Fragment, null,
    h("label", null, "Model",
    h("select", { className: "bees-select", name: "model", value: route, required: !allowSystemDefault, onChange: (event) => {
      setRoute(event.target.value); setReasoningEffort("");
    } },
      allowSystemDefault ? h("option", { value: "" }, catalog.loading ? `${systemDefaultLabel} (loading available models…)` : systemDefaultLabel)
        : !route ? h("option", { value: "", disabled: true }, catalog.loading ? "Loading available models…" : "Choose a model") : null,
      preserveCurrent ? h("option", { value: route }, catalog.loading ? `Current: ${route}`
        : catalog.error ? `Current: ${route} (catalog unavailable)` : `Current: ${route} (unavailable)`) : null,
      ...groups.flatMap((group) => [
        h("option", { value: `__provider_${group.id}`, disabled: true, key: `provider:${group.id}` }, group.name),
        ...(group.id === "openai-codex" ? channels.map((channel) => h("option", {
          value: channel.route, key: `${group.id}:channel:${channel.id}`
        }, `\u00a0\u00a0Latest ${channel.name} (auto-updates)`)) : []),
        ...group.models.map((model) => h("option", { value: `${group.id}/${model.id}`, key: `${group.id}:${model.id}` },
          `\u00a0\u00a0${agentModelLabel(group, model)}`))])),
    catalog.error ? h("span", { className: "bees-muted", role: "status" }, `Could not load available models: ${catalog.error}`)
      : catalog.failures.length ? h("span", { className: "bees-muted", role: "status" },
        `Some providers could not load: ${catalog.failures.map(({ name }) => name).join(", ")}`) : null),
    h("label", null, "Reasoning effort",
      h("select", { className: "bees-select", name: "reasoningEffort", value: reasoningEffort,
        disabled: !selectedModel?.reasoning && !reasoningEffort,
        onChange: (event) => setReasoningEffort(event.target.value) },
        h("option", { value: "" }, defaultEffortName ? `Model default (${defaultEffortName})` : "Model default (recommended)"),
        preserveEffort ? h("option", { value: reasoningEffort }, `Current: ${reasoningEffort} (unavailable)`) : null,
        ...efforts.map((level) => h("option", { value: level.id, key: level.id }, level.name))),
      !route ? h("span", { className: "bees-muted" }, "Choose a model to override its reasoning effort.") : null));
}

export function SystemDefaultSettings({ ctx, modelSettings, systemDefault, reload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeModelSettings = usePreference(modelSettings);
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
      await request("/bees-api/system-default-model", { method: "POST", body: JSON.stringify({
        provider: modelRoute.slice(0, separator), model: modelRoute.slice(separator + 1),
        reasoningEffort: String(form.get("reasoningEffort") ?? "")
      }) });
      await reload();
      setMessage("System default updated.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return h("section", { className: "bees-box bees-system-default" },
    h("h2", null, "System default"),
    h("p", { className: "bees-muted" }, "New agents use this model unless you choose a different one. Choose another default before turning this connection off."),
    h("form", { key: `${route}:${systemDefault?.reasoningEffort ?? ""}`, onSubmit: save },
      h(AgentModelSelect, { ctx, value: route, effort: systemDefault?.reasoningEffort, allowSystemDefault: false, refreshKey: JSON.stringify(activeModelSettings) }),
      h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save default")),
    message ? h("div", { className: message.endsWith("updated.") ? "bees-muted" : "bees-error", role: "status" }, message) : null);
}


/** Which MCP servers this agent may use. Shared by the create and edit forms. */
export function McpAccess({ servers, access, chosen, label = "MCP servers this agent may use" }) {
  const [mode, setMode] = useState(access ?? "all");
  const picked = new Set(chosen ?? []);
  return h(React.Fragment, null,
    h("label", null, label,
      h("select", { className: "bees-select", name: "mcpAccess", value: mode,
        onChange: (event) => setMode(event.target.value) },
        h("option", { value: "all" }, "Every connected server"),
        h("option", { value: "none" }, "None"),
        h("option", { value: "listed" }, "Only the ones I pick")),
      h("span", { className: "bees-muted" }, servers.length
        ? "A server's tools reach an agent only if it is allowed here."
        : "No MCP servers are connected yet; add one under Agents, MCP servers.")),
    mode === "listed" ? h("div", { className: "bees-form" }, h("span", null, "Allowed servers"),
      ...servers.map((server) => h("label", { key: server.id, className: "bees-muted" },
        h("span", null,
          h("input", { type: "checkbox", name: "mcpServers", value: server.id, defaultChecked: picked.has(server.id) }),
          ` ${server.label} (${server.toolCount} tool${server.toolCount === 1 ? "" : "s"})`))),
      servers.length ? null : h("span", { className: "bees-muted" }, "Nothing to pick yet.")) : null);
}

export function AgentCreateForm({ ctx, data, servers, workspaceId, act, onCancel, onCreated, setPageHeader, inline = false, processId = null }) {
  const presets = data.presets.filter(({ broken }) => !broken);
  const [inputLocationIds, setInputLocationIds] = useState([]);
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
  return h("form", { className: "bees-box bees-form bees-agent-form", onSubmit },
    inline
      ? h("div", { className: "bees-page-head" }, h("div", null, h("h2", null, "New agent"),
        h("div", { className: "bees-muted" }, "Give it a name, a toolbox, and a model. Everything here can be changed later.")))
      : h(PageHead, { setPageHeader }, h(Button, { onClick: onCancel }, "← Agents"),
        h("div", null, h("h2", null, "New agent"), h("div", { className: "bees-muted" }, "Give it a name, a toolbox, and a model. Everything here can be changed later."))),
    
    h("div", { className: "bees-form-row" },
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Research agent" })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", placeholder: "What should this agent be used for?" }))
    ),
    
    h("div", { className: "bees-form-row" },
      h("label", null, "Agent preset, its skills and tools",
        h("select", { className: "bees-select", name: "presetId", required: true,
          defaultValue: presets.find(({ id }) => id === "standard")?.id ?? presets[0]?.id },
          ...presets.map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))),
        h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run.")),
      h("label", null, "Max concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: 0 }))
    ),
    
    h("div", { className: "bees-form-row" },
      h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel })
    ),
    
    h("div", { className: "bees-form-row", style: { alignItems: "center" } },
      h("label", null, "Capabilities, comma separated",
        h("input", { className: "bees-input", name: "capabilities", placeholder: "research, writing" }),
        h("span", { className: "bees-muted" }, "Optional labels for process routing.")),
      h("label", null, h("span", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: true }), " Available for routing"))
    ),
    
    h(McpAccess, { servers }),
    h("p", { className: "bees-muted" }, "Process and work inputs are included automatically when this agent runs."),
    h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, allowOutput: false, inherited: inheritedInputs(data, processId) }),
    h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", placeholder: "How should this agent complete work?" })),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: busy || !presets.length }, busy ? "Creating…" : "Create agent"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

export function AgentEditForm({ ctx, data, servers, selected, act, onCancel, onSaved, cancelLabel = "← Agents", processId = null }) {
  const [inputLocationIds, setInputLocationIds] = useState(() =>
    data.agentAttachments.filter(({ agentAssignmentId }) => agentAssignmentId === selected.id).map(({ locationId }) => locationId));
  const teamId = data.workspaces.find(({ id }) => id === selected.workspaceId)?.teamId;
  useEffect(() => setInputLocationIds(
    data.agentAttachments.filter(({ agentAssignmentId }) => agentAssignmentId === selected.id).map(({ locationId }) => locationId)
  ), [selected.id]);

  // keyed on what the model select seeds itself from, or an editor left open keeps showing the
  // old model and saving it back over whoever changed it.
  const key = `${selected.id}:${selected.model ?? ""}:${selected.reasoningEffort ?? ""}`;
  return h("form", { className: "bees-box bees-form bees-agent-form", key, onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const saved = await act({
      action: "edit_agent_assignment", agentAssignmentId: selected.id,
      name: String(form.get("name") ?? selected.name), presetId: String(form.get("presetId") ?? selected.presetId),
      description: String(form.get("description") ?? ""), instructions: String(form.get("instructions") ?? ""),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""),
      capabilities: String(form.get("capabilities") ?? "").split(","),
      inputLocationIds,
      mcpAccess: String(form.get("mcpAccess") ?? "all"), mcpServers: form.getAll("mcpServers").map(String),
      enabled: form.get("enabled") === "on", maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
    });
    if (saved) onSaved();
  } },
    h("div", { className: "bees-row" }, h(Button, { onClick: onCancel }, cancelLabel), h("strong", null, selected.name), h("div", { className: "bees-grow" }), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null),
    
    h("div", { className: "bees-form-row" },
      h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selected.name, disabled: Boolean(selected.systemRole) })),
      h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selected.description }))
    ),
    
    h("div", { className: "bees-form-row" },
      h("label", null, "Agent preset, its skills and tools",
        h("select", { className: "bees-select", name: "presetId", defaultValue: selected.presetId },
          ...data.presets.filter(({ broken }) => !broken).map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))),
        h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run.")),
      h("label", null, "Max concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: selected.maxConcurrency }))
    ),
    
    h("div", { className: "bees-form-row" },
      h(AgentModelSelect, { ctx, value: selected.model ?? "", effort: selected.reasoningEffort ?? "", systemDefault: data.systemDefaultModel })
    ),
    
    h("div", { className: "bees-form-row", style: { alignItems: "center" } },
      h("label", null, "Capabilities, comma separated",
        h("input", { className: "bees-input", name: "capabilities", defaultValue: (selected.capabilities ?? []).join(", "), placeholder: "research, writing" }),
        h("span", { className: "bees-muted" }, "Optional labels for process routing.")),
      h("label", null, h("span", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: selected.enabled }), " Available for routing"))
    ),
    
    h(McpAccess, { servers, access: selected.mcpAccess, chosen: selected.mcpServers }),
    h("p", { className: "bees-muted" }, "Process and work inputs are included automatically when this agent runs."),
    h(ResourceFields, { ctx, data, teamId, act, inputIds: inputLocationIds,
      onInputIds: setInputLocationIds, allowOutput: false, inherited: inheritedInputs(data, processId) }),
    h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", defaultValue: selected.instructions, placeholder: selected.systemRole === "reviewer" ? "How this team should review work" : "How this agent should complete work" })),
    h("p", { className: "bees-muted" }, selected.systemRole ? "Bees keeps the runtime completion protocol protected. These instructions customize how this team's built-in agent performs its role." : "These instructions are mounted with the selected runtime preset."),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Save agent"))
  );
}

export function AgentsPage({ ctx, data, servers = [], workspaceIds, workspaceId, creating, setCreating, act, openDshSettings, preference, preferences, setPageActions, setPageHeader }) {
  const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
  const [selectedId, setSelectedId] = useState("");
  const selected = assignments.find(({ id }) => id === selectedId);
  if (creating === "agent") return h(AgentCreateForm, { ctx, data, servers, workspaceId, act,
    onCancel: () => setCreating(""), onCreated: (id) => { setCreating(""); setSelectedId(id); }, setPageHeader });
  if (selected) return h(AgentEditForm, { ctx, data, servers, selected, act,
    onCancel: () => setSelectedId(""), onSaved: () => setSelectedId("") });
  const agents = h("div", null,
      ...(assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.enabled ? agent.presetId : "Unavailable"}${agent.model ? ` · ${agent.model}` : " · default model"}${agent.reasoningEffort ? ` · ${agent.reasoningEffort} effort` : ""}${agent.capabilities?.length ? ` · ${agent.capabilities.join(", ")}` : ""} · ${agent.description || "Agent preset assignment"}`)), agent.systemRole ? h("span", { className: "bees-badge" }, `Bees ${agent.systemRole}`) : null, h(Button, { onClick: () => setSelectedId(agent.id) }, "Configure"))) : [h(Empty, { key: "empty" }, "No agents assigned to this scope") ]));
  const presets = h("div", null,
      h("div", { className: "bees-row" }, h("div", { className: "bees-row-main bees-muted" }, "Toolboxes available to agents."),
        h(Button, { onClick: openDshSettings }, "Manage presets & skills")),
      ...(data.presets.length ? data.presets.map((preset) => h("div", { className: "bees-row", key: preset.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, preset.name),
          h("div", { className: "bees-muted" }, preset.broken ? "Unavailable" : preset.description || "Agent preset")),
        h("span", { className: "bees-badge" }, preset.trust ?? "preset"))) : [h(Empty, { key: "empty" }, "No agent presets are available")]));
  return h(GridStackPage, {
    layoutId: "agents", defaults: AGENTS_LAYOUT, preference, preferences, setPageActions,
    panels: {
      agents: { label: "Agents", actions: h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("agent") }, "New agent"), minW: 4, minH: 4, content: agents },
      presets: { label: "Agent presets", minW: 4, minH: 3, content: presets }
    }
  });
}
