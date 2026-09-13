import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeProductDatabase } from "../dsh-runtime/plugin/lib/product-database.js";
import { ProcessRuntime, processWorkflowId } from "../dsh-runtime/plugin/lib/process-runtime.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const { Client, Connection } = require("@temporalio/client");
const { Worker, NativeConnection } = require("@temporalio/worker");
const target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin" ? "apple-darwin" : process.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
const binary = new URL(`../src-tauri/binaries/temporal-${target}${process.platform === "win32" ? ".exe" : ""}`, import.meta.url);

async function until(predicate) {
  for (let i = 0; i < 200; i += 1) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error("Timed out waiting for the workflow transition");
}

// Run explicitly: node --test tests/durable-temporal.integration.mjs
// Uses only an isolated Temporal database and a fake agent; never calls an AI provider.
test("durable human waits survive offline time and server restart; active steps recover on worker replacement", { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "bees-durable-temporal-"));
  const database = new DatabaseSync(join(directory, "bees.db"));
  initializeProductDatabase(database);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const address = `127.0.0.1:${port}`;
  let server, connection, nativeConnection, runtime, client;
  let serverLog = "";
  const calls = [];
  let recoverActive = false;
  let answerReceived = false;
  const phase = (id) => database.prepare("SELECT runtime_phase AS phase FROM work_items WHERE id = ?").get(id)?.phase;
  const addWork = (id) => {
    const stage = database.prepare(`SELECT s.id, s.process_id FROM stages s JOIN processes p ON p.id = s.process_id
      WHERE p.kind = 'goals' AND s.driver = 'agent' LIMIT 1`).get();
    database.prepare(`INSERT INTO work_items (id, process_id, stage_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')`).run(id, stage.process_id, stage.id, id);
  };
  const startServer = async () => {
    server = spawn(fileURLToPath(binary), ["server", "start-dev", "--headless", "--ip", "127.0.0.1", "--port", String(port),
      "--db-filename", join(directory, "temporal.db"), "--disable-config-file", "--disable-config-env"],
    { stdio: ["ignore", "pipe", "pipe"] });
    server.on("error", (error) => { serverLog += error.message; });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverLog = (serverLog + data).slice(-4_000); });
    connection = await Connection.connect({ address, connectTimeout: "15 seconds" });
    client = new Client({ connection });
  };
  const stopServer = async () => {
    await connection?.close();
    connection = null;
    if (server && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    server = null;
  };
  const startWorker = async () => {
    nativeConnection = await NativeConnection.connect({ address });
    runtime = new ProcessRuntime(database, {
      client, pendingInteraction: () => answerReceived ? null : { kind: "work-review" },
      workerFactory: (options) => Worker.create({ ...options, connection: nativeConnection }),
    });
    await runtime.start(async (stage, signal) => {
      calls.push({ id: stage.workItemId, executionId: stage.executionId, purpose: stage.purpose });
      if (stage.workItemId === "active" && !recoverActive)
        await new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      if (stage.workItemId === "approval" && stage.purpose === "reviewer" && !answerReceived)
        return { outcome: "suspended" };
      return { outcome: stage.purpose === "reviewer" ? "pass" : "candidate", summary: "Finished" };
    });
  };
  const stopWorker = async () => {
    await runtime?.close();
    runtime = null;
    await nativeConnection?.close();
    nativeConnection = null;
  };
  try {
    await startServer();
    addWork("approval");
    await startWorker();
    await until(() => phase("approval") === "waiting");
    await until(async () => !(await connection.workflowService.describeWorkflowExecution({
      namespace: "default", execution: { workflowId: processWorkflowId("approval") },
    })).pendingActivities?.length);
    const reviewId = calls.find(({ purpose }) => purpose === "reviewer").executionId;
    await stopWorker();
    await stopServer();
    // Longer than the real 30-second heartbeat deadline, with the same databases restored afterward.
    await delay(31_000);
    await startServer();
    await startWorker();
    assert.equal(phase("approval"), "waiting");
    assert.equal(calls.length, 2);
    answerReceived = true;
    await runtime.wakeStage(reviewId);
    await until(() => phase("approval") === "completed");
    assert.deepEqual(calls.map(({ purpose }) => purpose), ["worker", "reviewer", "reviewer"]);
    assert.equal(calls[2].executionId, reviewId);

    addWork("active");
    await runtime.reconcile();
    await until(() => calls.some(({ id }) => id === "active"));
    const activeId = calls.find(({ id }) => id === "active").executionId;
    await stopWorker();
    recoverActive = true;
    await startWorker();
    await until(() => phase("active") === "completed");
    const attempts = calls.filter(({ id, purpose }) => id === "active" && purpose === "worker");
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(({ executionId }) => executionId === activeId));
  } catch (error) {
    error.message += `\nWork state: ${JSON.stringify(database.prepare("SELECT id, runtime_phase, runtime_error FROM work_items").all())}\nCalls: ${JSON.stringify(calls)}`;
    if (client) error.message += `\nWorkflow: ${JSON.stringify(await client.workflow.getHandle(processWorkflowId("approval")).describe().catch((failure) => ({ error: failure.message })))}`;
    error.message += `\nIsolated Temporal log:\n${serverLog}`;
    throw error;
  } finally {
    await stopWorker();
    await stopServer();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
