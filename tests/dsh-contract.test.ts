import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { apply } from "../dsh-runtime/plugin/lib/index.js";

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
  const ctx: any = {
    logger: { warn: () => undefined },
    effect(factory: () => unknown) {
      const dispose = factory();
      if (typeof dispose === "function") disposers.push(dispose as () => unknown);
      return dispose;
    },
    on: () => () => undefined,
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
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose();
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
      await apply(harness.ctx);
      expect((await request(server, routes, "/healthz")).status).toBe(200);
      expect((await request(server, routes, "/bees-api/snapshot")).status).toBe(401);
      const auth = await request(server, routes, "/bees-auth?token=contract-token");
      expect(auth.status).toBe(302);
      const cookie = auth.headers["set-cookie"]?.split(";")[0];
      expect(cookie).toContain("bees_dsh=contract-token");
      const headers = { cookie: String(cookie), "content-type": "application/json" };
      const initial = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
      expect(initial.workspaces[0].dshWorkspaceId).toBe("dsh-workspace-1");
      expect(harness.settings).toContain("bees-ui");

      const created = (await request(server, routes, "/bees-api/command", {
        method: "POST", headers,
        body: { action: "create_goal", workspaceId: initial.workspaces[0].id, title: "Contract goal" }
      })).json() as any;
      await request(server, routes, "/bees-api/command", {
        method: "POST", headers,
        body: { action: "run_item", itemId: created.id, model: "test-provider/test-model" }
      });
      await waitFor(async () => {
        const snapshot = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
        return snapshot.runs.some((run: any) => run.workItemId === created.id && run.status === "completed");
      });
      const completed = (await request(server, routes, "/bees-api/snapshot", { headers })).json() as any;
      const firstRun = completed.runs.find((run: any) => run.workItemId === created.id);
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
      await apply(harness.ctx);
      const secondAuth = await request(server, routes, "/bees-auth?token=contract-token");
      const secondCookie = secondAuth.headers["set-cookie"]?.split(";")[0];
      const restarted = (await request(server, routes, "/bees-api/snapshot", {
        headers: { cookie: String(secondCookie) }
      })).json() as any;
      expect(restarted.items).toContainEqual(expect.objectContaining({ id: created.id, title: "Contract goal" }));
      expect(restarted.runs).toContainEqual(expect.objectContaining({ workItemId: created.id, status: "interrupted" }));
      await request(server, routes, "/bees-api/command", {
        method: "POST", headers: { cookie: String(secondCookie), "content-type": "application/json" },
        body: { action: "recover_run", executionId: firstRun.id }
      });
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

      const client = readFileSync(new URL("../dsh-runtime/plugin/lib/client.js", import.meta.url), "utf8");
      expect(client).toContain('const NAVIGATION = [');
      expect(client).toContain('NAVIGATION.flatMap((item) => [');
      expect(client).toContain('h(PinButton, { id: child, label, pins, setPins })');
      expect(client).toContain('...pinnedRows(pinned.route).map');
      expect(client).toContain('h(PinButton, { id: route, label: routeLabel, pins, setPins })');
      expect(client).toContain('h(ContextSwitcher, {');
      expect(client).toContain('className: "bees-input bees-context-search"');
      expect(client).toContain('document.addEventListener("pointerdown", dismiss, true)');
      expect(client).toContain('action: "create_organization"');
      expect(client).not.toContain("organizationOrder");
      expect(client).not.toContain("EntityRail");
      expect(client).toContain('api.llm.providers({})');
      expect(client).not.toContain("openDsh");
      expect(client).toContain('ctx.settingsScope.bind({ namespace: "bees-ui" })');
      expect(client).not.toContain('id: "bees-navigation"');
      const runtimePackage = JSON.parse(readFileSync(new URL(
        "../dsh-runtime/package.json", import.meta.url
      ), "utf8"));
      const pluginPackage = JSON.parse(readFileSync(new URL(
        "../dsh-runtime/plugin/package.json", import.meta.url
      ), "utf8"));
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
