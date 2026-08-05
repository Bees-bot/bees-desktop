import { createSandboxSessionEnv } from "@flue/runtime";
import type { FileStat, SandboxApi, SandboxFactory, SessionEnv } from "@flue/runtime";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { instancePointer } from "../state.ts";

class WorkspaceApi implements SandboxApi {
  constructor(private readonly root: string) {}

  private path(value: string): string {
    const logical = value.replaceAll("\\", "/");
    const relativePath =
      logical === "/workspace"
        ? ""
        : logical.startsWith("/workspace/")
          ? logical.slice("/workspace/".length)
          : logical.replace(/^\/+/, "");
    const candidate = resolve(this.root, relativePath);
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${sep}`)) {
      throw new Error("Path escapes the Bees workspace");
    }
    return candidate;
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.path(path), "utf8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(path)));
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const destination = this.path(path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }

  async stat(path: string): Promise<FileStat> {
    const value = await lstat(this.path(path));
    return {
      isFile: value.isFile(),
      isDirectory: value.isDirectory(),
      isSymbolicLink: value.isSymbolicLink(),
      size: value.size,
      mtime: value.mtime
    };
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(this.path(path));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.path(path));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(this.path(path), { recursive: options?.recursive });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const target = this.path(path);
    if (!relative(this.root, target)) throw new Error("Refusing to remove the workspace root");
    await rm(target, options);
  }

  async exec(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return {
      stdout: "",
      stderr: "Host shell commands are disabled in the Bees virtual workspace. Use file tools.",
      exitCode: 126
    };
  }
}

/**
 * Flue 2 hands the agent instance id to `createSessionEnv`, so this is a plain factory
 * rather than one built per run. The id is the execution id, which is also the workspace
 * pointer key — see `bind_flue_workspace`.
 */
export const beesWorkspace: SandboxFactory = {
  async createSessionEnv({ id }: { id: string }): Promise<SessionEnv> {
    const pointer = JSON.parse(await readFile(instancePointer(id), "utf8")) as {
      workspace: string;
    };
    return createSandboxSessionEnv(new WorkspaceApi(pointer.workspace), "/workspace");
  }
};
