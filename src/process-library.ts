import {
  GOAL_PLANNER_PROMPT,
  GOAL_REVIEWER_PROMPT,
  GOAL_WORKER_PROMPT,
  GOALS_BOARD_NAME,
  GOALS_PROCESS_DESCRIPTION,
  GOALS_PROCESS_NAME,
  GOALS_STAGES
} from "./goals.js";

export interface ProcessLibraryAgent {
  role: string;
  name: string;
  purpose: string;
  stage: string;
  prompt: string;
  provider: string;
  model: string;
  skills?: readonly string[];
}

export interface ProcessLibraryEntry {
  id: string;
  name: string;
  description: string;
  boardName: string;
  stages: readonly string[];
  agents: readonly ProcessLibraryAgent[];
}

/** Shipped with Bees Desktop, so browsing and installing never needs an organization connection. */
export const PROCESS_LIBRARY: readonly ProcessLibraryEntry[] = [
  {
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
];

export function processLibraryEntry(id: string): ProcessLibraryEntry | undefined {
  return PROCESS_LIBRARY.find((entry) => entry.id === id);
}
