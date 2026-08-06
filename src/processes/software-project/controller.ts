import type { Execution, Process, WorkItem, WorkItemStatus } from "../../domain.js";
import { FOLLOW_UP_LIMIT } from "../../domain.js";
import type { ProcessStudio } from "../types.js";
import { SoftwareProjectGit } from "./git.js";
import {
  DEBATE_CONCERN_BUDGET,
  MAX_DEBATE_ROUNDS,
  SOFTWARE_PROJECT_PROCESS_NAME,
  SOFTWARE_PROJECT_ROLES,
  SOFTWARE_PROJECT_STAGES,
  debateSettled,
  emptySoftwareProjectState,
  lastAssistantText,
  parseArchitectureProposal,
  parseDebateTurn,
  parseImplementationPlan,
  parseRequirementSpec,
  parseTestReport,
  routeSoftwareProject,
  softwareProjectStateKey,
  softwareProjectView,
  type DebateRound,
  type SoftwareProjectEvent,
  type SoftwareProjectStage,
  type SoftwareProjectState,
  type TestReport
} from "./index.js";

interface SoftwareProjectContext {
  item: WorkItem;
  process: Process;
  stage: string;
}

/** One agent turn. `executionId` reopens that conversation instead of starting a cold one. */
export interface ProcessAgentTurn {
  role: string;
  prompt: string;
  executionId?: string;
}

export interface SoftwareProjectHost {
  current(): SoftwareProjectContext | null;
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting<T>(key: string, value: T): Promise<void>;
  /** Turns passed together run concurrently, so only pass turns that cannot observe each other. */
  runAgentTurns(item: WorkItem, turns: ProcessAgentTurn[]): Promise<Execution[]>;
  moveWorkItem(itemId: string, stageId: string): Promise<void>;
  setWorkItemStatus(item: WorkItem, status: WorkItemStatus): Promise<void>;
  getWorkItem(itemId: string): Promise<WorkItem | null>;
  requireTeamRoot(): Promise<string>;
  chooseProjectFolder(): Promise<string | null>;
  confirm(title: string, message: string, button: string): Promise<boolean>;
  refresh(): Promise<void>;
  notify(message: string, kind: "success" | "error"): void;
}

export class SoftwareProjectController implements ProcessStudio {
  readonly git = new SoftwareProjectGit();

  constructor(private readonly host: SoftwareProjectHost) {}

  matches(processName: string): boolean {
    return processName === SOFTWARE_PROJECT_PROCESS_NAME;
  }

  async render(item: WorkItem, process: Process, runs: Execution[]): Promise<string> {
    const stage = process.stages.find(({ id }) => id === item.stageId)?.name;
    if (!SOFTWARE_PROJECT_STAGES.includes(stage as SoftwareProjectStage)) {
      throw new Error("The Software Project process definition has changed");
    }
    const state = await this.state(item.id);
    const mapping = await this.git.get(item.id);
    const snapshot =
      mapping && (stage === "Phase Review" || stage === "Final Review")
        ? await this.git.snapshot(item.id, state.phaseStartSha).catch(() => null)
        : null;
    return softwareProjectView({
      item,
      stage: stage as SoftwareProjectStage,
      state,
      runs,
      mapping,
      git: snapshot
    });
  }

  async handleAction(action: string, control: HTMLElement): Promise<boolean> {
    if (!action.startsWith("project-")) return false;
    if (action === "project-select-folder") {
      const { item } = this.current();
      const path = await this.host.chooseProjectFolder();
      if (!path) return true;
      const selection = await this.git.selectFolder(
        item.id,
        path,
        await this.host.requireTeamRoot()
      );
      const state = await this.state(item.id);
      state.projectKind = selection.projectKind;
      await this.save(item.id, state);
      await this.host.refresh();
      this.host.notify(
        selection.projectKind === "new"
          ? "New local Git project and isolated worktree created"
          : "Existing local Git project attached in an isolated worktree",
        "success"
      );
      return true;
    }
    if (action === "project-approve-requirements") {
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      if (!state.requirements) throw new Error("Create the requirements draft first");
      state.requirementsApprovedAt = new Date().toISOString();
      await this.save(item.id, state);
      await this.move(item, process, stage, "requirements-approved");
      await this.host.refresh();
      return true;
    }
    if (action === "project-start-architecture") {
      await this.startArchitectureDebate();
      return true;
    }
    if (action === "project-debate-architecture") {
      await this.runDebateRound();
      return true;
    }
    if (action === "project-synthesize-architecture") {
      await this.synthesizeArchitecture();
      return true;
    }
    if (action === "project-approve-architecture") {
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      if (!state.architecture?.decision) throw new Error("Synthesize the architecture first");
      state.architecture.approvedAt = new Date().toISOString();
      await this.save(item.id, state);
      await this.move(item, process, stage, "architecture-approved");
      await this.host.refresh();
      return true;
    }
    if (action === "project-generate-plan" || action === "project-regenerate-plan") {
      await this.generateImplementationPlan();
      return true;
    }
    if (action === "project-phase-up" || action === "project-phase-down") {
      const { item } = this.current();
      const state = await this.stateFromPlan(control);
      const index = Number(control.dataset.index);
      const destination = action === "project-phase-up" ? index - 1 : index + 1;
      if (Number.isInteger(index) && state.phases[index] && state.phases[destination]) {
        [state.phases[index], state.phases[destination]] = [
          state.phases[destination]!,
          state.phases[index]!
        ];
        await this.save(item.id, state);
        await this.host.refresh();
      }
      return true;
    }
    if (action === "project-phase-remove") {
      const { item } = this.current();
      const state = await this.stateFromPlan(control);
      if (state.phases.length <= 1) throw new Error("An implementation plan needs at least one phase");
      state.phases.splice(Number(control.dataset.index), 1);
      await this.save(item.id, state);
      await this.host.refresh();
      return true;
    }
    if (action === "project-phase-split") {
      const { item } = this.current();
      const state = await this.stateFromPlan(control);
      const index = Number(control.dataset.index);
      const phase = state.phases[index];
      if (!phase) return true;
      const idBase = `${phase.id}-part`;
      let suffix = 2;
      while (state.phases.some(({ id }) => id === `${idBase}-${suffix}`)) suffix += 1;
      const lines = Math.ceil(phase.estimatedChangedLines / 2);
      phase.estimatedChangedLines = Math.max(0, phase.estimatedChangedLines - lines);
      state.phases.splice(index + 1, 0, {
        ...phase,
        id: `${idBase}-${suffix}`,
        title: `${phase.title} — continued`,
        outcome: `Complete the remaining part of: ${phase.outcome}`,
        estimatedChangedLines: lines,
        dependsOn: [...new Set([...phase.dependsOn, phase.id])]
      });
      await this.save(item.id, state);
      await this.host.refresh();
      return true;
    }
    if (action === "project-phase-merge") {
      const { item } = this.current();
      const state = await this.stateFromPlan(control);
      const index = Number(control.dataset.index);
      const phase = state.phases[index];
      const next = state.phases[index + 1];
      if (!phase || !next) return true;
      state.phases[index] = {
        ...phase,
        title: `${phase.title} + ${next.title}`,
        outcome: `${phase.outcome} ${next.outcome}`,
        scope: [...new Set([...phase.scope, ...next.scope])],
        acceptanceCriteria: [...new Set([...phase.acceptanceCriteria, ...next.acceptanceCriteria])],
        estimatedChangedLines: phase.estimatedChangedLines + next.estimatedChangedLines,
        dependsOn: [...new Set([...phase.dependsOn, ...next.dependsOn])].filter(
          (id) => id !== phase.id
        ),
        tests: [...new Set([...phase.tests, ...next.tests])],
        risks: [...new Set([...phase.risks, ...next.risks])]
      };
      state.phases.splice(index + 1, 1);
      await this.save(item.id, state);
      await this.host.refresh();
      return true;
    }
    if (action === "project-approve-plan") {
      const { item, process, stage } = this.current();
      const state = await this.stateFromPlan(control);
      if (!state.phases.length) throw new Error("Generate the implementation plan first");
      const oversized = state.phases.filter(({ estimatedChangedLines }) => estimatedChangedLines > 1500);
      if (
        oversized.length &&
        !(await this.host.confirm(
          "Approve oversized phases?",
          `${oversized.length} phase(s) exceed the 1,500-line split threshold. This approval accepts them explicitly.`,
          "Approve anyway"
        ))
      ) {
        return true;
      }
      state.planApprovedAt = new Date().toISOString();
      state.currentPhaseIndex = 0;
      await this.save(item.id, state);
      await this.move(item, process, stage, "plan-approved");
      await this.host.refresh();
      return true;
    }
    if (action === "project-implement-phase") {
      await this.runPhaseLoop();
      return true;
    }
    if (action === "project-approve-phase") {
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      if (!state.testReport?.passed) throw new Error("Independent testing must pass before approval");
      const snapshot = await this.git.snapshot(item.id, state.phaseStartSha);
      if (snapshot.dirty) throw new Error("The project worktree has uncommitted changes");
      const changedLines = snapshot.additions + snapshot.deletions;
      if (
        changedLines > 1500 &&
        !(await this.host.confirm(
          "Approve a large phase?",
          `This phase changed ${changedLines} source lines. Approving records your explicit size exception.`,
          "Approve phase"
        ))
      ) {
        return true;
      }
      const hasMore = state.currentPhaseIndex + 1 < state.phases.length;
      if (hasMore) state.currentPhaseIndex += 1;
      delete state.phaseStartSha;
      state.attempts = 0;
      delete state.feedback;
      delete state.testReport;
      await this.save(item.id, state);
      await this.move(item, process, stage, "phase-approved", hasMore);
      await this.host.refresh();
      return true;
    }
    if (action === "project-final-test") {
      await this.runFinalProjectTest();
      return true;
    }
    if (action === "project-finish") {
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      if (!state.finalReport?.passed) throw new Error("Final verification must pass before merging");
      await this.git.merge(item.id);
      await this.move(item, process, stage, "final-tests-passed");
      const latest = (await this.host.getWorkItem(item.id)) ?? item;
      await this.host.setWorkItemStatus(latest, "done");
      await this.host.refresh();
      this.host.notify("Project branch merged locally; nothing was pushed", "success");
      return true;
    }
    if (action === "project-resume") {
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      state.attempts = 0;
      await this.save(item.id, state);
      await this.move(item, process, stage, "resume");
      await this.host.setWorkItemStatus(item, "open");
      await this.host.refresh();
      return true;
    }
    return false;
  }

  async handleSubmit(form: HTMLFormElement): Promise<boolean> {
    if (form.matches("form[data-project-requirements]")) {
      const answers = Object.fromEntries(
        [...new FormData(form).entries()].map(([key, value]) => [key, String(value).trim()])
      );
      await this.synthesizeRequirements(answers);
      return true;
    }
    if (form.matches("form[data-project-refine]")) {
      const message = String(new FormData(form).get("message") ?? "").trim();
      if (!message) throw new Error("Enter an answer or requested revision");
      await this.refineRequirements(message);
      return true;
    }
    if (form.matches("form[data-project-plan]")) {
      await this.savePlanForm(form);
      await this.host.refresh();
      this.host.notify("Implementation plan edits saved", "success");
      return true;
    }
    if (form.matches("form[data-project-architecture-chat]")) {
      const data = new FormData(form);
      const architect = String(data.get("architect")) === "anthropic" ? "anthropic" : "openai";
      const message = String(data.get("message") ?? "").trim();
      if (!message) throw new Error("Enter an architecture question or requested revision");
      await this.reviseArchitecture(architect, message);
      return true;
    }
    if (form.matches("form[data-project-review]")) {
      const feedback = String(new FormData(form).get("feedback") ?? "").trim();
      if (!feedback) throw new Error("Explain what the coding agent should change");
      const { item, process, stage } = this.current();
      const state = await this.state(item.id);
      state.feedback = feedback;
      state.attempts = 0;
      delete state.testReport;
      await this.save(item.id, state);
      await this.move(item, process, stage, "phase-changes-requested");
      await this.host.refresh();
      return true;
    }
    return false;
  }

  handlesSubmit(form: HTMLFormElement): boolean {
    return form.matches(
      "form[data-project-requirements], form[data-project-refine], form[data-project-plan], form[data-project-architecture-chat], form[data-project-review]"
    );
  }

  /** One turn, waited on. Every studio turn runs against the item's project worktree. */
  private async turn(
    item: WorkItem,
    role: string,
    prompt: string,
    executionId?: string
  ): Promise<Execution> {
    const [execution] = await this.host.runAgentTurns(item, [
      { role, prompt, ...(executionId ? { executionId } : {}) }
    ]);
    if (!execution) throw new Error(`The ${role} turn produced no receipt`);
    return execution;
  }

  private current(): { item: WorkItem; process: Process; stage: SoftwareProjectStage } {
    const current = this.host.current();
    if (
      !current ||
      !this.matches(current.process.name) ||
      !SOFTWARE_PROJECT_STAGES.includes(current.stage as SoftwareProjectStage)
    ) {
      throw new Error("Open a Software Project item first");
    }
    return { ...current, stage: current.stage as SoftwareProjectStage };
  }

  private async state(workItemId: string): Promise<SoftwareProjectState> {
    const state = await this.host.getSetting<SoftwareProjectState | null>(
      softwareProjectStateKey(workItemId),
      null
    );
    return state?.version === 1 ? state : emptySoftwareProjectState();
  }

  private save(workItemId: string, state: SoftwareProjectState): Promise<void> {
    return this.host.setSetting(softwareProjectStateKey(workItemId), state);
  }

  private async stateFromPlan(control: HTMLElement): Promise<SoftwareProjectState> {
    const form = control.closest<HTMLFormElement>("form[data-project-plan]");
    return form ? this.savePlanForm(form) : this.state(this.current().item.id);
  }

  private async savePlanForm(form: HTMLFormElement): Promise<SoftwareProjectState> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const data = new FormData(form);
    const ids = data.getAll("phaseId").map(String);
    const titles = data.getAll("phaseTitle").map(String);
    const outcomes = data.getAll("phaseOutcome").map(String);
    const acceptance = data.getAll("phaseAcceptance").map(String);
    const lines = data.getAll("phaseLines").map(Number);
    state.phases = ids.map((id, index) => {
      const existing = state.phases.find((phase) => phase.id === id);
      if (!existing) throw new Error(`Phase ${id} is unavailable`);
      const title = titles[index]?.trim();
      const outcome = outcomes[index]?.trim();
      const acceptanceCriteria = (acceptance[index] ?? "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!title || !outcome || !acceptanceCriteria.length) {
        throw new Error(`Phase ${index + 1} needs a title, outcome, and acceptance criteria`);
      }
      return {
        ...existing,
        title,
        outcome,
        acceptanceCriteria,
        estimatedChangedLines: Math.max(0, Math.round(lines[index] || 0))
      };
    });
    await this.save(item.id, state);
    return state;
  }

  private async move(
    item: WorkItem,
    process: Process,
    stage: SoftwareProjectStage,
    event: SoftwareProjectEvent,
    hasMorePhases = true
  ): Promise<SoftwareProjectStage> {
    const next = routeSoftwareProject(stage, event, hasMorePhases);
    const destination = process.stages.find(({ name }) => name === next);
    if (!destination) throw new Error(`The Software Project process is missing ${next}`);
    await this.host.moveWorkItem(item.id, destination.id);
    return next;
  }

  private projectContext(state: SoftwareProjectState): string {
    return JSON.stringify(
      {
        projectKind: state.projectKind,
        requirements: state.requirements,
        architecture: state.architecture?.decision,
        implementationPhases: state.phases,
        currentPhase: state.phases[state.currentPhaseIndex]
      },
      null,
      2
    );
  }

  private async synthesizeRequirements(
    answers: Record<string, string | string[]>
  ): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const mapping = await this.git.get(item.id);
    if (!mapping) throw new Error("Choose the local project folder first");
    state.answers = answers;
    await this.save(item.id, state);
    const execution = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.requirements,
      `Project kind: ${state.projectKind ?? "existing"}\n\nOriginal brief:\n${item.description}\n\nInline questionnaire answers:\n${JSON.stringify(answers, null, 2)}\n\nInspect the repository before producing the requirements.`
    );
    state.requirements = parseRequirementSpec(lastAssistantText(execution));
    state.lastExecutionId = execution.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  private async refineRequirements(message: string): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    if (!state.requirements) throw new Error("Create the requirements draft first");
    const execution = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.requirements,
      `Revise the requirements JSON using this user response:\n${message}\n\nCurrent requirements:\n${JSON.stringify(state.requirements, null, 2)}`
    );
    state.requirements = parseRequirementSpec(lastAssistantText(execution));
    state.lastExecutionId = execution.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  private async startArchitectureDebate(): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    if (!state.requirementsApprovedAt || !state.requirements) {
      throw new Error("Approve requirements before architecture begins");
    }
    const prompt = `Approved requirements:\n${JSON.stringify(state.requirements, null, 2)}\n\nInspect the repository, then produce your independent proposal.`;
    // Neither architect may see the other's opening position, so the two runs are independent
    // and hand over together.
    const [openai, anthropic] = await this.host.runAgentTurns(item, [
      { role: SOFTWARE_PROJECT_ROLES.openaiArchitect, prompt },
      { role: SOFTWARE_PROJECT_ROLES.anthropicArchitect, prompt }
    ]);
    if (!openai || !anthropic) throw new Error("An architect turn produced no receipt");
    state.architecture = {
      openai: parseArchitectureProposal(lastAssistantText(openai)),
      anthropic: parseArchitectureProposal(lastAssistantText(anthropic)),
      rounds: [],
      openaiExecutionId: openai.id,
      anthropicExecutionId: anthropic.id
    };
    state.lastExecutionId = anthropic.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  /**
   * One round of the bounded debate. Each architect reads the other's current proposal and the
   * transcript, then returns a critique *and* a revised proposal, so the two positions converge
   * in the artifact rather than only in the commentary. The concern budget shrinks each round and
   * reaches one on the last, which is what makes three rounds enough to hand the synthesizer a
   * short list instead of an open argument.
   *
   * Both sides answer the same fixed state, so the round's two turns run concurrently, each
   * continuing its own conversation from the previous round.
   */
  private async runDebateRound(): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const architecture = state.architecture;
    if (!architecture?.openai || !architecture.anthropic) {
      throw new Error("Generate both independent proposals first");
    }
    const rounds = architecture.rounds ?? [];
    if (debateSettled(rounds)) throw new Error("The architecture debate is already settled");
    const round = rounds.length + 1;
    const budget = DEBATE_CONCERN_BUDGET[round - 1] ?? 1;
    const last = round === MAX_DEBATE_ROUNDS;
    const instructions = `Debate round ${round} of ${MAX_DEBATE_ROUNDS}.

Argue only what changes cost, risk, or whether the approved requirements are met. Concede everything else in this round — style, naming, and preference-level choices are not worth a round. Name each concession in \`critique.strengths\` and adopt the other architect's choice in your revised proposal.

The debate ends after round ${MAX_DEBATE_ROUNDS}, when a synthesizer merges whatever is still open. Every round must therefore close more than it opens: raise at most ${budget} concern${budget === 1 ? "" : "s"}, ranked by impact, and drop any concern you raised earlier that the other architect has since answered.${
      last
        ? " This is the final round. Your revised proposal must be one you would accept as the merged decision, with any surviving disagreement reduced to a single explicitly stated trade-off."
        : ""
    }

Return exactly one JSON object, with no Markdown fence:
{"critique":{"summary":"...","strengths":["..."],"concerns":["..."],"recommendedChanges":["..."]},"proposal":{the full architecture proposal schema from your instructions},"resolved":false}

\`critique\` judges the other architect's current proposal. \`proposal\` is your complete revised proposal after absorbing everything you now accept. Set \`resolved\` to true when nothing material is left in dispute.`;
    // A continued conversation already holds the requirements, this architect's own proposal, and
    // every round it argued, so resending them only eats into the 20,000-character follow-up
    // budget. Carry the previous round's *open* items, which is what a rebuttal has to answer, and
    // let the concessions live in the revised proposals where they belong.
    const previous = rounds[rounds.length - 1];
    const open = previous
      ? `\n\nStill open from round ${rounds.length}:\n${JSON.stringify(
          {
            openai: {
              concerns: previous.openai.critique.concerns,
              recommendedChanges: previous.openai.critique.recommendedChanges
            },
            anthropic: {
              concerns: previous.anthropic.critique.concerns,
              recommendedChanges: previous.anthropic.critique.recommendedChanges
            }
          },
          null,
          2
        )}`
      : "";
    const turn = (
      role: string,
      other: string,
      otherProposal: unknown,
      own: unknown,
      executionId?: string
    ): ProcessAgentTurn => {
      const rebuttal = `${instructions}${open}\n\n${other} architect's current proposal:\n${JSON.stringify(otherProposal, null, 2)}`;
      // A big architecture can push even the trimmed rebuttal past the follow-up limit. Rather
      // than fail the round, fall back to a cold conversation, which carries no cap because it
      // resends the instructions and context the warm one was relying on.
      if (executionId && rebuttal.length <= FOLLOW_UP_LIMIT) return { role, prompt: rebuttal, executionId };
      return {
        role,
        prompt: `${instructions}\n\nApproved requirements:\n${JSON.stringify(state.requirements, null, 2)}${open}\n\n${other} architect's current proposal:\n${JSON.stringify(otherProposal, null, 2)}\n\nYour current proposal:\n${JSON.stringify(own, null, 2)}`
      };
    };
    const [openai, anthropic] = await this.host.runAgentTurns(item, [
      turn(
        SOFTWARE_PROJECT_ROLES.openaiArchitect,
        "Anthropic",
        architecture.anthropic,
        architecture.openai,
        architecture.openaiExecutionId
      ),
      turn(
        SOFTWARE_PROJECT_ROLES.anthropicArchitect,
        "OpenAI",
        architecture.openai,
        architecture.anthropic,
        architecture.anthropicExecutionId
      )
    ]);
    if (!openai || !anthropic) throw new Error("An architect turn produced no receipt");
    const turns: DebateRound = {
      openai: parseDebateTurn(lastAssistantText(openai)),
      anthropic: parseDebateTurn(lastAssistantText(anthropic))
    };
    architecture.rounds = [...rounds, turns];
    architecture.openai = turns.openai.proposal;
    architecture.anthropic = turns.anthropic.proposal;
    architecture.openaiCritique = turns.openai.critique;
    architecture.anthropicCritique = turns.anthropic.critique;
    architecture.openaiExecutionId = openai.id;
    architecture.anthropicExecutionId = anthropic.id;
    delete architecture.decision;
    state.lastExecutionId = anthropic.id;
    await this.save(item.id, state);
    await this.host.refresh();
    this.host.notify(
      debateSettled(architecture.rounds)
        ? "Architecture debate finished; synthesize the decision"
        : `Debate round ${round} of ${MAX_DEBATE_ROUNDS} complete`,
      "success"
    );
  }

  private async reviseArchitecture(
    architect: "openai" | "anthropic",
    message: string
  ): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const architecture = state.architecture;
    const current = architect === "openai" ? architecture?.openai : architecture?.anthropic;
    if (!architecture || !current) throw new Error("Generate both architecture proposals first");
    const role =
      architect === "openai"
        ? SOFTWARE_PROJECT_ROLES.openaiArchitect
        : SOFTWARE_PROJECT_ROLES.anthropicArchitect;
    const executionId =
      architect === "openai" ? architecture.openaiExecutionId : architecture.anthropicExecutionId;
    const execution = await this.turn(
      item,
      role,
      `The user challenged your proposal: ${message}\n\nReturn a complete revised proposal using the architecture JSON schema from your instructions.\n\nCurrent proposal:\n${JSON.stringify(current, null, 2)}`,
      executionId
    );
    architecture[architect] = parseArchitectureProposal(lastAssistantText(execution));
    // The rounds stay: they are the record of how the proposals got here, and a user nudge is not
    // grounds for spending the budget again. What does go is the merged decision and the other
    // architect's critique, which was written against the proposal this call just replaced.
    if (architect === "openai") {
      architecture.openaiExecutionId = execution.id;
      delete architecture.anthropicCritique;
    } else {
      architecture.anthropicExecutionId = execution.id;
      delete architecture.openaiCritique;
    }
    delete architecture.decision;
    state.lastExecutionId = execution.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  /**
   * Merges the debate into one decision. Deliberately a cold conversation: the transcript is in
   * the prompt, and an architect still warm from defending its own side is the wrong reader for it.
   */
  private async synthesizeArchitecture(): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const architecture = state.architecture;
    if (!architecture?.openai || !architecture.anthropic) {
      throw new Error("Generate both independent proposals first");
    }
    const rounds = architecture.rounds ?? [];
    if (!debateSettled(rounds)) {
      throw new Error(
        `Run the architecture debate first — ${rounds.length} of ${MAX_DEBATE_ROUNDS} rounds are done`
      );
    }
    const debate = {
      requirements: state.requirements,
      openaiProposal: architecture.openai,
      anthropicProposal: architecture.anthropic,
      rounds
    };
    const execution = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.openaiArchitect,
      `The two architects have finished a bounded ${MAX_DEBATE_ROUNDS}-round debate. Merge their final proposals into one decision. Return the architecture proposal JSON schema from your instructions.\n\nBoth final proposals are positions the architects said they could accept, so prefer the choices they converged on and change them only with a reason. For each point still disputed in the last round, pick the simpler option that meets the approved requirements and state in that decision's \`reason\` what was given up and why. Leave nothing unresolved.\n\nRequirements and debate:\n${JSON.stringify(debate, null, 2)}`
    );
    architecture.decision = parseArchitectureProposal(lastAssistantText(execution));
    state.lastExecutionId = execution.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  private async generateImplementationPlan(): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    if (!state.architecture?.approvedAt || !state.architecture.decision) {
      throw new Error("Approve the architecture before planning");
    }
    const execution = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.planner,
      `Approved requirements and architecture:\n${this.projectContext(state)}`
    );
    const draft = parseImplementationPlan(lastAssistantText(execution));
    const validation = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.anthropicArchitect,
      `Validate this implementation plan against the approved requirements and architecture. Fix missing coverage, bad dependencies, non-reviewable phases, and phases likely to exceed roughly 1,500 changed source lines. Return exactly one complete {"phases":[...]} object using the planning schema, with no other text.\n\nApproved context:\n${this.projectContext(state)}\n\nDraft plan:\n${JSON.stringify({ phases: draft }, null, 2)}`
    );
    state.phases = parseImplementationPlan(lastAssistantText(validation));
    state.currentPhaseIndex = 0;
    state.lastExecutionId = validation.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }

  private async runPhaseLoop(): Promise<void> {
    const { item, process, stage } = this.current();
    const state = await this.state(item.id);
    const phase = state.phases[state.currentPhaseIndex];
    if (!phase || !state.planApprovedAt) throw new Error("Approve a valid implementation plan first");
    if (!state.phaseStartSha) {
      const before = await this.git.snapshot(item.id);
      if (before.dirty) throw new Error("The project worktree must be clean before a phase starts");
      state.phaseStartSha = before.head;
      state.attempts = 0;
      await this.save(item.id, state);
    }
    let feedback = state.feedback ?? "";
    while (state.attempts < 3) {
      const beforeCoding = await this.git.snapshot(item.id);
      if (beforeCoding.dirty) {
        throw new Error("The project worktree must be clean before the coding agent can continue");
      }
      const coding = await this.turn(
        item,
        SOFTWARE_PROJECT_ROLES.coder,
        `Approved project context:\n${this.projectContext(state)}\n\nActive phase:\n${JSON.stringify(phase, null, 2)}${feedback ? `\n\nFix every item from the latest test or human review:\n${feedback}` : ""}`
      );
      const afterCoding = await this.git.snapshot(item.id);
      if (afterCoding.head !== beforeCoding.head) {
        throw new Error("The coding agent changed Git history; project agents must leave commits to Bees");
      }
      const commit = await this.git.commit(
        item.id,
        phase.id,
        coding.id,
        `${phase.id}: ${phase.title}`
      );
      const testing = await this.turn(
        item,
        SOFTWARE_PROJECT_ROLES.tester,
        `Verify commit ${commit} for this active phase. Do not edit files.\n\nApproved project context:\n${this.projectContext(state)}\n\nActive phase:\n${JSON.stringify(phase, null, 2)}`
      );
      const report = { ...parseTestReport(lastAssistantText(testing)), executionId: testing.id };
      const testerChangedFiles = (await this.git.snapshot(item.id)).dirty;
      if (testerChangedFiles) {
        report.passed = false;
        report.failures.push("The testing turn changed project files; testing must be read-only.");
      }
      state.attempts = testerChangedFiles ? 3 : state.attempts + 1;
      state.testReport = report;
      state.lastExecutionId = testing.id;
      state.feedback = report.failures.join("\n");
      await this.save(item.id, state);
      if (report.passed) {
        delete state.feedback;
        await this.save(item.id, state);
        await this.move(item, process, stage, "tests-passed");
        await this.host.refresh();
        return;
      }
      feedback = state.feedback;
    }
    const blocked = process.stages.find(({ name }) => name === "Blocked");
    if (!blocked) throw new Error("The Software Project process is missing Blocked");
    await this.host.moveWorkItem(item.id, blocked.id);
    await this.host.setWorkItemStatus(item, "blocked");
    await this.host.refresh();
  }

  private async runFinalProjectTest(): Promise<void> {
    const { item } = this.current();
    const state = await this.state(item.id);
    const before = await this.git.snapshot(item.id);
    if (before.dirty) throw new Error("The project worktree must be clean before final verification");
    const execution = await this.turn(
      item,
      SOFTWARE_PROJECT_ROLES.tester,
      `Run whole-project verification for the approved requirements, architecture, and all completed phases. Do not edit files.\n\n${this.projectContext(state)}`
    );
    const report: TestReport = {
      ...parseTestReport(lastAssistantText(execution)),
      executionId: execution.id
    };
    if ((await this.git.snapshot(item.id)).dirty) {
      report.passed = false;
      report.failures.push("The final testing turn changed project files; testing must be read-only.");
    }
    state.finalReport = report;
    state.lastExecutionId = execution.id;
    await this.save(item.id, state);
    await this.host.refresh();
  }
}
