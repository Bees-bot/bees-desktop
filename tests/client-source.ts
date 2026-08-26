import { readFileSync } from "node:fs";

const sourceFiles = [
  "runtime.js", "shared.js", "dashboard-model.js", "flexible-grid.js", "home.js", "work.js", "processes.js",
  "agents.js", "resources.js", "settings.js", "shell.js", "index.js"
];

export const clientBundle = readFileSync(
  new URL("../dsh-runtime/plugin/lib/client.js", import.meta.url), "utf8"
);

export const clientSource = sourceFiles.map((file) =>
  readFileSync(new URL(`../dsh-runtime/plugin/client/${file}`, import.meta.url), "utf8")
).join("\n");
