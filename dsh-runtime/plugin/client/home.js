import { h, useState } from "./runtime.js";
import { Button, Empty } from "./shared.js";

export function Home({ data, workspaceId, act, openWorkItem }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  return h("div", { className: "bees-panel" },
    h("section", { className: "bees-hero bees-home-hero" }, 
      h("div", { className: "bees-status" }, "START WITH THE OUTCOME"),
      h("h1", null, "What do you want to accomplish?"),
      h("p", { className: "bees-muted" }, "Describe your goal. Bees will plan the steps and perform the work."),
      h("form", { onSubmit: (event) => { event.preventDefault(); void submit(); } },
        h("textarea", { 
          className: "bees-textarea bees-home-textarea", 
          value: outcome, 
          disabled: !workspaceId || busy, 
          onChange: (event) => setOutcome(event.target.value), 
          placeholder: workspaceId ? "Before every sales meeting, research the company, attendees, and competitors, then rank the best reasons they should adopt Bees." : "Choose a workspace first", 
          "aria-label": "Goal outcome" 
        }),
        error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
        h("div", { className: "bees-prompt-actions" },
          h("button", { type: "submit", className: "bees-btn primary bees-home-submit", disabled: !workspaceId || !outcome.trim() || busy }, busy ? "Starting..." : "Ask Bees")
        )
      )
    ),
    h("div", { className: "bees-home-templates" }, 
      h("h3", { className: "bees-section-title" }, "Or start from a Template"),
      cards.length ? h("div", { className: "bees-grid" }, 
        ...cards.map((card) => h("button", { 
          className: "bees-hierarchy-card", key: card.id, 
          onClick: async () => {
            if (card.isTemplate) {
              const p = await act({ action: "create_process", workspaceId, name: `New from ${card.name}`, templateId: card.id });
              if (p?.id) openWorkItem(null, p.id);
            } else {
              openWorkItem(null, card.id);
            }
          }
        },
          h("h3", null, card.name),
          h("div", { className: "bees-muted" }, card.description || (card.isTemplate ? "Template" : "Process"))
        ))
      ) : h("p", { className: "bees-muted" }, "No templates or processes available.")
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

