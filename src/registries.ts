import type { AgentConfig, Capability, CapabilityKind, Registry } from "./domain.js";
import type { FlueProjectPort } from "./flue-project.js";

function capabilityKind(path: string): CapabilityKind | null {
  const normalized = `/${path.toLowerCase().replaceAll("\\", "/")}`;
  // Dot folders are the copy's own business, not the team's: `.archive` holds retired skills,
  // and a registry copied from a working folder brings `.git` along with it.
  if (normalized.includes("/.")) return null;
  if (normalized.endsWith("/skill.md")) return "skill";
  if (
    (normalized.includes("/tools/") || normalized.includes("/actions/")) &&
    /\.(?:mjs|js|ts)$/.test(normalized)
  ) {
    return "tool";
  }
  return null;
}

export function registryCapabilities(registries: Registry[]): Capability[] {
  return registries.flatMap((registry) =>
    registry.files.flatMap((path) => {
      const kind = capabilityKind(path);
      if (!kind) return [];
      const segments = path.replaceAll("\\", "/").split("/");
      const fallback = segments.at(-2) ?? segments.at(-1) ?? path;
      const name = kind === "skill" ? fallback : (segments.at(-1) ?? path).replace(/\.[^.]+$/, "");
      return [
        {
          ref: `${registry.id}:${path}`,
          registryId: registry.id,
          path,
          name,
          kind
        }
      ];
    })
  );
}

export function selectedCapabilities(registries: Registry[], refs: string[]): Capability[] {
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
  constructor(private readonly port: FlueProjectPort) {}

  copy(registryId: string, sourcePath: string): Promise<string[]> {
    return this.port.copyRegistry(registryId, sourcePath);
  }

  copyBundled(registryId: string): Promise<string[]> {
    return this.port.copyBundledRegistry(registryId);
  }

  inventory(registryId: string): Promise<string[]> {
    return this.port.inventoryRegistry(registryId);
  }

  remove(registryId: string): Promise<void> {
    return this.port.removeRegistry(registryId);
  }
}
