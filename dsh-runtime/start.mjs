import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { mark, step, observePlugins } from "./plugin/lib/startup.js";

mark("node.entry");
// opened from the Dock, Bees got launchd's bare PATH with no npx, uvx or node, so no add-on could start
if (process.platform !== "win32") {
  const login = await step("shell.path", () => new Promise((resolve) => {
    // detached with no stdin, so the shell can't take over a dev terminal or sit on a prompt
    const shell = spawn(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__BEES_PATH__%s__BEES_PATH__" "$PATH"'],
      { detached: true, stdio: ["ignore", "pipe", "ignore"], cwd: homedir(), env: scrubbedParentEnv() });
    let out = "";
    const done = (path) => { clearTimeout(timer); shell.stdout.destroy(); resolve(path); };
    // SIGKILL, an interactive shell ignores SIGTERM
    const timer = setTimeout(() => { try { process.kill(-shell.pid, "SIGKILL"); } catch {} done(); }, 5_000);
    shell.stdout.on("data", (chunk) => { out += chunk; const path = /__BEES_PATH__(.*)__BEES_PATH__/.exec(out)?.[1]; if (path) done(path); });
    shell.on("close", () => done()).on("error", () => done());
  }));
  if (login) process.env.PATH = `${login}:${process.env.PATH}`;
}
let stopObserving;
globalThis.__beesStartup = {
  step,
  observe(ctx) { stopObserving = observePlugins(ctx); }
};
try {
  const { runCli } = await step("dsh.cli.import", () =>
    import("./node_modules/@deepseek-ai/dsh/lib/bin.js"));
  await step("dsh.boot", () => runCli());
} finally {
  stopObserving?.();
  delete globalThis.__beesStartup;
}
