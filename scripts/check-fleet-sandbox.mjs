// Run inside the Linux runner image; all files and commands below are synthetic.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Context } from "../dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js";
import { LocalSandboxProvider } from "../dsh-runtime/node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js";

assert.equal(
  process.platform,
  "linux",
  "Run this check inside the Linux image",
);
const root = await mkdtemp("/tmp/bees-fleet-fence-"),
  workspace = join(root, "work"),
  temporary = join(root, "tmp");
try {
  await mkdir(workspace);
  await mkdir(temporary);
  const secret = join(root, "runner.json"),
    input = join(workspace, "input.txt"),
    output = join(workspace, "output.txt");
  await writeFile(secret, "SYNTHETIC_PRIVATE_RUNNER");
  await writeFile(input, "admitted input");
  process.env.BEES_FLEET_JOB = "synthetic";
  process.env.TMPDIR = temporary;
  process.env.BEES_RUNTIME_ROOT = resolve("dsh-runtime");
  globalThis.__beesReadFence = () => ({
    closed: [root],
    open: [workspace, temporary],
  });
  const provider = new LocalSandboxProvider(new Context(), {
    runnerCommand: [],
    runnerFailureSignatures: [],
    probeTimeoutMs: 5000,
  });
  const run = async (argv) => {
    const wrapped = await provider.confine(argv, {
      mode: "workspace-write",
      workspaceRoot: workspace,
    });
    return spawnSync(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: workspace,
      encoding: "utf8",
      timeout: 15000,
    });
  };
  const allowed = await run([
    "/bin/bash",
    "-c",
    'cat "$1"; printf output > "$2"; printf temporary > "$3"',
    "--",
    input,
    output,
    join(temporary, "file"),
  ]);
  assert.equal(allowed.status, 0, allowed.stderr || String(allowed.error));
  assert.match(allowed.stdout, /admitted input/);
  assert.equal(await readFile(output, "utf8"), "output");
  const denied = await run(["/bin/cat", secret]);
  assert.notEqual(denied.status, 0, "Private runner files must be unreadable");
  assert(!denied.stdout.includes("SYNTHETIC_PRIVATE_RUNNER"));
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "admitted input",
        "workspace write",
        "private temporary write",
        "private runner file denied",
      ],
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
