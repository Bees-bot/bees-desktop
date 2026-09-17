import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedBeesContent } from "./embed-dsh-content.mjs";
import { batchDshClientModules } from "./batch-dsh-client-modules.mjs";
import { bootTimings, loaderTimings, profileTimings, timeDshStartup } from "./time-dsh-startup.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(desktopRoot, "dsh-runtime");
const manifest = JSON.parse(
  await readFile(path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
);
if (manifest.version !== "0.1.5-rc.2") {
  throw new Error(`Installed DSH ${manifest.version}; expected 0.1.5-rc.2`);
}

const dshLib = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib");
const profiles = await readdir(dshLib);
const profile = (await Promise.all(profiles.filter((name) => name.startsWith("profile-boot-")).map(async (name) => ({
  entry: path.join(dshLib, name), source: await readFile(path.join(dshLib, name), "utf8")
})))).find(({ source }) => source.includes("async function runProfile(options)"));
if (!profile) throw new Error("DSH startup timing cannot find the pinned profile entry");
await writeFile(profile.entry, timeDshStartup(profile.source, profileTimings));
for (const [packageName, timings] of [["dsh-app-boot", bootTimings], ["cordis-plugin-loader", loaderTimings]]) {
  const entry = path.join(runtimeRoot, "node_modules", "@deepseek-ai", packageName, "lib", "index.js");
  await writeFile(entry, timeDshStartup(await readFile(entry, "utf8"), timings));
}

// Preserve the native slot owner and session providers while Bees embeds its widgets.
const layoutEntry = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh-client-ui-layout", "lib", "client.js");
await writeFile(layoutEntry, embedBeesContent(await readFile(layoutEntry, "utf8")));

// DSH 0.1.5-rc.2's continuation manager already supports a child model route, but the
// experimental Agent Team wrapper omits it. Apply the existing one-field bridge
// after every deterministic install.
const teamEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-experimental-agent-team", "lib", "index.js",
);
const teamSource = await readFile(teamEntry, "utf8");
const teamNeedle = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root\n";
const teamPatch = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root,\n\t\t\t\t\t...request.agentOptions ? { agentOptions: request.agentOptions } : {}\n";
if (!teamSource.includes(teamNeedle) && !teamSource.includes(teamPatch)) {
  throw new Error("DSH 0.1.5-rc.2 Agent Team model-route patch no longer matches its pinned package");
}
await writeFile(teamEntry, teamSource.replace(teamNeedle, teamPatch));

// Keep immutable bundle revisions addressable during rapid HMR churn. DSH 0.1.5-rc.2
// retains only one previous graph, so a browser two revisions behind gets a 404.
const hmrEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-client-modules", "lib", "index.js",
);
const hmrSource = await readFile(hmrEntry, "utf8");
const hmrClass = "var ClientModuleRegistry = class extends Service {";
const hmrPrevious = "\t/** One prior graph generation covers a request racing the HMR recomposition that replaced its URL. */\n\tpreviousBatchResponses = /* @__PURE__ */ new Map();\n";
const hmrCompose = "\t\tthis.previousBatchResponses = this.batchResponses;\n\t\tthis.batchResponses = batchResponses;\n\t\tthis.responses = responses;";
const hmrServe = "\t\tconst response = this.responses.get(resourceUrl) ?? this.previousBatchResponses.get(resourceUrl);";
if (!hmrSource.includes("const retiredResponses = new Map()")) {
for (const needle of [hmrClass, hmrPrevious, hmrCompose, hmrServe]) {
  if (!hmrSource.includes(needle)) {
    throw new Error("DSH 0.1.5-rc.2 client bundle history patch no longer matches its pinned package");
  }
}
await writeFile(hmrEntry, hmrSource
  .replace(hmrClass, `const retiredResponses = new Map();\n${hmrClass}`)
  .replace(hmrPrevious, "")
  .replace(hmrCompose, "\t\tif (this.responses) for (const [url, response] of this.responses) retiredResponses.set(url, response);\n\t\tthis.batchResponses = batchResponses;\n\t\tthis.responses = responses;")
  .replace(hmrServe, "\t\tconst response = this.responses.get(resourceUrl) ?? retiredResponses.get(resourceUrl);"));

}
await writeFile(hmrEntry, batchDshClientModules(await readFile(hmrEntry, "utf8")));
