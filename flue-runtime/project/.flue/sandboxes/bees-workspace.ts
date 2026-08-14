import { createSandboxSessionEnv } from "@flue/runtime";
import type { FileStat, SandboxApi, SandboxFactory, SessionEnv } from "@flue/runtime";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { instancePointer } from "../state.ts";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const require = createRequire(import.meta.url);

interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface Launch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function inside(root: string, value: string): boolean {
  return value === root || value.startsWith(`${root}${sep}`);
}

function boundedEnvironment(root: string, supplied: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const allowedBase = new Set([
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT"
  ]);
  const blockedName = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i;
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && allowedBase.has(key) && !blockedName.test(key)
    )
  );
  for (const [key, value] of Object.entries(supplied)) {
    if (
      value !== undefined &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
      !blockedName.test(key) &&
      !key.startsWith("BEES_") &&
      !key.startsWith("DYLD_") &&
      !key.startsWith("LD_") &&
      !["HOME", "TMPDIR", "TMP", "TEMP", "NODE_OPTIONS", "BASH_ENV", "ENV"].includes(key)
    ) {
      environment[key] = value;
    }
  }
  environment.HOME = root;
  environment.TMPDIR = resolve(root, ".bees-tmp");
  environment.TMP = environment.TMPDIR;
  environment.TEMP = environment.TMPDIR;
  return environment;
}

function shellCommand(command: string, cwd: string): string[] {
  if (process.platform === "win32") {
    const quoted = cwd.replaceAll('"', '""');
    return [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", `cd /d "${quoted}" && ${command}`];
  }
  const quoted = `'${cwd.replaceAll("'", `'"'"'`)}'`;
  return ["/bin/sh", "-c", `cd -- ${quoted} && ${command}`];
}

/**
 * Use the pinned Codex package's maintained Seatbelt/Landlock/Windows sandbox implementation.
 * Bees supplies a stricter named profile: deny the filesystem root, reopen only Codex's
 * minimal OS runtime paths for reading, and reopen the execution workspace for writes.
 * The independent state switch forces networking off as well.
 */
export function workspaceSandboxLaunch(
  command: string,
  root: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Launch | null {
  if (!["darwin", "linux", "win32"].includes(process.platform)) return null;
  let script: string;
  try {
    script = require.resolve("@openai/codex/bin/codex.js");
  } catch {
    return null;
  }
  env = boundedEnvironment(root, env);
  env.CODEX_HOME = process.env.BEES_CODEX_HOME ?? join(process.env.BEES_STATE_DIR ?? root, "codex-home");
  const filesystem = `{${JSON.stringify(root)}="write", ":root"="deny", ":minimal"="read"}`;
  return {
    command: process.execPath,
    args: [
      script,
      "sandbox",
      "--permission-profile",
      "bees-workspace",
      "--cd",
      root,
      "--sandbox-state-disable-network",
      "--config",
      `permissions.bees-workspace.filesystem=${filesystem}`,
      "--config",
      "permissions.bees-workspace.network.enabled=false",
      "--config",
      "shell_environment_policy.ignore_default_excludes=false",
      "--",
      ...shellCommand(command, cwd)
    ],
    cwd: root,
    env
  };
}

function appendBounded(current: string, chunk: Buffer): { value: string; overflow: boolean } {
  const remaining = OUTPUT_LIMIT_BYTES - Buffer.byteLength(current);
  if (remaining <= 0) return { value: current, overflow: true };
  return {
    value: current + chunk.subarray(0, remaining).toString(),
    overflow: chunk.byteLength > remaining
  };
}

export class WorkspaceApi implements SandboxApi {
  constructor(private readonly root: string) {}

  private lexical(value: string): string {
    const logical = value.replaceAll("\\", "/");
    const relativePath = logical === "/workspace"
      ? ""
      : logical.startsWith("/workspace/")
        ? logical.slice("/workspace/".length)
        : logical.replace(/^\/+/, "");
    const candidate = resolve(this.root, relativePath);
    if (!inside(this.root, candidate)) throw new Error("Path escapes the Bees workspace");
    return candidate;
  }

  /** Reject symlink escapes for existing targets and for the nearest parent of new targets. */
  private async path(value: string): Promise<string> {
    const candidate = this.lexical(value);
    let cursor = candidate;
    while (inside(this.root, cursor)) {
      try {
        const actual = await realpath(cursor);
        if (!inside(this.root, actual)) throw new Error("Path escapes the Bees workspace through a symlink");
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (cursor === this.root) break;
      cursor = dirname(cursor);
    }
    throw new Error("The Bees workspace is unavailable");
  }

  async readFile(path: string): Promise<string> {
    return readFile(await this.path(path), "utf8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.path(path)));
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const destination = await this.path(path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }

  async stat(path: string): Promise<FileStat> {
    const target = await this.path(path);
    const [value, link] = await Promise.all([stat(target), lstat(target)]);
    return {
      isFile: value.isFile(),
      isDirectory: value.isDirectory(),
      isSymbolicLink: link.isSymbolicLink(),
      size: value.size,
      mtime: value.mtime
    };
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(await this.path(path));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(await this.path(path));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(await this.path(path), { recursive: options?.recursive });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const target = await this.path(path);
    if (!relative(this.root, target)) throw new Error("Refusing to remove the workspace root");
    await rm(target, options);
  }

  async exec(
    command: string,
    options: ExecOptions = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cwd = await this.path(options.cwd ?? "/workspace");
    const environment = boundedEnvironment(this.root, options.env);
    await mkdir(environment.TMPDIR!, { recursive: true });
    const launch = workspaceSandboxLaunch(command, this.root, cwd, environment);
    if (!launch) {
      return {
        stdout: "",
        stderr: "Shell commands are disabled because this platform has no supported Bees OS sandbox.",
        exitCode: 126
      };
    }
    await mkdir(launch.env.CODEX_HOME!, { recursive: true });
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
    return new Promise((resolvePromise, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let overflow = false;
      let timedOut = false;
      const kill = () => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      const abort = () => kill();
      options.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        const next = appendBounded(stdout, chunk);
        stdout = next.value;
        overflow ||= next.overflow;
        if (overflow) kill();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const next = appendBounded(stderr, chunk);
        stderr = next.value;
        overflow ||= next.overflow;
        if (overflow) kill();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (timedOut) {
          return resolvePromise({ stdout, stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`.trim(), exitCode: 124 });
        }
        if (overflow) {
          return resolvePromise({ stdout, stderr: `${stderr}\nCommand exceeded the ${OUTPUT_LIMIT_BYTES} byte output limit`.trim(), exitCode: 137 });
        }
        resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }
}

export const beesWorkspace: SandboxFactory = {
  async createSessionEnv({ id }: { id: string }): Promise<SessionEnv> {
    const pointer = JSON.parse(await readFile(instancePointer(id), "utf8")) as {
      workspace: string;
    };
    const root = await realpath(pointer.workspace);
    return createSandboxSessionEnv(new WorkspaceApi(root), "/workspace");
  }
};
