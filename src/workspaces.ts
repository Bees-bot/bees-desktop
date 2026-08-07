import { invoke } from "@tauri-apps/api/core";
import {
  logicalFileReferences,
  logicalPath,
  logicalPaths,
  parseLogicalFileReference,
  type FileLocation
} from "./domain.js";

export interface WorkspaceNativePort {
  validateDirectory(path: string): Promise<string>;
  defaultRoot(): Promise<string>;
  ensureDirectory(path: string): Promise<string>;
  create(executionId: string): Promise<string>;
  projectWorkspace(workItemId: string): Promise<string>;
  copyInputs(
    teamRoot: string,
    workspaceRoot: string,
    paths: string[],
    destinationPrefix?: string,
    projectWorkItemId?: string
  ): Promise<string[]>;
  writeOutput(workspaceRoot: string, output: string, contents: string): Promise<string>;
  collectOutputs(workspaceRoot: string): Promise<string[]>;
  preview(
    workspaceRoot: string,
    output: string,
    teamRoot: string,
    destination: string
  ): Promise<OutputPreview>;
  publish(
    workspaceRoot: string,
    output: string,
    teamRoot: string,
    destination: string
  ): Promise<string>;
  cleanup(workspaceRoot: string): Promise<void>;
}

/**
 * Where a run says which status it chose. It lives under outputs/ because that is the
 * one channel the sandbox can already write to, and is filtered out of the reviewable
 * outputs so it never shows up as a document to approve.
 */
export const STATUS_OUTPUT = ".status";

/** Where a Software Project run finds its approved inputs, relative to the worktree root. */
export const PROJECT_INPUT_PREFIX = ".bees/inputs";

export interface OutputPreview {
  before: string | null;
  after: string | null;
  truncated: boolean;
}

export class TauriWorkspacePort implements WorkspaceNativePort {
  validateDirectory(path: string): Promise<string> {
    return invoke("validate_directory", { path });
  }

  defaultRoot(): Promise<string> {
    return invoke("default_workspace_root");
  }

  ensureDirectory(path: string): Promise<string> {
    return invoke("ensure_directory", { path });
  }

  create(executionId: string): Promise<string> {
    return invoke("create_workspace", { executionId });
  }

  projectWorkspace(workItemId: string): Promise<string> {
    return invoke("software_project_workspace", { workItemId });
  }

  copyInputs(
    teamRoot: string,
    workspaceRoot: string,
    logicalPaths: string[],
    destinationPrefix = "",
    projectWorkItemId?: string
  ): Promise<string[]> {
    return invoke("copy_input_files", {
      teamRoot,
      workspaceRoot,
      logicalPaths,
      destinationPrefix,
      projectWorkItemId
    });
  }

  writeOutput(workspaceRoot: string, output: string, contents: string): Promise<string> {
    return invoke("write_workspace_output", { workspaceRoot, output, contents });
  }

  collectOutputs(workspaceRoot: string): Promise<string[]> {
    return invoke("collect_outputs", { workspaceRoot });
  }

  preview(
    workspaceRoot: string,
    relativeOutput: string,
    teamRoot: string,
    logicalDestination: string
  ): Promise<OutputPreview> {
    return invoke("preview_output", {
      workspaceRoot,
      relativeOutput,
      teamRoot,
      logicalDestination
    });
  }

  publish(
    workspaceRoot: string,
    relativeOutput: string,
    teamRoot: string,
    logicalDestination: string
  ): Promise<string> {
    return invoke("publish_output", {
      workspaceRoot,
      relativeOutput,
      teamRoot,
      logicalDestination
    });
  }

  cleanup(workspaceRoot: string): Promise<void> {
    return invoke("cleanup_workspace", { workspaceRoot });
  }
}

export class TemporaryWorkspaceService {
  constructor(private readonly native: WorkspaceNativePort) {}

  validateDirectory(path: string): Promise<string> {
    return this.native.validateDirectory(path);
  }

  defaultRoot(): Promise<string> {
    return this.native.defaultRoot();
  }

  ensureDirectory(path: string): Promise<string> {
    return this.native.ensureDirectory(path);
  }

  projectWorkspace(workItemId: string): Promise<string> {
    return this.native.projectWorkspace(workItemId);
  }

  async prepare(
    executionId: string,
    teamRoot: string,
    inputs: string[],
    locations: FileLocation[] = []
  ): Promise<string> {
    const validatedRoot = await this.native.validateDirectory(teamRoot);
    const workspace = await this.native.create(executionId);
    await this.copyInputs(workspace, validatedRoot, inputs, locations);
    return workspace;
  }

  /**
   * The same approved inputs, staged into a Software Project worktree. A project run works in
   * the user's repository, so the files land under `.bees/inputs` — inside the agent's sandbox,
   * which cannot see past the worktree, and outside what Git reports as project changes.
   */
  async prepareProject(
    workspace: string,
    teamRoot: string,
    inputs: string[],
    locations: FileLocation[],
    projectWorkItemId: string
  ): Promise<void> {
    const validatedRoot = await this.native.validateDirectory(teamRoot);
    await this.copyInputs(workspace, validatedRoot, inputs, locations, projectWorkItemId);
  }

  private async copyInputs(
    workspace: string,
    teamRoot: string,
    inputs: string[],
    locations: FileLocation[],
    projectWorkItemId?: string
  ): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const value of logicalFileReferences(inputs)) {
      const reference = parseLogicalFileReference(value);
      const key = reference.locationId ?? "";
      groups.set(key, [...(groups.get(key) ?? []), reference.path]);
    }
    const primary = groups.get("") ?? [];
    if (primary.length) {
      await this.native.copyInputs(teamRoot, workspace, primary, "", projectWorkItemId);
    }
    for (const [locationId, paths] of groups) {
      if (!locationId) continue;
      const location = locations.find(({ id }) => id === locationId);
      if (!location) {
        throw new Error(`Linked file location ${locationId} is not available to this team`);
      }
      if (!location.localPath) {
        throw new Error(`Map the linked location "${location.name}" on this machine before running`);
      }
      const root = await this.native.validateDirectory(location.localPath).catch(() => {
        throw new Error(`Linked location is unavailable: ${location.name}`);
      });
      await this.native.copyInputs(
        root,
        workspace,
        paths,
        linkedLocationInputDirectory(location),
        projectWorkItemId
      );
    }
  }

  collect(workspace: string): Promise<string[]> {
    return this.native.collectOutputs(workspace);
  }

  writeOutput(workspace: string, output: string, contents: string): Promise<string> {
    return this.native.writeOutput(workspace, logicalPath(output), contents);
  }

  preview(
    workspace: string,
    output: string,
    teamRoot: string,
    destination: string
  ): Promise<OutputPreview> {
    return this.native.preview(workspace, output, teamRoot, destination);
  }

  /** Reads one collected output as text by reusing preview — no second native command. */
  async readOutput(workspace: string, output: string, teamRoot: string): Promise<string> {
    const { after } = await this.native.preview(workspace, output, teamRoot, output);
    return after ?? "";
  }

  async publishApproved(
    workspace: string,
    output: string,
    teamRoot: string,
    destination: string
  ): Promise<string> {
    return await this.native.publish(
      workspace,
      logicalPath(output),
      teamRoot,
      logicalPath(destination)
    );
  }

  cleanup(workspace: string): Promise<void> {
    return this.native.cleanup(workspace);
  }
}

export function linkedLocationInputDirectory(location: Pick<FileLocation, "id" | "name">): string {
  const slug = location.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "location";
  return `locations/${slug}-${location.id.slice(0, 8)}`;
}

export function validateCollectedOutputs(outputs: string[], rules: string[] = []): void {
  outputs.forEach(logicalPath);
  if (rules.includes("require-output") && outputs.length === 0) {
    throw new Error("Agent validation requires at least one output file");
  }
  if (rules.includes("action-receipt") && !outputs.includes("action-receipt.json")) {
    throw new Error("An external action must produce action-receipt.json");
  }
  const extensionRule = rules.find((rule) => rule.startsWith("extension:"));
  if (extensionRule) {
    const extension = extensionRule.slice("extension:".length);
    if (!extension.startsWith(".") || outputs.some((output) => !output.endsWith(extension))) {
      throw new Error(`Agent outputs must use the ${extension} extension`);
    }
  }
}
