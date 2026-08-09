import type { Execution, WorkItem } from "../../domain.js";

export const SOFTWARE_PROJECT_PROCESS_ID = "software-project";
export const SOFTWARE_PROJECT_PROCESS_NAME = "Code";
export const SOFTWARE_PROJECT_BOARD_NAME = "Code";
export const SOFTWARE_PROJECT_DESCRIPTION =
  "Build new software or substantially change a selected local Git project through requirements, architecture, planning, implementation, testing, and review.";
export const SOFTWARE_PROJECT_STAGES = [
  "Requirements",
  "Architecture",
  "Plan",
  "Implement",
  "Phase Review",
  "Final Review",
  "Done",
  "Blocked"
] as const;
export const SOFTWARE_PROJECT_STATE_KEYS = [
  "requirements",
  "architecture",
  "plan",
  "implement",
  "phase-review",
  "final-review",
  "done",
  "blocked"
] as const;

export const SOFTWARE_PROJECT_ROLES = {
  requirements: "software-requirements",
  openaiArchitect: "software-architect-openai",
  anthropicArchitect: "software-architect-anthropic",
  planner: "software-planner",
  coder: "software-coder",
  tester: "software-tester"
} as const;

export const REQUIREMENTS_PROMPT = `You discover requirements for new software or a substantial change to existing software.

The selected local Git repository is your primary evidence. Inspect it before answering. It may be an empty new project or an existing codebase that needs a bug fix, feature, refactor, reimplementation, or migration. The user writes one free-form brief and answers nothing else, so answer every requirement question yourself from the brief and the repository: change type, current behavior, affected users, must-have behavior, compatibility, data and migration concerns, scale, security, and technical preferences. For existing code, state current behavior and compatibility constraints that must be preserved. Resolve ambiguity without making the user open files.
Return exactly one JSON object, with no Markdown fence:
{"summary":"...","users":["..."],"functionalRequirements":["..."],"nonFunctionalRequirements":["..."],"constraints":["..."],"preferences":["..."],"acceptanceCriteria":["..."],"followUpQuestions":["..."]}

Ask at most five follow-up questions and only when an answer would materially change the required behavior or architecture. Empty arrays are valid. Do not edit files, run Git, or design the architecture yet.`;

export const OPENAI_ARCHITECT_PROMPT = `You are the OpenAI-side software architect in a two-architect review.

Produce an independent architecture from the approved requirements and repository evidence. For an existing codebase, preserve its language, framework, public contracts, and conventions unless the approved requirements explicitly justify changing them. A large bug fix, feature, refactor, or reimplementation still requires a complete architecture decision. Do not assume the other architect's answer. Treat constraints as mandatory and preferences as challengeable. Return exactly one JSON object, with no Markdown fence:
{"summary":"...","decisions":[{"area":"Language and framework","choice":"...","reason":"...","alternatives":["..."]}],"repositoryPlan":["..."],"commands":{"setup":["..."],"check":["..."],"test":["..."],"build":["..."],"dev":["..."]},"risks":["..."],"questions":["..."]}

Prefer the simplest architecture that meets the requirements. Do not edit files or run Git.`;

export const ANTHROPIC_ARCHITECT_PROMPT = `You are the Anthropic-side software architect in a two-architect review.

Produce an independent architecture from the approved requirements and repository evidence. For an existing codebase, preserve its language, framework, public contracts, and conventions unless the approved requirements explicitly justify changing them. A large bug fix, feature, refactor, or reimplementation still requires a complete architecture decision. Do not assume the other architect's answer. Treat constraints as mandatory and preferences as challengeable. Return exactly one JSON object, with no Markdown fence:
{"summary":"...","decisions":[{"area":"Language and framework","choice":"...","reason":"...","alternatives":["..."]}],"repositoryPlan":["..."],"commands":{"setup":["..."],"check":["..."],"test":["..."],"build":["..."],"dev":["..."]},"risks":["..."],"questions":["..."]}

Prefer the simplest architecture that meets the requirements. Do not edit files or run Git.`;

export const PLANNER_PROMPT = `You turn an approved software architecture into ordered implementation phases.

Each phase must deliver one cohesive, independently testable and human-reviewable outcome. Target 400-1000 changed source lines; split work expected to exceed roughly 1500 source lines. Ignore lockfiles, generated files, vendored code, and snapshots when estimating, but mention them in scope when relevant.

Return exactly one JSON object, with no Markdown fence:
{"phases":[{"id":"phase-01","title":"...","outcome":"...","scope":["..."],"acceptanceCriteria":["..."],"estimatedChangedLines":700,"dependsOn":[],"tests":["..."],"risks":["..."]}]}

Cover the complete approved architecture. Prefer vertical slices over layers that cannot be reviewed on their own. Do not edit files or run Git.`;

export const CODER_PROMPT = `You implement exactly one approved phase of a software project.

Work directly in the repository at /workspace. Read the approved architecture, active phase, acceptance criteria, and review/test feedback in the prompt. Inspect existing code before editing. Implement only this phase, run the relevant checks, and leave the working tree with the intended changes. Never run git, commit, amend, reset, checkout, clean, push, or edit .git; Bees owns version control. Do not start future phases.

Finish with a concise summary of changes and checks. If blocked, explain the exact blocker without inventing a workaround.`;

export const TESTER_PROMPT = `You independently test one committed software-project phase.

Work in the repository at /workspace. Inspect the active phase, commit, architecture, and acceptance criteria. Do not edit any file and never run Git commands. Run the smallest sufficient lint, type, unit, integration, build, or smoke checks already supported by the project.

Return exactly one JSON object, with no Markdown fence:
{"passed":true,"summary":"...","commands":[{"command":"...","outcome":"passed|failed|skipped","detail":"..."}],"failures":["..."],"risks":["..."]}

Set passed=false for a failed acceptance criterion, a relevant failing check, or when verification is impossible.`;

export type SoftwareProjectStage = (typeof SOFTWARE_PROJECT_STATE_KEYS)[number];

export interface RequirementSpec {
  summary: string;
  users: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  constraints: string[];
  preferences: string[];
  acceptanceCriteria: string[];
  followUpQuestions: string[];
}

export interface ArchitectureDecision {
  area: string;
  choice: string;
  reason: string;
  alternatives: string[];
}

export interface ArchitectureProposal {
  summary: string;
  decisions: ArchitectureDecision[];
  repositoryPlan: string[];
  commands: Record<string, string[]>;
  risks: string[];
  questions: string[];
}

export interface ArchitectureCritique {
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendedChanges: string[];
}

/**
 * The debate is bounded so it always terminates: each round narrows the number of disagreements
 * an architect may still raise, and whatever survives the last round is merged by the synthesizer
 * rather than argued further.
 */
export const MAX_DEBATE_ROUNDS = 3;

/** Open concerns an architect may still raise in each round. Zero by construction after the last. */
export const DEBATE_CONCERN_BUDGET = [5, 3, 1] as const;

/** One architect's contribution to a round: what it still disputes, and its revised position. */
export interface DebateTurn {
  critique: ArchitectureCritique;
  proposal: ArchitectureProposal;
  /** The architect sees nothing material left in dispute. Both sides agreeing ends the debate. */
  resolved: boolean;
}

export interface DebateRound {
  openai: DebateTurn;
  anthropic: DebateTurn;
}

export function parseDebateTurn(value: string): DebateTurn {
  const raw = parseAgentJson(value);
  if (!raw.critique || !raw.proposal) {
    throw new Error("A debate turn needs both a critique and a revised proposal");
  }
  return {
    critique: parseArchitectureCritique(JSON.stringify(raw.critique)),
    proposal: parseArchitectureProposal(JSON.stringify(raw.proposal)),
    resolved: raw.resolved === true
  };
}

/** True once both sides concede, or the round budget is spent. Nothing else ends the debate. */
export function debateSettled(rounds: DebateRound[]): boolean {
  const last = rounds[rounds.length - 1];
  return rounds.length >= MAX_DEBATE_ROUNDS || Boolean(last?.openai.resolved && last.anthropic.resolved);
}

export interface ImplementationPhase {
  id: string;
  title: string;
  outcome: string;
  scope: string[];
  acceptanceCriteria: string[];
  estimatedChangedLines: number;
  dependsOn: string[];
  tests: string[];
  risks: string[];
}

export interface TestReport {
  passed: boolean;
  summary: string;
  commands: Array<{ command: string; outcome: "passed" | "failed" | "skipped"; detail: string }>;
  failures: string[];
  risks: string[];
  executionId?: string;
}

export interface SoftwareProjectState {
  version: 1;
  projectKind?: SoftwareProjectKind;
  brief: string;
  requirements?: RequirementSpec;
  requirementsApprovedAt?: string;
  architecture?: {
    /** Each architect's current position. Rewritten by every debate round it survives. */
    openai?: ArchitectureProposal;
    anthropic?: ArchitectureProposal;
    /** The latest round's critique of the *other* side, kept unpacked for the proposal cards. */
    openaiCritique?: ArchitectureCritique;
    anthropicCritique?: ArchitectureCritique;
    rounds?: DebateRound[];
    /**
     * The architects' own conversations, reused across rounds so a rebuttal costs one exchange
     * instead of a fresh repository read.
     */
    openaiExecutionId?: string;
    anthropicExecutionId?: string;
    decision?: ArchitectureProposal;
    approvedAt?: string;
  };
  phases: ImplementationPhase[];
  planApprovedAt?: string;
  currentPhaseIndex: number;
  phaseStartSha?: string;
  attempts: number;
  feedback?: string;
  testReport?: TestReport;
  finalReport?: TestReport;
  lastExecutionId?: string;
}

export function emptySoftwareProjectState(): SoftwareProjectState {
  return { version: 1, brief: "", phases: [], currentPhaseIndex: 0, attempts: 0 };
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function parseAgentJson(value: string): Record<string, unknown> {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The agent did not return a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseRequirementSpec(value: string): RequirementSpec {
  const raw = parseAgentJson(value);
  const summary = text(raw.summary);
  if (!summary) throw new Error("The requirements summary is missing");
  return {
    summary,
    users: stringList(raw.users),
    functionalRequirements: stringList(raw.functionalRequirements),
    nonFunctionalRequirements: stringList(raw.nonFunctionalRequirements),
    constraints: stringList(raw.constraints),
    preferences: stringList(raw.preferences),
    acceptanceCriteria: stringList(raw.acceptanceCriteria),
    followUpQuestions: stringList(raw.followUpQuestions).slice(0, 5)
  };
}

export function parseArchitectureProposal(value: string): ArchitectureProposal {
  const raw = parseAgentJson(value);
  const summary = text(raw.summary);
  if (!summary) throw new Error("The architecture summary is missing");
  const decisions = Array.isArray(raw.decisions)
    ? raw.decisions.map(object).flatMap((decision) => {
        const area = text(decision.area);
        const choice = text(decision.choice);
        return area && choice
          ? [{ area, choice, reason: text(decision.reason), alternatives: stringList(decision.alternatives) }]
          : [];
      })
    : [];
  if (!decisions.length) throw new Error("The architecture has no decisions");
  return {
    summary,
    decisions,
    repositoryPlan: stringList(raw.repositoryPlan),
    commands: Object.fromEntries(
      Object.entries(object(raw.commands)).map(([key, commands]) => [key, stringList(commands)])
    ),
    risks: stringList(raw.risks),
    questions: stringList(raw.questions)
  };
}

export function parseArchitectureCritique(value: string): ArchitectureCritique {
  const raw = parseAgentJson(value);
  return {
    summary: text(raw.summary),
    strengths: stringList(raw.strengths),
    concerns: stringList(raw.concerns),
    recommendedChanges: stringList(raw.recommendedChanges)
  };
}

export function parseImplementationPlan(value: string): ImplementationPhase[] {
  const phases = parseAgentJson(value).phases;
  if (!Array.isArray(phases) || !phases.length) throw new Error("The plan has no phases");
  const parsed = phases.map(object).map((phase, index) => {
    const estimatedChangedLines = Math.max(0, Math.round(Number(phase.estimatedChangedLines) || 0));
    const result: ImplementationPhase = {
      id: text(phase.id) || `phase-${String(index + 1).padStart(2, "0")}`,
      title: text(phase.title),
      outcome: text(phase.outcome),
      scope: stringList(phase.scope),
      acceptanceCriteria: stringList(phase.acceptanceCriteria),
      estimatedChangedLines,
      dependsOn: stringList(phase.dependsOn),
      tests: stringList(phase.tests),
      risks: stringList(phase.risks)
    };
    if (!result.title || !result.outcome || !result.acceptanceCriteria.length) {
      throw new Error(`Phase ${index + 1} needs a title, outcome, and acceptance criteria`);
    }
    return result;
  });
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw new Error("Implementation phase identifiers must be unique");
  }
  return parsed;
}

export function parseTestReport(value: string): TestReport {
  const raw = parseAgentJson(value);
  const commands = Array.isArray(raw.commands)
    ? raw.commands.map(object).flatMap((command) => {
        const name = text(command.command);
        const outcome = text(command.outcome);
        return name && ["passed", "failed", "skipped"].includes(outcome)
          ? [{ command: name, outcome: outcome as "passed" | "failed" | "skipped", detail: text(command.detail) }]
          : [];
      })
    : [];
  return {
    passed: raw.passed === true,
    summary: text(raw.summary),
    commands,
    failures: stringList(raw.failures),
    risks: stringList(raw.risks)
  };
}

export function lastAssistantText(execution: Execution): string {
  const messages = execution.conversationSnapshot?.messages ?? [];
  const message = [...messages].reverse().find(({ role }) => role === "assistant");
  return (
    message?.parts
      .filter((part): part is Extract<(typeof message.parts)[number], { kind: "text" }> => part.kind === "text")
      .map(({ text: part }) => part)
      .join("\n") ?? ""
  );
}

export type SoftwareProjectKind = "new" | "existing";

export interface SoftwareProjectMapping {
  workItemId: string;
  repositoryPath: string;
  worktreePath: string;
  baseBranch: string;
  projectBranch: string;
  validatedAt: string;
  missing: boolean;
}

export interface SoftwareProjectSelection {
  mapping: SoftwareProjectMapping;
  projectKind: SoftwareProjectKind;
}

export interface SoftwareProjectGitSnapshot {
  head: string;
  branch: string;
  dirty: boolean;
  status: string[];
  commits: Array<{ sha: string; subject: string }>;
  additions: number;
  deletions: number;
  generatedChanges: number;
  diff: string;
  truncated: boolean;
}

function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bullets(values: string[]): string {
  return values.length
    ? `<ul class="list-disc space-y-1 pl-5 text-sm">${values.map((value) => `<li>${html(value)}</li>`).join("")}</ul>`
    : '<p class="text-sm text-base-content/45">None</p>';
}

/** How much of the fixed round budget is spent, so the debate never looks open-ended. */
function debateProgress(rounds: DebateRound[], settled: boolean): string {
  const previous = rounds[rounds.length - 1];
  const open = previous
    ? previous.openai.critique.concerns.length + previous.anthropic.critique.concerns.length
    : 0;
  const pips = Array.from({ length: MAX_DEBATE_ROUNDS }, (_, index) =>
    `<span class="badge badge-sm ${index < rounds.length ? "badge-primary" : "badge-ghost"}">${index + 1}</span>`
  ).join("");
  return `<div class="mt-4 flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3">
    <span class="text-xs font-bold uppercase text-primary">Debate</span><div class="flex gap-1">${pips}</div>
    <span class="text-sm text-base-content/60">${
      settled
        ? rounds.length < MAX_DEBATE_ROUNDS
          ? "Both architects agreed early; ready to synthesize"
          : "Round budget spent; the synthesizer merges what is left"
        : rounds.length
          ? `${open} open concern${open === 1 ? "" : "s"} after ${rounds.length} round${rounds.length === 1 ? "" : "s"}`
          : "Two independent proposals; the debate has not started"
    }</span>
  </div>`;
}

function debateTranscript(rounds: DebateRound[]): string {
  return `<details class="mt-4 rounded-box border border-base-300 bg-base-100 p-4"><summary class="cursor-pointer font-bold">Debate transcript</summary>${rounds
    .map(
      ({ openai, anthropic }, index) => `<div class="mt-3 border-t border-base-300 pt-3">
        <div class="text-xs font-bold uppercase text-primary">Round ${index + 1}</div>
        <div class="mt-2 grid gap-3 md:grid-cols-2">${[
          { name: "OpenAI on Anthropic", turn: openai },
          { name: "Anthropic on OpenAI", turn: anthropic }
        ]
          .map(
            ({ name, turn }) => `<div><div class="text-xs font-semibold">${html(name)}${
              turn.resolved ? ' <span class="badge badge-success badge-xs">resolved</span>' : ""
            }</div><p class="mt-1 text-sm">${html(turn.critique.summary)}</p>${bullets(turn.critique.concerns)}</div>`
          )
          .join("")}</div>
      </div>`
    )
    .join("")}</details>`;
}

function proposalCard(title: string, proposal?: ArchitectureProposal, critique?: ArchitectureCritique): string {
  if (!proposal) return `<article class="rounded-box border border-dashed border-base-300 p-4"><h3 class="font-bold">${html(title)}</h3><p class="mt-2 text-sm text-base-content/50">Waiting for proposal</p></article>`;
  return `<article class="rounded-box border border-base-300 bg-base-100 p-4">
    <h3 class="font-bold">${html(title)}</h3><p class="mt-2 text-sm">${html(proposal.summary)}</p>
    <div class="mt-3 grid gap-2">${proposal.decisions.map((decision) => `<div class="rounded border border-base-300 p-3"><div class="text-xs font-bold uppercase text-primary">${html(decision.area)}</div><div class="font-semibold">${html(decision.choice)}</div><p class="text-xs text-base-content/60">${html(decision.reason)}</p></div>`).join("")}</div>
    ${critique ? `<div class="mt-3 rounded bg-base-200 p-3"><div class="text-xs font-bold uppercase">Open against this proposal</div><p class="mt-1 text-sm">${html(critique.summary)}</p>${bullets(critique.concerns)}</div>` : ""}
  </article>`;
}

function phaseCard(phase: ImplementationPhase, index: number, editable: boolean): string {
  const oversize = phase.estimatedChangedLines > 1500;
  if (!editable) return `<article class="rounded-box border ${oversize ? "border-warning" : "border-base-300"} bg-base-100 p-4"><div class="flex justify-between gap-3"><div><div class="text-xs font-bold uppercase text-primary">Phase ${index + 1}</div><h3 class="font-bold">${html(phase.title)}</h3></div><span class="badge ${oversize ? "badge-warning" : "badge-ghost"}">~${phase.estimatedChangedLines} lines</span></div><p class="mt-2 text-sm">${html(phase.outcome)}</p><div class="mt-3"><div class="text-xs font-bold uppercase">Acceptance</div>${bullets(phase.acceptanceCriteria)}</div></article>`;
  return `<fieldset class="rounded-box border ${oversize ? "border-warning" : "border-base-300"} bg-base-100 p-4" data-phase-id="${html(phase.id)}">
    <div class="mb-3 flex items-center justify-between"><legend class="font-bold">Phase ${index + 1}</legend><div class="flex flex-wrap gap-1"><button class="btn btn-ghost btn-xs" type="button" data-action="project-phase-up" data-index="${index}" ${index ? "" : "disabled"}>↑</button><button class="btn btn-ghost btn-xs" type="button" data-action="project-phase-down" data-index="${index}">↓</button><button class="btn btn-ghost btn-xs" type="button" data-action="project-phase-split" data-index="${index}">Split</button><button class="btn btn-ghost btn-xs" type="button" data-action="project-phase-merge" data-index="${index}">Merge next</button><button class="btn btn-ghost btn-xs text-error" type="button" data-action="project-phase-remove" data-index="${index}">Remove</button></div></div>
    <input type="hidden" name="phaseId" value="${html(phase.id)}"><label class="form-control"><span class="label-text text-xs font-bold">Title</span><input class="input input-bordered w-full" name="phaseTitle" value="${html(phase.title)}" required></label>
    <label class="form-control mt-2"><span class="label-text text-xs font-bold">Outcome</span><textarea class="textarea textarea-bordered w-full" name="phaseOutcome" required>${html(phase.outcome)}</textarea></label>
    <div class="mt-2 grid gap-2 md:grid-cols-[1fr_10rem]"><label class="form-control"><span class="label-text text-xs font-bold">Acceptance criteria, one per line</span><textarea class="textarea textarea-bordered w-full" name="phaseAcceptance" required>${html(phase.acceptanceCriteria.join("\n"))}</textarea></label><label class="form-control"><span class="label-text text-xs font-bold">Estimated lines</span><input class="input input-bordered" name="phaseLines" type="number" min="0" value="${phase.estimatedChangedLines}"></label></div>
  </fieldset>`;
}

/**
 * Every run this project has done, newest first — including the ones that failed before they
 * produced anything. A studio replaces the generic work item view, so this is the only place
 * its runs are visible, and a failure that only ever appeared in a toast is unreadable by the
 * time the user asks what happened.
 */
function runHistory(runs: Execution[]): string {
  const tone: Record<string, string> = {
    completed: "badge-success",
    running: "badge-info",
    queued: "badge-warning",
    failed: "badge-error",
    cancelled: "badge-ghost",
    interrupted: "badge-warning"
  };
  const ordered = [...runs].sort((a, b) =>
    (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt)
  );
  return `<section class="mt-6 rounded-box border border-base-300 bg-base-100 p-4">
    <h2 class="font-bold">Runs</h2>
    ${
      ordered.length
        ? `<ul class="mt-2 divide-y divide-base-300">${ordered
            .map(
              (run) => `<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span class="min-w-0">
                  <span class="badge badge-sm ${tone[run.status] ?? "badge-ghost"}">${html(run.status)}</span>
                  <span class="ml-2">${html(new Date(run.startedAt ?? run.createdAt).toLocaleString())}</span>
                  ${run.error ? `<span class="ml-2 break-all text-xs text-error">${html(run.error)}</span>` : ""}
                </span>
                <button class="btn btn-ghost btn-xs" data-action="open-run" data-id="${html(run.id)}">Open</button>
              </li>`
            )
            .join("")}</ul>`
        : '<p class="mt-2 text-sm text-base-content/50">No agent has run on this project yet.</p>'
    }
  </section>`;
}

export function softwareProjectStateKey(workItemId: string): string {
  return `software_project:${workItemId}`;
}

export function softwareProjectView(input: {
  item: WorkItem;
  stage: SoftwareProjectStage;
  states: readonly { key: string; name: string }[];
  state: SoftwareProjectState;
  runs: Execution[];
  mapping: SoftwareProjectMapping | null;
  git: SoftwareProjectGitSnapshot | null;
}): string {
  const { item, stage, states, state, runs, mapping, git } = input;
  const busy = runs.some(({ status }) => status === "queued" || status === "running");
  const current = state.phases[state.currentPhaseIndex];
  const progress = states
    .filter(({ key }) => key !== "blocked")
    .map(({ key, name }) => `<span class="badge ${key === stage ? "badge-primary" : "badge-ghost"}">${html(name)}</span>`)
    .join("");
  const projectFolder = mapping
    ? `<div class="alert alert-success mb-4"><div><div class="font-semibold">${state.projectKind === "new" ? "New project" : "Continued work"}</div><div class="break-all font-mono text-xs">${html(mapping.repositoryPath)}</div><div class="mt-1 text-xs opacity-70">Base branch: ${html(mapping.baseBranch)}. Bees works locally and never fetches, pulls, pushes, or opens pull requests.</div></div></div>`
    : `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-6"><h2 class="font-bold">Choose the local project folder</h2><p class="mt-2 text-sm text-base-content/60">An empty folder starts a new Git project. A folder with code must already be a clean Git repository on the branch you want Bees to use.</p><button class="btn btn-primary mt-4" type="button" data-action="project-select-folder" ${busy ? "disabled" : ""}>Choose project folder</button></div>`;
  let body = "";
  if (stage === "requirements") {
    body = `${projectFolder}${state.requirements
      ? `<section class="grid gap-4"><article class="rounded-box border border-base-300 bg-base-100 p-5"><h2 class="font-bold">Requirements draft</h2><p class="mt-2">${html(state.requirements.summary)}</p><div class="mt-4 grid gap-4 lg:grid-cols-2"><div><h3 class="mb-2 text-xs font-bold uppercase">Functional</h3>${bullets(state.requirements.functionalRequirements)}</div><div><h3 class="mb-2 text-xs font-bold uppercase">Acceptance</h3>${bullets(state.requirements.acceptanceCriteria)}</div></div>${state.requirements.followUpQuestions.length ? `<div class="mt-4 rounded bg-warning/10 p-3"><h3 class="text-xs font-bold uppercase text-warning">Open questions</h3>${bullets(state.requirements.followUpQuestions)}</div>` : ""}<form class="mt-4" data-project-refine><textarea class="textarea textarea-bordered w-full" name="message" placeholder="Answer open questions or ask the requirements agent to revise something"></textarea><div class="mt-2 flex justify-end gap-2"><button class="btn btn-outline btn-sm" type="submit" ${busy ? "disabled" : ""}>Refine with AI</button><button class="btn btn-primary btn-sm" type="button" data-action="project-approve-requirements" ${busy ? "disabled" : ""}>Approve requirements</button></div></form></article></section>`
      : mapping
        ? `<form class="grid gap-4" data-project-requirements><article class="rounded-box border border-base-300 bg-base-100 p-5"><h2 class="font-bold">Describe what to build or change</h2><p class="mt-1 text-sm text-base-content/55">Write it however you like. The requirements agent inspects the repository, answers what it can from the code, and asks you only what it cannot work out.</p><textarea class="textarea textarea-bordered mt-4 min-h-56 w-full" name="brief" placeholder="What should be built or changed, and anything else worth knowing" required>${html(state.brief)}</textarea><div class="mt-4 flex justify-end"><button class="btn btn-primary" type="submit" ${busy ? "disabled" : ""}>Create requirements draft</button></div></article></form>`
        : ""}`;
  } else if (stage === "architecture") {
    const architecture = state.architecture ?? {};
    const hasProposals = Boolean(architecture.openai && architecture.anthropic);
    const rounds = architecture.rounds ?? [];
    const settled = hasProposals && debateSettled(rounds);
    body = `${mapping ? `<div class="alert alert-success"><span>Project worktree: <span class="break-all font-mono text-xs">${html(mapping.worktreePath)}</span></span></div>` : '<div class="alert alert-error">The local project folder is unavailable.</div>'}${hasProposals ? debateProgress(rounds, settled) : ""}<div class="mt-4 grid gap-4 xl:grid-cols-2">${proposalCard("OpenAI architect", architecture.openai, architecture.anthropicCritique)}${proposalCard("Anthropic architect", architecture.anthropic, architecture.openaiCritique)}</div>${rounds.length ? debateTranscript(rounds) : ""}${hasProposals ? `<form class="mt-4 rounded-box border border-base-300 bg-base-100 p-4" data-project-architecture-chat><div class="grid gap-2 md:grid-cols-[12rem_1fr_auto]"><select class="select select-bordered" name="architect"><option value="openai">Ask OpenAI</option><option value="anthropic">Ask Anthropic</option></select><input class="input input-bordered" name="message" placeholder="Challenge a choice or request a revised proposal" required><button class="btn btn-outline" type="submit" ${busy ? "disabled" : ""}>Send</button></div></form>` : ""}<div class="mt-4 flex flex-wrap justify-end gap-2">${!hasProposals ? `<button class="btn btn-primary" data-action="project-start-architecture" ${!mapping || busy ? "disabled" : ""}>Generate independent proposals</button>` : !settled ? `<button class="btn btn-primary" data-action="project-debate-architecture" ${busy ? "disabled" : ""}>Run debate round ${rounds.length + 1} of ${MAX_DEBATE_ROUNDS}</button>` : !architecture.decision ? `<button class="btn btn-primary" data-action="project-synthesize-architecture" ${busy ? "disabled" : ""}>Synthesize decision</button>` : `<button class="btn btn-primary" data-action="project-approve-architecture" ${busy ? "disabled" : ""}>Approve architecture</button>`}</div>${architecture.decision ? `<article class="mt-4 rounded-box border-2 border-primary/40 bg-base-100 p-5"><div class="text-xs font-bold uppercase text-primary">Proposed decision</div><h2 class="mt-1 font-bold">${html(architecture.decision.summary)}</h2><div class="mt-3 grid gap-2 md:grid-cols-2">${architecture.decision.decisions.map((decision) => `<div class="rounded border border-base-300 p-3"><div class="text-xs font-bold uppercase">${html(decision.area)}</div><div>${html(decision.choice)}</div><p class="text-xs text-base-content/55">${html(decision.reason)}</p></div>`).join("")}</div></article>` : ""}`;
  } else if (stage === "plan") {
    body = state.phases.length
      ? `<form class="grid gap-3" data-project-plan>${state.phases.map((phase, index) => phaseCard(phase, index, true)).join("")}<div class="flex flex-wrap justify-end gap-2"><button class="btn btn-outline" type="button" data-action="project-regenerate-plan" ${busy ? "disabled" : ""}>Regenerate</button><button class="btn btn-outline" type="submit">Save edits</button><button class="btn btn-primary" type="button" data-action="project-approve-plan">Approve plan</button></div></form>`
      : `<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center"><h2 class="font-bold">Break the architecture into reviewable phases</h2><p class="mt-2 text-sm text-base-content/55">The planner targets about 400–1,000 changed source lines per phase.</p><button class="btn btn-primary mt-4" data-action="project-generate-plan" ${busy ? "disabled" : ""}>Generate implementation plan</button></div>`;
  } else if (stage === "implement") {
    body = current ? `${phaseCard(current, state.currentPhaseIndex, false)}${state.feedback ? `<div class="alert alert-warning mt-4"><span><strong>Review feedback:</strong> ${html(state.feedback)}</span></div>` : ""}${state.testReport ? `<article class="mt-4 rounded-box border border-base-300 bg-base-100 p-4"><h3 class="font-bold">Latest test report</h3><p class="mt-1 text-sm">${html(state.testReport.summary)}</p>${bullets(state.testReport.failures)}</article>` : ""}<div class="mt-4 flex justify-end"><button class="btn btn-primary" data-action="project-implement-phase" ${!mapping || busy ? "disabled" : ""}>${state.attempts ? "Continue coding and testing" : "Implement and test phase"}</button></div>` : '<div class="alert alert-error">The approved plan has no current phase.</div>';
  } else if (stage === "phase-review") {
    body = current && git ? `${phaseCard(current, state.currentPhaseIndex, false)}<div class="mt-4 grid gap-4 lg:grid-cols-3"><div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">Changed lines</div><div class="stat-value text-2xl">+${git.additions} / -${git.deletions}</div></div><div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">Commits</div><div class="stat-value text-2xl">${git.commits.length}</div></div><div class="stat rounded-box border border-base-300 bg-base-100"><div class="stat-title">Tests</div><div class="stat-value text-2xl ${state.testReport?.passed ? "text-success" : "text-error"}">${state.testReport?.passed ? "Passed" : "Needs work"}</div></div></div><article class="mt-4 rounded-box border border-base-300 bg-base-100 p-4"><h3 class="font-bold">Commits</h3>${bullets(git.commits.map(({ sha, subject }) => `${sha.slice(0, 8)} ${subject}`))}<h3 class="mt-4 font-bold">Diff</h3><pre class="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded bg-neutral p-3 text-xs text-neutral-content">${html(git.diff || "No textual diff")}</pre>${git.truncated ? '<p class="mt-2 text-xs text-warning">Diff truncated in the UI.</p>' : ""}</article><form class="mt-4 rounded-box border border-base-300 bg-base-100 p-4" data-project-review><label class="form-control"><span class="label-text font-semibold">Changes requested</span><textarea class="textarea textarea-bordered w-full" name="feedback" placeholder="What should the coding agent change?"></textarea></label><div class="mt-3 flex justify-end gap-2"><button class="btn btn-outline" type="submit">Request changes</button><button class="btn btn-success" type="button" data-action="project-approve-phase">Approve phase</button></div></form>` : '<div class="alert alert-error">Review data is unavailable.</div>';
  } else if (stage === "final-review") {
    body = `<article class="rounded-box border border-base-300 bg-base-100 p-5"><h2 class="font-bold">Final project review</h2><p class="mt-2 text-sm text-base-content/60">Run independent whole-project verification, inspect the cumulative branch diff, then explicitly merge. Bees never pushes.</p>${git ? `<div class="mt-4 grid gap-3 md:grid-cols-3"><div class="stat rounded border border-base-300"><div class="stat-title">Source lines</div><div class="stat-value text-xl">+${git.additions} / -${git.deletions}</div></div><div class="stat rounded border border-base-300"><div class="stat-title">Commits</div><div class="stat-value text-xl">${git.commits.length}</div></div><div class="stat rounded border border-base-300"><div class="stat-title">Generated files</div><div class="stat-value text-xl">${git.generatedChanges}</div></div></div><details class="mt-4 rounded border border-base-300 p-3"><summary class="cursor-pointer font-semibold">Cumulative diff</summary><pre class="mt-3 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded bg-neutral p-3 text-xs text-neutral-content">${html(git.diff || "No textual diff")}</pre></details>` : ""}${state.finalReport ? `<div class="mt-4 alert ${state.finalReport.passed ? "alert-success" : "alert-error"}"><span>${html(state.finalReport.summary)}</span></div>${bullets(state.finalReport.failures)}` : ""}<div class="mt-4 flex justify-end gap-2"><button class="btn btn-outline" data-action="project-final-test" ${busy ? "disabled" : ""}>Run final verification</button><button class="btn btn-primary" data-action="project-finish" ${state.finalReport?.passed && !busy ? "" : "disabled"}>Merge and finish</button></div></article>`;
  } else if (stage === "done") {
    body = `<div class="hero min-h-72 rounded-box border border-success/30 bg-success/5"><div class="hero-content text-center"><div><div class="text-4xl">✓</div><h2 class="mt-3 text-xl font-bold">Project complete</h2><p class="mt-2 text-sm">The project branch was merged locally. Nothing was pushed.</p></div></div></div>`;
  } else {
    body = `<div class="alert alert-error"><div><div class="font-bold">This project is blocked</div><div class="text-sm">${html(state.testReport?.summary || "The coding and testing loop reached its retry limit.")}</div>${state.testReport ? bullets(state.testReport.failures) : ""}</div><button class="btn btn-sm" data-action="project-resume">Resume with another three attempts</button></div>`;
  }
  return `<div class="mb-4 flex flex-wrap gap-2">${progress}</div><div class="mb-5 rounded-box border border-base-300 bg-base-100 px-4 py-3"><div class="flex flex-wrap items-center justify-between gap-2"><div><div class="text-xs font-bold uppercase text-primary">Code Studio</div><h1 class="font-bold">${html(item.title)}</h1></div><div class="text-right text-xs text-base-content/55">${mapping ? `<div>${html(mapping.projectBranch)}</div><div class="max-w-96 truncate font-mono">${html(mapping.worktreePath)}</div>` : '<span class="badge badge-warning badge-sm">Waiting on you: choose a folder</span>'}</div></div></div>${body}${runHistory(runs)}`;
}
