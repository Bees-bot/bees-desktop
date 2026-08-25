import { h, React, useEffect, useState } from "./runtime.js";
import { ask, Button, confirmAction, Empty, request } from "./shared.js";

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

function AgentModelSelect({ ctx, value = "", effort = "", systemDefault, allowSystemDefault = true }) {
  const [catalog, setCatalog] = useState({ groups: [], failures: [], loading: true, error: "" });
  const [route, setRoute] = useState(value);
  const [reasoningEffort, setReasoningEffort] = useState(effort);
  useEffect(() => {
    let mounted = true;
    void ctx.get("connection").api.llm.models({}).then((response) => {
      if (!response.result.ok) throw new Error(response.result.error.message);
      if (mounted) setCatalog({ ...response.result.value, loading: false, error: "" });
    }).catch((reason) => {
      if (mounted) setCatalog({ groups: [], failures: [], loading: false,
        error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { mounted = false; };
  }, [ctx]);
  const groups = [...catalog.groups].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const codex = groups.find(({ id }) => id === "openai-codex");
  const channels = CODEX_CHANNELS.flatMap(([id, family, name]) => {
    const model = latestCodexModel(codex?.models ?? [], family);
    return model ? [{ id, name, model, route: `openai-codex/${id}` }] : [];
  });
  const routes = new Set(groups.flatMap((group) => group.models.map((model) => `${group.id}/${model.id}`)));
  for (const channel of channels) routes.add(channel.route);
  const preserveCurrent = value && (catalog.loading || catalog.error || !routes.has(value));
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
      preserveCurrent ? h("option", { value }, catalog.loading ? `Current: ${value}`
        : catalog.error ? `Current: ${value} (catalog unavailable)` : `Current: ${value} (unavailable)`) : null,
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

export function SystemDefaultSettings({ ctx, systemDefault, reload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      h(AgentModelSelect, { ctx, value: route, effort: systemDefault?.reasoningEffort, allowSystemDefault: false }),
      h(Button, { type: "submit", className: "primary", disabled: busy }, busy ? "Saving…" : "Save default")),
    message ? h("div", { className: message.endsWith("updated.") ? "bees-muted" : "bees-error", role: "status" }, message) : null);
}


/** Which MCP servers this agent may use. Shared by the create and edit forms. */
function McpAccess({ servers, access, chosen }) {
  const [mode, setMode] = useState(access ?? "all");
  const picked = new Set(chosen ?? []);
  return h(React.Fragment, null,
    h("label", null, "MCP servers this agent may use",
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
        h("input", { type: "checkbox", name: "mcpServers", value: server.id, defaultChecked: picked.has(server.id) }),
        ` ${server.label} (${server.toolCount} tool${server.toolCount === 1 ? "" : "s"})`)),
      servers.length ? null : h("span", { className: "bees-muted" }, "Nothing to pick yet.")) : null);
}

function AgentCreateForm({ ctx, data, servers, workspaceId, act, onCancel, onCreated }) {
  const presets = data.presets.filter(({ broken }) => !broken);
  if (!workspaceId) return h(Empty, null, "Choose one workspace before creating an agent.");
  return h("form", { className: "bees-box bees-form bees-agent-form", onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const created = await act({
      action: "add_agent_assignment", workspaceId,
      name: String(form.get("name") ?? ""), presetId: String(form.get("presetId") ?? ""),
      description: String(form.get("description") ?? ""), instructions: String(form.get("instructions") ?? ""),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""),
      capabilities: String(form.get("capabilities") ?? "").split(","),
      mcpAccess: String(form.get("mcpAccess") ?? "all"), mcpServers: form.getAll("mcpServers").map(String),
      enabled: form.get("enabled") === "on", maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
    });
    if (created?.id) onCreated(created.id);
  } },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Agents"),
      h("div", null, h("h2", null, "New agent"), h("div", { className: "bees-muted" }, "Give it a name, a toolbox, and a model. Everything here can be changed later."))),
    h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Research agent" })),
    h("label", null, "Description", h("input", { className: "bees-input", name: "description", placeholder: "What should this agent be used for?" })),
    h("label", null, "Agent preset, its skills and tools",
      h("select", { className: "bees-select", name: "presetId", required: true,
        defaultValue: presets.find(({ id }) => id === "standard")?.id ?? presets[0]?.id },
        ...presets.map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))),
      h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run. "
        + "Skills & tools lists what each one carries.")),
    h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel }),
    h("label", null, "Capabilities, comma separated",
      h("input", { className: "bees-input", name: "capabilities", placeholder: "research, writing" }),
      h("span", { className: "bees-muted" }, "Optional labels. A process stage can ask for an agent that has one.")),
    h(McpAccess, { servers }),
    h("label", null, "Maximum concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: 0 })),
    h("label", null, h("span", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: true }), " Available for routing")),
    h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", placeholder: "How should this agent complete work?" })),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary", disabled: !presets.length }, "Create agent"),
      h(Button, { onClick: onCancel }, "Cancel"))
  );
}

function PoolCreateForm({ workspaceId, act, onCancel, onCreated }) {
  if (!workspaceId) return h(Empty, null, "Choose one workspace before creating a pool.");
  return h("form", { className: "bees-box bees-form", onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const created = await act({ action: "add_agent_pool", workspaceId,
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") });
    if (created?.id) onCreated(created.id);
  } },
    h("div", { className: "bees-page-head" }, h(Button, { onClick: onCancel }, "← Pools"),
      h("div", null, h("h2", null, "New agent pool"), h("div", { className: "bees-muted" }, "Name the interchangeable role now, then add and prioritize member agents."))),
    h("label", null, "Name", h("input", { className: "bees-input", name: "name", required: true, autoFocus: true, placeholder: "Editorial reviewers" })),
    h("label", null, "Description", h("textarea", { className: "bees-textarea", name: "description", placeholder: "When should Bees route work to this pool?" })),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Create pool"), h(Button, { onClick: onCancel }, "Cancel"))
  );
}

export function AgentsPage({ ctx, data, servers = [], route, workspaceIds, workspaceId, creating, setCreating, act, openDshSettings }) {
  const assignments = data.assignments.filter((row) => workspaceIds.includes(row.workspaceId));
  const pools = data.pools.filter((row) => workspaceIds.includes(row.workspaceId));
  const [selectedId, setSelectedId] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const selected = assignments.find(({ id }) => id === selectedId);
  const selectedPool = pools.find(({ id }) => id === selectedPoolId);
  if (creating === "agent") return h(AgentCreateForm, { ctx, data, servers, workspaceId, act,
    onCancel: () => setCreating(""), onCreated: (id) => { setCreating(""); setSelectedId(id); } });
  if (creating === "pool") return h(PoolCreateForm, { workspaceId, act,
    onCancel: () => setCreating(""), onCreated: (id) => { setCreating(""); setSelectedPoolId(id); } });
  if (route === "presets") return h("div", { className: "bees-stack" },
    h("div", { className: "bees-callout" }, h("h3", null, "A preset is an agent's toolbox"),
      h("div", null, "It bundles the prompt, the skills, the tools and the permissions an agent gets. "
        + "Every agent picks one. What the presets themselves contain is edited in DSH settings.")),
    h("section", { className: "bees-box" }, h("div", { className: "bees-row" }, h("div", { className: "bees-row-main" },
      h("h3", null, "Available agent presets"), h("div", { className: "bees-muted" }, "Agents select one of these libraries.")),
      h(Button, { className: "primary", onClick: openDshSettings }, "Manage presets & skills")),
      ...(data.presets.length ? data.presets.map((preset) => h("div", { className: "bees-row", key: preset.id },
        h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, preset.name),
          h("div", { className: "bees-muted" }, preset.broken ? "Unavailable" : preset.description || "Agent preset")),
        h("span", { className: "bees-badge" }, preset.trust ?? "preset"))) : [h(Empty, { key: "empty" }, "No agent presets are available")]))
  );
  if (route === "pools") {
    if (selectedPool) {
      const members = data.poolMembers.filter(({ poolId }) => poolId === selectedPool.id);
      const memberAgents = members.map((member) => ({
        ...member, agent: assignments.find(({ id }) => id === member.agentAssignmentId)
      })).filter(({ agent }) => agent);
      const available = assignments.filter(({ workspaceId: id, id: agentId }) =>
        id === selectedPool.workspaceId && !members.some(({ agentAssignmentId }) => agentAssignmentId === agentId));
      const addMember = async () => {
        const name = await ask(`Agent:\n${available.map(({ name }) => name).join("\n")}`, available[0]?.name ?? "");
        const agent = available.find((row) => row.name === name); if (!agent) return;
        const priority = await ask("Priority (1 runs first)", "100", "number"); if (priority === null) return;
        await act({ action: "set_agent_pool_member", agentPoolId: selectedPool.id, agentAssignmentId: agent.id, priority: Number(priority) });
      };
      return h("div", { className: "bees-stack" },
        h("form", { className: "bees-box bees-form", onSubmit: async (event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          await act({ action: "edit_agent_pool", agentPoolId: selectedPool.id,
            name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") });
        } },
          h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelectedPoolId("") }, "← Pools"), h("strong", null, selectedPool.name)),
          h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selectedPool.name })),
          h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selectedPool.description })),
          h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Save pool"))),
        h("section", { className: "bees-box" },
          h("div", { className: "bees-row" }, h("h3", null, "Members"), h("div", { className: "bees-grow" }),
            h(Button, { className: "primary", disabled: !available.length, onClick: addMember }, "Add agent")),
          ...(memberAgents.length ? memberAgents.map((member) => h("div", { className: "bees-row", key: member.agentAssignmentId },
            h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, member.agent.name),
              h("div", { className: "bees-muted" }, `Priority ${member.priority}${member.lastAssignedAt ? ` · last selected ${new Date(member.lastAssignedAt).toLocaleString()}` : " · never selected"}`)),
            h(Button, { onClick: () => act({ action: "set_agent_pool_member", agentPoolId: selectedPool.id,
              agentAssignmentId: member.agentAssignmentId, priority: member.priority, enabled: !member.enabled }) }, member.enabled ? "Pause" : "Enable"),
            h(Button, { className: "danger", onClick: async () => (await confirmAction(`Remove ${member.agent.name} from ${selectedPool.name}?`)) &&
              act({ action: "set_agent_pool_member", agentPoolId: selectedPool.id, agentAssignmentId: member.agentAssignmentId, remove: true }) }, "Remove")))
            : [h(Empty, { key: "empty" }, "No agents in this pool yet")])));
    }
    return h("div", null,
      h("div", { className: "bees-callout" }, h("h3", null, "A pool is a backup bench"),
        h("div", null, "Put interchangeable agents in a pool when any one of them can do the same stage. Bees picks an available compatible agent deterministically. Use one named agent when continuity matters.")),
      h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
      h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("pool") }, "New pool")),
      ...(pools.length ? pools.map((pool) => {
        const members = data.poolMembers.filter(({ poolId }) => poolId === pool.id);
        return h("div", { className: "bees-row", key: pool.id },
          h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, pool.name),
            h("div", { className: "bees-muted" }, `${members.filter(({ enabled }) => enabled).length} enabled agents · ${pool.description || "Deterministic agent pool"}`)),
          h(Button, { onClick: () => setSelectedPoolId(pool.id) }, "Configure"));
      }) : [h(Empty, { key: "empty" }, "No agent pools yet")])) ;
  }
  if (selected) return h("form", { className: "bees-box bees-form bees-agent-form", key: selected.id, onSubmit: async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const saved = await act({
      action: "edit_agent_assignment", agentAssignmentId: selected.id,
      name: String(form.get("name") ?? selected.name), presetId: String(form.get("presetId") ?? selected.presetId),
      description: String(form.get("description") ?? ""), instructions: String(form.get("instructions") ?? ""),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""),
      capabilities: String(form.get("capabilities") ?? "").split(","),
      mcpAccess: String(form.get("mcpAccess") ?? "all"), mcpServers: form.getAll("mcpServers").map(String),
      enabled: form.get("enabled") === "on", maxConcurrency: Number(form.get("maxConcurrency") ?? 0)
    });
    if (saved) setSelectedId("");
  } },
    h("div", { className: "bees-row" }, h(Button, { onClick: () => setSelectedId("") }, "← Agents"), h("strong", null, selected.name), h("div", { className: "bees-grow" }), selected.systemRole ? h("span", { className: "bees-badge" }, `Bees ${selected.systemRole}`) : null),
    h("label", null, "Name", h("input", { className: "bees-input", name: "name", defaultValue: selected.name, disabled: Boolean(selected.systemRole) })),
    h("label", null, "Description", h("input", { className: "bees-input", name: "description", defaultValue: selected.description })),
    h("label", null, "Agent preset, its skills and tools",
      h("select", { className: "bees-select", name: "presetId", defaultValue: selected.presetId },
        ...data.presets.filter(({ broken }) => !broken).map((preset) => h("option", { value: preset.id, key: preset.id }, preset.name))),
      h("span", { className: "bees-muted" }, "The preset decides which tools this agent can run. "
        + "Skills & tools lists what each one carries.")),
    h(AgentModelSelect, { ctx, value: selected.model ?? "", effort: selected.reasoningEffort ?? "",
      systemDefault: data.systemDefaultModel }),
    h("label", null, "Capabilities, comma separated",
      h("input", { className: "bees-input", name: "capabilities", defaultValue: selected.capabilities.join(", "), placeholder: "research, writing" }),
      h("span", { className: "bees-muted" }, "Optional labels. A process stage can ask for an agent that has one.")),
    h(McpAccess, { servers, access: selected.mcpAccess, chosen: selected.mcpServers }),
    h("label", null, "Maximum concurrent runs (0 is unlimited)", h("input", { className: "bees-input", name: "maxConcurrency", type: "number", min: 0, max: 1000, defaultValue: selected.maxConcurrency })),
    h("label", null, h("input", { name: "enabled", type: "checkbox", defaultChecked: selected.enabled }), " Available for routing"),
    h("label", null, "Instructions", h("textarea", { className: "bees-textarea", name: "instructions", defaultValue: selected.instructions, placeholder: selected.systemRole === "reviewer" ? "How this workspace should review work" : "How this agent should complete work" })),
    h("p", { className: "bees-muted" }, selected.systemRole ? "Bees keeps the runtime completion protocol protected. These instructions customize how this workspace's built-in agent performs its role." : "These instructions are mounted with the selected DSH preset."),
    h("div", { className: "bees-detail-actions" }, h("button", { className: "bees-btn primary" }, "Save agent"))
  );
  return h("div", null, h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }), h(Button, { className: "primary", disabled: !workspaceId, onClick: () => setCreating("agent") }, "New agent")),
    ...(assignments.length ? assignments.map((agent) => h("div", { className: "bees-row", key: agent.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, agent.name), h("div", { className: "bees-muted" }, `${agent.enabled ? agent.presetId : "Unavailable"}${agent.model ? ` · ${agent.model}` : " · default model"}${agent.reasoningEffort ? ` · ${agent.reasoningEffort} effort` : ""}${agent.capabilities.length ? ` · ${agent.capabilities.join(", ")}` : ""} · ${agent.description || "Agent preset assignment"}`)), agent.systemRole ? h("span", { className: "bees-badge" }, `Bees ${agent.systemRole}`) : null, h(Button, { onClick: () => setSelectedId(agent.id) }, "Configure"))) : [h(Empty, { key: "empty" }, "No agents assigned to this scope")])
  );
}
