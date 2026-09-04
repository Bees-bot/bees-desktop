import { configureRuntime, h, React } from "./runtime.js";
import gridstackCss from "gridstack/dist/gridstack.min.css";
import cronGeneratorCss from "react-cron-generator/build/cron-builder.css";
import { css } from "./shared.js";
import { BeesApp } from "./shell.js";
import { installScrollbars } from "./scrollbars.js";

window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    configureRuntime(require);
    class BeesErrorBoundary extends React.Component {
      state = { error: null, attempt: 0 };
      static getDerivedStateFromError(error) {
        return { error: (error instanceof Error ? error.message : String(error)) || "Unknown error" };
      }
      componentDidCatch(error, info) {
        console.error("Bees UI crashed:", error, info.componentStack);
      }
      retry = () => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }));
      render() {
        if (this.state.error === null) return h(BeesApp, { ...this.props, key: this.state.attempt });
        return h("div", { className: "bees-app bees-loading", role: "alert" },
          h("div", { className: "bees-stack" },
            h("div", { className: "bees-mark" }, "B"),
            h("strong", null, "Bees hit a problem"),
            h("div", { className: "bees-muted" }, this.state.error),
            h("div", { className: "bees-card-actions" },
              h("button", { className: "bees-btn primary", onClick: this.retry }, "Try again"),
              h("button", { className: "bees-btn", onClick: () => window.location.reload() }, "Reload Bees"))));
      }
    }
    const module = { exports: {} };
    const exports = module.exports;
    exports.inject = ["slots", "uiWorkspace", "settingsScope", "connection", "theme", "sessions", "uiSession"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-plugin";
      style.textContent = `${gridstackCss}\n${cronGeneratorCss}\n${css}`;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees: styles");
      ctx.effect(() => installScrollbars(document), "bees: scrollbars");
      const toggleDsh = (event) => {
        if (event.repeat || event.code !== "KeyD" || !event.altKey || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        document.documentElement.toggleAttribute("data-bees-debug-dsh");
      };
      ctx.effect(() => {
        window.addEventListener("keydown", toggleDsh, true);
        return () => {
          window.removeEventListener("keydown", toggleDsh, true);
          document.documentElement.removeAttribute("data-bees-debug-dsh");
        };
      }, "bees: DSH debug shortcut");
      const preferences = ctx.settingsScope.bind({ namespace: "bees-ui" });
      const modelSettings = ctx.settingsScope.bind({ namespace: "llm-pi-ai" });
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "bees-product", order: -100, label: "Bees",
        inject: () => ({ ctx, preferences, modelSettings })
      }, BeesErrorBoundary));
    };
    return module.exports;
  }
});
