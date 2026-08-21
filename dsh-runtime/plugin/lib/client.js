window.__ModuleLoader__.load({
  id: "@bees/dsh-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const style = document.createElement("style");
    style.dataset.plugin = "@bees/dsh-plugin";
    style.textContent = `
      .bees-dsh-open { position: fixed; top: 10px; right: 12px; z-index: 100; pointer-events: auto; border: 1px solid #5b5143; color: #fff; background: #29231b; border-radius: 7px; padding: 5px 9px; cursor: pointer; font: 12px/1 system-ui, sans-serif; }
    `;
    document.head.appendChild(style);

    function BeesSurface() {
      return React.createElement("button", {
        className: "bees-dsh-open",
        type: "button",
        onClick: () => location.assign("/bees-return"),
        title: "Open the Bees board"
      }, "Open Bees");
    }

    function referenceToken(item) {
      const prefix = item.namespace === "$" ? "$" : "@";
      return `${prefix}[${String(item.label).replace(/[\]\\]/g, "")}](${`bees:${item.kind}:${item.id}`})`;
    }

    exports.inject = ["slots", "inputTriggers"];
    exports.apply = (ctx) => {
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "bees",
        order: -100,
        label: "Bees"
      }, BeesSurface));

      const cache = new Map();
      const source = {
        trigger: "@",
        name: "bees",
        order: -20,
        showGroupTitle: true,
        async candidates(_session, { query, signal }) {
          const response = await fetch(`/bees-api/references?q=${encodeURIComponent(query)}`, { signal });
          if (!response.ok) return [];
          const value = await response.json();
          const rows = [
            ...(value.at ?? []).map((item) => ({ ...item, namespace: "@" })),
            ...(value.dollar ?? []).map((item) => ({ ...item, namespace: "$" }))
          ];
          for (const item of rows) cache.set(`${item.kind}:${item.id}`, item);
          return rows.map((item) => ({
            name: `${item.namespace} ${item.label}`,
            description: `${item.kind} · stable Bees reference`,
            section: item.namespace === "@" ? "Bees work" : "Bees capabilities",
            value: JSON.stringify(item)
          }));
        },
        onPick({ candidate }) {
          const item = JSON.parse(candidate.value);
          const token = referenceToken(item);
          return { insert: {
            source: "bees",
            ref: token,
            label: `${item.namespace}${item.label}`,
            appearance: item.kind === "location" ? "folder" : undefined,
            clipboardText: token
          } };
        },
        lexicon() { return [...cache.values()].map((item) => `${item.namespace}${item.label}`); },
        codec: {
          clipboardText: (ref) => ref,
          serialize: (ref) => Promise.resolve(ref)
        }
      };
      ctx.effect(() => ctx.inputTriggers.registerSource(source), "bees: typed references");
    };
    return module.exports;
  }
});
