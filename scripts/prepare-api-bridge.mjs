// Bundles the API bridge the way the binaries are prepared. Out of package.json on purpose:
// 311 packages to produce about 1 MB, and nothing in the app imports it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.16.1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "services", "api-bridge", "bridge.mjs");

// The bundle is not versioned, so a dev build has to make it once. Rebuild it with --force after
// bumping the version above.
if (existsSync(output) && !process.argv.includes("--force")) {
  console.log(`The API bridge is already built at ${output}. Pass --force to rebuild it.`);
  process.exit(0);
}

const staging = mkdtempSync(join(tmpdir(), "bees-api-bridge-"));
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });

try {
  mkdirSync(dirname(output), { recursive: true });
  run("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--prefix", staging, `@ivotoby/openapi-mcp-server@${version}`]);
  run(join(root, "node_modules", ".bin", "rolldown"), [
    "--input", join(staging, "node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js"),
    "--format", "esm", "--platform", "node", "--file", output
  ]);
}
finally {
  rmSync(staging, { recursive: true, force: true });
}
