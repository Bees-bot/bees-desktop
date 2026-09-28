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
const pinned = JSON.parse(
  await readFile(path.join(runtimeRoot, "package.json"), "utf8"),
).dependencies["@deepseek-ai/dsh"];
if (manifest.version !== pinned) {
  throw new Error(`Installed DSH ${manifest.version}; expected ${pinned}`);
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

// DSH's continuation manager already supports a child model route, but the
// experimental Agent Team wrapper omits it. Apply the existing one-field bridge
// after every deterministic install.
const teamEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-experimental-agent-team", "lib", "index.js",
);
const teamSource = await readFile(teamEntry, "utf8");
const teamNeedle = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root\n";
const teamPatch = "\t\t\t\t\tprompt: request.prompt,\n\t\t\t\t\tparent: root,\n\t\t\t\t\t...request.agentOptions ? { agentOptions: request.agentOptions } : {}\n";
if (!teamSource.includes(teamNeedle) && !teamSource.includes(teamPatch)) {
  throw new Error(`DSH ${pinned} Agent Team model-route patch no longer matches its pinned package`);
}
await writeFile(teamEntry, teamSource.replace(teamNeedle, teamPatch));

// seatbelt only fences writes; the bees plugin names the folders a shell may never read (readFence in data-folder.js)
const sandboxEntry = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh-sandbox-local", "lib", "index.js");
await writeFile(sandboxEntry, timeDshStartup(await readFile(sandboxEntry, "utf8"), [[
  '\treturn ["-p", forms.join(" ")];',
  '\tconst fence = globalThis.__beesReadFence?.();\n\tfor (const [rule, roots] of [["deny", fence?.closed], ["allow", fence?.open]]) if (roots?.length) forms.push(`(${rule} file-read-data ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`);\n\treturn ["-p", forms.join(" ")];',
]]));

// RC2 owns failed batch recovery and bounded response history. Retain only the
// measured startup batching optimization; do not accumulate retired bundles.
const hmrEntry = path.join(
  runtimeRoot, "node_modules", "@deepseek-ai", "dsh-client-modules", "lib", "index.js",
);
await writeFile(hmrEntry, batchDshClientModules(await readFile(hmrEntry, "utf8")));
