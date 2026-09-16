import { appendFileSync } from "node:fs";

// One JSON line per event. Never include credentials, configuration, or error messages.
export function mark(phase, event = "mark", durationMs) {
  const path = process.env.BEES_STARTUP_LOG;
  if (!path) return;
  const line = `[bees-startup] ${JSON.stringify({
    atMs: Date.now(), pid: process.pid, source: "dsh", phase, event,
    elapsedMs: Math.round(process.uptime() * 1000),
    ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) })
  })}\n`;
  // A diagnostic must never prevent the runtime from starting.
  try { appendFileSync(path, line); } catch {}
}

export function startStep(phase) {
  const started = performance.now();
  mark(phase, "start");
  return (event = "done") => mark(phase, event, performance.now() - started);
}

// Preserve synchronous return values and the original error, including async rejection.
export function step(phase, run) {
  const finish = startStep(phase);
  try {
    const result = run();
    if (result && typeof result.then === "function") return Promise.resolve(result).then(
      (value) => { finish(); return value; },
      (error) => { finish("failed"); throw error; }
    );
    finish();
    return result;
  } catch (error) { finish("failed"); throw error; }
}

// Cordis exposes dependency waits separately from plugin execution. Observe only boot;
// agent contexts and later plugin reloads must not turn this into a session event log.
export function observePlugins(ctx) {
  const pending = new Map();
  const stops = [ctx.on("internal/plugin", (fiber) => {
    if (!fiber.runtime?.name || fiber.uid === null) return;
    pending.set(fiber, startStep(`plugin.wait:${fiber.name}#${fiber.uid}`));
  }, { global: true }), ctx.on("internal/status", (fiber) => {
    const finish = pending.get(fiber);
    if (!finish) return;
    if (fiber.state === 1) {
      finish();
      pending.set(fiber, startStep(`plugin.init:${fiber.name}#${fiber.uid}`));
    } else if ([2, 3, 4, 5].includes(fiber.state)) {
      finish(fiber.state === 2 ? "done" : fiber.state === 3 ? "failed" : "stopped");
      pending.delete(fiber);
    }
  }, { global: true })];
  return () => {
    stops.forEach((stop) => stop());
    for (const finish of pending.values()) finish("pending-at-boot-end");
    pending.clear();
  };
}
