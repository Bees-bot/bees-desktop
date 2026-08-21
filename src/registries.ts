import type { AgentConfig, Capability, CapabilityKind, Registry } from "./domain.js";
import type { DshProjectPort } from "./dsh-project.js";
import { parseAgentPlugin } from "./plugins.js";

export function registryCapabilities(registries: Registry[]): Capability[] {
  return registries.flatMap((registry) => registry.plugin.skills.map((skill) => ({
    ref: `${registry.id}:${skill.path}`,
    registryId: registry.id,
    path: skill.path,
    name: skill.name,
    kind: "skill" as const,
    description: skill.description,
    instructions: skill.instructions
  })));
}

function selectedCapabilities(registries: Registry[], refs: string[]): Capability[] {
  const selected = new Set(refs);
  return registryCapabilities(registries).filter(({ ref }) => selected.has(ref));
}

export function capabilityRefsFor(config: AgentConfig, kind: CapabilityKind): string[] {
  return kind === "skill" ? (config.skillRefs ?? []) : (config.toolRefs ?? []);
}

export function selectedAgentCapabilities(registries: Registry[], config: AgentConfig): Capability[] {
  return selectedCapabilities(registries, [
    ...capabilityRefsFor(config, "skill"),
    ...capabilityRefsFor(config, "tool")
  ]);
}

export class RegistryFiles {
  constructor(private readonly port: DshProjectPort) {}

  async copy(registryId: string, sourcePath: string): Promise<Registry["plugin"]> {
    return parseAgentPlugin(await this.port.copyRegistry(registryId, sourcePath));
  }

  async copyBundled(registryId: string): Promise<Registry["plugin"]> {
    return parseAgentPlugin(await this.port.copyBundledRegistry(registryId));
  }

  remove(registryId: string): Promise<void> {
    return this.port.removeRegistry(registryId);
  }
}
