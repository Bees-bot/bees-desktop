import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { bindParentLifecycle } from "../parent-lifecycle.mjs";
import {
  Connection,
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

const taskQueue = "bees-work-items-v1";
const workflowType = "workItemWorkflow";
const stateQuery = "runtimeState";
const commandUpdate = "workItemCommand";
const archiveStateSignal = "archiveState";
const address = process.env.BEES_TEMPORAL_ADDRESS;
const databasePath = process.env.BEES_DATABASE_PATH;
const token = process.env.BEES_WORKFLOW_TOKEN ?? "";
const port = Number.parseInt(process.env.PORT ?? "0", 10);

if (!address || !databasePath || !token || !port) {
  throw new Error("The local process runtime is missing its launch configuration");
}

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");
database.exec("PRAGMA foreign_keys = ON");

function workflowId(organizationId, workItemId) {
  return `org/${organizationId}/work-item/${workItemId}`;
}

function workflowInput(organizationId, workItemId) {
  const work = database
    .prepare(
      `SELECT w.process_id AS processId, w.stage_id AS stageId, p.team_id AS teamId
       FROM work_items w
       JOIN processes p ON p.id = w.process_id
       JOIN teams t ON t.id = p.team_id
       WHERE w.id = ? AND w.deleted_at IS NULL AND t.organization_id = ?`
    )
    .get(workItemId, organizationId);
  if (!work) throw new Error("Work item not found");
  const stages = database
    .prepare(
      `SELECT id, is_terminal AS isTerminal FROM stages
       WHERE process_id = ? AND (archived_at IS NULL OR id = ?)
       ORDER BY position`
    )
    .all(work.processId, work.stageId);
  const validStageIds = stages.map(({ id }) => String(id));
  if (!validStageIds.includes(String(work.stageId))) {
    throw new Error("The work item does not point at a valid process stage");
  }
  return {
    organizationId,
    teamId: String(work.teamId),
    workItemId,
    processId: String(work.processId),
    stageId: String(work.stageId),
    validStageIds,
    terminalStageIds: stages.filter(({ isTerminal }) => Number(isTerminal) === 1).map(({ id }) => String(id))
  };
}

function projectStage({ organizationId, workItemId, processId, stageId }) {
  const result = database
    .prepare(
      `UPDATE work_items
       SET stage_id = ?, updated_at = ?
       WHERE id = ? AND process_id = ?
         AND EXISTS (
           SELECT 1 FROM stages s
           JOIN processes p ON p.id = s.process_id
           JOIN teams t ON t.id = p.team_id
           WHERE s.id = ? AND s.process_id = work_items.process_id
             AND t.organization_id = ?
         )`
    )
    .run(stageId, new Date().toISOString(), workItemId, processId, stageId, organizationId);
  if (Number(result.changes) !== 1) {
    throw new Error("The requested stage does not belong to this work item's process");
  }
}

const [clientConnection, workerConnection] = await Promise.all([
  Connection.connect({ address }),
  NativeConnection.connect({ address })
]);
const client = new WorkflowClient({ connection: clientConnection, namespace: "default" });
const worker = await Worker.create({
  connection: workerConnection,
  namespace: "default",
  taskQueue,
  workflowsPath: fileURLToPath(new URL("./work-item-workflow.ts", import.meta.url)),
  activities: { projectStage }
});
const workerRun = worker.run();

async function ensure(input) {
  try {
    await client.start(workflowType, {
      workflowId: workflowId(input.organizationId, input.workItemId),
      taskQueue,
      args: [input]
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
  return client.getHandle(workflowId(input.organizationId, input.workItemId));
}

// A query costs no history; an update is recorded forever. Reads happen every few seconds per
// item, so they only write when the process definition has actually moved.
async function configured(handle, input) {
  const current = await handle.query(stateQuery);
  if (current.processId === input.processId
    && JSON.stringify(current.validStageIds) === JSON.stringify([...new Set(input.validStageIds)])
    && JSON.stringify(current.terminalStageIds) === JSON.stringify([...new Set(input.terminalStageIds)])) return current;
  return handle.executeUpdate(commandUpdate, { args: [{
    type: "configure",
    processId: input.processId,
    validStageIds: input.validStageIds,
    terminalStageIds: input.terminalStageIds
  }] });
}

async function state(organizationId, workItemId) {
  const input = workflowInput(organizationId, workItemId);
  return configured(await ensure(input), input);
}

function isNondeterminism(error) {
  let message = "";
  for (let value = error, depth = 0; value && depth < 5; depth++) {
    message += ` ${typeof value?.message === "string" ? value.message : String(value)}`;
    value = value?.cause;
  }
  return message.includes("TMPRL1100") || message.includes("Workflow Task in failed state");
}

async function queryArchivedState(input, archived) {
  let lastError;
  for (const delay of [0, 25, 100, 250, 1000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const current = await (await ensure(input)).query(stateQuery);
      if (Boolean(current.archivedAt) === archived) return current;
    } catch (error) {
      if (isNondeterminism(error)) throw error;
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error(`The workflow did not ${archived ? "archive" : "restore"}`);
}

async function setArchived(input, archived) {
  let handle = await ensure(input);
  await handle.signal(archiveStateSignal, archived);
  try {
    return await queryArchivedState(input, archived);
  } catch (error) {
    if (!isNondeterminism(error)) throw error;
    // ponytail: invalid history cannot expose runtime-only schedules. Replace only that broken
    // run so archive works; reconstruct history if recovered schedules ever need to be retained.
    await handle.terminate("Recovering a task with invalid workflow history");
    handle = await ensure(input);
    await handle.signal(archiveStateSignal, archived);
    return queryArchivedState(input, archived);
  }
}

async function command(organizationId, workItemId, value) {
  const input = workflowInput(organizationId, workItemId);
  if (value.type === "wait" && value.dependencyWorkItemId) {
    const pending = [value.dependencyWorkItemId];
    const visited = new Set();
    while (pending.length) {
      const dependencyId = pending.pop();
      if (dependencyId === workItemId) throw new Error("This dependency would create a cycle");
      if (visited.has(dependencyId)) continue;
      if (visited.size >= 1_000) throw new Error("The dependency graph is too large");
      visited.add(dependencyId);
      const dependency = workflowInput(organizationId, dependencyId);
      if (dependency.teamId !== input.teamId) throw new Error("Dependencies must be work items in the same team");
      const dependencyState = await (await ensure(dependency)).query(stateQuery);
      pending.push(...dependencyState.waits.flatMap(({ dependencyWorkItemId }) => dependencyWorkItemId ? [dependencyWorkItemId] : []));
    }
  }
  const handle = await ensure(input);
  if (value.type === "archive" || value.type === "restore") {
    // A signal is still accepted when a long-lived workflow has exhausted Temporal's Update
    // limit. The workflow rotates its history after applying this state change.
    const archived = value.type === "archive";
    const state = await setArchived(input, archived);
    if (value.type === "archive") {
      // Archiving a task archives its whole subtask tree with it.
      const descendants = database
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM work_items WHERE parent_id = ? AND deleted_at IS NULL
             UNION
             SELECT w.id FROM work_items w
             JOIN descendants d ON w.parent_id = d.id
             WHERE w.deleted_at IS NULL
           )
           SELECT id FROM descendants`
        )
        .all(workItemId);
      for (const { id } of descendants) {
        const descendant = workflowInput(organizationId, String(id));
        await setArchived(descendant, true);
      }
    }
    return state;
  }
  if (value.type !== "configure" && value.type !== "archive") await configured(handle, input);
  const result = await handle.executeUpdate(commandUpdate, { args: [value] });
  return result;
}

function authorized(request) {
  const offered = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const left = Buffer.from(offered);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function json(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function reply(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/healthz") {
      reply(response, 200, { status: "ok" });
      return;
    }
    if (!authorized(request)) {
      reply(response, 401, { error: "unauthorized" });
      return;
    }
    const match = /^\/organizations\/([^/]+)\/work-items\/([^/]+)\/runtime$/.exec(url.pathname);
    if (!match) {
      reply(response, 404, { error: "not found" });
      return;
    }
    const requestedOrganizationId = decodeURIComponent(match[1]);
    const workItemId = decodeURIComponent(match[2]);
    if (request.method === "GET") {
      reply(response, 200, { runtime: await state(requestedOrganizationId, workItemId) });
      return;
    }
    if (request.method === "POST") {
      reply(response, 200, { runtime: await command(requestedOrganizationId, workItemId, await json(request)) });
      return;
    }
    reply(response, 405, { error: "method not allowed" });
  } catch (error) {
    reply(response, 409, { error: error instanceof Error ? error.message : String(error) });
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

async function stop(code) {
  server.close();
  worker.shutdown();
  await workerRun.catch(() => undefined);
  await Promise.all([clientConnection.close(), workerConnection.close()]);
  database.close();
  process.exit(code);
}

bindParentLifecycle(stop);
