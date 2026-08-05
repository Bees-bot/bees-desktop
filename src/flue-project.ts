import { invoke } from "@tauri-apps/api/core";
import type { Capability, SkillSnapshot } from "./domain.js";
import { BEES_RUN_AGENT } from "./run-config.js";

export interface FlueProjectPort {
  bindWorkspace(
    executionId: string,
    workspace: string,
    teamRoot?: string,
    capabilities?: Capability[],
    grantedCapabilityRefs?: string[],
    projectWorkItemId?: string
  ): Promise<SkillSnapshot[]>;
  purgeExecution(executionId: string): Promise<void>;
  restart(): Promise<void>;
  copyRegistry(registryId: string, sourcePath: string): Promise<string[]>;
  copyBundledRegistry(registryId: string): Promise<string[]>;
  inventoryRegistry(registryId: string): Promise<string[]>;
  removeRegistry(registryId: string): Promise<void>;
}

export class TauriFlueProjectPort implements FlueProjectPort {
  bindWorkspace(
    executionId: string,
    workspace: string,
    teamRoot?: string,
    capabilities?: Capability[],
    grantedCapabilityRefs?: string[],
    projectWorkItemId?: string
  ): Promise<SkillSnapshot[]> {
    return invoke("bind_flue_workspace", {
      executionId,
      workspace,
      teamRoot,
      capabilities,
      grantedCapabilityRefs,
      projectWorkItemId
    });
  }

  purgeExecution(executionId: string): Promise<void> {
    return invoke("purge_flue_execution_state", { executionId });
  }

  restart(): Promise<void> {
    return invoke("restart_flue_runtime");
  }

  copyRegistry(registryId: string, sourcePath: string): Promise<string[]> {
    return invoke("copy_registry", { registryId, sourcePath });
  }

  copyBundledRegistry(registryId: string): Promise<string[]> {
    return invoke("copy_bundled_registry", { registryId });
  }

  inventoryRegistry(registryId: string): Promise<string[]> {
    return invoke("inventory_registry", { registryId });
  }

  removeRegistry(registryId: string): Promise<void> {
    return invoke("remove_registry", { registryId });
  }
}

/** Every ordinary Bee is one immutable instance of the same stable Flue agent. */
export function runtimeAgentName(_agentId: string): string {
  return BEES_RUN_AGENT;
}

export class FlueProjectService {
  constructor(private readonly port: FlueProjectPort) {}

  bindWorkspace(
    executionId: string,
    workspace: string,
    teamRoot?: string,
    capabilities?: Capability[],
    grantedCapabilityRefs?: string[],
    projectWorkItemId?: string
  ): Promise<SkillSnapshot[]> {
    return this.port.bindWorkspace(
      executionId,
      workspace,
      teamRoot,
      capabilities,
      grantedCapabilityRefs,
      projectWorkItemId
    );
  }
}
