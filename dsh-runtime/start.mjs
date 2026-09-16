import { mark, step, observePlugins } from "./plugin/lib/startup.js";

mark("node.entry");
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
