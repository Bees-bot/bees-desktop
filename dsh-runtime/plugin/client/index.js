import { configureRuntime, h, React } from "./runtime.js";
import { css } from "./common.js";
import { ThreadApp as BeesApp } from "./thread-app.js";
import { installScrollbars } from "./scrollbars.js";
import brandMark from "../../../src/brand-mark.png";

// A form answers with nothing until the host has described its namespace. Components persist what
// they read on mount, so without this a first render saves those defaults over the stored settings.
function blockWritesUntilServed(form) {
  const held = () => Promise.resolve(false);
  const gate = (write) => (...args) => form.getSnapshot().status === "ready" ? write(...args) : held();
  return Object.assign(Object.create(form), {
    set: gate(form.set.bind(form)), unset: gate(form.unset.bind(form)), mutate: gate(form.mutate.bind(form))
  });
}

window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    configureRuntime(require);
    class BeesErrorBoundary extends React.Component {
      state = { error: null, attempt: 0 };
      static getDerivedStateFromError() {
        // the real crash goes to the console in componentDidCatch
        return { error: "This screen stopped working. Try again, or reload Bees if it keeps happening." };
      }
      componentDidCatch(error, info) {
        console.error("Bees UI crashed:", error, info.componentStack);
      }
      retry = () => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }));
      render() {
        if (this.state.error === null) return h(BeesApp, { ...this.props, key: this.state.attempt });
        return h("div", { className: "bees-app bees-loading", role: "alert" },
          h("div", { className: "bees-stack" },
            h("img", { className: "bees-mark", src: brandMark, alt: "" }),
            h("strong", null, "Bees hit a problem"),
            h("div", { className: "bees-muted" }, this.state.error),
            h("div", { className: "bees-card-actions" },
              h("button", { className: "bees-btn primary", onClick: this.retry }, "Try again"),
              h("button", { className: "bees-btn", onClick: () => window.location.reload() }, "Reload Bees"))));
      }
    }
    const module = { exports: {} };
    const exports = module.exports;
    exports.inject = ["slots", "configForms", "connection", "theme", "remote", "remote.credentials"];
    exports.apply = (ctx) => {
      const style = document.createElement("style");
      style.dataset.plugin = "@bees/dsh-plugin";
      style.textContent = css;
      document.head.append(style);
      ctx.effect(() => () => style.remove(), "bees: styles");
      ctx.effect(() => installScrollbars(document), "bees: scrollbars");
      // Entry ids of the profile plugins that own these settings: the Bees plugin and DSH's provider transport.
      const preferences = blockWritesUntilServed(ctx.configForms.get("bees"));
      const modelSettings = blockWritesUntilServed(ctx.configForms.get("llm-pi-ai"));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "bees-product", order: -100, label: "Bees",
        inject: () => ({ ctx, preferences, modelSettings })
      }, BeesErrorBoundary));
    };
    return module.exports;
  }
});
