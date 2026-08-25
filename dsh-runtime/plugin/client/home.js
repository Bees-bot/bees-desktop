import { h, useState } from "./runtime.js";
import { Button, Empty } from "./shared.js";

export function Home({ data, workspaceId, act, openWorkItem }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  
  const submit = async () => {
    if (!workspaceId || !outcome.trim()) return;
    setBusy(true); setError("");
    try {
      const text = outcome.trim();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const title = lines[0].length > 60 ? lines[0].substring(0, 57) + "..." : lines[0];
      const created = await act({ action: "create_goal", workspaceId, title, description: text, priority: "normal" });
      if (created?.id) openWorkItem(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const processes = data.processes.filter((row) => row.workspaceId === workspaceId && row.kind === "standard");
  const templates = (data.templates ?? []).filter((row) => row.workspaceId === workspaceId);
  const cards = [...templates.map(t => ({...t, isTemplate: true})), ...processes.map(p => ({...p, isTemplate: false}))];
  const visibleCards = showAllTemplates ? cards : cards.slice(0, 10);
  
  // Calculate Needs Attention vs Recent Active
  const activeWork = data.workItems ? data.workItems.filter(w => !["completed", "cancelled", "archived"].includes(w.runtimePhase)) : [];
  const needsAttention = activeWork.filter(w => ["waiting", "failed"].includes(w.runtimePhase)).slice(0, 5);
  const recentWork = activeWork.filter(w => !needsAttention.includes(w)).slice(0, 5);

  return h("div", { className: "bees-panel bees-panel-wide bees-home-layout" },
    h("div", { className: "bees-home-main" },
      h("div", { className: "bees-hero" },
        h("div", { className: "bees-hero-head" },
          h("h1", null, "What outcome should Bees own?"),
          h("p", { className: "bees-hero-desc" }, "Ask an agent to propose a goal or visible process. Nothing changes until you review and apply it.")
        ),
        h("form", {
          className: "bees-composer",
          onSubmit: (event) => { event.preventDefault(); void submit(); }
        },
          h("textarea", {
            className: "bees-composer-input",
            placeholder: workspaceId ? "e.g., Research top CRM software and draft a comparison report" : "Choose a workspace first",
            disabled: !workspaceId || busy,
            value: outcome,
            onInput: (e) => setOutcome(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }
          }),
          error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
          h("div", { className: "bees-composer-foot" },
            h("span", { className: "bees-composer-hint" }, "Press ⌘ + Enter to start"),
            h("button", { className: "bees-btn primary", disabled: !workspaceId || !outcome.trim() || busy }, busy ? "Starting..." : "Ask Bees")
          )
        )
      ),
      needsAttention.length > 0 && h("div", { className: "bees-home-section" },
        h("h3", null, "Needs your attention"),
        h("div", { className: "bees-work-list" },
          needsAttention.map(w =>
            h("button", { className: "bees-work-card", onClick: () => openWorkItem(w.id), key: w.id },
              h("div", { className: "bees-work-card-title" }, w.title || w.id),
              h("div", { className: "bees-work-card-meta" }, `Phase: ${w.runtimePhase || "unknown"}`)
            )
          )
        )
      ),
      recentWork.length > 0 && h("div", { className: "bees-home-section" },
        h("h3", null, "Recent work"),
        h("div", { className: "bees-work-list" },
          recentWork.map(w =>
            h("button", { className: "bees-work-card", onClick: () => openWorkItem(w.id), key: w.id },
              h("div", { className: "bees-work-card-title" }, w.title || w.id),
              h("div", { className: "bees-work-card-meta" }, w.runtimePhase || "in progress")
            )
          )
        )
      )
    ),
    h("div", { className: "bees-home-side" },
      h("h3", null, "Templates"),
      h("div", { className: "bees-home-templates" },
        cards.length > 0 ? visibleCards.map(card =>
          h("button", { className: "bees-template-card", onClick: async () => {
            if (card.isTemplate) {
              const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
              if (p?.id) openWorkItem(null, p.id);
            } else {
              openWorkItem(null, card.id);
            }
          }, key: card.id },
            h("div", { className: "bees-template-card-title" }, card.name),
            h("div", { className: "bees-template-card-meta" }, card.description || (card.isTemplate ? "Template" : "Process"))
          )
        ) : h("p", { className: "bees-muted" }, "No templates available."),
        cards.length > 10 && !showAllTemplates ? h("button", { 
          className: "bees-btn", 
          style: { width: "100%", marginTop: "4px" }, 
          onClick: () => setShowAllTemplates(true) 
        }, `Show all ${cards.length} templates`) : null
      )
    )
  );
}

export function GuidePage() {
  return h("div", { className: "bees-stack" },
    h("div", { className: "bees-callout" }, h("h3", null, "Bees in one sentence"),
      h("div", null, "Tell Bees the outcome, choose the repeatable path, and let agents move the work through it.")),
    h("div", { className: "bees-grid bees-help-grid" },
      h("section", { className: "bees-box" }, h("h3", null, "Goal = the outcome"),
        h("p", null, "Use a goal when you care about the result but do not want to plan every task."),
        h("p", { className: "bees-muted" }, "Example: “Launch the new website.” Bees may create or coordinate several work items to reach it.")),
      h("section", { className: "bees-box" }, h("h3", null, "Work item = one piece of work"),
        h("p", null, "Use a work item for one concrete deliverable that follows a process."),
        h("p", { className: "bees-muted" }, "Example: “Write the launch announcement.” It moves through Draft → Review → Done.")),
      h("section", { className: "bees-box" }, h("h3", null, "Process = the path"),
        h("p", null, "A process is a live sequence of stages that routes real work to agents."),
        h("p", { className: "bees-muted" }, "Create one when work should repeatedly follow the same handoffs.")),
      h("section", { className: "bees-box" }, h("h3", null, "Template = a saved blueprint"),
        h("p", null, "A template remembers a process design but runs nothing."),
        h("p", { className: "bees-muted" }, "Create one directly under Processes → Templates, or save an existing process as a template.")),
      h("section", { className: "bees-box" }, h("h3", null, "Agent pool = interchangeable agents"),
        h("p", null, "Use a pool when several agents can handle the same stage and Bees may choose any available match."),
        h("p", { className: "bees-muted" }, "Use one named agent when context, ownership, or continuity matters.")),
      h("section", { className: "bees-box" }, h("h3", null, "Needs you = blocked work"),
        h("p", null, "This queue collects questions, approvals, failures, and other work an agent cannot continue alone."),
        h("p", { className: "bees-muted" }, "It is not a stage and you do not assign an agent to it. Assign agents on a process stage or override one on the work item."))
    )
  );
}
