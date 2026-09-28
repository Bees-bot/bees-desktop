import { h, useState } from "./runtime.js";
import { openExternal } from "./shared.js";

// ─── CSS ─────────────────────────────────────────────────────────────────────

const BASICS_CSS = `
/* ── Page shell ── */
.bb-page {
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  padding-bottom: 48px;
  display: grid;
  gap: 0;
  font-size: 14px;
  line-height: 1.65;
}

/* ── Hero ── */
.bb-hero {
  padding: 28px 0 24px;
  display: grid;
  gap: 8px;
}
.bb-hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--bees-accent);
}
.bb-hero-eyebrow::before {
  content: "";
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 2px;
  background: var(--bees-accent);
}
.bb-hero h1 {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.15;
}
.bb-hero p {
  margin: 0;
  font-size: 15px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1.55;
  max-width: 540px;
}

/* ── TOC pills ── */
.bb-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 0 4px;
}
.bb-toc-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.bb-toc-pill:hover {
  border-color: var(--bees-accent);
  color: var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 7%, var(--dsw-alias-bg-base));
}
.bb-toc-num {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 800;
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ── Section card ── */
.bb-section {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  margin-top: 16px;
  scroll-margin-top: 80px;
}
.bb-section-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
}
.bb-section-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  font-size: 18px;
  background: color-mix(in srgb, var(--bees-accent) 14%, var(--dsw-alias-bg-base));
  border: 1px solid color-mix(in srgb, var(--bees-accent) 22%, transparent);
}
.bb-section-head-copy { min-width: 0; flex: 1; }
.bb-section-head-copy h2 {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0 0 2px;
  line-height: 1.2;
}
.bb-section-head-copy p {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1.45;
}
.bb-section-body {
  padding: 18px 22px;
  display: grid;
  gap: 14px;
}
.bb-section-body p { margin: 0; }
.bb-section-body p + p { margin-top: 0; }

/* ── Flow steps ── */
.bb-flow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  padding: 0;
  list-style: none;
  counter-reset: flow-step;
}
.bb-flow-item {
  counter-increment: flow-step;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base));
  border: 1px solid color-mix(in srgb, var(--bees-accent) 18%, transparent);
  font-size: 13px;
  font-weight: 600;
  position: relative;
}
.bb-flow-item::before {
  content: counter(flow-step);
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 800;
  background: var(--bees-accent);
  color: var(--bees-accent-contrast);
  flex-shrink: 0;
}

/* ── Concept cards grid ── */
.bb-concepts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.bb-concept {
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 11px;
  background: var(--dsw-specific-sidebar-fill);
  display: grid;
  gap: 5px;
}
.bb-concept-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bees-accent);
}
.bb-concept strong { font-size: 13px; font-weight: 700; }
.bb-concept span { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
.bb-concept em { font-size: 11px; color: var(--dsw-alias-label-secondary); font-style: normal; margin-top: 2px; }

/* ── Key-value list ── */
.bb-kv { display: grid; gap: 8px; }
.bb-kv-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--dsw-specific-sidebar-fill);
  border: 1px solid var(--dsw-alias-border-l1);
}
.bb-kv-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.bb-kv-copy { display: grid; gap: 2px; min-width: 0; }
.bb-kv-copy strong { font-size: 13px; font-weight: 700; }
.bb-kv-copy span { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }

/* ── Org / team comparison ── */
.bb-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 580px) { .bb-compare { grid-template-columns: 1fr; } }
.bb-compare-card {
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 11px;
  background: var(--dsw-specific-sidebar-fill);
  display: grid;
  gap: 6px;
}
.bb-compare-card h3 { font-size: 13px; font-weight: 800; margin: 0; }
.bb-compare-card ul { margin: 0; padding-left: 16px; display: grid; gap: 3px; }
.bb-compare-card li { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }

/* ── Inline badge ── */
.bb-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: color-mix(in srgb, var(--bees-accent) 14%, transparent);
  color: var(--bees-accent);
  border: 1px solid color-mix(in srgb, var(--bees-accent) 25%, transparent);
  vertical-align: middle;
}

/* ── Action controls ── */
.bb-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bb-control-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.bb-control-chip.approve { border-color: color-mix(in srgb, var(--bees-accent) 35%, transparent); background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base)); color: var(--bees-accent); }
.bb-control-chip.stop { border-color: #cf535355; background: #cf535310; color: #d45d5d; }

/* ── Code / example block ── */
.bb-code {
  padding: 14px 16px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base));
  border: 1px solid var(--dsw-alias-border-l1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  color: var(--dsw-alias-label-secondary);
}
.bb-code-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--dsw-alias-label-secondary);
  margin-bottom: 6px;
}

/* ── Expandable FAQ ── */
.bb-faq { display: grid; gap: 6px; }
.bb-faq-item {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  overflow: hidden;
}
.bb-faq-item summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  user-select: none;
  background: var(--dsw-specific-sidebar-fill);
  transition: background 0.15s;
}
.bb-faq-item summary::-webkit-details-marker { display: none; }
.bb-faq-item summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bb-faq-chevron {
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  transition: transform 0.2s;
}
.bb-faq-item[open] .bb-faq-chevron { transform: rotate(180deg); }
.bb-faq-body {
  padding: 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.bb-faq-body p { margin: 0; }
.bb-faq-body p + p { margin-top: 8px; }

/* ── Note callout ── */
.bb-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 1.5;
  background: color-mix(in srgb, #f2b84b 8%, var(--dsw-alias-bg-base));
  border: 1px solid color-mix(in srgb, #f2b84b 25%, transparent);
}
.bb-note-icon { flex-shrink: 0; font-size: 15px; }

/* ── Footer CTA ── */
.bb-footer {
  margin-top: 24px;
  padding: 22px 24px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--bees-accent) 28%, transparent);
  background: color-mix(in srgb, var(--bees-accent) 7%, var(--dsw-alias-bg-base));
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.bb-footer-copy { flex: 1; min-width: 0; display: grid; gap: 3px; }
.bb-footer-copy strong { font-size: 16px; font-weight: 800; }
.bb-footer-copy p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.bb-footer-actions { display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }

/* ── Buttons ── */
.bb-btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 18px; border-radius: 9px;
  border: 1px solid var(--bees-accent);
  background: var(--bees-accent); color: var(--bees-accent-contrast);
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  transition: filter 0.15s, box-shadow 0.15s;
}
.bb-btn-primary:hover { filter: brightness(1.07); box-shadow: 0 3px 12px color-mix(in srgb, var(--bees-accent) 40%, transparent); }
.bb-btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 16px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.bb-btn-secondary:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }
.bb-btn-ghost {
  border: 0; background: transparent; color: var(--bees-accent);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0;
  text-decoration: underline; text-decoration-color: transparent; transition: text-decoration-color 0.15s;
}
.bb-btn-ghost:hover { text-decoration-color: currentColor; }

/* ── Responsive ── */
@media (max-width: 600px) {
  .bb-section-head, .bb-section-body { padding-left: 16px; padding-right: 16px; }
  .bb-flow { grid-template-columns: 1fr 1fr; }
  .bb-hero h1 { font-size: 22px; }
}
`;

// ─── Inject CSS once ──────────────────────────────────────────────────────────

let cssInjected = false;
function ensureBasicsCss() {
  if (cssInjected) return;
  cssInjected = true;
  const el = document.createElement("style");
  el.id = "bb-styles";
  el.textContent = BASICS_CSS;
  document.head.appendChild(el);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ id, icon, title, subtitle, children }) {
  return h("section", { id, className: "bb-section" },
    h("div", { className: "bb-section-head" },
      h("div", { className: "bb-section-icon" }, icon),
      h("div", { className: "bb-section-head-copy" },
        h("h2", null, title),
        subtitle ? h("p", null, subtitle) : null
      )
    ),
    h("div", { className: "bb-section-body" }, ...children)
  );
}

function KvRow({ icon, label, desc }) {
  return h("div", { className: "bb-kv-row" },
    h("span", { className: "bb-kv-icon" }, icon),
    h("div", { className: "bb-kv-copy" },
      h("strong", null, label),
      h("span", null, desc)
    )
  );
}

function FaqItem({ q, children }) {
  return h("details", { className: "bb-faq-item" },
    h("summary", null,
      h("span", null, q),
      h("span", { className: "bb-faq-chevron", "aria-hidden": "true" }, "▾")
    ),
    h("div", { className: "bb-faq-body" }, ...children)
  );
}

// ─── TOC pills ────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "bb-flow",     num: 1, label: "How it works" },
  { id: "bb-workspace", num: 2, label: "Workspaces" },
  { id: "bb-concepts", num: 3, label: "Concepts" },
  { id: "bb-agents",   num: 4, label: "Agents & AI" },
  { id: "bb-files",    num: 5, label: "Files" },
  { id: "bb-control",  num: 6, label: "You in control" },
  { id: "bb-privacy",  num: 7, label: "Privacy" },
  { id: "bb-exec",     num: 8, label: "Executive team" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export function BasicsPage({ navigate, onStart }) {
  ensureBasicsCss();

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return h("div", { className: "bb-page" },

    // ── Hero ──
    h("div", { className: "bb-hero" },
      h("div", { className: "bb-hero-eyebrow" }, "The essentials"),
      h("h1", null, "Bees basics"),
      h("p", null, "Everything you need to understand how Bees works — from workspace to finished file. Return here anytime.")
    ),

    // ── TOC ──
    h("nav", { className: "bb-toc", "aria-label": "Jump to section" },
      ...SECTIONS.map(({ id, num, label }) =>
        h("button", { type: "button", key: id, className: "bb-toc-pill", onClick: () => scrollTo(id) },
          h("span", { className: "bb-toc-num" }, String(num)),
          label
        )
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 1. How it works
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-flow", icon: "🔄",
      title: "How it works",
      subtitle: "Start with an outcome. Bees handles the steps.",
    },
      h("ol", { className: "bb-flow", "aria-label": "From request to result" },
        h("li", { className: "bb-flow-item" }, "Describe an outcome"),
        h("li", { className: "bb-flow-item" }, "Choose input files"),
        h("li", { className: "bb-flow-item" }, "Agents plan & execute"),
        h("li", { className: "bb-flow-item" }, "Reviewer checks the work"),
        h("li", { className: "bb-flow-item" }, "Open the result file")
      ),
      h("p", null,
        "Track progress in ",
        h("span", { className: "bb-badge" }, "Process Runs"),
        ". Your request, discussions, delegated work, and output files stay connected in one place."
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Workspaces
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-workspace", icon: "🏢",
      title: "Where your work belongs",
      subtitle: "Organizations group people; teams hold the actual work.",
    },
      h("div", { className: "bb-compare" },
        h("div", { className: "bb-compare-card" },
          h("h3", null, "🌐 Regular organization"),
          h("ul", null,
            h("li", null, "Requires an account"),
            h("li", null, "Supports collaboration"),
            h("li", null, "Synchronized coordination records"),
            h("li", null, "Multiple members & teams")
          )
        ),
        h("div", { className: "bb-compare-card" },
          h("h3", null, "🔒 Private organization"),
          h("ul", null,
            h("li", null, "No account required"),
            h("li", null, "Stays on this device only"),
            h("li", null, "Cannot be shared later"),
            h("li", null, "Can still use cloud AI")
          )
        )
      ),
      h("p", null,
        "A ", h("strong", null, "team"), " has its own process templates, process runs, agents, file locations, and knowledge sources. ",
        "Create another team when a different group needs a separate working context — not for every individual request."
      ),
      h("div", { className: "bb-note" },
        h("span", { className: "bb-note-icon" }, "💡"),
        h("span", null, "A Private organization can still use cloud AI. Your AI connection choice determines where model requests are sent — not the organization type.")
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Concepts: process templates, runs, work items
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-concepts", icon: "📋",
      title: "Process templates, runs & work items",
      subtitle: "One repair café project — four concepts explained.",
    },
      h("div", { className: "bb-concepts" },
        ...[
          ["Process template", "Reusable stages and rules for a type of work.", "\"Launch planning\"", "📐"],
          ["Process run",      "A specific instance of work following a template.",    "\"Repair café launch\"", "▶️"],
          ["Work item",        "A tracked unit of work within a process run.",           "\"Review volunteer availability\"", "✅"],
          ["Stage",            "The current step in a work item's lifecycle.",           "Work, Review, or Done", "🔖"],
          ["Execution",        "One agent attempt at a stage. A work item can have several.", "Visible in Activity → Executions", "⚙️"],
        ].map(([term, meaning, example, icon]) =>
          h("div", { key: term, className: "bb-concept" },
            h("span", { className: "bb-concept-label" }, icon + " " + term),
            h("span", null, meaning),
            h("em", null, example)
          )
        )
      ),
      h("p", null,
        "The built-in ",
        h("span", { className: "bb-badge" }, "Goals"),
        " process template runs: ",
        h("strong", null, "Work → Review → Done"),
        ". The lead agent executes your goal; a fresh reviewer session checks it and can send work back for revision. ",
        "Use ",
        h("span", { className: "bb-badge" }, "Process Templates"),
        " to define your own stages for repeatable work."
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Agents & AI
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-agents", icon: "🤖",
      title: "Agents & AI",
      subtitle: "What powers the work and how to configure it.",
    },
      h("div", { className: "bb-kv" },
        h(KvRow, { icon: "🧠", label: "Agent",    desc: "Instructions and configuration for a role — e.g., planner, reviewer, or specialist." }),
        h(KvRow, { icon: "⚡", label: "AI model", desc: "The language model powering the agent's responses. Set a system default in Settings → AI connections." }),
        h(KvRow, { icon: "🔧", label: "Tools",    desc: "Capabilities for taking actions — file access, web search, code execution, and more." }),
        h(KvRow, { icon: "📚", label: "Skills",   desc: "Reusable instruction sets for particular kinds of work, attached per-agent or globally." }),
      ),
      h("p", null,
        "Agents can discuss a problem or delegate independent sub-tasks. Their contributions stay visible in the run. ",
        h("strong", null, "More agents do not automatically improve a result"), " — one well-configured agent is often better."
      ),
      h("p", null,
        "Set a ", h("strong", null, "System default"), " in ", h("span", { className: "bb-badge" }, "Settings → AI connections"),
        ". Agents and process runs use it unless you explicitly assign another model."
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Files, knowledge & results
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-files", icon: "📂",
      title: "Files, knowledge & results",
      subtitle: "Inputs go in. Results come out.",
    },
      h("div", { className: "bb-kv" },
        h(KvRow, { icon: "📁", label: "File locations", desc: "Configure folders in Files & Folders and select them as inputs for a team or specific goal." }),
        h(KvRow, { icon: "🔍", label: "Knowledge Base", desc: "Helps agents find relevant information across configured sources during execution." }),
        h(KvRow, { icon: "📄", label: "Results",        desc: "Open a process run's Files tab to find deliverables. Publishing to a destination is a separate explicit action." }),
      ),
      h(FaqItem, { q: "Does inviting someone give them access to my files?" },
        h("p", null,
          "Team membership grants access to coordination records only. Document access still depends on your storage provider's permissions and each device's file mappings. ",
          "Inviting someone does ", h("strong", null, "not"), " automatically share your documents."
        )
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 6. When Bees needs you
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-control", icon: "🙋",
      title: "You stay in control",
      subtitle: "Bees asks before acting on anything consequential.",
    },
      h("p", null,
        h("span", { className: "bb-badge" }, "Needs your attention"),
        " collects questions, action-approval requests, completed-work reviews, and failed or blocked items — all in one place."
      ),
      h("div", { className: "bb-controls" },
        h("span", { className: "bb-control-chip approve" }, "✅ Approve"),
        h("span", { className: "bb-control-chip approve" }, "✔ Accept result"),
        h("span", { className: "bb-control-chip" }, "⏸ Pause"),
        h("span", { className: "bb-control-chip" }, "▶ Resume"),
        h("span", { className: "bb-control-chip" }, "↩ Retry"),
        h("span", { className: "bb-control-chip stop" }, "⬛ Stop"),
      ),
      h("p", null,
        "Approving lets an action proceed. Accepting confirms the result meets your expectations. ",
        "Use Pause, Resume, Retry, or Stop whenever you need direct control over the execution."
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Privacy & what runs locally
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-privacy", icon: "🔒",
      title: "What runs locally — what is shared",
      subtitle: "Your files and credentials stay on your device.",
    },
      h("div", { className: "bb-kv" },
        h(KvRow, { icon: "💻", label: "Execution",           desc: "Runs on an available desktop. Schedules need Bees running and the machine awake." }),
        h(KvRow, { icon: "🔄", label: "Coordination records", desc: "Synchronized across regular-organization members. Files remain in your own storage." }),
        h(KvRow, { icon: "🔑", label: "Stays on-device",     desc: "Credentials, installed models, and knowledge indexes never leave each device." }),
        h(KvRow, { icon: "☁️", label: "Cloud AI / tools",   desc: "May receive the content needed for the work. Check your provider's data policy." }),
      ),
      h("div", null,
        h("button", { type: "button", className: "bb-btn-ghost",
          onClick: () => void openExternal("https://bees.bot/help/privacy") },
          "Read the full privacy guide →"
        )
      )
    ),

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Executive team example
    // ─────────────────────────────────────────────────────────────────────────
    h(SectionCard, {
      id: "bb-exec", icon: "👔",
      title: "Try your executive team",
      subtitle: "CEO, CTO, CMO, and CRO — ordinary agents you can edit.",
    },
      h("p", null,
        "These are regular agents — edit their instructions, AI model, and tool access in ",
        h("span", { className: "bb-badge" }, "Agents"),
        ". Use ", h("strong", null, "$agent-name"), " at the start of a goal description to choose a lead or trigger a discussion."
      ),
      h("div", { className: "bb-kv" },
        h(KvRow, { icon: "1️⃣", label: "Map a folder",       desc: "In Files & Folders, map any folder containing your company notes. Attach it as an input to Goals or just one goal — no special structure required." }),
        h(KvRow, { icon: "2️⃣", label: "Write a goal",       desc: "Start with $ceo to pick a lead, or $ceo $cto $cmo to open a discussion first. Use current names if you've renamed agents." }),
        h(KvRow, { icon: "3️⃣", label: "Describe the result", desc: "Say what the finished deliverable looks like and any constraints. The lead can assign sub-work to named agents." }),
        h(KvRow, { icon: "4️⃣", label: "Follow the run",     desc: "Open the run to watch discussion, child work items, and inspect finished files." }),
      ),
      h("div", null,
        h("p", { style: { margin: "0 0 6px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dsw-alias-label-secondary)" } }, "Example goal"),
        h("div", { className: "bb-code" },
          "$ceo $cto $cmo Use the attached product brief. Discuss the approach, then assign CTO a tested local landing page and CMO finished launch copy. Collect both and verify that the copy matches the page. Keep everything as local deliverables; do not publish."
        )
      ),
      h("div", null,
        h("p", { style: { margin: "0 0 6px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dsw-alias-label-secondary)" } }, "Example — research only"),
        h("div", { className: "bb-code" },
          "$cro Use our attached customer profile to research five relevant prospects with source links and prepare tailored outreach drafts. Do not send messages."
        )
      ),
      h("div", { className: "bb-note" },
        h("span", { className: "bb-note-icon" }, "⚠️"),
        h("span", null,
          "For advice only, say so explicitly. Executive titles do ",
          h("strong", null, "not"), " grant extra tool access or bypass approval requirements."
        )
      ),
      h("div", { className: "bb-faq" },
        h(FaqItem, { q: "What is an execution?" },
          h("p", null,
            "An execution is one agent attempt at a stage. A process run can have several executions, including revisions sent back from review. ",
            "Open ", h("span", { className: "bb-badge" }, "Activity → Executions"), " to inspect a specific attempt when troubleshooting."
          )
        ),
        h(FaqItem, { q: "Explore further: schedules, learning, presets, permissions" },
          h("p", null, "Explore schedules, specialist learning, agent presets, tools, and permissions when you need them."),
          h("p", null,
            h("button", { type: "button", className: "bb-btn-ghost", onClick: () => navigate("guide") },
              "Open detailed guides →"
            )
          )
        )
      )
    ),

    // ── Footer CTA ──
    h("div", { className: "bb-footer" },
      h("div", { className: "bb-footer-copy" },
        h("strong", null, "Ready to try it?"),
        h("p", null, "Create your first result in minutes — or return to the setup checklist.")
      ),
      h("div", { className: "bb-footer-actions" },
        h("button", { type: "button", className: "bb-btn-primary", onClick: onStart }, "✨ Create first result"),
        h("button", { type: "button", className: "bb-btn-secondary", onClick: () => navigate("getting-started") }, "← Back to setup")
      )
    )
  );
}
