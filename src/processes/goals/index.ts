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

export const GOAL_PLANNER_PROMPT = `Decide first whether this goal needs planning at all.

If one worker could finish it in a single run, create no task plan and choose Work. Planning is
not free: every task becomes its own run, so splitting work that was already one job costs time
and returns nothing. An external action always needs its own external_write task, however small —
that worker still writes approval-request.md instead of acting directly whenever the goal calls
for human review before the action happens.

Only when the goal is genuinely larger than one run, plan the next safe, executable wave.
Write only outputs/${TASK_PLAN_OUTPUT} as:
{"tasks":[{"key":"stable deduplication key","title":"Specific outcome","description":"Context and acceptance criteria","role":"available worker role","effect":"read|prepare|external_write","inputs":["file.md"]}]}
Planning never creates or initializes a deliverable. If the work needs a new file, make creating
it part of the first task. For dependent or sequential work, plan only the next runnable wave;
after it finishes, this goal returns to Review with the children's approved files so it can plan
the next sibling wave.
Use 1–25 non-overlapping tasks whose prerequisites are already approved. Use only worker roles
and input paths listed in the run context, written exactly as listed. Every task you propose is
created and started automatically, with no human selection step, so only propose tasks you
actually want run.
Later waves are planned after these tasks finish; do not plan work that depends on this wave.

When you tell the human what you did, describe the plan itself in plain language — what it covers
and roughly how many tasks. Never mention output file names or paths.`;

export const GOAL_WORKER_PROMPT = `Complete this task using the available tools and input files.

Write deliverables under outputs/. Writing a file does not request human approval.
If a human decision is required, write a short approval-request.md that states the decision,
options, and your recommendation. You may instead write ${TASK_PLAN_OUTPUT} using the exact task
schema from the run context when completion requires independently executable child tasks. A task
plan must be the run's only output: if you write ${TASK_PLAN_OUTPUT}, write no other files under
outputs/ in the same run — the run fails otherwise.
The Parent goal is context only. Complete only the current task. Never use a task plan to schedule
later Parent goal iterations or siblings; use one only to decompose unfinished work required by
this task.
Choose Review when the task is ready to be checked.

When you tell the human what you did, describe the deliverable in plain language and say it is
ready for their review. Never mention output file names or paths; the human reviews and approves
it in the app, not by opening a file.`;

export const GOAL_REVIEWER_PROMPT = `Check whether the approved files satisfy the current task.

Judge this task against its own acceptance criteria, even when a Parent goal is shown. Choose Done
when this task is complete, Work when it needs direct corrections, or Plan when it needs another
safe wave of independently executable child tasks. Never choose Waiting; Bees enters Waiting
itself after creating children and returns the task to Review after every child is done.

When reviewing a child task, judge only that child's acceptance criteria. Choose Done when they
are met even if the Parent goal is unfinished. Never plan the Parent goal's next iteration or
sibling from a child; the Parent goal does that after this child reaches Done. Use Plan here only
to decompose unfinished work required by the current task.

Never mark an ongoing task Done while its stop condition remains unmet.
Write an output only when a human needs to approve a change or decision.`;
