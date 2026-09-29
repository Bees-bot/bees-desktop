import "./build-dsh-client.mjs";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugins = [
  ["plugin", "dsh-plugin"],
  ["plugins/local-ai", "dsh-local-ai"],
  ["plugins/free-ai", "dsh-free-ai"],
  ["plugins/custom-ai", "dsh-custom-ai"],
  ["plugins/subscriptions", "dsh-subscriptions"]
];

for (const [sourceName, packageName] of plugins) {
  const source = resolve(root, "dsh-runtime", sourceName);
  const destination = resolve(root, "dsh-runtime", "node_modules", "@bees", packageName);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
}
