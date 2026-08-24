import { h, useState } from "./runtime.js";
import { Button, Empty } from "./shared.js";

export function Home({ data, workspaceId, act, askBees }) {
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


