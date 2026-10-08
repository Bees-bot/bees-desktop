import { setTimeout as sleep } from "node:timers/promises";
import { isAgentLoopRequest } from "@deepseek-ai/dsh-llm";

const isLocal = (provider) => provider === "local-openai" || provider?.startsWith("local-openai-");

const setting = (ctx, ns) => ctx.settings.describe().find((row) => row.ns === ns)?.value;
const wanted = (ctx, provider) => (setting(ctx, "bees")?.localModelWantedIds ?? []).some((id) => provider === "local-openai" ||
  provider === `local-openai-${id.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`);

/** The desktop app restarts a wanted model that is down, so wait up to five minutes for it to answer. */
async function localModelReady(ctx, provider, signal) {
  for (const end = Date.now() + 300_000; Date.now() < end && wanted(ctx, provider);) {
    const base = setting(ctx, "llm-pi-ai")?.providers?.[provider]?.baseURL;
    if (base && await fetch(new URL("/health", base), { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })
      .then((response) => response.ok, () => false)) return;
    await sleep(1000, undefined, { signal });
  }
}

/** llama-server has one slot. Queue before pi-ai starts its stream idle timer. */
export class LocalInference {
  queues = new Map();
  stop = new AbortController();

  async acquire(base, signal, background = false, affinity) {
    signal = AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])]);
    signal.throwIfAborted();
    // The active-model alias, named provider and memory bridge share the same process.
    const key = new URL(base).origin;
    let queue = this.queues.get(key);
    if (!queue) this.queues.set(key, queue = { active: false, pending: [] });
    return new Promise((resolve, reject) => {
      const entry = { resolve, background, affinity, cleanup: () => signal.removeEventListener("abort", abort) };
      const abort = () => {
        queue.pending.splice(queue.pending.indexOf(entry), 1);
        entry.cleanup();
        reject(signal.reason);
        this.advance(key, queue);
      };
      queue.pending.push(entry);
      signal.addEventListener("abort", abort, { once: true });
      this.advance(key, queue);
    });
  }

  advance(key, queue) {
    if (queue.active) return;
    const continuation = queue.pending.findIndex((entry) => !entry.background && entry.affinity && entry.affinity === queue.affinity);
    if (queue.timer && continuation < 0 && !this.stop.signal.aborted) return;
    clearTimeout(queue.timer); queue.timer = null;
    if (!queue.pending.length) { this.queues.delete(key); return; }
    // Keep memory extraction and title generation from interrupting queued agent turns.
    const foreground = queue.pending.findIndex(({ background }) => !background);
    const [entry] = queue.pending.splice(continuation >= 0 && queue.burst < 4 ? continuation : foreground < 0 ? 0 : foreground, 1);
    queue.burst = entry.affinity && queue.affinity === entry.affinity ? (queue.burst ?? 0) + 1 : 1;
    queue.affinity = entry.affinity;
    queue.active = true;
    entry.cleanup();
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      queue.active = false;
      // Let fast tools return before starting a background job. The four-request
      // bound yields to other workers, not to memory/title jobs between steps.
      if (entry.affinity && !this.stop.signal.aborted &&
          (queue.burst < 4 || !queue.pending.some(({ background }) => !background))) {
        queue.timer = setTimeout(() => { queue.timer = null; this.advance(key, queue); }, 100);
        return;
      }
      this.advance(key, queue);
    });
  }

  close() { this.stop.abort(); }
}

export function mountLocalInference(ctx) {
  const inference = new LocalInference();
  ctx.on("dispose", () => inference.close());
  const stopped = (signal) => AbortSignal.any([inference.stop.signal, ...(signal ? [signal] : [])]);
  // an agent call binds its server address before llm/stream, so it has to wait here first
  ctx.on("agent/created", ({ agent }) => {
    agent.ctx.on("agent/request", async ({ signal }, next) => {
      const config = await next();
      if (isLocal(config.provider) && wanted(ctx, config.provider)) await localModelReady(ctx, config.provider, stopped(signal));
      return config;
    });
  }, { global: true });
  ctx.on("llm/stream", async function* (options, next) {
    const provider = options.provider;
    if (!isLocal(provider)) {
      yield* next(); return;
    }
    // skipping the await keeps queue order when no local model is wanted
    if (wanted(ctx, provider)) await localModelReady(ctx, provider, stopped(options.signal));
    const base = ctx.settings.describe().find(({ ns }) => ns === "llm-pi-ai")?.value?.providers?.[provider]?.baseURL;
    if (!base) { yield* next(); return; }
    const foreground = isAgentLoopRequest(options);
    const release = await inference.acquire(base, options.signal, !foreground,
      foreground ? options.sessionId : undefined);
    try {
      options.signal?.throwIfAborted();
      yield* next();
    } finally { release(); }
  });
  return inference;
}
