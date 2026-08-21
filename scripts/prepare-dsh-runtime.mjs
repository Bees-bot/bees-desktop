import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dsh = resolve(root, "dsh-runtime", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
if (!existsSync(dsh)) throw new Error("DeepSeek Harness is missing. Run npm install first.");

const target = process.env.CARGO_BUILD_TARGET ||
  execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = target.includes("windows") ? ".exe" : "";
const destination = resolve(root, "src-tauri", "binaries", `bees-node-${target}${extension}`);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(process.execPath, destination);
if (!target.includes("windows")) chmodSync(destination, 0o755);
