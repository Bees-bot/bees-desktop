import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(desktopRoot, "dsh-runtime");
const bundleRoot = path.join(runtimeRoot, "vendor", "dsh-v0.1.2-rc.1");
const bundle = (await readdir(bundleRoot)).filter((name) => name.endsWith(".tgz")).sort();

if (bundle.length !== 256) {
  throw new Error(`Expected 256 DSH rc.1 packages, found ${bundle.length}`);
}

// This optional adapter embeds a platform-specific Codex CLI. Bees uses DSH's
// in-process providers, so installing it adds a large, unrelated binary matrix.
const tarballs = bundle
  .filter((name) => !name.startsWith("deepseek-ai-dsh-subagent-codex-"))
  .map((name) => path.join(bundleRoot, name));

const install = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-save",
    "--package-lock=false",
    "--legacy-peer-deps",
    ...tarballs,
  ],
  { cwd: runtimeRoot, stdio: "inherit" },
);
if (install.status !== 0) process.exit(install.status ?? 1);

const manifest = JSON.parse(
  await readFile(path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
);
if (manifest.version !== "0.1.2-rc.1") {
  throw new Error(`Installed DSH ${manifest.version}; expected 0.1.2-rc.1`);
}

// DSH rc.1's continuation manager already supports a child model route, but the
// experimental Agent Team wrapper omits it. Keep the release package intact in
// vendor/ and apply this one-field bridge after every deterministic install.
const teamEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-experimental-agent-team", "lib", "index.js",
);
const teamSource = await readFile(teamEntry, "utf8");
const teamNeedle = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root\n";
const teamPatch = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root,\n\t\t\t\t\t...request.agentOptions ? { agentOptions: request.agentOptions } : {}\n";
if (!teamSource.includes(teamNeedle)) {
  throw new Error("DSH rc.1 Agent Team model-route patch no longer matches its pinned package");
}
await writeFile(teamEntry, teamSource.replace(teamNeedle, teamPatch));
