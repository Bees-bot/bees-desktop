import { requiredText } from "../../domain.js";

export const GOALS_PROCESS_NAME = "Goals";
export const GOALS_PROCESS_DESCRIPTION =
  "Turn any goal into approved, executable tasks and keep working until it is complete.";
export const GOALS_BOARD_NAME = "Goals";
export const GOALS_STAGES = ["Plan", "Work", "Waiting", "Review", "Done"] as const;
export const TASK_PLAN_OUTPUT = ".tasks.json";

export interface PlannedTask {
  title: string;
  description: string;
}

/**
 * The planner's only privileged output. It is reviewed like a file, but approval creates linked
 * work items instead of copying the JSON into the team folder.
 */
export function parseTaskPlan(value: string): PlannedTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The proposed task plan is not valid JSON");
  }
  const values =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { tasks?: unknown }).tasks
      : parsed;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('A task plan must contain a non-empty "tasks" list');
  }
  if (values.length > 25) throw new Error("A task plan can contain at most 25 tasks");
  return values.map((entry, index) => {
    if (typeof entry === "string") {
      return { title: requiredText(entry, `Task ${index + 1} title`, 180), description: "" };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Task ${index + 1} must be text or an object`);
    }
    const task = entry as { title?: unknown; description?: unknown };
    const description = typeof task.description === "string" ? task.description.trim() : "";
    if (description.length > 2_000) {
      throw new Error(`Task ${index + 1} description must be 2000 characters or fewer`);
    }
    return {
      title: requiredText(task.title, `Task ${index + 1} title`, 180),
      description
    };
  });
}

/**
 * Small local models sometimes return the requested control value as their final text instead of
 * calling a file tool. Recover only the planner's two exact, privileged outputs.
 */
export function recoverGoalPlannerOutput(
  output: unknown
): { statusName?: string; taskPlan?: string } | null {
  const text =
    typeof output === "string"
      ? output
      : output && typeof output === "object" && typeof (output as { text?: unknown }).text === "string"
        ? (output as { text: string }).text
        : "";
  const trimmed = text.trim();
  const candidate = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
  if (candidate.toLowerCase() === GOALS_STAGES[1].toLowerCase()) {
    return { statusName: GOALS_STAGES[1] };
  }
  if (candidate.startsWith("{") || candidate.startsWith("[")) {
    return { taskPlan: `${JSON.stringify({ tasks: parseTaskPlan(candidate) }, null, 2)}\n` };
  }
  const numberedLines = candidate.match(/^[ \t]*\d+[.)][ \t]+.+$/gm) ?? [];
  const matches = [
    ...candidate.matchAll(/^[ \t]*(\d+)[.)][ \t]+\*\*(.+?):\*\*[ \t]+(.+)$/gm)
  ];
  if (
    matches.length < 2 ||
    matches.length !== numberedLines.length ||
    matches.some((match, index) => Number(match[1]) !== index + 1)
  ) {
    return null;
  }
  const tasks = matches.map((match) => ({ title: match[2], description: match[3] }));
  return {
    taskPlan: `${JSON.stringify({ tasks: parseTaskPlan(JSON.stringify(tasks)) }, null, 2)}\n`
  };
}

export function validateGoalRun(
  currentStage: string,
  outputs: string[],
  statusName: string,
  stages: readonly string[]
): void {
  const stage = currentStage.trim().toLowerCase();
  const taskPlan = outputs.includes(TASK_PLAN_OUTPUT);
  if (taskPlan) {
    if (stage !== GOALS_STAGES[0].toLowerCase()) {
      throw new Error("Only the Plan status can propose subtasks");
    }
    return;
  }
  const target = stages.find(
    (name) => name.trim().toLowerCase() === statusName.trim().toLowerCase()
  );
  if (stage === GOALS_STAGES[0].toLowerCase()) {
    if (outputs.length || target?.trim().toLowerCase() !== GOALS_STAGES[1].toLowerCase()) {
      throw new Error(`Goal planner must choose Work or write ${TASK_PLAN_OUTPUT} for approval`);
    }
    return;
  }
  if (!target) {
    throw new Error(`Goal run must choose one of: ${stages.join(", ")}`);
  }
  if (target.trim().toLowerCase() === GOALS_STAGES[2].toLowerCase()) {
    throw new Error("Waiting is reserved for goals with approved subtasks");
  }
}

export const GOAL_PLANNER_PROMPT = `Decide whether this goal is already one concrete task.

If it is small enough for one agent to execute, create no task plan and choose the Work status.

If it needs multiple independently completable tasks, write only outputs/${TASK_PLAN_OUTPUT} as:
{"tasks":[{"title":"Specific outcome","description":"Context and acceptance criteria"}]}
Use 2–25 non-overlapping tasks that together finish the goal. Do not create coordination,
review, or planning tasks. The human will approve or reject this plan before tasks are created.`;

export const GOAL_WORKER_PROMPT = `Complete this task using the available tools and input files.

Write proposed deliverables under outputs/ so a human can approve consequential changes.
If a human decision is required, write a short approval-request.md that states the decision,
options, and your recommendation. Choose Review when the task is ready to be checked; choose
Plan only when the task genuinely needs decomposition.`;

export const GOAL_REVIEWER_PROMPT = `Check whether the work and approved files satisfy the task description and its parent goal.

Choose Done only when the task is complete. Choose Work when concrete corrections remain, or
Plan when it must be decomposed. Write an output only when a human needs to approve a change or
decision; otherwise finish without creating a file.`;
