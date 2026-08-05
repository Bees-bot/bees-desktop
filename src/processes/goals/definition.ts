import {
  GOAL_PLANNER_PROMPT,
  GOAL_REVIEWER_PROMPT,
  GOAL_WORKER_PROMPT,
  GOALS_BOARD_NAME,
  GOALS_PROCESS_DESCRIPTION,
  GOALS_PROCESS_NAME,
  GOALS_STAGES
} from "./index.js";
import type { ProcessModule } from "../types.js";

export const goalsProcess = {
  mode: "data-driven",
  starter: true,
  autoStart: true,
  definition: {
    id: "goals",
    name: GOALS_PROCESS_NAME,
    description: GOALS_PROCESS_DESCRIPTION,
    boardName: GOALS_BOARD_NAME,
    stages: GOALS_STAGES,
    agents: [
      {
        role: "goal-planner",
        name: "Goal planner",
        purpose: "Breaks large goals into an approved task plan",
        stage: GOALS_STAGES[0],
        prompt: GOAL_PLANNER_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["bees-file-work"]
      },
      {
        role: "goal-worker",
        name: "Goal worker",
        purpose: "Executes one concrete task at a time",
        stage: GOALS_STAGES[1],
        prompt: GOAL_WORKER_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["bees-file-work"]
      },
      {
        role: "goal-reviewer",
        name: "Goal reviewer",
        purpose: "Checks completed work and closes or redirects it",
        stage: GOALS_STAGES[3],
        prompt: GOAL_REVIEWER_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["bees-file-work"]
      }
    ]
  }
} as const satisfies ProcessModule;
