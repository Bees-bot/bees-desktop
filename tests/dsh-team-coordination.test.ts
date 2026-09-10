import { createRequire } from "node:module";
import { expect, it } from "vitest";
// @ts-expect-error Plain JS runtime boundary.
import { mountTeamCoordination } from "../dsh-runtime/plugin/lib/team-coordination.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Context } = require("@deepseek-ai/cordis");
const { createScope, scopeTarget } = require("@deepseek-ai/dsh-scope");
const { SystemPrompt } = require("@deepseek-ai/dsh-system-prompt");
const { ToolRuntime, defineTool } = require("@deepseek-ai/dsh-tools");
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const ctx = new Context();
  const prompt = new SystemPrompt(ctx, {});
  const tools = new ToolRuntime(ctx);
  const scopes: any[] = [];
  const roots = new Map<any, any>();
  const roster: any[] = [];
  const teams = {
    tryMembership: (agent: any) => roots.has(agent) ? { root: roots.get(agent) } : undefined,
    membership: (agent: any) => ({ root: roots.get(agent) }),
    listMembers: (agent: any) => roster.filter((member) => roots.get(member) === roots.get(agent))
      .map(({ id, name, status }) => ({ id, name, status })),
  };
  for (const name of ["list_agents", "wait_agent"]) tools.register(defineTool({
    name, description: name, parameters: {},
    output: { schema: { type: "object", additionalProperties: false, properties: {} }, render: () => [] },
    execute: () => ({}),
  }));
  return {
    ctx, prompt, teams,
    agent(name: string, root?: any, managed = true) {
      const inbox = { nextStep: [] as any[], nextTurn: [] as any[],
        get hasPending() { return this.nextStep.length > 0 || this.nextTurn.length > 0; } };
      const agent: any = { id: name, name, status: "running", inbox, session: { id: name, header: {} } };
      const scope = createScope(ctx, agent, root ? { parent: root } : {});
      agent.ctx = scope.ctx;
      agent.disposeScope = () => scope.dispose();
      scopes.push(scope);
      roots.set(agent, root ?? agent);
      roster.push(agent);
      if (managed) mountTeamCoordination(scope.ctx, teams);
      return agent;
    },
    wait(agent: any, signal = new AbortController().signal) {
      return tools.execute({ agent, callId: `wait-${agent.id}`, name: "bees_wait_for_team", arguments: {}, signal });
    },
    status(agent: any, status: string) {
      agent.status = status;
      ctx.emit(scopeTarget(agent, agent), "agent/status", { agent, status });
    },
    message(agent: any, target: "nextStep" | "nextTurn" = "nextStep") {
      const message = { id: "message" };
      agent.inbox[target].push(message);
      ctx.emit(scopeTarget(agent, agent), "agent/inbox/inserted", { agent, message });
    },
    remove(agent: any) {
      roster.splice(roster.indexOf(agent), 1);
      ctx.emit(scopeTarget(agent, agent), "agent/disposed", { agent });
    },
    listeners() {
      return ["agent/status", "agent/inbox/inserted", "agent/disposed"]
        .map((event) => ctx.events._hooks[event]?.length ?? 0);
    },
    async close() { for (const scope of scopes.reverse()) await scope.dispose(); },
  };
}

it("provides live roster context and hides polling tools only in the owned scope", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const solo = await h.prompt.assemble({ scope: lead });
    expect(solo.contexts).toEqual([{ name: "bees:team-status", text: "" }]);
    expect(solo.tools).toEqual([]);
    const peer = h.agent("peer", lead);
    const unmanaged = h.agent("unmanaged", lead, false);
    const other = h.agent("other", undefined, false);
    const assembly = await h.prompt.assemble({ scope: lead });
    expect(assembly.tools.map(({ name }: any) => name)).toEqual(["bees_wait_for_team"]);
    expect(assembly.contexts[0].text).toContain("peer=running");
    expect(assembly.contexts[0].text).toContain("never list_agents or wait_agent");
    h.status(peer, "idle");
    expect((await h.prompt.assemble({ scope: lead })).contexts[0].text).toContain("peer=idle");
    for (const agent of [unmanaged, other]) {
      const unrelated = await h.prompt.assemble({ scope: agent });
      expect(unrelated.tools.map(({ name }: any) => name)).toEqual(expect.arrayContaining(["list_agents", "wait_agent"]));
      expect(unrelated.contexts.every(({ text }: any) => !text)).toBe(true);
    }
    expect((await h.wait(unmanaged)).isError).toBe(true);
  } finally { await h.close(); }
});

it("returns immediately for existing messages or when no peer can progress", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    expect((await h.wait(lead)).value.reason).toBe("no-progress");
    const peer = h.agent("peer", lead);
    h.status(peer, "idle");
    expect((await h.wait(lead)).value.reason).toBe("no-progress");
    h.message(lead);
    expect((await h.wait(lead)).value.reason).toBe("message");
    expect(h.listeners()).toEqual([0, 0, 0]);
  } finally { await h.close(); }
});

it("keeps a single call pending across irrelevant events and wakes for the caller's inbox", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const peer = h.agent("peer", lead);
    const other = h.agent("other");
    let settled = false;
    const waiting = h.wait(lead).then((value: any) => { settled = true; return value; });
    await tick();
    expect(h.listeners()).toEqual([1, 1, 1]);
    h.message(peer);
    h.status(other, "idle");
    h.ctx.emit("session/event", {}, { type: "team/task" });
    await tick();
    expect(settled).toBe(false);
    h.message(lead);
    expect((await waiting).value.reason).toBe("message");
    expect(h.listeners()).toEqual([0, 0, 0]);
  } finally { await h.close(); }
});

it.each(["idle", "failed", "disappeared"])("wakes when an active peer becomes %s", async (status) => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const peer = h.agent("peer", lead);
    const waiting = h.wait(lead);
    await tick();
    if (status === "disappeared") h.remove(peer);
    else h.status(peer, status);
    const result = await waiting;
    expect(result.isError).toBe(false);
    expect(result.value.reason).toBe("member-settled");
    expect(h.listeners()).toEqual([0, 0, 0]);
  } finally { await h.close(); }
});

it.each(["nextStep", "nextTurn"] as const)("handles a %s message at its own inbox boundary", async (target) => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    h.agent("peer", lead);
    const waiting = h.wait(lead);
    await tick();
    h.message(lead, target);
    const result = await waiting;
    expect(result.value.reason).toBe("message");
    expect(Boolean(result.concludesTurn)).toBe(target === "nextTurn");
  } finally { await h.close(); }
});

it("observes failed provisioning after the durable roster projection updates", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const peer = h.agent("peer", lead);
    peer.status = "provisioning";
    const waiting = h.wait(lead);
    await tick();
    h.ctx.emit("session/event", lead.session, { type: "team/member" });
    peer.status = "failed";
    expect((await waiting).value).toMatchObject({
      reason: "member-settled", members: [{ name: "lead", status: "running" }, { name: "peer", status: "failed" }]
    });
    expect(h.ctx.events._hooks["session/event"]?.length ?? 0).toBe(0);
  } finally { await h.close(); }
});

it("wakes one participant when all live participants attempt to wait for each other", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const peer = h.agent("peer", lead);
    const first = h.wait(lead);
    await tick();
    expect((await h.prompt.assemble({ scope: peer })).contexts[0].text).toContain("lead=waiting");
    const second = h.wait(peer);
    expect((await first).value.reason).toBe("no-progress");
    h.status(lead, "idle");
    expect((await second).value.reason).toBe("member-settled");
    expect(h.listeners()).toEqual([0, 0, 0]);
  } finally { await h.close(); }
});

it("cancels pending calls, disposes listeners, and clears waiting bookkeeping", async () => {
  const h = harness();
  try {
    const lead = h.agent("lead");
    const peer = h.agent("peer", lead);
    const abort = new AbortController();
    const waiting = h.wait(lead, abort.signal);
    await tick();
    abort.abort(new Error("Canceled by owner"));
    expect((await waiting).isError).toBe(true);
    expect(h.listeners()).toEqual([0, 0, 0]);
    expect((await h.prompt.assemble({ scope: peer })).contexts[0].text).toContain("lead=running");
    const retry = h.wait(lead);
    await tick();
    h.status(peer, "idle");
    expect((await retry).value.reason).toBe("member-settled");
    h.status(peer, "running");
    const disposed = h.wait(lead);
    await tick();
    await lead.disposeScope();
    expect((await disposed).isError).toBe(true);
    expect(h.listeners()).toEqual([0, 0, 0]);
  } finally { await h.close(); }
});
