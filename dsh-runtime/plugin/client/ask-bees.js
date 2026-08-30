import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button, clip } from "./shared.js";
import { AgentModelSelect, McpAccess } from "./agents.js";
import { inheritedInputs, ResourceFields } from "./location-fields.js";
import { McpPage } from "./skills.js";
import { SettingsPage } from "./settings.js";

export function goalSetup(data, workspaceId) {
  const process = data.processes.find((row) => row.workspaceId === workspaceId && row.kind === "goals");
  const stages = data.stages.filter((row) => row.processId === process?.id && !row.isTerminal).map((stage) => {
    const role = stage.driver === "review" ? "reviewer" : "worker";
    const agents = stage.routeType === "pool"
      ? data.assignments.filter((agent) => agent.workspaceId === workspaceId && agent.enabled &&
        data.poolMembers.some((member) => member.poolId === stage.routeTargetId && member.agentAssignmentId === agent.id && member.enabled))
      : [data.assignments.find((agent) => agent.workspaceId === workspaceId &&
        (stage.routeType === "agent" ? agent.id === stage.routeTargetId : agent.systemRole === role))].filter(Boolean);
    return { ...stage, agents };
  });
  const inherited = [
    ...inheritedInputs(data, process?.id),
    ...stages.flatMap((stage) => stage.agents.flatMap((agent) => inheritedInputs(data, null, agent.id)
      .map((ref) => ({ ...ref, source: `${stage.name}: ${agent.name}` }))))
  ];
  return { process, stages, inherited };
}

const modelLabel = (agent, systemDefault) => agent.model || (systemDefault?.provider && systemDefault?.model
  ? `${systemDefault.provider}/${systemDefault.model}` : "System default (not configured)");

export function AskBeesSetup({ ctx, data, workspaceId, outcome, onOutcome, act, onBack, onStarted,
  capabilities, modelSettings, preferences, reload, active = true }) {
  const [inputIds, setInputIds] = useState([]);
  const [outputId, setOutputId] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [customTools, setCustomTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manage, setManage] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const submitting = useRef(false);
  const heading = useRef(null);
  const { process, stages, inherited } = goalSetup(data, workspaceId);
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;
  const team = data.teams.find(({ id }) => id === teamId);
  const servers = capabilities.data?.servers ?? [];
  const enabledServers = servers.filter((server) => server.enabled);
  const unavailable = !process || !stages.length || stages.some((stage) => !stage.agents.length || stage.agents.some((agent) => !agent.enabled));
  const custom = customModel || customTools || inputIds.length || outputId;
  useEffect(() => { if (active && !manage) heading.current?.focus(); }, [active, manage]);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || unavailable || !outcome.trim()) return;
    const form = new FormData(event.currentTarget);
    const runSettings = {};
    if (customModel) {
      runSettings.model = String(form.get("model") ?? "") || null;
      runSettings.reasoningEffort = String(form.get("reasoningEffort") ?? "") || null;
    }
    if (customTools) {
      runSettings.mcpAccess = String(form.get("mcpAccess") ?? "none");
      runSettings.mcpServers = form.getAll("mcpServers").map(String);
      if (runSettings.mcpAccess === "listed" && !runSettings.mcpServers.length) {
        setError("Choose at least one tool connection, or choose None."); return;
      }
    }
    submitting.current = true; setBusy(true); setError("");
    try {
      const text = outcome.trim();
      const firstLine = text.split("\n")[0].trim();
      const result = await act({ action: "create_goal", workspaceId,
        title: firstLine.length > 60 ? `${clip(firstLine, 57)}...` : firstLine,
        description: text, priority: "normal", inputLocationIds: inputIds, outputLocationId: outputId || null, runSettings });
      if (!result?.id) throw new Error("Could not create your goal. Your setup is preserved; try again.");
      // A start error still returns a saved goal. Open it for recovery instead of creating a duplicate.
      onStarted(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const closeManager = () => { setManage(""); setCatalogRevision((value) => value + 1); void reload(); };
  return h("div", { className: "bees-ask-setup" },
    h("div", { hidden: Boolean(manage) },
      h(Button, { onClick: onBack, disabled: busy }, "← Back to Home"),
      h("header", { className: "bees-ask-heading" },
        h("span", { className: "bees-muted" }, `ASK BEES · ${team?.name ?? "Choose a team"}`),
        h("h1", { ref: heading, tabIndex: -1 }, "Review & start"),
        h("p", { className: "bees-muted" }, "Ready with your workflow defaults. Change only what this goal needs. Nothing runs until you start.")),
      h("form", { onSubmit: submit },
        h("fieldset", { className: "bees-ask-fields", disabled: busy || !["admin", "member"].includes(team?.role) },
          h("section", { className: "bees-box bees-form" },
            h("label", null, "Your outcome", h("textarea", { className: "bees-textarea", name: "outcome", required: true,
              value: outcome, onChange: (event) => onOutcome(event.target.value), rows: 3 })),
            h("p", { className: "bees-muted" }, "Include useful context, constraints, and what a good result looks like.")),
          h("div", { className: "bees-ask-columns" },
            h("section", { className: "bees-box bees-form" },
              h("h2", null, "Model & workflow"),
              h("p", { className: "bees-muted" }, "Bees does the work, then an independent reviewer checks it. You do not need to pick an agent."),
              h("strong", null, customModel ? "Workflow defaults (overridden below)" : "Workflow defaults"),
              h("div", { className: "bees-ask-stages" }, ...stages.map((stage) => h("div", { key: stage.id },
                h("strong", null, stage.name),
                ...stage.agents.map((agent) => h("div", { key: agent.id, className: "bees-muted" },
                  `${agent.name} · ${modelLabel(agent, data.systemDefaultModel)}${agent.reasoningEffort ? ` · ${agent.reasoningEffort} effort` : ""}`))))),
              h("label", { className: "bees-ask-toggle" }, h("input", { type: "checkbox", checked: customModel,
                onChange: (event) => setCustomModel(event.target.checked) }), "Choose a model for this goal"),
              customModel ? h("div", { className: "bees-form" },
                h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel, refreshKey: catalogRevision }),
                h("p", { className: "bees-muted" }, "Applies to work, review, and delegated tasks for this goal. Shared agents stay unchanged.")) : null,
              h(Button, { onClick: () => setManage("models") }, "Connect a model provider")),
            h("section", { className: "bees-box bees-form" },
              h("h2", null, "Tools & connections"),
              h("p", { className: "bees-muted" }, "Connected apps provide extra tools. Built-in tools and approval requirements stay in place."),
              capabilities.error ? h("p", { className: "bees-error", role: "status" }, `Could not refresh connections: ${capabilities.error}`)
                : !capabilities.data ? h("p", { role: "status" }, "Loading connections…")
                  : h("p", { className: "bees-muted" }, enabledServers.length
                    ? enabledServers.map((server) => `${server.label} · ${server.status === "connected" ? `${server.toolCount} tools` : server.status}`).join(" · ")
                    : "No extra tools connected. You can continue with built-in tools or connect an app."),
              h("strong", null, "Workflow tool access"),
              ...stages.map((stage) => h("div", { key: stage.id, className: "bees-muted" }, `${stage.name}: ${stage.agents.map((agent) =>
                agent.mcpAccess === "none" ? "No connected tools" : agent.mcpAccess === "listed"
                  ? (agent.mcpServers ?? []).map((id) => servers.find((server) => server.id === id)?.label ?? "Unavailable connection").join(", ") || "No connected tools"
                  : "All connected tools").join(" / ")}`)),
              h("label", { className: "bees-ask-toggle" }, h("input", { type: "checkbox", checked: customTools,
                onChange: (event) => setCustomTools(event.target.checked) }), "Limit connected tools for this goal"),
              customTools ? h("div", { className: "bees-form" },
                h(McpAccess, { servers: enabledServers, access: "none", label: "Connected tools allowed for this goal" }),
                h("p", { className: "bees-muted" }, "This can limit access further, but cannot grant tools blocked by an agent's settings.")) : null,
              h(Button, { onClick: () => setManage("tools") }, "Connect tools"))),
          h("section", { className: "bees-box" },
            h("h2", null, "Files & folders"),
            h(ResourceFields, { ctx, data, teamId, act, inputIds, onInputIds: setInputIds, outputId, onOutputId: setOutputId,
              inherited, defaultOutputId: process?.outputLocationId,
              defaultOutputName: data.locations.find(({ id }) => id === process?.outputLocationId)?.name ?? "" })),
          unavailable ? h("p", { className: "bees-error", role: "alert" }, "This workflow needs an enabled work agent and reviewer. Configure them under Agents before starting.") : null,
          error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
          h("footer", { className: "bees-ask-footer" },
            h("span", { className: "bees-muted" }, "Changes here apply to this goal. Publishing files still needs your approval."),
            h("button", { className: "bees-btn primary", disabled: busy || unavailable || !outcome.trim() },
              busy ? "Starting…" : custom ? "Start goal" : "Start with defaults"))))),
    manage ? h("div", { className: "bees-stack" },
      h(Button, { onClick: closeManager }, "← Back to goal setup"),
      h("p", { className: "bees-callout" }, "Your goal setup is preserved. Connections added here are available across Bees; choose which ones this goal may use when you return."),
      manage === "tools" ? h(McpPage, { ctx, capabilities })
        : h(SettingsPage, { ctx, data, route: "personal-ai", teamId, modelSettings, preferences, reload })) : null);
}
