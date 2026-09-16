import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// These are the existing pre-launch commands, timed individually. Build output stays in
// the terminal; startup.log begins when the native application actually enters run().
for (const [phase, script, args = []] of [
  ["build.frontend", "../node_modules/vite/bin/vite.js", ["build"]],
  ["build.dsh.install", "./install-dsh-runtime.mjs"],
  ["build.dsh.plugins", "./stage-dsh-plugin.mjs"],
  ["build.bundled-runtimes", "./prepare-dsh-runtime.mjs"]
]) {
  const started = performance.now();
  const log = (event) => console.error(`[bees-startup] ${JSON.stringify({
    atMs: Date.now(), pid: process.pid, source: "build", phase, event,
    durationMs: Math.round(performance.now() - started)
  })}`);
  log("start");
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit"
    });
    log("done");
  } catch (error) {
    log("failed");
    process.exit(error.status || 1);
  }
}
