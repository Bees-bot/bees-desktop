import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fallbackPolicyRoot = join(tmpdir(), `bees-srt-${process.pid}`);

export const DEVELOPMENT_NETWORK_DOMAINS = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "registry.yarnpkg.com",
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "gitlab.com",
  "*.gitlab.com",
  "bitbucket.org",
  "*.bitbucket.org",
  "pypi.org",
  "*.pypi.org",
  "*.pythonhosted.org",
  "crates.io",
  "*.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "repo.maven.apache.org",
  "*.gradle.org",
  "nuget.org",
  "*.nuget.org",
  "rubygems.org",
  "*.rubygems.org",
  "nodejs.org",
  "*.nodejs.org",
  "bun.sh",
  "*.bun.sh",
  "deno.land",
  "*.deno.land",
  "static.rust-lang.org",
  "sh.rustup.rs"
] as const;

export interface SandboxLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  policyPath: string;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** No provider credentials, app capabilities, or user startup hooks reach sandboxed code. */
export function sandboxEnvironment(
  root: string,
  supplied: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
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
    "PATHEXT",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "USERPROFILE"
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

function toolReadRoots(root: string, environment: NodeJS.ProcessEnv): string[] {
  const executable = canonical(process.execPath);
  const values = new Set([root, dirname(executable), dirname(dirname(executable))]);
  const home = canonical(homedir());
  const broadUserRoots = new Set([
    home,
    join(home, "Library"),
    join(home, ".cargo"),
    join(home, ".local")
  ]);
  for (const entry of (environment.PATH ?? "").split(delimiter).filter(Boolean)) {
    const absolute = canonical(entry);
    values.add(absolute);
    const parent = dirname(absolute);
    if (
      ["bin", "sbin", ".bin"].includes(basename(absolute)) &&
      parent !== dirname(parent) &&
      !broadUserRoots.has(parent)
    ) {
      values.add(parent);
    }
  }
  values.add(join(home, ".rustup", "toolchains"));
  return [...values];
}

function deniedReadRoots(): string[] {
  const home = canonical(homedir());
  const userRoot = process.platform === "linux" && home === "/root" ? home : dirname(home);
  return [...new Set([userRoot, canonical(tmpdir())])];
}

async function sandboxPolicy(
  root: string,
  environment: NodeJS.ProcessEnv,
  allowedDomains: readonly string[]
): Promise<string> {
  const policy = {
    network: {
      allowedDomains: [...allowedDomains],
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: true
    },
    filesystem: {
      denyRead: deniedReadRoots(),
      allowRead: toolReadRoots(root, environment),
      allowWrite: [root],
      denyWrite: [],
      allowGitConfig: false
    },
    git: { safeDirectories: [root] },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
    allowPty: false
  };
  const encoded = `${JSON.stringify(policy)}\n`;
  const id = createHash("sha256").update(encoded).digest("hex");
  const directory = join(process.env.BEES_STATE_DIR ?? fallbackPolicyRoot, "sandbox-policies");
  const path = join(directory, `${id}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, encoded, { mode: 0o600 });
  return path;
}

function sandboxRuntimeCli(): string {
  return process.env.BEES_SRT_TEST_PATH ?? require.resolve("@anthropic-ai/sandbox-runtime/dist/cli.js");
}

async function launch(
  root: string,
  cwd: string,
  supplied: NodeJS.ProcessEnv,
  allowedDomains: readonly string[],
  args: string[]
): Promise<SandboxLaunch> {
  const env = sandboxEnvironment(root, supplied);
  const policyPath = await sandboxPolicy(root, env, allowedDomains);
  return {
    command: process.execPath,
    args: [sandboxRuntimeCli(), "--settings", policyPath, ...args],
    cwd,
    env,
    policyPath
  };
}

export function sandboxCommandLaunch(
  command: string,
  root: string,
  cwd: string,
  supplied: NodeJS.ProcessEnv = {},
  allowedDomains: readonly string[] = DEVELOPMENT_NETWORK_DOMAINS
): Promise<SandboxLaunch> {
  return launch(root, cwd, supplied, allowedDomains, ["-c", command]);
}

export function sandboxArgvLaunch(
  command: string,
  args: readonly string[],
  root: string,
  cwd: string,
  supplied: NodeJS.ProcessEnv = {},
  allowedDomains: readonly string[] = DEVELOPMENT_NETWORK_DOMAINS
): Promise<SandboxLaunch> {
  return launch(root, cwd, supplied, allowedDomains, ["--", command, ...args]);
}
