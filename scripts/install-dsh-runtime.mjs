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

// Keep immutable bundle revisions addressable during rapid HMR churn. DSH rc.1
// retains only one previous graph, so a browser two revisions behind gets a 404.
const hmrEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-client-modules", "lib", "index.js",
);
const hmrSource = await readFile(hmrEntry, "utf8");
const hmrClass = "var ClientModuleRegistry = class extends Service {";
const hmrPrevious = "\t/** One prior graph generation covers a request racing the HMR recomposition that replaced its URL. */\n\tpreviousBatchResponses = /* @__PURE__ */ new Map();\n";
const hmrCompose = "\t\tthis.previousBatchResponses = this.batchResponses;\n\t\tthis.batchResponses = batchResponses;\n\t\tthis.responses = responses;";
const hmrServe = "\t\tconst response = this.responses.get(resourceUrl) ?? this.previousBatchResponses.get(resourceUrl);";
for (const needle of [hmrClass, hmrPrevious, hmrCompose, hmrServe]) {
  if (!hmrSource.includes(needle)) {
    throw new Error("DSH rc.1 client bundle history patch no longer matches its pinned package");
  }
}
await writeFile(hmrEntry, hmrSource
  .replace(hmrClass, `const retiredResponses = new Map();\n${hmrClass}`)
  .replace(hmrPrevious, "")
  .replace(hmrCompose, "\t\tif (this.responses) for (const [url, response] of this.responses) retiredResponses.set(url, response);\n\t\tthis.batchResponses = batchResponses;\n\t\tthis.responses = responses;")
  .replace(hmrServe, "\t\tconst response = this.responses.get(resourceUrl) ?? retiredResponses.get(resourceUrl);"));
