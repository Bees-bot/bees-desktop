import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../dsh-runtime/plugin/lib/index.js";
import { clientSource } from "./client-source.js";

type Route = {
  kind: "exact";
  path: string;
  handler: (request: any, response: any) => unknown;
};

const originalEnvironment = {
  database: process.env.BEES_DATABASE_PATH,
  token: process.env.BEES_DSH_TOKEN,
  workspace: process.env.BEES_DEFAULT_WORKSPACE
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    BEES_DATABASE_PATH: originalEnvironment.database,
    BEES_DSH_TOKEN: originalEnvironment.token,
    BEES_DEFAULT_WORKSPACE: originalEnvironment.workspace
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function testContext(
  server: EventEmitter,
  routes: Route[],
  workspaces: Map<string, any>,
  sessions: Map<string, any[]>
) {
  const disposers: Array<() => unknown> = [];
  const mountedPresets: string[] = [];
  const policies: string[] = [];
  const settings: string[] = [];
  const persistenceLoads: string[] = [];
  let workspaceSequence = workspaces.size;
  let defaultModel = { provider: "local-openai", model: "active" } as {
    provider: string; model: string; reasoningEffort?: string;
  };
  const temporalClient = {
    workflow: {
      start: async () => undefined,
      getHandle: () => ({ signal: async () => undefined, cancel: async () => undefined })
    }
  };
  const ctx: any = {
    logger: { warn: () => undefined, error: () => undefined },
    credentials: {
      resolve: async () => undefined,
      set: async () => undefined,
      unset: async () => undefined
    },
    effect(factory: () => unknown) {
      const dispose = factory();
      if (typeof dispose === "function") disposers.push(dispose as () => unknown);
      return dispose;
    },
    on: () => () => undefined,
    agentDefaultModel: {
      currentSelection: () => ({ ...defaultModel }),
      saveSelection: async (next: typeof defaultModel) => { defaultModel = { ...next }; }
    },
    settings: { register: (namespace: { name?: string } | string) => settings.push(String((namespace as any).name ?? namespace)) },
    webServer: {
      server,
      register(route: Route) {
        routes.push(route);
        return () => {
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      }
    },
    workspaceRegistry: {
      get: (id: string) => workspaces.get(String(id)),
      async create(path: string, name: string) {
        const record = { id: `dsh-workspace-${++workspaceSequence}`, path, name };
        workspaces.set(record.id, record);
        return record;
      }
    },
    agentPresets: {
      defaultId: "standard",
      list: async () => [{ id: "standard", name: "Standard", description: "Contract preset", trust: "local" }],
      mount: async (_agent: unknown, id: string) => { mountedPresets.push(id); }
    },
    approval: {
      setPolicy: (_agent: unknown, policy: string) => { policies.push(policy); },
      request: async () => "allowed-once"
    },
    sessionPersistence: {
      inspect: async (id: string) => ({ events: sessions.get(String(id)) ?? [] }),
      load: async (id: string) => {
        persistenceLoads.push(String(id));
        return { events: sessions.get(String(id)) ?? [] };
      }
    },
    agents: {
      async create(options: any) {
        const session = { id: String(options.sessionId), seq: 0, events: [] as any[] };
        sessions.set(session.id, session.events);
        const agentContext = {
          systemPrompt: { section: () => undefined, context: () => undefined },
          tools: { register: () => undefined }
        };
        await options.setup(agentContext);
        const agent = {
          session,
          followup(message: any) {
            session.events.push({ type: "user/message", seq: ++session.seq, time: Date.now(), data: { id: `m-${session.seq}`, content: message.content } });
            session.events.push({ type: "turn/start", seq: ++session.seq, time: Date.now(), data: {} });
            session.events.push({
              type: "assistant/message", seq: ++session.seq, time: Date.now(),
              data: { message: { id: `m-${session.seq}`, content: [{ type: "text", text: "Contract turn complete" }] } }
            });
            session.events.push({ type: "turn/end", seq: ++session.seq, time: Date.now(), data: { reason: { kind: "completed" } } });
          },
          whenIdle: async () => undefined,
          cancel: () => undefined
        };
        return { agent, dispose: async () => undefined };
      },
      resume: async () => { throw new Error("Unexpected resume in contract test"); }
    }
  };
  return {
    ctx,
    mountedPresets,
    policies,
    settings,
    persistenceLoads,
    temporalClient,
    dispose: async () => {
      for (const dispose of disposers.splice(0).reverse()) await dispose();
    }
  };
}

async function request(server: EventEmitter, routes: Route[], path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}) {
  const source = options.body === undefined ? [] : [JSON.stringify(options.body)];
  const incoming: any = Readable.from(source);
  incoming.url = path;
  incoming.method = options.method ?? "GET";
  incoming.headers = options.headers ?? {};
  incoming.socket = { localPort: 45123 };
  const response: any = {
    status: 200,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(status: number, headers: Record<string, string> = {}) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(value = "") { this.body += String(value); return this; }
  };
  server.emit("request", incoming, response);
  const routePath = new URL(incoming.url ?? "/", "http://127.0.0.1").pathname;
  const route = routes.find((candidate) => candidate.kind === "exact" && candidate.path === routePath);
  if (!route) throw new Error(`Missing contract route: ${routePath}`);
  await route.handler(incoming, response);
  return {
    status: response.status,
    headers: response.headers,
    json: () => response.body ? JSON.parse(response.body) : {}
  };
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for the contract turn to settle");
}

describe("Bees DSH public contract", () => {
  it("boots, authenticates, runs through DSH, and restarts from the same durable state", async () => {
    const root = mkdtempSync(join(tmpdir(), "bees-dsh-contract-"));
    process.env.BEES_DATABASE_PATH = join(root, "bees.sqlite3");
    process.env.BEES_DSH_TOKEN = "contract-token";
    process.env.BEES_DEFAULT_WORKSPACE = join(root, "runtime");
    const routes: Route[] = [];
    const workspaces = new Map<string, any>();
    const sessions = new Map<string, any[]>();
    const server = new EventEmitter();
    let harness = testContext(server, routes, workspaces, sessions);
    try {
      await apply(harness.ctx, {}, { temporalClient: harness.temporalClient });
      expect((await request(server, routes, "/healthz")).status).toBe(200);
      expect((await request(server, routes, "/bees-api/snapshot")).status).toBe(401);
      const auth = await request(server, routes, "/bees-auth?token=contract-token");
      expect(auth.status).toBe(302);
      const cookie = auth.headers["set-cookie"]?.split(";")[0];
      expect(cookie).toBe("bees_dsh_45123=contract-token");
      expect((await request(server, routes, "/bees-api/snapshot", {
        headers: { cookie: "bees_dsh_45124=contract-token" }
      })).status).toBe(401);
      const headers = { cookie: String(cookie), "content-type": "application/json" };
      const initial = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
      expect(initial.workspaces[0].dshWorkspaceId).toBe("dsh-workspace-1");
      expect(harness.settings).toContain("bees-ui");

      const created = (await request(server, routes, "/bees-api/command", {
        method: "POST", headers,
        body: { action: "create_goal", workspaceId: initial.workspaces[0].id, title: "Contract goal" }
      })).json() as any;
      const customProcess = (await request(server, routes, "/bees-api/command", {
        method: "POST", headers,
        body: {
          action: "create_process", workspaceId: initial.workspaces[0].id,
          name: "Contract process", stages: ["Ready", "Done"]
        }
      })).json() as any;
      const runnable = await request(server, routes, "/bees-api/command", {
        method: "POST", headers,
        body: { action: "ask_bees", workspaceId: initial.workspaces[0].id, outcome: "Plan a contract launch" }
      });
      const planning = runnable.json() as any;
      await waitFor(async () => {
        const snapshot = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
        return snapshot.runs.some((run: any) => run.id === planning.executionId && run.status === "completed");
      });
      const completed = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
      expect(completed.assignments).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Bees work agent", systemRole: "worker" }),
        expect.objectContaining({ name: "Bees reviewer", systemRole: "reviewer" })
      ]));
      expect(completed.stages.filter((stage: any) => stage.processId === customProcess.id).map(({ driver }: any) => driver))
        .toEqual(["agent", "terminal"]);
      const firstRun = completed.runs.find((run: any) => run.id === planning.executionId);
      const history = (await request(server, routes, `/bees-api/run-history?executionId=${firstRun.id}`, { headers })).json() as any;
      expect(history.history.messages).toContainEqual(expect.objectContaining({ role: "assistant" }));
      expect(harness.mountedPresets).toEqual(["standard"]);
      expect(harness.policies).toEqual(["ask"]);
      const references = (await request(
        server, routes, `/bees-api/references?workspaceId=${initial.workspaces[0].id}&q=Contract`, { headers }
      )).json() as any;
      expect(references.at).toContainEqual(expect.objectContaining({ id: created.id, kind: "work-item" }));

      await harness.dispose();
      expect(routes).toHaveLength(0);
      const database = new DatabaseSync(process.env.BEES_DATABASE_PATH);
      database.prepare("UPDATE execution_links SET status = 'running' WHERE execution_id = ?").run(firstRun.id);
      database.close();
      harness = testContext(server, routes, workspaces, sessions);
      await apply(harness.ctx, {}, { temporalClient: harness.temporalClient });
      const secondAuth = await request(server, routes, "/bees-auth?token=contract-token");
      const secondCookie = secondAuth.headers["set-cookie"]?.split(";")[0];
      const restarted = (await request(server, routes, "/bees-api/snapshot", {
        headers: { cookie: String(secondCookie) }
      })).json() as any;
      expect(restarted.items).toContainEqual(expect.objectContaining({ id: created.id, title: "Contract goal" }));
      expect(restarted.runs.find((run: any) => run.id === firstRun.id)?.status).not.toBe("interrupted");
      await waitFor(async () => {
        const snapshot = (await request(server, routes, "/bees-api/snapshot", {
          headers: { cookie: String(secondCookie) }
        })).json() as any;
        return snapshot.runs.some((run: any) => run.id === firstRun.id && run.status === "completed");
      });
      expect(harness.persistenceLoads).toContain(firstRun.sessionId);
      const recovered = (await request(server, routes, "/bees-api/snapshot", {
        headers: { cookie: String(secondCookie) }
      })).json() as any;
      expect(recovered.runs).toContainEqual(expect.objectContaining({
        id: firstRun.id, previousSessionId: firstRun.sessionId, status: "completed"
      }));
      const changedDefault = (await request(server, routes, "/bees-api/system-default-model", {
        method: "POST", headers: { cookie: String(secondCookie), "content-type": "application/json" },
        body: { provider: "local-openai", model: "active", reasoningEffort: "high" }
      })).json() as any;
      expect(changedDefault.systemDefaultModel).toEqual({
        provider: "local-openai", model: "active", reasoningEffort: "high"
      });

      const client = clientSource;
      const localAiClient = readFileSync(new URL(
        "../dsh-runtime/plugins/local-ai/lib/client.js", import.meta.url
      ), "utf8");
      const freeAiClient = readFileSync(new URL(
        "../dsh-runtime/plugins/free-ai/lib/client.js", import.meta.url
      ), "utf8");
      const freeAiHost = readFileSync(new URL(
        "../dsh-runtime/plugins/free-ai/lib/index.js", import.meta.url
      ), "utf8");
      const runtimePreparation = readFileSync(new URL(
        "../scripts/prepare-dsh-runtime.mjs", import.meta.url
      ), "utf8");
      const customAiClient = readFileSync(new URL(
        "../dsh-runtime/plugins/custom-ai/lib/client.js", import.meta.url
      ), "utf8");
      const customAiHost = readFileSync(new URL(
        "../dsh-runtime/plugins/custom-ai/lib/index.js", import.meta.url
      ), "utf8");
      const subscriptionsClient = readFileSync(new URL(
        "../dsh-runtime/plugins/subscriptions/lib/client.js", import.meta.url
      ), "utf8");
      const subscriptionsHost = readFileSync(new URL(
        "../dsh-runtime/plugins/subscriptions/lib/index.js", import.meta.url
      ), "utf8");
      expect(client).toContain('const NAVIGATION = [');
      expect(client).toContain('function WorkItemCockpit');
      expect(client).toContain('"Root work item"');
      expect(client).toContain('"Delegate work"');
      expect(client).toContain('action: "edit_agent_assignment"');
      const pluginHost = readFileSync(new URL("../dsh-runtime/plugin/lib/index.js", import.meta.url), "utf8");
      expect(pluginHost).toContain("systemDefaultModel: ctx.agentDefaultModel.currentSelection()");
      expect(pluginHost).toContain('path: "/bees-api/system-default-model"');
      expect(pluginHost).toContain("ctx.agentDefaultModel.saveSelection");
      expect(client).toContain('NAVIGATION.find((item) => item.id === id || item.defaultChild === id || item.children.some(([child]) => child === id))');
      expect(client).toContain('h(PinButton, { id: child, label, pins, setPins })');
      expect(client).toContain('...pinnedRows(pinned.route).map');
      expect(client).toContain('h(PinButton, { id: route, label: routeLabel, pins, setPins })');
      expect(client).toContain('h(ContextSwitcher, {');
      expect(client).toContain('className: "bees-input bees-context-search"');
      expect(client).toContain('"Search organizations and teams"');
      expect(client).not.toContain('"New workspace"');
      expect(client).not.toContain('"All workspaces"');
      expect(client).not.toContain('"workspace-settings"');
      expect(client).not.toContain('"Default workspace"');
      expect(client).toContain('document.addEventListener("pointerdown", dismiss, true)');
      expect(client).toContain('["light", "Light"]');
      expect(client).toContain('["dark", "Dark"]');
      expect(client).toContain('["system", "System"]');
      expect(client).toContain('(currentIndex + 1) % THEMES.length');
      expect(client).toContain('ctx.theme.setTheme(nextTheme)');
      expect(client).toContain('require("@bees/dsh-local-ai")');
      expect(client).toContain('require("@bees/dsh-free-ai")');
      expect(client).toContain('h(FreeAiController, { modelSettings, onError: setError })');
      expect(client).toContain('require("@bees/dsh-custom-ai")');
      expect(client).toContain('require("@bees/dsh-subscriptions")');
      expect(client).not.toContain('const LOCAL_MODELS = [');
      expect(localAiClient).toContain('invokeLocal("ensure_local_model"');
      expect(localAiClient).toContain('invokeLocal("start_local_model"');
      expect(localAiClient).toContain('DEFAULT_LOCAL_MODEL.id');
      expect(localAiClient).not.toContain('contextSize:');
      expect(localAiClient).toContain('const wanted = config.localModelWantedId;');
      expect(localAiClient).not.toContain('? DEFAULT_LOCAL_MODEL.id : config.localModelWantedId');
      expect(localAiClient).toContain('"data-model-toggle": "download"');
      expect(localAiClient).toContain('"data-model-toggle": "run"');
      expect(localAiClient).toContain('"Add a model"');
      expect(localAiClient).toContain('"external-local-ai"');
      expect(localAiClient).toContain('"externalLocalAiProfile"');
      expect(localAiClient).toContain('"Add model"');
      expect(localAiClient).toContain('systemDefault?.provider === "local-openai"');
      expect(localAiClient).toContain('systemDefault?.provider === "external-local-ai"');
      expect(freeAiClient).toContain('data-bees-plugin": "@bees/dsh-free-ai"');
      expect(freeAiClient).toContain('"Free LLM"');
      expect(freeAiClient).toContain('{ id: "openrouter", name: "OpenRouter Free"');
      expect(freeAiClient).toContain('"/bees-api/free-ai/state"');
      expect(freeAiClient).toContain('"/bees-api/free-ai/command"');
      expect(freeAiClient).toContain('apiKeyEnv: API_KEY_REF');
      expect(freeAiClient).toContain('models: [{ id: "auto"');
      expect(freeAiClient).toContain('exports.FreeAiController = FreeAiController');
      expect(freeAiClient).toContain('role: "switch"');
      expect(freeAiClient).toContain('className: `bees-provider-card');
      expect(freeAiClient).toContain('openExternal(provider.signup)');
      expect(freeAiClient).toContain('"Add and test"');
      expect(freeAiClient).toContain('systemDefault?.provider === "freellmapi"');
      expect(freeAiClient).toContain("it does not spend OpenRouter API credits");
      expect(freeAiClient).not.toContain("credentials.describe");
      expect(freeAiHost).toContain("embedded.startServer({");
      expect(freeAiHost).toContain('"x-dashboard-token": runtime.sessionToken');
      expect(freeAiHost).toContain("/api/health/check/${keyId(added.id)}");
      expect(freeAiHost).toContain('ctx.credentials.set(API_KEY_REF, embedded.getUnifiedApiKey())');
      expect(runtimePreparation).toContain('const freeLlmVersion = "0.8.4"');
      expect(runtimePreparation).toContain("05cbaf60792f5183f74a238ca7938de93b0246e98a90ff571d243ea646e14469");
      expect(runtimePreparation).toContain('external: ["better-sqlite3"]');
      expect(customAiClient).toContain('data-bees-plugin": "@bees/dsh-custom-ai"');
      expect(customAiClient).toContain('"General AI APIs"');
      expect(customAiClient).toContain('{ id: "openrouter", name: "OpenRouter"');
      expect(customAiClient).toContain('{ id: "xai", name: "xAI"');
      expect(customAiClient).toContain('"/bees-api/general-ai/test"');
      expect(customAiClient).toContain('credentials.describe({ refs: Object.values(refs) })');
      expect(customAiClient).toContain('openExternal(provider.signup)');
      expect(customAiClient).toContain('"generalAiModels"');
      expect(customAiClient).toContain('"Model ID"');
      expect(customAiClient).toContain("systemDefault?.provider === provider");
      expect(customAiHost).toContain('path: "/bees-api/general-ai/test"');
      expect(customAiHost).toContain("Preserve credentials saved by the earlier combined AI APIs screen");
      expect(subscriptionsClient).toContain('data-bees-plugin": "@bees/dsh-subscriptions"');
      expect(subscriptionsClient).toContain('"Codex"');
      expect(subscriptionsClient).toContain('"Claude Code"');
      expect(subscriptionsClient).toContain('await openExternal(authUrl)');
      expect(subscriptionsClient).toContain('"aria-label": "Enable Codex"');
      expect(subscriptionsClient).toContain('"claude_models"');
      expect(subscriptionsClient).toContain('"Add model"');
      expect(subscriptionsClient).toContain("systemDefault?.provider === provider");
      expect(subscriptionsHost).toContain("const CLAUDE_REASONING");
      expect(subscriptionsHost).toContain('"low", "medium", "high", "xhigh", "max"');
      expect(subscriptionsClient).not.toContain('"Continue sign in"');
      expect(client).toContain('action: "create_organization"');
      expect(client).not.toContain("organizationOrder");
      expect(client).not.toContain("EntityRail");
      expect(client).not.toContain('api.llm.providers({})');
      expect(client).not.toContain('"Other runtime providers"');
      expect(client).not.toContain('"Models"');
      expect(client).not.toContain('["dsh-settings", "DSH settings"]');
      expect(client).toContain('button[aria-haspopup="dialog"][aria-expanded]');
      expect(client).toContain('ctx.settingsScope.bind({ namespace: "bees-ui" })');
      expect(readFileSync(new URL("../dsh-runtime/plugin/lib/index.js", import.meta.url), "utf8"))
        .toContain("generalAiModels: z.dict(z.array(ModelPreference)).default({})");
      expect(client).not.toContain('id: "bees-navigation"');
      const runtimePackage = JSON.parse(readFileSync(new URL(
        "../dsh-runtime/package.json", import.meta.url
      ), "utf8"));
      const pluginPackage = JSON.parse(readFileSync(new URL(
        "../dsh-runtime/plugin/package.json", import.meta.url
      ), "utf8"));
      expect(runtimePackage.dependencies).toMatchObject({
        "@bees/dsh-local-ai": "file:plugins/local-ai",
        "@bees/dsh-free-ai": "file:plugins/free-ai",
        "@bees/dsh-custom-ai": "file:plugins/custom-ai",
        "@bees/dsh-subscriptions": "file:plugins/subscriptions",
        "better-sqlite3": "12.10.0",
        "@tobilu/qmd": "2.5.3"
      });
      expect(pluginPackage.dsh.client.inject).toEqual(expect.arrayContaining([
        "@bees/dsh-local-ai", "@bees/dsh-free-ai", "@bees/dsh-custom-ai", "@bees/dsh-subscriptions"
      ]));
      const requiredClientModules = [...client.matchAll(/require\(\"(@bees\/[^\"]+)\"\)/g)]
        .map((match) => match[1]);
      expect(pluginPackage.dsh.client.external).toEqual(requiredClientModules);
      const release = runtimePackage.dependencies["@deepseek-ai/dsh"];
      expect(release).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      for (const [name, version] of Object.entries(runtimePackage.dependencies))
        if (name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")) expect(version).toBe(release);
      for (const [name, version] of Object.entries(pluginPackage.peerDependencies))
        if (name.startsWith("@deepseek-ai/dsh-")) expect(version).toBe(release);
    } finally {
      await harness.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
