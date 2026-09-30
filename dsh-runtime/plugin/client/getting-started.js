import { h, useEffect, useState } from "./runtime.js";
import { AgentModelSelect } from "./agents.js";

const SAMPLE_BRIEF = `Project: launch a neighborhood repair café in four weeks.\nBudget: $600. Venue: library meeting room, free on Saturdays.\nPeople: Maya coordinates volunteers, Jules handles publicity, Sam manages supplies.\nWe have five volunteers, but only two have confirmed availability.\nBring small household items; exclude mains electrical repairs until a qualified person joins.\nNeed a booking form, safety checklist, supply list, and an announcement.\nOpen questions: insurance requirements, opening hours, and how many bookings we can safely accept.`;

const STARTER_TASKS = [
  { id: "plan", title: "Turn notes into an action plan", prompt: "Create a practical launch plan from the brief. Include milestones, owners, budget, risks, and decisions that need my input." },
  { id: "review", title: "Find risks and missing decisions", prompt: "Review the brief for gaps and risks. Prioritize the five most important issues and propose concrete next actions." },
  { id: "brief", title: "Write a one-page project brief", prompt: "Turn the brief into a clear one-page project summary with the goal, constraints, responsibilities, and next steps." }
];

export function onboardingProgress(data, teamId, state, aiReady) {
  const team = data.teams.find((row) => row.id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId && row.mapped && !row.archivedAt);
  const item = data.items.find((row) => row.id === state.workItemId);
  const output = item && data.runs.some((run) => run.workItemId === item.id && run.outputs?.length);
  return [Boolean(team), aiReady, Boolean(locations.length || state.filesChoice),
    Boolean(item && item.runtimePhase !== "cancelled" && (item.completed || item.runtimePhase === "completed") && output)];
}

// starter tasks say "from the brief", so they get the sample unless files were attached as the brief
const usesSampleBrief = (text, filesChoice, inputs) => filesChoice === "sample" ||
  (!inputs && STARTER_TASKS.some((task) => task.prompt === text));

export function starterDescription(prompt, filesChoice, inputs) {
  const text = prompt.trim();
  return `${text}\n\n${usesSampleBrief(text, filesChoice, inputs) ? `Sample brief (fictional):\n${SAMPLE_BRIEF}\n\n` : ""}In Work, discuss the approach with the seated planning partner, reconcile their critique, then execute and write the final result to outputs/first-result.md. Review checks the finished result in a fresh session. Use the files explicitly attached to this task, or the brief above. Do not invent missing facts; list open questions. Do not contact people, publish anything, or purchase anything.`;
}

export function planningAgents(data, workspaceId) {
  const process = data.processes?.find((row) => row.workspaceId === workspaceId && row.kind === "goals");
  if (!process) return [];
  const stage = data.stages?.filter((row) => row.processId === process.id).sort((a, b) => a.position - b.position)[0];
  // teams made after the two-agent route was dropped run Work and Review on the team's own work and review agents
  const agents = data.assignments?.filter((row) => row.workspaceId === workspaceId) ?? [];
  return (stage?.agentIds?.length ? stage.agentIds.map((id) => agents.find((row) => row.id === id))
    : ["worker", "reviewer"].map((role) => agents.find((row) => row.systemRole === role))).filter(Boolean);
}

export function onboardingAiKey(data, workspaceId, config) {
  const agents = planningAgents(data, workspaceId).map(({ id, model, reasoningEffort, enabled }) => ({ id, model, reasoningEffort, enabled }));
  // only providers in use count, and a local model counts by id since each start gives it a new port
  const used = [data.systemDefaultModel?.provider, ...agents.map(({ model }) => String(model ?? "").split("/")[0])].filter(Boolean);
  return JSON.stringify({ workspaceId, selection: data.systemDefaultModel, agents,
    providers: [...new Set(used)].map((id) => id.startsWith("local-openai-") ? id : config?.providers?.[id] ?? null) });
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const GETTING_STARTED_CSS = `
/* ── Page container ── */
.gs-page {
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding-bottom: 40px;
  display: grid;
  gap: 0;
}

/* ── Page header banner (replaces old bees-callout h1) ── */
.gs-header {
  padding: 20px 24px;
  margin-bottom: 20px;
  border-radius: 12px;
  border-left: 3px solid var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base));
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.gs-header-content { display: grid; gap: 4px; min-width: 0; flex: 1; }
.gs-header h1 {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.2;
}
.gs-header p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.gs-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.gs-skip-btn {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 6px 0;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: color 0.15s, text-decoration-color 0.15s;
}
.gs-skip-btn:hover {
  color: var(--dsw-alias-label-primary);
  text-decoration-color: currentColor;
}
.gs-outline-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.gs-outline-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l1);
}

/* ── Step rail ── */
.gs-stepper-wrap {
  margin-bottom: 20px;
}
.gs-stepper {
  display: grid;
  /* 4 columns, each step centred in its column */
  grid-template-columns: repeat(4, 1fr);
  position: relative;
  /* The connector line sits behind the circles.
     It must reach from center of step 1 to center of step 4.
     Each column is 25% wide; centers at 12.5%, 37.5%, 62.5%, 87.5%.
     We offset 18px (circle radius) so the line touches the circle edges. */
  --gs-rail-inset: calc(12.5% + 18px);
}
/* Background track – goes from step-1 center to step-4 center */
.gs-stepper::before {
  content: "";
  position: absolute;
  top: 17px;          /* half of 36px circle */
  left: var(--gs-rail-inset);
  right: var(--gs-rail-inset);
  height: 2px;
  background: var(--dsw-alias-border-l1);
  border-radius: 1px;
  z-index: 0;
  pointer-events: none;
}
/* Filled progress overlay */
.gs-stepper-progress {
  position: absolute;
  top: 17px;
  left: var(--gs-rail-inset);
  right: var(--gs-rail-inset);
  height: 2px;
  background: var(--bees-accent);
  border-radius: 1px;
  z-index: 1;
  pointer-events: none;
  transform: scaleX(var(--gs-progress));
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.gs-step-btn {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.gs-step-btn:focus-visible .gs-step-circle {
  outline: 2px solid var(--bees-accent);
  outline-offset: 3px;
}
.gs-step-circle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
  border: 2px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.gs-step-btn.gs-step-active .gs-step-circle {
  border-color: var(--bees-accent);
  background: var(--bees-accent);
  color: var(--bees-accent-contrast);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bees-accent) 20%, transparent);
}
.gs-step-btn.gs-step-done .gs-step-circle {
  border-color: var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 18%, var(--dsw-alias-bg-base));
  color: var(--bees-accent);
}
.gs-step-label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  max-width: 80px;
  transition: color 0.15s;
}
.gs-step-btn.gs-step-active .gs-step-label { color: var(--dsw-alias-label-primary); font-weight: 700; }
.gs-step-btn.gs-step-done .gs-step-label  { color: var(--bees-accent); }

/* ── Main step card ── */
.gs-card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}
.gs-card-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 24px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
}
.gs-card-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  font-size: 19px;
  background: color-mix(in srgb, var(--bees-accent) 15%, var(--dsw-alias-bg-base));
  border: 1px solid color-mix(in srgb, var(--bees-accent) 25%, transparent);
}
.gs-card-head-copy { min-width: 0; flex: 1; }
.gs-card-head-copy h2 {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0 0 3px;
  line-height: 1.2;
}
.gs-card-head-copy p {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1.45;
}
.gs-card-body {
  padding: 22px 24px;
  display: grid;
  gap: 16px;
}

/* ── Option cards (workspace / AI provider selection) ── */
.gs-option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}
.gs-option {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 11px;
  background: var(--dsw-specific-sidebar-fill);
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.gs-option:hover:not(:disabled) {
  border-color: var(--bees-accent);
  box-shadow: 0 2px 12px color-mix(in srgb, var(--bees-accent) 15%, transparent);
  background: color-mix(in srgb, var(--bees-accent) 6%, var(--dsw-alias-bg-base));
}
.gs-option:disabled { opacity: 0.45; cursor: not-allowed; }
.gs-option-icon { font-size: 20px; line-height: 1; margin-bottom: 2px; }
.gs-option strong { font-size: 13px; font-weight: 700; }
.gs-option span { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }

/* ── Navigate-away hint under AI options ── */
.gs-nav-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  padding: 8px 0 2px;
}
.gs-nav-hint svg { flex: none; opacity: 0.6; }

/* ── Agent pair cards ── */
.gs-agent-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 640px) { .gs-agent-pair { grid-template-columns: 1fr; } }
.gs-agent-card {
  padding: 13px 15px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 11px;
  background: var(--dsw-specific-sidebar-fill);
  display: grid;
  gap: 5px;
}
.gs-agent-card-head { display: flex; align-items: center; gap: 7px; }
.gs-agent-role {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: color-mix(in srgb, var(--bees-accent) 15%, transparent);
  color: var(--bees-accent);
}
.gs-agent-warn { font-size: 12px; color: #cf8b3a; }
.gs-agent-model {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gs-change-ai-toggle { margin-top: 4px; }
.gs-change-ai-toggle summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--bees-accent);
  list-style: none;
  user-select: none;
}
.gs-change-ai-toggle summary::-webkit-details-marker { display: none; }
.gs-change-ai-inner { margin-top: 10px; display: grid; gap: 8px; }

/* ── AI status banner ── */
.gs-ai-status {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 1.5;
}
.gs-ai-status.gs-ready {
  background: color-mix(in srgb, var(--bees-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bees-accent) 28%, transparent);
}
.gs-ai-status.gs-pending {
  background: color-mix(in srgb, #f2b84b 8%, transparent);
  border: 1px solid color-mix(in srgb, #f2b84b 25%, transparent);
}
.gs-status-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
}
.gs-ready .gs-status-dot { background: var(--bees-accent); }
.gs-pending .gs-status-dot { background: #f2b84b; }

/* ── File choice cards ── */
.gs-file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}
.gs-file-choice {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 14px;
  border: 1.5px solid var(--dsw-alias-border-l1);
  border-radius: 11px;
  background: var(--dsw-specific-sidebar-fill);
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.gs-file-choice:hover:not(:disabled) {
  border-color: var(--bees-accent);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--bees-accent) 15%, transparent);
  transform: translateY(-1px);
}
.gs-file-choice:disabled { opacity: 0.45; cursor: not-allowed; }
.gs-file-choice.gs-chosen {
  border-color: var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base));
}
.gs-file-icon { font-size: 22px; }
.gs-file-choice strong { font-size: 13px; font-weight: 700; }
.gs-file-choice span { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
.gs-rec { display: inline-flex; padding: 2px 7px; border-radius: 999px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; background: var(--bees-accent); color: var(--bees-accent-contrast); margin-top: auto; width: fit-content; }

/* ── Sample brief preview ── */
.gs-brief {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  overflow: hidden;
}
.gs-brief summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 13px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  user-select: none;
  background: var(--dsw-specific-sidebar-fill);
}
.gs-brief summary::-webkit-details-marker { display: none; }
.gs-brief pre {
  margin: 0;
  padding: 13px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  border-top: 1px solid var(--dsw-alias-border-l1);
}

/* ── Task selector (radio-style) ── */
.gs-task-list { display: grid; gap: 7px; }
.gs-task-opt {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border: 1.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-specific-sidebar-fill);
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.gs-task-opt:hover { border-color: var(--bees-accent); }
.gs-task-opt.gs-selected {
  border-color: var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base));
}
.gs-radio {
  flex: none;
  width: 17px; height: 17px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  display: grid;
  place-items: center;
}
.gs-task-opt.gs-selected .gs-radio { border-color: var(--bees-accent); }
.gs-radio-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--bees-accent);
  opacity: 0; transform: scale(0.3);
  transition: opacity 0.15s, transform 0.15s;
}
.gs-task-opt.gs-selected .gs-radio-dot { opacity: 1; transform: scale(1); }
.gs-task-opt strong { font-size: 13px; font-weight: 700; }

/* ── Label helper ── */
.gs-label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; }
.gs-label-hint { font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); }

/* ── File location checkboxes ── */
.gs-locs { display: grid; gap: 5px; }
.gs-loc {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  font-size: 13px;
}
.gs-loc:has(input:checked) {
  border-color: var(--bees-accent);
  background: color-mix(in srgb, var(--bees-accent) 8%, var(--dsw-alias-bg-base));
}

/* ── Result state card ── */
.gs-result {
  padding: 18px 20px;
  border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
  display: grid;
  gap: 10px;
}
.gs-result.gs-done {
  border-color: color-mix(in srgb, var(--bees-accent) 35%, transparent);
  background: color-mix(in srgb, var(--bees-accent) 6%, var(--dsw-alias-bg-base));
}
.gs-result.gs-failed {
  border-color: #cf535355;
  background: #cf535310;
}
.gs-result-head { display: flex; align-items: center; gap: 10px; }
.gs-result-icon { font-size: 26px; }
.gs-result-head h3 { margin: 0; font-size: 16px; font-weight: 800; }
.gs-result p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }

/* ── Card footer ── */
.gs-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
  flex-wrap: wrap;
}
.gs-foot-left { display: flex; gap: 8px; }
.gs-foot-right { display: flex; gap: 8px; }

/* ── Buttons ── */
.gs-btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px;
  border: 1px solid var(--bees-accent);
  background: var(--bees-accent);
  color: var(--bees-accent-contrast);
  font: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s, box-shadow 0.15s;
}
.gs-btn-primary:hover:not(:disabled) {
  filter: brightness(1.07);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--bees-accent) 40%, transparent);
}
.gs-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.gs-btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.gs-btn-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l1);
}
.gs-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

.gs-link-btn {
  border: 0; background: transparent; color: var(--bees-accent);
  font: inherit; font-size: 13px; cursor: pointer;
  text-decoration: underline; text-decoration-color: transparent;
  padding: 0; transition: text-decoration-color 0.15s;
}
.gs-link-btn:hover { text-decoration-color: currentColor; }
.gs-link-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Finish banner ── */
.gs-finish {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--bees-accent) 10%, var(--dsw-alias-bg-base));
  border: 1px solid color-mix(in srgb, var(--bees-accent) 28%, transparent);
  margin-top: 14px;
}
.gs-finish p { margin: 0; font-size: 14px; flex: 1; line-height: 1.4; }

/* ── Note (info box) ── */
.gs-note {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;
  padding: 9px 12px;
  border-radius: 7px;
  background: var(--dsw-specific-sidebar-fill);
  border: 1px solid var(--dsw-alias-border-l1);
}

/* ── Persistent onboarding progress bar ── */
.gs-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  height: 44px;
  min-height: 44px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--bees-accent) 7%, var(--dsw-alias-bg-base));
  flex-shrink: 0;
  overflow: hidden;
}
.gs-bar-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--bees-accent);
  white-space: nowrap;
  flex-shrink: 0;
}
.gs-bar-steps {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.gs-bar-step {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.gs-bar-step:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.gs-bar-step.gs-bstep-active { background: color-mix(in srgb, var(--bees-accent) 14%, transparent); color: var(--bees-accent); font-weight: 700; }
.gs-bar-step.gs-bstep-done { color: color-mix(in srgb, var(--bees-accent) 80%, var(--dsw-alias-label-secondary)); }
.gs-bar-step-num {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 800;
  border: 1.5px solid currentColor;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.gs-bar-step.gs-bstep-active .gs-bar-step-num { background: var(--bees-accent); color: var(--bees-accent-contrast); border-color: var(--bees-accent); }
.gs-bar-step.gs-bstep-done .gs-bar-step-num { background: color-mix(in srgb, var(--bees-accent) 18%, transparent); border-color: color-mix(in srgb, var(--bees-accent) 50%, transparent); }
.gs-bar-chev { font-size: 10px; color: var(--dsw-alias-border-l2); flex-shrink: 0; user-select: none; }
.gs-bar-nav { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.gs-bar-nav-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 6px;
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  transition: background 0.15s, border-color 0.15s; white-space: nowrap;
}
.gs-bar-nav-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }
.gs-bar-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.gs-bar-nav-btn.gs-bar-primary { background: var(--bees-accent); color: var(--bees-accent-contrast); border-color: var(--bees-accent); }
.gs-bar-nav-btn.gs-bar-primary:hover:not(:disabled) { filter: brightness(1.07); }
.gs-bar-divider { width: 1px; height: 20px; background: var(--dsw-alias-border-l1); flex-shrink: 0; margin: 0 2px; }
.gs-bar-later { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; padding: 4px 6px; transition: color 0.15s; }
.gs-bar-later:hover { color: var(--dsw-alias-label-primary); }
@media (max-width: 700px) { .gs-bar-step-name { display: none; } .gs-bar-chev { display: none; } }

/* ── Responsive ── */
@media (max-width: 640px) {
  .gs-card-head, .gs-card-body, .gs-card-foot { padding-left: 16px; padding-right: 16px; }
  .gs-stepper { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .gs-stepper::before, .gs-stepper-progress { display: none; }
  .gs-option-grid, .gs-file-grid { grid-template-columns: 1fr; }
}
`;

// ─── Inject CSS once ─────────────────────────────────────────────────────

let cssInjected = false;
function ensureGsCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.id = "gs-styles";
  style.textContent = GETTING_STARTED_CSS;
  document.head.appendChild(style);
}

// ─── Checkmark icon ──────────────────────────────────────────────────────

function CheckIcon() {
  return h("svg", { width: 13, height: 13, viewBox: "0 0 13 13", fill: "none", "aria-hidden": "true" },
    h("path", { d: "M2 6.5L5 9.5L11 3.5", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
}

// ─── External-link arrow ─────────────────────────────────────────────────

function ExternalIcon() {
  return h("svg", { width: 11, height: 11, viewBox: "0 0 11 11", fill: "none", "aria-hidden": "true" },
    h("path", { d: "M7 1H10M10 1V4M10 1L6 5M4.5 2.5H2.5C1.67 2.5 1 3.17 1 4V8.5C1 9.33 1.67 10 2.5 10H7C7.83 10 8.5 9.33 8.5 8.5V6.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
}

// ─── Step Rail ───────────────────────────────────────────────────────────

const STEPS = [
  { label: "Workspace", icon: "🏢", title: "Make space for your work", desc: "Choose or create a workspace for your team." },
  { label: "AI setup", icon: "🤖", title: "Connect your AI", desc: "Pick an AI model to power your agents." },
  { label: "Files", icon: "📂", title: "Give Bees context", desc: "Attach files or use a sample brief." },
  { label: "First result", icon: "✨", title: "Create your first result", desc: "Choose a task and let Bees do the work." }
];

function StepRail({ step, done, onStep }) {
  return h("nav", { className: "gs-stepper-wrap", "aria-label": "Setup steps" },
    h("div", { className: "gs-stepper" },
      h("div", { className: "gs-stepper-progress", style: { "--gs-progress": step / (STEPS.length - 1) } }),
      ...STEPS.map(({ label }, index) => {
        const isDone = done[index] && index < step;
        const isActive = index === step;
        const cls = isActive ? "gs-step-active" : isDone ? "gs-step-done" : "";
        return h("button", {
          type: "button",
          key: label,
          className: `gs-step-btn ${cls}`,
          "aria-current": isActive ? "step" : undefined,
          onClick: () => onStep(index)
        },
          h("div", { className: "gs-step-circle" },
            isDone ? h(CheckIcon) : String(index + 1)
          ),
          h("span", { className: "gs-step-label" }, label)
        );
      })
    )
  );
}

// ─── Step 0: Workspace ───────────────────────────────────────────────────

function WorkspaceStep({ parts, done, busy, ensureTeam, update, go, navigate }) {
  return h("div", { className: "gs-card-body" },
    done[0]
      ? h("div", { style: { display: "grid", gap: "12px" } },
        h("div", { className: "gs-ai-status gs-ready" },
          h("div", { className: "gs-status-dot" }),
          h("span", null, `Ready · ${parts.organization?.name || "your organization"} › ${parts.team?.name}`)
        ),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { type: "button", className: "gs-btn-primary", onClick: () => update({ step: 1 }) }, "Continue to AI setup →"),
          h("button", { type: "button", className: "gs-btn-secondary", onClick: () => go(0) }, "Create another workspace")
        )
      )
      : h("div", { style: { display: "grid", gap: "12px" } },
        h("p", { style: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-secondary)", lineHeight: "1.55" } },
          parts.team
            ? `You're in ${parts.organization?.name || "an organization"} › ${parts.team.name}. You can use this workspace or create a new one.`
            : "Give your organization a name and we'll create a Default team for your first task."
        ),
        h("div", { className: "gs-option-grid" },
          !parts.team && parts.organizationId
            ? h("button", { type: "button", className: "gs-option", disabled: busy, onClick: ensureTeam },
              h("span", { className: "gs-option-icon" }, "🏗️"),
              h("strong", null, "Create Default team"),
              h("span", null, "Set up a team in your current organization")
            ) : null,
          h("button", { type: "button", className: "gs-option", onClick: () => go(0) },
            h("span", { className: "gs-option-icon" }, "➕"),
            h("strong", null, "Create workspace"),
            h("span", null, "Start fresh with a new organization and team")
          ),
          h("button", { type: "button", className: "gs-option", onClick: () => navigate("accounts") },
            h("span", { className: "gs-option-icon" }, "🔗"),
            h("strong", null, "Join an organization"),
            h("span", null, "Connect to an existing Bees organization")
          )
        )
      )
  );
}

// ─── Step 1: AI setup ────────────────────────────────────────────────────

function AiStep({ ctx, data, agents, aiReady, aiStatus, testAi, busy, saveAgentModel, go }) {
  const defaultModel = data.systemDefaultModel?.provider && data.systemDefaultModel?.model
    ? `${data.systemDefaultModel.provider}/${data.systemDefaultModel.model}` : null;

  return h("div", { className: "gs-card-body" },
    // Provider pick cards — each opens the relevant AI-connections sub-section
    h("div", { className: "gs-option-grid" },
      h("button", { type: "button", className: "gs-option", onClick: () => go(1, "local") },
        h("span", { className: "gs-option-icon" }, "💻"),
        h("strong", null, "AI on this computer · Recommended"),
        h("span", null, "Runs here. Nothing leaves this computer.")
      ),
      h("button", { type: "button", className: "gs-option", onClick: () => go(1, "subscriptions") },
        h("span", { className: "gs-option-icon" }, "☁️"),
        h("strong", null, "Connect Codex or Claude"),
        h("span", null, "Uses your subscription; messages go to its provider.")
      ),
      h("button", { type: "button", className: "gs-option", onClick: () => go(1, "other") },
        h("span", { className: "gs-option-icon" }, "🔌"),
        h("strong", null, "Choose another provider"),
        h("span", null, "Your own API key; provider charges may apply.")
      )
    ),
    // Hint: clicking a card opens AI connections settings
    h("p", { className: "gs-nav-hint" },
      h(ExternalIcon),
      "Selecting an option opens AI connections · return here when done"
    ),

    // Agent configuration (shown when agents exist)
    agents.length > 0 ? h("div", { style: { display: "grid", gap: "10px" } },
      h("p", { style: { margin: 0, fontSize: "13px", fontWeight: 600 } }, "Agent configuration"),
      h("div", { className: "gs-agent-pair" },
        ...agents.map((agent, index) => h("div", { key: agent.id, className: "gs-agent-card" },
          h("div", { className: "gs-agent-card-head" },
            h("span", { className: "gs-agent-role" }, index === 0 ? "Lead" : "Reviewer"),
            !agent.enabled ? h("span", { className: "gs-agent-warn" }, "⚠ Disabled") : null
          ),
          h("div", { className: "gs-agent-model" }, agent.model || defaultModel || "No model selected"),
          h("details", { className: "gs-change-ai-toggle" },
            h("summary", null, "Change AI (optional)"),
            h("div", { className: "gs-change-ai-inner" },
              h("form", { onSubmit: (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void saveAgentModel(agent, {
                  model: String(form.get("model") || "") || null,
                  reasoningEffort: String(form.get("reasoningEffort") || "") || null
                });
              } },
                h(AgentModelSelect, { key: `${agent.model}:${agent.reasoningEffort}`, ctx,
                  value: agent.model || "", effort: agent.reasoningEffort || "", systemDefault: data.systemDefaultModel }),
                h("button", { type: "submit", className: "gs-btn-secondary", disabled: busy,
                  style: { marginTop: "6px", fontSize: "12px", padding: "5px 11px" } }, "Save")
              )
            )
          )
        ))
      ),
      h("p", { style: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } },
        "One model is enough — agents use separate conversations. Changes update your team's agents."
      )
    ) : null,

    // AI readiness status
    h("div", { className: `gs-ai-status ${aiReady ? "gs-ready" : "gs-pending"}` },
      h("div", { className: "gs-status-dot" }),
      h("span", { role: "status" }, aiStatus)
    ),

    // Test button
    h("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
      h("button", { type: "button", className: "gs-btn-secondary",
        disabled: busy || !data.systemDefaultModel?.provider || agents.some((a) => !a.enabled),
        onClick: testAi
      }, busy ? "Testing…" : "Test AI connection"),
      h("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } },
        "Sends one greeting. Provider usage may apply."
      )
    )
  );
}

// ─── Step 2: Files ───────────────────────────────────────────────────────

function FilesStep({ parts, state, update, go }) {
  return h("div", { className: "gs-card-body" },
    state.filesChoice
      ? h("div", { className: "gs-ai-status gs-ready", style: { marginBottom: "4px" } },
        h("div", { className: "gs-status-dot" }),
        h("span", null,
          state.filesChoice === "sample" ? "Using the fictional repair café brief." :
          state.filesChoice === "none"   ? "No files — you can add them later from the Files page." :
          "Your files are connected to this team."
        )
      ) : null,

    h("div", { className: "gs-file-grid" },
      h("button", { type: "button",
        className: `gs-file-choice ${state.filesChoice === "sample" ? "gs-chosen" : ""}`,
        onClick: () => update({ filesChoice: "sample", step: 3 })
      },
        h("span", { className: "gs-file-icon" }, "📋"),
        h("strong", null, "Use sample brief"),
        h("span", null, "Try with a fictional project — no files needed."),
        h("span", { className: "gs-rec" }, "Quick start")
      ),
      h("button", { type: "button",
        className: "gs-file-choice",
        disabled: !parts.teamId,
        onClick: () => go(2)
      },
        h("span", { className: "gs-file-icon" }, "📁"),
        h("strong", null, "Choose my files"),
        h("span", null, "Map a folder or file for your team to use.")
      ),
      h("button", { type: "button",
        className: `gs-file-choice ${state.filesChoice === "none" ? "gs-chosen" : ""}`,
        onClick: () => update({ filesChoice: "none", step: 3 })
      },
        h("span", { className: "gs-file-icon" }, "✏️"),
        h("strong", null, "Write own instructions"),
        h("span", null, "Give Bees instructions without any file context.")
      )
    ),

    h("details", { className: "gs-brief" },
      h("summary", null, "📖 Preview sample brief"),
      h("pre", null, SAMPLE_BRIEF)
    ),

    h("div", { className: "gs-note" },
      "ℹ️ ",
      h("span", null, "File mappings make locations available to this team. Cloud AI may receive selected content; local AI processes it on this computer.")
    )
  );
}

// ─── Main GettingStarted component ───────────────────────────────────────

export function GettingStarted({ ctx, data, parts, state, update, aiReady, aiStatus, testAi, busy, saveAgentModel,
  go, start, openWorkItem, navigate, ensureTeam }) {
  ensureGsCss();

  const [task, setTask] = useState(state.task || "plan");
  const [prompt, setPrompt] = useState(state.prompt || STARTER_TASKS[0].prompt);
  const done = onboardingProgress(data, parts.teamId, state, aiReady);
  const step = Math.min(3, Math.max(0, state.step || 0));
  const agents = planningAgents(data, parts.workspaceId);
  const teamLocations = data.locations.filter((row) => row.teamId === parts.teamId && row.mapped && !row.archivedAt);
  const inputs = teamLocations.filter((row) => (state.inputLocationIds || []).includes(row.id)).length;
  // a cancelled first task gives the form back so the person can start again
  const firstItem = data.items.find(({ id, runtimePhase }) => id === state.workItemId && runtimePhase !== "cancelled");
  const failed = firstItem?.runtimePhase === "failed";
  const isComplete = done[3];

  // Footer nav visibility
  // Step 0: skip shown only when no own button is available
  const stepZeroHasOwnButton = done[0] || (!parts.team && parts.organizationId);
  const showSkip  = step < 3 && (step > 0 || !stepZeroHasOwnButton);
  const showBack  = step > 0;

  return h("div", { className: "gs-page" },

    // ── Page header (replaces original bees-callout h1) ──
    h("div", { className: "gs-header" },
      h("div", { className: "gs-header-content" },
        h("h1", null, "Your first result starts here"),
        h("p", null, "Set up your workspace, choose AI, and watch Bees turn a brief into a useful file.")
      ),
      h("div", { className: "gs-header-actions" },
        h("button", { type: "button", className: "gs-outline-btn", onClick: () => navigate("basics") }, "Bees basics"),
        h("button", { type: "button", className: "gs-skip-btn",
          onClick: () => { update({ active: false }); navigate("home"); }
        }, "Set up later")
      )
    ),

    // ── Step rail ──
    h(StepRail, { step, done, onStep: (i) => update({ step: i, active: true }) }),

    // ── Main card ──
    h("div", { className: "gs-card" },

      // Card header
      h("div", { className: "gs-card-head" },
        h("div", { className: "gs-card-icon" }, STEPS[step].icon),
        h("div", { className: "gs-card-head-copy" },
          h("h2", null, STEPS[step].title),
          h("p", null, STEPS[step].desc)
        )
      ),

      // ── Step 0: Workspace ──
      step === 0 ? h(WorkspaceStep, { parts, done, busy, ensureTeam, update, go, navigate }) : null,

      // ── Step 1: AI ──
      step === 1 ? h(AiStep, { ctx, data, agents, aiReady, aiStatus, testAi, busy, saveAgentModel, go }) : null,

      // ── Step 2: Files ──
      step === 2 ? h(FilesStep, { parts, state, update, go }) : null,

      // ── Step 3: First result ──
      step === 3 ? h("div", { className: "gs-card-body" },
        firstItem
          ? h("div", { className: `gs-result ${isComplete ? "gs-done" : failed ? "gs-failed" : ""}` },
            h("div", { className: "gs-result-head" },
              h("span", { className: "gs-result-icon" }, isComplete ? "🎉" : failed ? "⚠️" : "⏳"),
              h("h3", null, isComplete ? "Your first result is ready!" : failed ? "Task stopped" : "Working on it…")
            ),
            h("p", null,
              failed ? "Open the task to see why it stopped, then press Retry."
                : isComplete ? "Open your result to read the output and continue from there."
                : "Open the task to follow the discussion, answer questions, and see the file."
            ),
            h("div", null,
              h("button", { type: "button", className: "gs-btn-primary", onClick: () => openWorkItem(state.workItemId) },
                isComplete ? "View result →" : "Open task →"
              )
            )
          )
          : h("form", { onSubmit: (event) => { event.preventDefault(); void start(prompt); } },
            h("div", { style: { display: "grid", gap: "16px" } },

              // Task selector
              h("div", null,
                h("p", { style: { margin: "0 0 9px", fontSize: "13px", fontWeight: 600 } }, "Choose a starter task"),
                h("div", { className: "gs-task-list" },
                  ...STARTER_TASKS.map((row) => h("button", {
                    type: "button", key: row.id,
                    className: `gs-task-opt ${task === row.id ? "gs-selected" : ""}`,
                    onClick: () => {
                      setTask(row.id); setPrompt(row.prompt);
                      update({ task: row.id, prompt: row.prompt });
                    }
                  },
                    h("div", { className: "gs-radio" }, h("div", { className: "gs-radio-dot" })),
                    h("strong", null, row.title)
                  )),
                  h("button", {
                    type: "button",
                    className: `gs-task-opt ${task === "custom" ? "gs-selected" : ""}`,
                    onClick: () => { setTask("custom"); setPrompt(""); update({ task: "custom", prompt: "" }); }
                  },
                    h("div", { className: "gs-radio" }, h("div", { className: "gs-radio-dot" })),
                    h("strong", null, "Write my own task")
                  )
                )
              ),

              // Prompt textarea
              h("label", { className: "gs-label" },
                h("span", null, "Task instructions",
                  usesSampleBrief(prompt.trim(), state.filesChoice, inputs)
                    ? h("span", { className: "gs-label-hint" }, " · using fictional repair café brief") : null
                ),
                h("textarea", { className: "bees-textarea", value: prompt, required: true, rows: 4,
                  onChange: (event) => { setPrompt(event.target.value); update({ prompt: event.target.value }); }
                })
              ),

              // File location toggles
              teamLocations.length > 0 ? h("div", null,
                h("p", { style: { margin: "0 0 7px", fontSize: "13px", fontWeight: 600 } }, "Input files"),
                h("div", { className: "gs-locs" },
                  ...teamLocations.map((row) => h("label", { key: row.id, className: "gs-loc" },
                    h("input", { type: "checkbox",
                      checked: (state.inputLocationIds || []).includes(row.id),
                      onChange: (event) => update({ inputLocationIds: event.target.checked
                        ? [...(state.inputLocationIds || []), row.id]
                        : (state.inputLocationIds || []).filter((id) => id !== row.id) })
                    }),
                    row.name
                  ))
                )
              ) : null,

              // AI not ready warning
              !aiReady ? h("div", { className: "gs-ai-status gs-pending" },
                h("div", { className: "gs-status-dot" }),
                h("div", { style: { display: "grid", gap: "5px" } },
                  h("span", { role: "status" }, "AI not yet set up. Choose and test your AI before starting."),
                  h("button", { type: "button", className: "gs-link-btn", onClick: () => update({ step: 1 }) }, "Go to AI setup →")
                )
              ) : null,

              h("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
                h("button", { type: "submit", className: "gs-btn-primary",
                  disabled: busy || !done[0] || !aiReady || !prompt.trim()
                }, busy ? "Starting…" : "✨ Create my first result"),
                h("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } }, "Work → Review → Done")
              )
            )
          )
      ) : null,

      // ── Card footer ──
      h("div", { className: "gs-card-foot" },
        h("div", { className: "gs-foot-left" },
          showBack
            ? h("button", { type: "button", className: "gs-btn-secondary", onClick: () => update({ step: step - 1 }) }, "← Back")
            : null
        ),
        h("div", { className: "gs-foot-right" },
          showSkip
            ? h("button", { type: "button", className: "gs-btn-secondary", onClick: () => update({ step: step + 1 }) },
              done[step] ? "Continue →" : "Skip for now")
            : null
        )
      )
    ),

    // ── Finish banner ──
    isComplete ? h("div", { className: "gs-finish" },
      h("span", { style: { fontSize: "22px" } }, "🎊"),
      h("p", null,
        h("strong", null, "Setup complete! "),
        "You've created your first result with Bees."
      ),
      h("button", { type: "button", className: "gs-btn-primary",
        onClick: () => { update({ active: false }); navigate("home"); }
      }, "Go to dashboard →")
    ) : null
  );
}

// ─── GettingStartedBar ────────────────────────────────────────────────────
export function GettingStartedBar({ state, update, navigate, aiReady, aiStatus, data, openWorkItem }) {
  ensureGsCss();
  const item = data.items.find(({ id }) => id === state.workItemId);
  const [download, setDownload] = useState("");
  const step = state.step || 0;

  useEffect(() => {
    let active = true;
    let unlisten;
    void window.__TAURI__?.event?.listen("local-model-progress", ({ payload }) => {
      if (!active) return;
      setDownload(payload.state === "downloading"
        ? `Downloading${payload.totalBytes ? ` ${Math.round(payload.downloadedBytes / payload.totalBytes * 100)}%` : "…"}`
        : payload.state === "error" ? "Download failed"
        : payload.state === "ready" ? "Model ready" : "");
    }).then((dispose) => { if (active) unlisten = dispose; else dispose?.(); });
    return () => { active = false; unlisten?.(); };
  }, []);

  const done = onboardingProgress(data, state.teamId, state, aiReady);

  // Navigate to a step on the getting-started page
  const goStep = (i) => { update({ step: i, active: true }); navigate("getting-started"); };

  // Status hint shown alongside active step
  const hint = item ? (download || "Task running") : (download || (aiStatus !== "AI ready" ? aiStatus : ""));

  return h("aside", { className: "gs-bar", "aria-label": "Setup progress" },

    // "SETUP" label
    h("button", { type: "button", className: "gs-bar-label", style: { cursor: "pointer", border: 0, background: "transparent", font: "inherit" },
      title: "Return to full setup screen",
      onClick: () => navigate("getting-started")
    }, "Setup"),

    // Step tabs
    h("div", { className: "gs-bar-steps" },
      ...STEPS.flatMap(({ label }, i) => [
        i > 0 ? h("span", { key: `chev-${i}`, className: "gs-bar-chev" }, "›") : null,
        h("button", {
          type: "button",
          key: label,
          className: `gs-bar-step ${i === step ? "gs-bstep-active" : (done[i] && i < step ? "gs-bstep-done" : "")}`,
          "aria-current": i === step ? "step" : undefined,
          title: `Go to step ${i + 1}: ${label}`,
          onClick: () => goStep(i)
        },
          h("span", { className: "gs-bar-step-num" }, done[i] && i < step ? "✓" : String(i + 1)),
          h("span", { className: "gs-bar-step-name" }, label)
        )
      ]).filter(Boolean)
    ),

    // Status hint (only show on active step, truncated)
    hint ? h("span", { role: "status",
      style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "180px", flexShrink: 1 }
    }, hint) : null,

    // Nav controls
    h("div", { className: "gs-bar-nav" },
      // Open first task (if running)
      item ? h("button", { type: "button", className: "gs-bar-nav-btn",
        onClick: () => openWorkItem(item.id) }, "Open task") : null,

      // Back step
      h("button", { type: "button", className: "gs-bar-nav-btn", disabled: step === 0,
        title: step > 0 ? `Back to step ${step}: ${STEPS[step - 1].label}` : undefined,
        onClick: () => { update({ step: step - 1, active: true }); navigate("getting-started"); }
      }, "← Back"),

      // Next / open setup
      step < 3
        ? h("button", { type: "button", className: "gs-bar-nav-btn gs-bar-primary",
          title: `Go to step ${step + 2}: ${STEPS[step + 1].label}`,
          onClick: () => { update({ step: step + 1, active: true }); navigate("getting-started"); }
        }, "Next →")
        : h("button", { type: "button", className: "gs-bar-nav-btn gs-bar-primary",
          onClick: () => navigate("getting-started")
        }, "Open setup"),

      h("div", { className: "gs-bar-divider" }),

      // Dismiss
      h("button", { type: "button", className: "gs-bar-later",
        title: "Dismiss setup bar (you can reopen it from the sidebar)",
        onClick: () => update({ active: false })
      }, "Later")
    )
  );
}
