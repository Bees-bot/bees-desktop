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
  
  useEffect(() => { if (active && !manage) heading.current?.focus(); }, [active, manage]);
  
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || unavailable || !outcome.trim()) return;
    const form = new FormData(event.currentTarget);
    const runSettings = {};
    
    const model = String(form.get("model") ?? "");
    if (model) runSettings.model = model;
    
    const reasoningEffort = String(form.get("reasoningEffort") ?? "");
    if (reasoningEffort) runSettings.reasoningEffort = reasoningEffort;
    
    runSettings.mcpAccess = String(form.get("mcpAccess") ?? "all");
    runSettings.mcpServers = form.getAll("mcpServers").map(String);
    if (runSettings.mcpAccess === "listed" && !runSettings.mcpServers.length) {
      setError("Choose at least one tool connection, or choose None."); return;
    }
    
    submitting.current = true; setBusy(true); setError("");
    try {
      const text = outcome.trim();
      const firstLine = text.split("\n")[0].trim();
      const result = await act({ action: "create_goal", workspaceId,
        title: firstLine.length > 60 ? `${clip(firstLine, 57)}...` : firstLine,
        description: text, priority: "normal", inputLocationIds: inputIds, outputLocationId: outputId || null, runSettings });
      if (!result?.id) throw new Error("Could not create your goal. Your setup is preserved; try again.");
      onStarted(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitting.current = false; setBusy(false); }
  };
  
  const closeManager = () => { setManage(""); setCatalogRevision((value) => value + 1); void reload(); };
  
  return h("div", { className: "bees-ask-setup", style: { maxWidth: 640, margin: "0 auto", padding: "16px 0" } },
    h("div", { hidden: Boolean(manage) },
      h(Button, { onClick: onBack, disabled: busy }, "← Back to Home"),
      h("header", { className: "bees-ask-heading", style: { marginTop: 16, marginBottom: 24 } },
        h("span", { className: "bees-muted" }, `ASK BEES · ${team?.name ?? "Choose a team"}`),
        h("h1", { ref: heading, tabIndex: -1, style: { fontSize: "2rem", marginBottom: 8 } }, "Configure your goal"),
        h("p", { className: "bees-muted" }, "Provide your instructions and adjust any settings before starting.")),
      h("form", { onSubmit: submit, style: { display: "flex", flexDirection: "column", gap: "24px" } },
        h("fieldset", { disabled: busy || !["admin", "member"].includes(team?.role), style: { display: "flex", flexDirection: "column", gap: "24px", padding: 0, border: "none", margin: 0 } },
          
          h("section", { className: "bees-box bees-form" },
            h("label", { style: { fontSize: "1.1rem", fontWeight: 600, display: "block", marginBottom: 8 } }, "What would you like Bees to do?"), 
            h("textarea", { className: "bees-textarea", name: "outcome", required: true,
              value: outcome, onChange: (event) => onOutcome(event.target.value), rows: 4,
              placeholder: "e.g., Research top CRM software and draft a comparison report" }),
            h("p", { className: "bees-muted", style: { marginTop: 8 } }, "Include useful context, constraints, and what a good result looks like.")),

          h("section", { className: "bees-box bees-form" },
            h("h2", null, "AI Model"),
            h("p", { className: "bees-muted" }, "Choose the AI model for this goal. Leave as System Default to use your global preference."),
            h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel, refreshKey: catalogRevision }),
            h("div", { style: { marginTop: "12px" } }, 
              h(Button, { onClick: () => setManage("models") }, "Connect another model provider")
            )
          ),

          h("section", { className: "bees-box bees-form" },
            h("h2", null, "Tools & Connections (MCP)"),
            h("p", { className: "bees-muted" }, "Allow Bees to use connected apps to fetch information or perform actions."),
            h(McpAccess, { servers: enabledServers, access: "all", label: "Allowed tools for this goal" }),
            h("div", { style: { marginTop: "12px" } }, 
              h(Button, { onClick: () => setManage("tools") }, "Manage connected tools")
            )
          ),

          h("section", { className: "bees-box" },
            h("h2", null, "Files & folders"),
            h(ResourceFields, { ctx, data, teamId, act, inputIds, onInputIds: setInputIds, outputId, onOutputId: setOutputId,
              inherited, defaultOutputId: process?.outputLocationId,
              defaultOutputName: data.locations.find(({ id }) => id === process?.outputLocationId)?.name ?? "" })
          ),

          unavailable ? h("p", { className: "bees-error", role: "alert" }, "This workflow needs an enabled work agent and reviewer. Configure them under Agents before starting.") : null,
          error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
          
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 } },
            h("span", { className: "bees-muted" }, "Publishing files still needs your approval."),
            h("button", { type: "submit", className: "bees-btn primary", style: { padding: "8px 24px", fontSize: "1.1rem" }, disabled: busy || unavailable || !outcome.trim() },
              busy ? "Starting…" : "Start Goal"))
        )
      )
    ),
    manage ? h("div", { className: "bees-stack", style: { maxWidth: 640, margin: "0 auto", padding: "16px 0" } },
      h(Button, { onClick: closeManager }, "← Back to goal setup"),
      h("p", { className: "bees-callout" }, "Your goal setup is preserved. Connections added here are available across Bees; choose which ones this goal may use when you return."),
      manage === "tools" ? h(McpPage, { ctx, capabilities })
        : h(SettingsPage, { ctx, data, route: "personal-ai", teamId, modelSettings, preferences, reload })) : null
  );
}