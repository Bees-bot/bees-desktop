import {
  GOAL_PLANNER_PROMPT,
  GOAL_REVIEWER_PROMPT,
  GOAL_WORKER_PROMPT,
  GOALS_BOARD_NAME,
  GOALS_PROCESS_DESCRIPTION,
  GOALS_PROCESS_NAME,
  GOALS_STAGES,
  TASK_PLAN_OUTPUT
} from "./index.js";
import type { ProcessModule } from "../types.js";
import { AUTO_BEST_MODEL, AUTO_PROVIDER } from "../../model-routing.js";

export const goalsProcess = {
  starter: true,
  autoStart: true,
  definition: {
    id: "goals",
    version: 1,
    name: GOALS_PROCESS_NAME,
    description: GOALS_PROCESS_DESCRIPTION,
    boardName: GOALS_BOARD_NAME,
    states: [
      { key: "plan", name: GOALS_STAGES[0] },
      { key: "work", name: GOALS_STAGES[1] },
      { key: "waiting", name: GOALS_STAGES[2] },
      { key: "review", name: GOALS_STAGES[3] },
      { key: "done", name: GOALS_STAGES[4], terminal: true }
    ],
    automation: "automatic",
    renderer: "default",
    capabilities: [
      {
        type: "task-plan",
        output: TASK_PLAN_OUTPUT,
        states: {
          plan: "plan",
          work: "work",
          waiting: "waiting",
          review: "review",
          done: "done"
        }
      }
    ],
    agents: [
      {
        role: "goal-planner",
        name: "Goal planner",
        purpose: "Breaks large goals into an approved task plan",
        state: "plan",
        prompt: GOAL_PLANNER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["bees-file-work"]
      },
      {
        role: "goal-worker",
        name: "Goal worker",
        purpose: "Executes one concrete task at a time",
        state: "work",
        prompt: GOAL_WORKER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["bees-file-work"]
      },
      {
        role: "goal-reviewer",
        name: "Goal reviewer",
        purpose: "Checks completed work and closes or redirects it",
        state: "review",
        prompt: GOAL_REVIEWER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["bees-file-work"]
      }
    ]
  }
} as const satisfies ProcessModule;
