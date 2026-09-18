import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { apply, Config } = require("@deepseek-ai/dsh-llm-pi-ai");
const modelId = "~typesafe/jev-latest";

function settingsUi(providers: Record<string, any>, savedModels: any[] = []) {
  let config = Config({ providers });
  let adapter: any;
  let section: any;
  const ctx: any = {
    llm: {
      registerAdapter: (_routes: string[], value: any) => { adapter = value; return { replace() {} }; },
      registerConfigurableProviders: () => ({ replace() {} }), registerModelDiscovery() {}
    },
    get() {},
    inject(deps: string[], callback: (ctx: any) => void) { if (deps.includes("settings")) callback(ctx); },
    settings: {
      installSection(_ctx: any, _ns: string, _schema: any, _config: any, hooks: any) {
        section = hooks;
        hooks.setSource(() => config);
        hooks.onChange();
      }
    }
  };
  apply(ctx, config);
  const modelSettings = {
    getSnapshot: () => ({ value: config }),
    set: vi.fn(async (_key: string, value: any) => {
      const next = Config({ providers: value });
      section.validate(next);
      config = next;
      section.onChange();
    })
  };
  const preferences = {
    getSnapshot: () => ({ value: { generalAiProviders: ["openrouter"], generalAiModels: { openrouter: savedModels } } }),
    set: vi.fn(async () => {})
  };
  const states: any[] = [];
  let cursor = 0;
  let plugin: any;
  runInNewContext(readFileSync(new URL("../dsh-runtime/plugins/custom-ai/lib/client.js", import.meta.url), "utf8"), {
    Error,
    window: { __ModuleLoader__: { load: ({ factory }: any) => {
      plugin = factory(() => ({
        createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
        useEffect() {}, useMemo: (fn: () => any) => fn(),
        useState(initial: any) {
          const index = cursor++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        }
      }));
    } } }
  });
  const render = () => {
    cursor = 0;
    const tree = plugin.CustomAiSettings({ ctx: { remote: { credentials: {} } }, modelSettings, preferences,
      ask: async () => modelId, Button: "button" });
    const nodes: any[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      for (const child of node.props.children.flat(Infinity)) visit(child);
    };
    visit(tree);
    return nodes;
  };
  return { render, modelSettings, preferences, models: () => adapter.listModels("openrouter"),
    resolve: () => adapter.resolveModel("openrouter", modelId) };
}

it.each([false, true])("serves a custom OpenRouter ID when the provider was already enabled: %s", async (enabled) => {
  const ui = settingsUi(enabled ? { openrouter: { models: [{ id: "openai/gpt-4o" }] } } : {},
    [{ id: modelId }]);
  const nodes = ui.render();
  if (enabled) await nodes.find((node) => node.props.children.includes("Add model")).props.onClick();
  else await nodes.find((node) => node.props["aria-label"] === "Enable OpenRouter").props.onChange({ target: { checked: true } });
  expect(ui.modelSettings.set).toHaveBeenCalledOnce();
  expect(ui.modelSettings.getSnapshot().value.providers.openrouter.api).toBe("openai-completions");
  expect(await ui.models()).toContainEqual(expect.objectContaining({ id: modelId, provider: "openrouter" }));
  expect(await ui.resolve()).toMatchObject({ id: modelId, provider: "openrouter" });
});

it("keeps the saved model list unchanged when runtime configuration rejects an edit", async () => {
  const ui = settingsUi({ openrouter: { models: [{ id: "openai/gpt-4o" }] } });
  ui.modelSettings.set.mockRejectedValueOnce(new Error("Provider could not be configured"));
  await ui.render().find((node) => node.props.children.includes("Add model")).props.onClick();
  expect(ui.preferences.set).not.toHaveBeenCalled();
  expect(ui.render().some((node) => node.props.children.includes("Provider could not be configured"))).toBe(true);
});

it("disables the bundled DeepSeek adapter while allowing explicitly configured DeepSeek models", async () => {
  const yaml = require("js-yaml");
  // The overlay contains !!js values; only the disabled entry is relevant here.
  const profile = readFileSync(new URL("../dsh-runtime/profile/cordis.patch.yml", import.meta.url), "utf8");
  expect(yaml.load(profile.replace(/!!js [^\n]+/g, '"runtime value"')))
    .toContainEqual({ id: "llm-deepseek", disabled: true });
  let adapter: any;
  apply({ llm: {
    registerAdapter: (routes: string[], value: any) => { expect(routes).toEqual(["deepseek"]); adapter = value; },
    registerConfigurableProviders() {}, registerModelDiscovery() {}
  }, inject() {}, get() {} }, Config({ providers: { deepseek: { models: [{ id: "deepseek-chat" }] } } }));
  expect(await adapter.listModels("deepseek")).toContainEqual(expect.objectContaining({ id: "deepseek-chat" }));
});
