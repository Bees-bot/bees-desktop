import { configureRuntime } from "./runtime.js";
import { css } from "./shared.js";
import { BeesApp } from "./shell.js";

window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    configureRuntime(require);
    const module = { exports: {} };
    const exports = module.exports;
    exports.inject = ["slots", "workspaces", "settingsScope", "connection", "theme", "sessions"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-plugin";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees: styles");
      const preferences = ctx.settingsScope.bind({ namespace: "bees-ui" });
      const modelSettings = ctx.settingsScope.bind({ namespace: "llm-pi-ai" });
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "bees-product", order: -100, label: "Bees",
        inject: () => ({ ctx, preferences, modelSettings })
      }, BeesApp));
    };
    return module.exports;
  }
});

