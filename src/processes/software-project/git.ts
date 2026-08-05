import { invoke } from "@tauri-apps/api/core";
import type {
  SoftwareProjectGitSnapshot,
  SoftwareProjectMapping,
  SoftwareProjectSelection
} from "./index.js";

export class SoftwareProjectGit {
  get(workItemId: string): Promise<SoftwareProjectMapping | null> {
    return invoke("software_project_get", { workItemId });
  }

  selectFolder(
    workItemId: string,
    folderPath: string,
    teamRoot: string
  ): Promise<SoftwareProjectSelection> {
    return invoke("software_project_select_folder", { workItemId, folderPath, teamRoot });
  }

  workspace(workItemId: string): Promise<string> {
    return invoke("software_project_workspace", { workItemId });
  }

  commit(
    workItemId: string,
    phaseId: string,
    executionId: string,
    summary: string
  ): Promise<string> {
    return invoke("software_project_commit", {
      workItemId,
      phaseId,
      executionId,
      summary
    });
  }

  snapshot(workItemId: string, baseSha?: string): Promise<SoftwareProjectGitSnapshot> {
    return invoke("software_project_snapshot", { workItemId, baseSha });
  }

  merge(workItemId: string): Promise<string> {
    return invoke("software_project_merge", { workItemId });
  }
}
