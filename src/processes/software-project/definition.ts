import {
  ANTHROPIC_ARCHITECT_PROMPT,
  CODER_PROMPT,
  OPENAI_ARCHITECT_PROMPT,
  PLANNER_PROMPT,
  REQUIREMENTS_PROMPT,
  SOFTWARE_PROJECT_BOARD_NAME,
  SOFTWARE_PROJECT_DESCRIPTION,
  SOFTWARE_PROJECT_PROCESS_ID,
  SOFTWARE_PROJECT_PROCESS_NAME,
  SOFTWARE_PROJECT_ROLES,
  SOFTWARE_PROJECT_STAGES,
  TESTER_PROMPT
} from "./index.js";
import type { ProcessModule } from "../types.js";

export const softwareProjectProcess = {
  mode: "studio",
  legacyNames: ["Software Project"],
  legacyBoardNames: ["Software Projects"],
  definition: {
    id: SOFTWARE_PROJECT_PROCESS_ID,
    name: SOFTWARE_PROJECT_PROCESS_NAME,
    description: SOFTWARE_PROJECT_DESCRIPTION,
    boardName: SOFTWARE_PROJECT_BOARD_NAME,
    stages: SOFTWARE_PROJECT_STAGES,
    agents: [
      {
        role: SOFTWARE_PROJECT_ROLES.requirements,
        name: "Requirements interviewer",
        purpose: "Inspects the selected repository and turns one free-form brief into approvable requirements",
        stage: SOFTWARE_PROJECT_STAGES[0],
        prompt: REQUIREMENTS_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["software-requirements"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.openaiArchitect,
        name: "OpenAI architect",
        purpose: "Proposes and defends an independent project architecture",
        stage: SOFTWARE_PROJECT_STAGES[1],
        prompt: OPENAI_ARCHITECT_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["software-architecture"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.anthropicArchitect,
        name: "Anthropic architect",
        purpose: "Proposes and critiques an independent project architecture",
        stage: SOFTWARE_PROJECT_STAGES[1],
        prompt: ANTHROPIC_ARCHITECT_PROMPT,
        provider: "claude-cli",
        model: "default",
        skills: ["software-architecture"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.planner,
        name: "Implementation planner",
        purpose: "Breaks an approved architecture into small reviewable phases",
        stage: SOFTWARE_PROJECT_STAGES[2],
        prompt: PLANNER_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["software-planning"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.coder,
        name: "Coding agent",
        purpose: "Implements one approved phase directly in the project worktree",
        stage: SOFTWARE_PROJECT_STAGES[3],
        prompt: CODER_PROMPT,
        provider: "codex-cli",
        model: "default",
        skills: ["software-implementation"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.tester,
        name: "Testing agent",
        purpose: "Independently verifies each committed phase and the final project",
        stage: SOFTWARE_PROJECT_STAGES[3],
        prompt: TESTER_PROMPT,
        provider: "claude-cli",
        model: "default",
        skills: ["software-testing"]
      }
    ]
  }
} as const satisfies ProcessModule;
