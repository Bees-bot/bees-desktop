import { scopeOf } from "@deepseek-ai/dsh-scope";
import { defineTool } from "@deepseek-ai/dsh-tools";

const ACTIVE = new Set(["running", "provisioning"]);
const POLLING_TOOLS = new Set(["list_agents", "wait_agent"]);
// Native status remains running inside a tool. Share blocked waiters across the live Team.
const waitingByTeam = new WeakMap();

function members(teams, agent) {
  const membership = teams.tryMembership(agent);
  if (!membership) return [];
  const waiting = waitingByTeam.get(membership.root);
  return teams.listMembers(agent).map(({ id, name, status }) => ({
    name, status: waiting?.has(id) ? "waiting" : status
  }));
}

/** Wait for actionable discussion updates, or for all named participants to stop working. */
export function waitForTeam(agentCtx, teams, agent, signal, requiredNames) {
  signal.throwIfAborted();
  const { root } = teams.membership(agent);
  let waiting = waitingByTeam.get(root);
  if (!waiting) waitingByTeam.set(root, waiting = new Map());
  if (waiting.has(agent.id)) throw new Error("This agent is already waiting for its team");
  const active = new Set(teams.listMembers(agent)
    .filter(({ id, status }) => id !== agent.id && ACTIVE.has(status)).map(({ id }) => id));

  return new Promise((resolve, reject) => {
    let settled = false;
    const disposers = [];
    const finish = (reason, error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      for (const dispose of disposers) dispose();
      waiting.delete(agent.id);
      if (error) reject(error);
      else {
        try { resolve({ reason, members: members(teams, agent) }); }
        catch (failure) { reject(failure); }
      }
    };
    const aborted = () => finish(undefined, signal.reason ?? new Error("Team wait aborted"));
    const check = () => {
      if (settled) return;
      try {
        if (requiredNames) {
          const required = teams.listMembers(agent).filter(({ name }) => requiredNames.includes(name));
          if (!required.some(({ status }) => ACTIVE.has(status))) return finish("member-settled");
          if (required.filter(({ status }) => ACTIVE.has(status)).every(({ id }) => waiting.has(id)))
            return finish("no-progress");
          return;
        }
        if ((agent.inbox.nextStep.length || agent.inbox.nextTurn.length)) return finish("message");
        const roster = teams.listMembers(agent);
        if ([...active].some((id) => !roster.some((member) => member.id === id && ACTIVE.has(member.status))))
          return finish("member-settled");
        if (!roster.some(({ id, status }) => id !== agent.id && ACTIVE.has(status) && !waiting.has(id)))
          finish("no-progress");
      } catch (error) { finish(undefined, error); }
    };
    disposers.push(agentCtx.on("agent/inbox/inserted", ({ agent: target }) => {
      if (target === agent) check();
    }));
    disposers.push(agentCtx.on("agent/status", ({ agent: target }) => {
      if (active.has(target.id)) check();
    }, { global: true }));
    disposers.push(agentCtx.on("agent/disposed", ({ agent: target }) => {
      if (target === agent) finish(undefined, new Error("Team wait agent disposed"));
      else if (active.has(target.id)) check();
    }, { global: true }));
    disposers.push(agentCtx.on("session/event", (session, event) => {
      // Failed provisioning may never create a live agent. Recheck after projection applies.
      if (session === root.session && event.type === "team/member") queueMicrotask(check);
    }, { global: true }));
    disposers.push(agentCtx.effect(() => () => finish(undefined, new Error("Team wait scope disposed"))));
    signal.addEventListener("abort", aborted, { once: true });
    waiting.set(agent.id, check);
    // Joining the waiting set can remove the last runnable peer for an existing waiter.
    for (const recheck of [...waiting.values()]) recheck();
    if (signal.aborted) aborted();
  });
}

/** Runtime-owned team status and waiting, mounted only for this managed agent. */
export function mountTeamCoordination(agentCtx, teams) {
  if (!agentCtx?.on || !agentCtx.systemPrompt?.context || !teams?.tryMembership) return;
  const owner = scopeOf(agentCtx);
  if (!owner) return;
  agentCtx.systemPrompt.context({
    name: "bees:team-status", order: 125,
    text: ({ scope }) => {
      if (scope !== owner) return "";
      const roster = members(teams, owner);
      return roster.length > 1
        ? `Current team: ${roster.map(({ name, status }) => `${name}=${status}`).join(", ")}. Runtime updates this roster automatically. Use bees_wait_for_team once when waiting, never list_agents or wait_agent; it returns when a message or teammate result needs attention. If no peer can progress, use existing results or give an idle peer a concrete follow-up.`
        : "";
    }
  });
  agentCtx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const assembly = await next();
    if (context.scope !== owner) return assembly;
    const hasTeam = members(teams, owner).length > 1;
    return { ...assembly, tools: assembly.tools.filter(({ name }) =>
      !POLLING_TOOLS.has(name) && (name !== "bees_wait_for_team" || hasTeam) &&
      (name !== "bees_finish_discussion" || teams.tryMembership(owner)?.root !== owner && hasTeam)) };
  });
  agentCtx.tools.register(defineTool({
    name: "bees_finish_discussion",
    description: "Send your completed discussion recommendation to the lead and end this turn in one operation. Use send_message only for interim discussion. Do not keep researching after your contribution is complete.",
    parameters: { summary: { type: "string", required: true, description: "Your complete recommendation and reasoning." } },
    output: {
      schema: { type: "object", additionalProperties: false, properties: { reported: { type: "boolean", required: true } } },
      render: () => [{ type: "text", text: "Discussion contribution sent; ending this turn." }]
    },
    execute: async ({ summary }, exec) => {
      if (exec.agent !== owner || teams.membership(owner).root === owner)
        throw new Error("Only a discussion participant can finish its contribution");
      if (typeof summary !== "string" || !summary.trim()) throw new Error("A discussion recommendation is required");
      await teams.sendMessage(owner, {
        target: "lead", content: [{ type: "text", text: summary }], signal: exec.signal
      });
      exec.concludeTurn();
      return { reported: true };
    }
  }));
  agentCtx.tools.register(defineTool({
    name: "bees_wait_for_team",
    description: "Wait once for a teammate result or an incoming message. Runtime checks status without polling or additional model turns. Returns no-progress when no teammate can continue, including teammates also waiting. Use existing results or give an idle teammate a concrete follow-up then.",
    parameters: {},
    output: {
      schema: {
        type: "object", additionalProperties: false, properties: {
          reason: { type: "string", required: true, enum: ["message", "member-settled", "no-progress"] },
          members: { type: "array", required: true, items: {
            type: "object", additionalProperties: false, properties: {
              name: { type: "string", required: true }, status: { type: "string", required: true }
            }
          } }
        }
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    execute: async (_args, exec) => {
      if (exec.agent !== owner) throw new Error("Team coordination belongs to this run's own agent");
      const result = await waitForTeam(agentCtx, teams, owner, exec.signal);
      // Ordinary follow-ups belong to their own turn; another step cannot consume them.
      if (result.reason === "message" && !owner.inbox.nextStep.length && owner.inbox.nextTurn.length)
        exec.concludeTurn();
      return result;
    }
  }));
}
