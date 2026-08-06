import {
  logicalFileReferences,
  requiredText,
  type GoalTaskEffect
} from "../../domain.js";

export const GOALS_PROCESS_NAME = "Goals";
export const GOALS_PROCESS_DESCRIPTION =
  "Turn any goal into approved, executable tasks and keep working until it is complete.";
export const GOALS_BOARD_NAME = "Goals";
export const GOALS_STAGES = ["Plan", "Work", "Waiting", "Review", "Done"] as const;
export const TASK_PLAN_OUTPUT = ".tasks.json";
export const ACTION_RECEIPT_OUTPUT = "action-receipt.json";

export interface PlannedTask {
  key: string;
  title: string;
  description: string;
  role: string;
  effect: GoalTaskEffect;
  inputs: string[];
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
  const tasks = values.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Task ${index + 1} must be an object`);
    }
    const task = entry as Record<string, unknown>;
    const accepted = new Set(["key", "title", "description", "role", "effect", "inputs"]);
    const extra = Object.keys(task).find((key) => !accepted.has(key));
    if (extra) throw new Error(`Task ${index + 1} field "${extra}" is not supported`);
    const description = requiredText(task.description, `Task ${index + 1} description`, 2_000);
    if (!Array.isArray(task.inputs) || task.inputs.length > 100) {
      throw new Error(`Task ${index + 1} inputs must be a list of at most 100 files`);
    }
    const effect = requiredText(task.effect, `Task ${index + 1} effect`, 30);
    if (!(["read", "prepare", "external_write"] as string[]).includes(effect)) {
      throw new Error(`Task ${index + 1} effect must be read, prepare, or external_write`);
    }
    return {
      key: requiredText(task.key, `Task ${index + 1} key`, 500),
      title: requiredText(task.title, `Task ${index + 1} title`, 180),
      description,
      role: requiredText(task.role, `Task ${index + 1} role`, 120),
      effect: effect as GoalTaskEffect,
      inputs: logicalFileReferences(task.inputs)
    };
  });
  if (new Set(tasks.map(({ key }) => key)).size !== tasks.length) {
    throw new Error("Task keys must be unique within a plan");
  }
  return tasks;
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
  return null;
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
    if (outputs.length !== 1) {
      throw new Error(`${TASK_PLAN_OUTPUT} must be the run's only reviewable output`);
    }
    if (stage === GOALS_STAGES[2].toLowerCase() || stage === GOALS_STAGES[4].toLowerCase()) {
      throw new Error("Waiting and Done cannot propose tasks");
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

export const GOAL_PLANNER_PROMPT = `Decide first whether this goal needs planning at all.

If one worker could finish it in a single run, create no task plan and choose Work. Planning is
not free: every task becomes its own run and its own thing for a human to approve, so splitting
work that was already one job costs time and attention and returns nothing. The one exception is
an external action, which always needs its own approved external_write task, however small.

Only when the goal is genuinely larger than one run, plan the next safe, executable wave.
Write only outputs/${TASK_PLAN_OUTPUT} as:
{"tasks":[{"key":"stable deduplication key","title":"Specific outcome","description":"Context and acceptance criteria","role":"available worker role","effect":"read|prepare|external_write","inputs":["approved/file.md"]}]}
Use 1–25 non-overlapping tasks whose prerequisites are already approved. Use only worker roles
and input paths listed in the run context. The human selects and may edit tasks before creation.
Later waves are planned after these tasks finish; do not plan work that depends on this wave.`;

export const GOAL_WORKER_PROMPT = `Complete this task using the available tools and input files.

Write proposed deliverables under outputs/ so a human can approve consequential changes.
If a human decision is required, write a short approval-request.md that states the decision,
options, and your recommendation. You may instead write ${TASK_PLAN_OUTPUT} using the exact task
schema from the run context when completion requires independently executable child tasks.
Choose Review when the task is ready to be checked.`;

export const GOAL_REVIEWER_PROMPT = `Check whether the completed wave and approved files satisfy the task and its parent goal.

Choose Done only when the task is complete. Choose Work when concrete corrections remain, or
Plan when another safe wave is required. Never mark an ongoing campaign Done while its stop
condition remains unmet. Write an output only when a human needs to approve a change or decision.`;
