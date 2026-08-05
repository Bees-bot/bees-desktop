import type {
  Agent,
  BeesRunInitialData,
  BeesRunSkill,
  Capability,
  McpConnection,
  SkillSnapshot
} from "./domain.js";
import { isCliProvider } from "./cli-tools.js";
import { modelRef } from "./local-models.js";

export const BEES_RUN_AGENT = "bees-run";
export const BROWSER_TOOL_REF = "builtin:browser";
export const BROWSER_WRITE_GRANT = "browser-write";

function skill(snapshot: SkillSnapshot): BeesRunSkill {
  return {
    name: snapshot.name,
    description: snapshot.description,
    instructions: snapshot.instructions,
    files: snapshot.files
  };
}

function browserEnabled(agent: Agent): boolean {
  return agent.config.toolRefs?.includes(BROWSER_TOOL_REF) ?? true;
}

function granted(agent: Agent, value: string): boolean {
  return agent.config.grants?.includes(value) ?? false;
}

function instructions(agent: Agent, browser: boolean): string {
  return [
    agent.config.prompt,
    agent.config.instructions,
    "Read task inputs from /workspace/inputs. Write every proposed output under /workspace/outputs.",
    browser
      ? "You can use the browser tools. If a site needs a login, call browser_wait_for_login so the user signs in themselves; never ask for or type a password."
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildBeesRunInitialData(input: {
  executionId: string;
  teamId: string;
  agent: Agent;
  capabilities: Capability[];
  skillSnapshots: SkillSnapshot[];
  mcpConnections: McpConnection[];
  delegates: Array<{ agent: Agent; skillRefs: string[] }>;
}): BeesRunInitialData {
  const snapshots = new Map(input.skillSnapshots.map((entry) => [entry.ref, entry]));
  const selectedSkills = input.capabilities
    .filter(({ kind }) => kind === "skill")
    .flatMap(({ ref }) => (snapshots.has(ref) ? [skill(snapshots.get(ref)!)] : []));
  const localToolRefs = input.capabilities
    .filter(({ kind }) => kind === "tool")
    .map(({ ref }) => ref);
  const browser = browserEnabled(input.agent);
  const model = modelRef(input.agent.config);
  const delegateNames = new Set<string>();
  return {
    version: 1,
    executionId: input.executionId,
    agentId: input.agent.id,
    agentName: input.agent.name,
    purpose: input.agent.purpose,
    model: isCliProvider(input.agent.config.provider) ? `${model}@${input.executionId}` : model,
    ...(input.agent.config.thinkingLevel
      ? { thinkingLevel: input.agent.config.thinkingLevel }
      : {}),
    instructions: instructions(input.agent, browser),
    teamId: input.teamId,
    browser,
    browserWrite: browser && granted(input.agent, BROWSER_WRITE_GRANT),
    localTools: localToolRefs.some((ref) => granted(input.agent, `local:${ref}`)),
    skills: selectedSkills,
    mcpConnections: input.mcpConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      url: connection.url,
      transport: connection.transport,
      secretRef: connection.secretRef,
      tools: connection.allowedTools.filter((name) => {
        const tool = connection.tools.find((candidate) => candidate.name === name);
        return tool?.readOnly || granted(input.agent, `mcp:${connection.id}`);
      }),
      optional: connection.optional
    })),
    delegates: input.delegates.map(({ agent, skillRefs }) => {
      const helperBrowser = browserEnabled(agent);
      const fallback = `helper_${agent.id.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const base = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || fallback;
      let name = base;
      for (let suffix = 2; delegateNames.has(name); suffix += 1) name = `${base}_${suffix}`;
      delegateNames.add(name);
      return {
        name,
        description: agent.purpose || agent.description || `Delegate to ${agent.name}`,
        instructions: instructions(agent, helperBrowser),
        ...(agent.config.provider && agent.config.model
          ? { model: modelRef(agent.config) }
          : {}),
        ...(agent.config.thinkingLevel ? { thinkingLevel: agent.config.thinkingLevel } : {}),
        browser: helperBrowser,
        browserWrite: helperBrowser && granted(agent, BROWSER_WRITE_GRANT),
        skills: skillRefs.flatMap((ref) =>
          snapshots.has(ref) ? [skill(snapshots.get(ref)!)] : []
        )
      };
    }),
    grants: [...(input.agent.config.grants ?? [])]
  };
}
