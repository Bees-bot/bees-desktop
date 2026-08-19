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
  SOFTWARE_PROJECT_STATE_KEYS,
  SOFTWARE_PROJECT_STAGES,
  TESTER_PROMPT
} from "./index.js";
import type { ProcessModule } from "../types.js";
import {
  AUTO_ALTERNATIVE_MODEL,
  AUTO_BEST_MODEL,
  AUTO_PROVIDER
} from "../../model-routing.js";

export const softwareProjectProcess = {
  definition: {
    id: SOFTWARE_PROJECT_PROCESS_ID,
    version: 2,
    name: SOFTWARE_PROJECT_PROCESS_NAME,
    description: SOFTWARE_PROJECT_DESCRIPTION,
    boardName: SOFTWARE_PROJECT_BOARD_NAME,
    states: [
      { key: SOFTWARE_PROJECT_STATE_KEYS[0], name: SOFTWARE_PROJECT_STAGES[0] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[1], name: SOFTWARE_PROJECT_STAGES[1] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[2], name: SOFTWARE_PROJECT_STAGES[2] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[3], name: SOFTWARE_PROJECT_STAGES[3] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[4], name: SOFTWARE_PROJECT_STAGES[4] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[5], name: SOFTWARE_PROJECT_STAGES[5] },
      { key: SOFTWARE_PROJECT_STATE_KEYS[6], name: SOFTWARE_PROJECT_STAGES[6], terminal: true }
    ],
    automation: "interactive",
    renderer: "software-project",
    capabilities: [{ type: "project-workspace" }],
    agents: [
      {
        role: SOFTWARE_PROJECT_ROLES.requirements,
        name: "Requirements interviewer",
        purpose: "Inspects the selected repository and turns one free-form brief into approvable requirements",
        state: "requirements",
        prompt: REQUIREMENTS_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["software-requirements"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.openaiArchitect,
        name: "OpenAI architect",
        purpose: "Proposes and defends an independent project architecture",
        state: "architecture",
        prompt: OPENAI_ARCHITECT_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["software-architecture", "ponytail"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.anthropicArchitect,
        name: "Anthropic architect",
        purpose: "Proposes and critiques an independent project architecture",
        state: "architecture",
        prompt: ANTHROPIC_ARCHITECT_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_ALTERNATIVE_MODEL,
        skills: ["software-architecture", "ponytail"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.planner,
        name: "Implementation planner",
        purpose: "Breaks an approved architecture into small reviewable phases",
        state: "plan",
        prompt: PLANNER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["software-planning", "ponytail"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.coder,
        name: "Coding agent",
        purpose: "Implements one approved phase directly in the project worktree",
        state: "implement",
        prompt: CODER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["software-implementation", "ponytail"]
      },
      {
        role: SOFTWARE_PROJECT_ROLES.tester,
        name: "Testing agent",
        purpose: "Independently verifies each committed phase and the final project",
        state: "implement",
        prompt: TESTER_PROMPT,
        provider: AUTO_PROVIDER,
        model: AUTO_BEST_MODEL,
        skills: ["software-testing", "ponytail"]
      }
    ]
  }
} as const satisfies ProcessModule;
