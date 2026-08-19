// Agents live as JSON files in <teamRoot>/agents rather than rows in the local
// database. The team folder is already shared (Dropbox, iCloud, git), so agents
// distribute with it and never touch the coordination API — one channel, not two.

import { invoke } from "@tauri-apps/api/core";
import { stringify } from "yaml";
import { createId, now, requiredText, type Agent, type AgentConfig } from "./domain.js";
import { AUTO_BEST_MODEL, AUTO_PROVIDER } from "./model-routing.js";
import type { ProcessLibraryAgent } from "./processes/registry.js";

export interface AgentFilePort {
  list(teamRoot: string): Promise<string[]>;
  write(teamRoot: string, agentId: string, contents: string): Promise<void>;
  remove(teamRoot: string, agentId: string): Promise<void>;
  /** Writes a skill inside <teamRoot>/plugins/team-skills and returns its team-relative path. */
  writeSkill(teamRoot: string, slug: string, contents: string): Promise<string>;
  /** Moves a team-plugin skill under skills/.archive, recoverable by moving it back. */
  archiveSkill(teamRoot: string, slug: string): Promise<string>;
}

export class TauriAgentFilePort implements AgentFilePort {
  list(teamRoot: string): Promise<string[]> {
    return invoke("list_agent_files", { teamRoot });
  }

  write(teamRoot: string, agentId: string, contents: string): Promise<void> {
    return invoke("write_agent_file", { teamRoot, agentId, contents });
  }

  remove(teamRoot: string, agentId: string): Promise<void> {
    return invoke("delete_agent_file", { teamRoot, agentId });
  }

  writeSkill(teamRoot: string, slug: string, contents: string): Promise<string> {
    return invoke("write_team_skill", { teamRoot, slug, contents });
  }

  archiveSkill(teamRoot: string, slug: string): Promise<string> {
    return invoke("archive_team_skill", { teamRoot, slug });
  }
}

/** Slug for a skill folder: what `write_team_skill` accepts, derived from a display name. */
export function skillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("Skill name must contain letters or numbers");
  return slug;
}

/** A SKILL.md the runtime will accept: frontmatter Flue reads, then the procedure itself. */
export function skillFile(name: string, description: string, body: string): string {
  return `---\n${stringify({
    name: skillSlug(name),
    description: description.replace(/\n/g, " ").trim()
  }).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function parseAgent(contents: string): Agent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(contents) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const config =
    raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
      ? ({ ...(raw.config as AgentConfig) } as AgentConfig)
      : ({ prompt: "" } as AgentConfig);
  config.prompt = typeof config.prompt === "string" ? config.prompt : "";
  const lists = [
    "skillRefs",
    "toolRefs",
    "mcpConnectionRefs",
    "delegateRefs",
    "grants",
    "validationRules"
  ] as const;
  for (const key of lists) {
    const value = config[key];
    if (Array.isArray(value)) config[key] = [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
    else delete config[key];
  }
  if (config.mcpToolRefs && typeof config.mcpToolRefs === "object" && !Array.isArray(config.mcpToolRefs)) {
    config.mcpToolRefs = Object.fromEntries(
      Object.entries(config.mcpToolRefs).flatMap(([id, tools]) =>
        Array.isArray(tools)
          ? [[id, [...new Set(tools.filter((tool): tool is string => typeof tool === "string"))]]]
          : []
      )
    );
  } else {
    delete config.mcpToolRefs;
  }
  return {
    id: raw.id,
    name: raw.name,
    purpose: typeof raw.purpose === "string" ? raw.purpose : "",
    description: typeof raw.description === "string" ? raw.description : "",
    triggerStageId: typeof raw.triggerStageId === "string" ? raw.triggerStageId : null,
    config,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ""
  };
}

export class AgentFileStore {
  constructor(private readonly port: AgentFilePort) {}

  /**
   * Unreadable files are skipped rather than thrown on: a cloud sync can leave a
   * half-written or conflicted file in the folder, and one bad file must not take
   * the whole library down. Duplicate ids (conflict copies) collapse to the newest.
   */
  async list(teamRoot: string): Promise<Agent[]> {
    const parsed = (await this.port.list(teamRoot))
      .map(parseAgent)
      .filter((agent): agent is Agent => agent !== null);
    const byId = new Map<string, Agent>();
    for (const agent of parsed) {
      const existing = byId.get(agent.id);
      if (!existing || agent.updatedAt > existing.updatedAt) byId.set(agent.id, agent);
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async save(teamRoot: string, agent: Agent, draft = false): Promise<Agent> {
    const prompt = agent.config.prompt.trim();
    if (!draft && !prompt) throw new Error("Agent instructions are required");
    const saved: Agent = {
      ...agent,
      name: requiredText(agent.name, "Agent name", 120),
      purpose: requiredText(agent.purpose, "Agent purpose", 240),
      description: agent.description.trim(),
      config: { ...agent.config, prompt },
      updatedAt: now()
    };
    await this.port.write(teamRoot, saved.id, JSON.stringify(saved, null, 2));
    return saved;
  }

  async remove(teamRoot: string, agentId: string): Promise<void> {
    await this.port.remove(teamRoot, agentId);
  }

  saveSkill(teamRoot: string, name: string, description: string, body: string): Promise<string> {
    return this.port.writeSkill(
      teamRoot,
      skillSlug(name),
      skillFile(name, requiredText(description, "Skill description", 240), body)
    );
  }

  archiveSkill(teamRoot: string, slug: string): Promise<string> {
    return this.port.archiveSkill(teamRoot, slug);
  }
}

/**
 * First pair of agents that would start on one status, or null. Editing several agents at once
 * has to be judged as a set: checked one at a time, swapping two agents' statuses looks like a
 * conflict with the state being replaced. Statuses of a studio process dispatch by role instead,
 * so their assignments come in `exempt`.
 */
export function firstTriggerConflict(
  assignments: readonly { name: string; triggerStageId: string | null; exempt?: boolean }[]
): { first: string; second: string; triggerStageId: string } | null {
  const taken = new Map<string, string>();
  for (const { name, triggerStageId, exempt } of assignments) {
    if (!triggerStageId || exempt) continue;
    const first = taken.get(triggerStageId);
    if (first) return { first, second: name, triggerStageId };
    taken.set(triggerStageId, name);
  }
  return null;
}

/** Always mints a fresh id, so Duplicate is `newAgent({ ...agent, name })`. */
export function newAgent(input: Partial<Agent> = {}): Agent {
  return {
    name: "",
    purpose: "",
    description: "",
    triggerStageId: null,
    ...input,
    config: {
      prompt: "",
      provider: AUTO_PROVIDER,
      model: AUTO_BEST_MODEL,
      ...input.config
    },
    id: createId(),
    updatedAt: now()
  };
}

/** The agent a Process Library definition installs onto one status of a team's process.
 *
 * No toolRefs or grants key. An empty list would mean this agent has no tools, and both
 * run-config and the agent form read an absent list as "browser on". */
export function libraryAgent(
  definition: ProcessLibraryAgent,
  triggerStageId: string,
  skills: { ref: string; name: string }[]
): Agent {
  return newAgent({
    name: definition.name,
    purpose: definition.purpose,
    triggerStageId,
    config: {
      role: definition.role,
      prompt: definition.prompt,
      provider: definition.provider,
      model: definition.model,
      skillRefs: skills
        .filter(({ name }) => definition.skills?.includes(name))
        .map(({ ref }) => ref)
    }
  });
}
