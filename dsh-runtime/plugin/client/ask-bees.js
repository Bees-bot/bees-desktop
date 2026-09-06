import { h, useEffect, useRef, useState } from "./runtime.js";
import { Button, ProposalCard, useSnapshot } from "./shared.js";
import { EMPTY_INTERACTIONS, pendingInteractionFor, QuestionPanel } from "./work.js";
import { AgentModelSelect, McpAccess } from "./agents.js";
import { McpPage } from "./skills.js";
import { SettingsPage } from "./settings.js";

export function AskBeesSetup({ ctx, data, workspaceId, outcome, onOutcome, act, onBack, onStarted,
  capabilities, modelSettings, preferences, reload, active = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manage, setManage] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  // The planner run's session; its proposal shows up here when it lands.
  const [planning, setPlanning] = useState("");
  const [handled, setHandled] = useState(() => new Set());
  const waiting = useSnapshot(ctx.uiSession.pendingInteractions, EMPTY_INTERACTIONS);
  const heading = useRef(null);
  const teamId = data.workspaces.find(({ id }) => id === workspaceId)?.teamId;
  const team = data.teams.find(({ id }) => id === teamId);
  const enabledServers = (capabilities.data?.servers ?? []).filter((server) => server.enabled);
  const proposal = data.proposals.find((row) => row.sessionId === planning && row.status === "pending");
  const question = pendingInteractionFor(waiting, planning, handled);

  useEffect(() => { if (active && !manage) heading.current?.focus(); }, [active, manage]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !outcome.trim()) return;
    const form = new FormData(event.currentTarget);
    const mcpAccess = String(form.get("mcpAccess") ?? "all");
    const mcpServers = form.getAll("mcpServers").map(String);
    if (mcpAccess === "listed" && !mcpServers.length) { setError("Choose at least one tool connection, or choose None."); return; }
    setBusy(true); setError("");
    const result = await act({ action: "ask_bees", workspaceId, outcome: outcome.trim(),
      model: String(form.get("model") ?? ""), reasoningEffort: String(form.get("reasoningEffort") ?? ""), mcpAccess, mcpServers });
    setBusy(false);
    if (result?.sessionId) setPlanning(result.sessionId);
  };
  const apply = async () => {
    const result = await act({ action: "apply_proposal", proposalId: proposal.id });
    if (!result) return;
    const started = proposal.changes.findIndex(({ action }) => action === "create_item" || action === "create_goal");
    const id = result.results[started]?.id;
    if (id) onStarted(id); else onBack();
  };
  const dismiss = async () => { if (await act({ action: "reject_proposal", proposalId: proposal.id })) setPlanning(""); };
  const closeManager = () => { setManage(""); setCatalogRevision((value) => value + 1); void reload(); };

  const plan = proposal
    ? h(ProposalCard, { proposal, onApply: apply, onDismiss: dismiss })
    : h("section", { className: "bees-box" },
      h("h2", null, question ? "Bees has a question" : "Bees is planning"),
      question
        ? h(QuestionPanel, { key: question.key, wait: question, act, executionId: planning,
          onAnswered: (key) => setHandled((current) => new Set(current).add(key)) })
        : h("p", { className: "bees-muted" }, "Bees is choosing an existing process and checking for any missing setup. The proposed work appears here for you to apply."),
      h(Button, { onClick: () => setPlanning("") }, "Back to the form"));

  return h("div", { className: "bees-ask-setup", style: { maxWidth: 640, margin: "0 auto", padding: "16px 0" } },
    h("div", { hidden: Boolean(manage) },
      h(Button, { onClick: onBack, disabled: busy }, "← Back to Home"),
      h("header", { className: "bees-ask-heading", style: { marginTop: 16, marginBottom: 24 } },
        h("span", { className: "bees-muted" }, `ASK BEES · ${team?.name ?? "Choose a team"}`),
        h("h1", { ref: heading, tabIndex: -1, style: { fontSize: "2rem", marginBottom: 8 } }, "What should Bees build?"),
        h("p", { className: "bees-muted" }, "Bees uses Goals or an existing process, and proposes any missing setup. You review the changes before work starts.")),
      planning ? plan : h("form", { onSubmit: submit, style: { display: "flex", flexDirection: "column", gap: "24px" } },
        h("fieldset", { disabled: busy || !["admin", "member"].includes(team?.role), style: { display: "flex", flexDirection: "column", gap: "24px", padding: 0, border: "none", margin: 0 } },
          h("section", { className: "bees-box bees-form" },
            h("label", { style: { fontSize: "1.1rem", fontWeight: 600, display: "block", marginBottom: 8 } }, "What would you like Bees to do?"),
            h("textarea", { className: "bees-textarea", name: "outcome", required: true, value: outcome, rows: 4,
              "aria-describedby": "bees-ask-references",
              onChange: (event) => onOutcome(event.target.value),
              placeholder: "e.g., Every morning, read three news sites and brief me on the topics I pick" }),
            h("p", { className: "bees-muted", style: { marginTop: 8 } }, "Include the sources, keys or links it needs, when it should run, and what a good result looks like."),
            h("p", { id: "bees-ask-references", className: "bees-muted" }, "Reference an existing agent with $agent-name, or use $human:name, $work:title, $template:name, $file:filename, and $process:name. Files must be in a mapped team location. Put file paths with spaces in quotes.")),
          h("section", { className: "bees-box bees-form" },
            h("h2", null, "AI Model"),
            h("p", { className: "bees-muted" }, "A selected model plans and runs this work. System Default uses your configured models."),
            h(AgentModelSelect, { ctx, systemDefault: data.systemDefaultModel, refreshKey: catalogRevision }),
            h("div", { style: { marginTop: "12px" } }, h(Button, { onClick: () => setManage("models") }, "Connect another model provider"))),
          h("section", { className: "bees-box bees-form" },
            h("h2", null, "Tools & Connections (MCP)"),
            h("p", { className: "bees-muted" }, "Connected apps that planning and the resulting work may use, within each agent’s tool access."),
            h(McpAccess, { servers: enabledServers, access: "all", label: "Tools for this work" }),
            h("div", { style: { marginTop: "12px" } }, h(Button, { onClick: () => setManage("tools") }, "Manage connected tools"))),
          error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 8 } },
            h("button", { type: "submit", className: "bees-btn primary", style: { padding: "8px 24px", fontSize: "1.1rem" }, disabled: busy || !outcome.trim() },
              busy ? "Starting…" : "Plan it"))))),
    manage ? h("div", { className: "bees-stack", style: { maxWidth: 640, margin: "0 auto", padding: "16px 0" } },
      h(Button, { onClick: closeManager }, "← Back to Ask Bees"),
      h("p", { className: "bees-callout" }, "Your text is preserved. Connections added here are available across Bees; choose which ones this work may use when you return."),
      manage === "tools" ? h(McpPage, { ctx, capabilities })
        : h(SettingsPage, { ctx, data, route: "personal-ai", teamId, modelSettings, preferences, reload })) : null
  );
}
