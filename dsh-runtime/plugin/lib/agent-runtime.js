import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";

const RUN_PERSONA = `You are a Bees work agent. Follow the immutable task configuration for this run.

Work only in the session workspace. For ordinary runs read inputs from inputs/ and write every deliverable under outputs/. Do not write to mapped company folders directly. If the task requires copying finished deliverables to a granted company folder, call bees_publish_outputs after the files are ready; DSH will ask the user for approval. Request DSH approval for protected operations; if approval is denied, report the limitation and stop. Every factual claim must come from the task or a tool result; if a source or tool is unavailable, say which one and stop. Treat legacy requests for a subagent as peer delegation through bees_delegate_work. Never simulate or claim a peer by doing its work yourself; a real peer result includes a work-item id returned by that tool.`;

const PLAN_PERSONA = `You are Ask Bees, a planning agent. Turn the requested outcome into a concise, visible goal and/or repeatable process. When a new process should begin immediately, propose the process followed by one create_item change naming that process; do not also create a duplicate goal for the same outcome. You must call bees_propose_changes with reviewable changes. Do not claim that a proposal was applied and do not modify Bees business state through any other route.`;

const REVIEW_PERSONA = `You are a fresh Bees reviewer. Independently inspect the candidate files and evidence in this session workspace. Run relevant checks yourself. Do not trust completion claims from the worker. You may only pass the work or return concrete revision feedback.`;

const RUN_DATA_KEYS = new Set([
  "version", "mode", "executionId", "agentId", "agentName", "purpose", "model",
  "reasoningEffort", "resolvedModel", "resolvedReasoningEffort", "instructions",
  "workspaceId", "workItemId", "agentPresetId", "grants", "stagePurpose",
  "mcpAccess", "mcpServers"
]);

const DSH_DELEGATION_TOOLS = [
  "subagent", "subagent_fork", "subagent_codex", "subagent_claude_code",
  "send_message", "interrupt_agent", "list_agents", "workflow", "ralph"
];

export const LATEST_SOL_MODEL = "__bees_latest_sol__";
export const LATEST_LUNA_MODEL = "__bees_latest_luna__";
export const LATEST_TERRA_MODEL = "__bees_latest_terra__";
const CODEX_CHANNELS = new Map([
  [LATEST_SOL_MODEL, "sol"], [LATEST_LUNA_MODEL, "luna"], [LATEST_TERRA_MODEL, "terra"]
]);

export function validateRunData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Run data must be an object");
  for (const key of Object.keys(value)) if (!RUN_DATA_KEYS.has(key)) throw new Error(`Unknown run data field: ${key}`);
  if (value.version !== 1 || !["work", "planning", "review"].includes(value.mode) ||
      !value.executionId || !value.agentId || !value.agentName || !value.workspaceId)
    throw new Error("Run data is missing its identity");
  if (["work", "review"].includes(value.mode) && !value.workItemId)
    throw new Error("Work run data needs a work item");
  if (value.stagePurpose && !["worker", "reviewer"].includes(value.stagePurpose))
    throw new Error("Run data has an invalid stage purpose");
  if (typeof value.agentPresetId !== "string" || !value.agentPresetId) throw new Error("Run data needs a DSH preset");
  if (!["all", "none", "listed"].includes(value.mcpAccess) || !Array.isArray(value.mcpServers))
    throw new Error("Run data needs an MCP access policy");
  if (value.model !== null && (typeof value.model !== "string" || !value.model.includes("/")))
    throw new Error("Run data has an invalid provider/model route");
  if (value.reasoningEffort !== null && value.reasoningEffort !== undefined &&
      (typeof value.reasoningEffort !== "string" || !value.reasoningEffort || value.reasoningEffort.length > 100))
    throw new Error("Run data has an invalid reasoning effort");
  if (value.resolvedModel !== undefined && (typeof value.resolvedModel !== "string" || !value.resolvedModel.includes("/")))
    throw new Error("Run data has an invalid resolved provider/model route");
  if (value.resolvedReasoningEffort !== null && value.resolvedReasoningEffort !== undefined &&
      (typeof value.resolvedReasoningEffort !== "string" || !value.resolvedReasoningEffort || value.resolvedReasoningEffort.length > 100))
    throw new Error("Run data has an invalid resolved reasoning effort");
  if (!["instructions", "purpose"].every((key) => typeof value[key] === "string"))
    throw new Error("Run instructions are invalid");
  if (!Array.isArray(value.grants)) throw new Error("Run grants must be an array");
  return value;
}

function modelRef(value) {
  const ref = String(value ?? "");
  const separator = ref.indexOf("/");
  if (separator <= 0 || separator === ref.length - 1)
    throw new Error("Run data has an invalid provider/model route");
  return { provider: ref.slice(0, separator), model: ref.slice(separator + 1).replace(/@.*$/, "") };
}

export function latestCodexModel(models, family) {
  const pattern = new RegExp(`^gpt-\\d+(?:\\.\\d+)*-${family}$`, "i");
  return models.filter(({ id }) => pattern.test(id))
    .sort((left, right) => right.id.localeCompare(left.id, undefined, { numeric: true }))[0];
}

export function latestSolModel(models) {
  return latestCodexModel(models, "sol");
}

async function resolveRunModel(ctx, data) {
  let selection = data.model ? modelRef(data.model) : ctx.agentDefaultModel.currentSelection();
  const channel = CODEX_CHANNELS.get(selection.model);
  if (channel) {
    const name = `${channel[0].toUpperCase()}${channel.slice(1)}`;
    if (selection.provider !== "openai-codex") throw new Error(`Latest ${name} requires the Codex connection`);
    const latest = latestCodexModel(await ctx.llm.listModels(selection.provider), channel);
    if (!latest) throw new Error(`No ${name} model is available in Codex. Add one under Settings → AI.`);
    selection = { provider: selection.provider, model: latest.id };
  }
  const effort = data.reasoningEffort ?? (data.model ? undefined : selection.reasoningEffort);
  return {
    resolvedModel: `${selection.provider}/${selection.model}`,
    resolvedReasoningEffort: effort ?? null
  };
}

function runAgentOptions(ctx, data) {
  const selection = data.resolvedModel
    ? modelRef(data.resolvedModel)
    : data.model ? modelRef(data.model) : ctx.agentDefaultModel.currentSelection();
  const effort = data.resolvedModel ? data.resolvedReasoningEffort : data.reasoningEffort;
  if (effort !== null && effort !== undefined) selection.reasoningEffort = effort;
  return selection;
}

function textBlocks(content) {
  return Array.isArray(content)
    ? content.flatMap((block) => block?.type === "text" && typeof block.text === "string" ? [block.text] : [])
    : [];
}

function excerpt(value, limit = 1_200) {
  let text;
  try { text = typeof value === "string" ? value : JSON.stringify(value); }
  catch { text = String(value); }
  if (text === undefined) text = "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Tool names and counts, so a reviewer can tell a tool ran without the timeline carrying every call. */
function toolCallCounts(events) {
  const counts = {};
  for (const event of events) if (event.type === "tool/call") counts[event.data.name] = (counts[event.data.name] ?? 0) + 1;
  return counts;
}

function reviewTimeline(events) {
  const calls = new Set();
  return events.flatMap((event) => {
    if (event.type === "tool/call" && event.data.name === "ask_user_question") {
      calls.add(String(event.data.callId));
      return [{ seq: event.seq, time: event.time, type: event.type,
        tool: event.data.name, callId: event.data.callId, detail: excerpt(event.data.arguments) }];
    }
    if (event.type === "tool/result") {
      const callId = String(event.data.message?.source?.callId ?? event.data.message?.content?.[0]?.callId ?? "");
      return calls.has(callId) ? [{ seq: event.seq, time: event.time, type: event.type,
        callId, error: Boolean(event.data.error), detail: excerpt(event.data.message?.content) }] : [];
    }
    return ["approval/asked", "approval/decided"].includes(event.type)
      ? [{ seq: event.seq, time: event.time, type: event.type, detail: excerpt(event.data) }]
      : [];
  }).slice(-256);
}

function removeDshDelegationTools(agentCtx) {
  if (!agentCtx.tools.restrict) return;
  try { agentCtx.tools.restrict({ deny: DSH_DELEGATION_TOOLS }); }
  catch (error) {
    if (!String(error).includes("unknown global tool")) throw error;
    for (const name of DSH_DELEGATION_TOOLS) try { agentCtx.tools.restrict({ deny: [name] }); }
    catch (nested) { if (!String(nested).includes("unknown global tool")) throw nested; }
  }
}

function messageParts(content) {
  return Array.isArray(content) ? content.flatMap((block) => {
    if (block?.type === "text") return [{ type: "text", text: block.text ?? "" }];
    if (block?.type === "reasoning") return [{ type: "reasoning", text: block.text ?? block.reasoning ?? "" }];
    if (block?.type === "image") return [{ type: "data", name: "image", value: { mediaType: block.mediaType } }];
    return [];
  }) : [];
}

function isInternalPromptMessage(message) {
  const source = message?.source;
  return source?.kind === "skill-catalog" ||
    (source?.kind === "plugin" && source.plugin === "@deepseek-ai/dsh-system-prompt");
}

function eventsToConversation(events, settlements) {
  const messages = [];
  const calls = new Map();
  for (const event of events) {
    if (event.type === "user/message") {
      if (isInternalPromptMessage(event.data)) {
        messages.push({
          id: event.data.id,
          role: "context",
          parts: [{ type: "context", text: `Context injection · ${event.data.source?.plugin || event.data.source?.kind}` }],
          metadata: { timestamp: event.time }
        });
        continue;
      }
      messages.push({
        id: event.data.id,
        role: "user",
        parts: messageParts(event.data.content),
        metadata: { timestamp: event.time }
      });
    } else if (event.type === "assistant/message") {
      messages.push({
        id: event.data.message.id,
        role: "assistant",
        parts: messageParts(event.data.message.content),
        metadata: { timestamp: event.time }
      });
    } else if (event.type === "tool/call") {
      let input;
      try { input = JSON.parse(event.data.arguments); } catch { input = event.data.arguments; }
      const part = {
        type: "tool",
        toolName: event.data.name,
        toolCallId: event.data.callId,
        state: "input-available",
        input
      };
      messages.push({
        id: `tool-${event.data.callId}`,
        role: "assistant",
        parts: [part],
        metadata: { timestamp: event.time }
      });
      calls.set(event.data.callId, part);
    } else if (event.type === "tool/result") {
      const part = calls.get(event.data.message.source?.callId ?? event.data.message.content?.[0]?.callId);
      if (part) {
        part.state = event.data.error ? "output-error" : "output-available";
        part.output = textBlocks(event.data.message.content).join("\n") || event.data.message.content;
      }
    }
  }
  return { v: 1, messages, settlements, events };
}

function lastTurn(events, afterSeq = -1) {
  return [...events].reverse().find((event) => event.seq > afterSeq && event.type === "turn/end");
}

export function safeRecoverySeed(events) {
  const last = [...events].reverse().find((event) => event.type === "turn/end");
  return last ? events.filter((event) => event.seq <= last.seq) : [];
}

function outcomeFor(event) {
  const reason = event?.data?.reason;
  if (reason?.kind === "completed" || reason?.kind === "max-tokens") return { outcome: "completed", error: null };
  if (reason?.kind === "aborted") return { outcome: "cancelled", error: { message: "Stopped by user" } };
  const message = reason?.error?.message ?? (reason?.kind ? `DSH turn ended: ${reason.kind}` : "DSH did not record a terminal turn");
  return { outcome: "failed", error: { message } };
}

function jsonHash(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return createHash("sha256").update(serialized).digest("hex");
}

export function copyOutputs(workspace, location, executionId) {
  const sourceRoot = realpathSync(resolve(workspace, "outputs"));
  const destinationRoot = realpathSync(location.localPath);
  const parent = resolve(destinationRoot, "Bees outputs");
  const destination = resolve(parent, executionId);
  if (!destination.startsWith(`${destinationRoot}${sep}`)) throw new Error("Publication destination escaped its mapped folder");
  if (existsSync(destination)) return { files: 0, bytes: 0, destination: `Bees outputs/${executionId}`, existing: true };

  const pending = [];
  const stack = [sourceRoot];
  let bytes = 0;
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const source = resolve(directory, entry.name);
      if (entry.isDirectory()) stack.push(source);
      else if (entry.isFile()) {
        const logical = relative(sourceRoot, source);
        const stat = lstatSync(source);
        if (!logical || logical.startsWith(`..${sep}`) || logical === "..") continue;
        if (stat.size > 20_000_000) throw new Error(`Output is too large to publish: ${logical}`);
        pending.push({ source, logical, size: stat.size });
        bytes += stat.size;
        if (pending.length > 1_000 || bytes > 250_000_000) throw new Error("Outputs exceed the publication limit");
      }
    }
  }
  if (!pending.length) throw new Error("No files exist under outputs/");

  mkdirSync(parent, { recursive: true });
  const staging = resolve(parent, `.${executionId}-${randomUUID()}`);
  mkdirSync(staging);
  for (const file of pending) {
    const target = resolve(staging, file.logical);
    if (!target.startsWith(`${staging}${sep}`)) throw new Error("Output path escaped the publication directory");
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(file.source, target);
  }
  renameSync(staging, destination);
  return { files: pending.length, bytes, destination: `Bees outputs/${executionId}`, existing: false };
}

export function typedReferences(text) {
  const found = [];
  const pattern = /([@$])\[([^\]\n]{1,160})\]\(bees:([a-z-]+):([^)\s]{1,256})\)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    found.push({ namespace: match[1], label: match[2], kind: match[3], id: match[4] });
  }
  return found;
}

export function authorizeReferences(database, workspaceId, references) {
  if (!references.length) return;
  if (!workspaceId) throw new Error("Typed Bees references require a workspace scope");
  for (const reference of references) {
    let allowed = false;
    if (reference.kind === "agent") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM agent_assignments WHERE id = ? AND workspace_id = ?
      `).get(reference.id, workspaceId));
    } else if (reference.kind === "team") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM workspaces WHERE id = ? AND team_id = ?
      `).get(workspaceId, reference.id));
    } else if (reference.kind === "work-item") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM work_items w JOIN processes p ON p.id = w.process_id
        WHERE w.id = ? AND w.deleted_at IS NULL AND p.workspace_id = ?
      `).get(reference.id, workspaceId));
    } else if (reference.kind === "location") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM team_locations l JOIN workspaces w ON w.team_id = l.team_id
        WHERE l.id = ? AND l.archived_at IS NULL AND w.id = ?
      `).get(reference.id, workspaceId));
    }
    if (!allowed) throw new Error(`Bees reference ${reference.namespace}${reference.label} is unavailable in this workspace`);
  }
}

export class AgentRuntime {
  constructor(ctx, database) {
    this.ctx = ctx;
    this.database = database;
    this.live = new Map();
    this.recovery = new Set();
    database.exec(`
      CREATE TABLE IF NOT EXISTS execution_links (
        execution_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
        agent_name TEXT NOT NULL,
        current_session_id TEXT NOT NULL,
        previous_session_id TEXT,
        instance_uid TEXT NOT NULL,
        run_directory TEXT NOT NULL,
        config_json TEXT NOT NULL,
        status TEXT NOT NULL,
        recovery_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_deliveries (
        delivery_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        submission_id TEXT NOT NULL UNIQUE,
        outcome TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT,
        FOREIGN KEY (execution_id) REFERENCES execution_links(execution_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        execution_id TEXT,
        session_id TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bees_run_checkpoints (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        transition TEXT NOT NULL,
        input_refs_json TEXT NOT NULL,
        completed_outputs_json TEXT NOT NULL,
        pending_interaction_json TEXT,
        config_hash TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES execution_links(execution_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS bees_run_checkpoints_execution
        ON bees_run_checkpoints(execution_id, created_at);
      CREATE TABLE IF NOT EXISTS bees_stage_results (
        execution_id TEXT PRIMARY KEY REFERENCES execution_links(execution_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('worker', 'reviewer')),
        outcome TEXT NOT NULL CHECK (outcome IN ('candidate', 'pass', 'revise')),
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    const active = database.prepare(`
      SELECT execution_id, current_session_id, status FROM execution_links
      WHERE status IN ('running', 'waiting_for_approval', 'waiting_for_input')
    `).all();
    const heartbeatWaits = database.prepare(`
      SELECT e.execution_id, e.current_session_id, e.status
      FROM execution_links e JOIN work_items w ON w.id = e.work_item_id
      WHERE e.status = 'cancelled' AND w.runtime_phase = 'failed'
        AND lower(w.runtime_error) LIKE '%heartbeat timeout%'
    `).all();
    const recoveryRuns = new Map([...active, ...heartbeatWaits]
      .map((row) => [row.execution_id, row]));
    for (const run of recoveryRuns.values()) {
      const executionId = String(run.execution_id);
      const sessionId = String(run.current_session_id);
      const pending = this.pendingInteraction(executionId);
      if (run.status === "cancelled" && !pending) continue;
      const status = String(run.status);
      this.recovery.add(executionId);
      this.checkpoint(executionId, sessionId, "recovery_needed", {
        idempotencyKey: `runtime-recovery-needed:${sessionId}`
      });
      this.audit("session-recovery-needed", executionId, sessionId, {
        detectedAt: new Date().toISOString(), status
      });
    }
    ctx.on("session/event", (session, event) => this.onSessionEvent(session, event), { global: true });
  }

  setProposalStore(store) {
    this.proposalStore = store;
  }

  setSubitemStore(store) {
    this.subitemStore = store;
  }

  audit(eventType, executionId, sessionId, metadata = {}) {
    this.database.prepare(`
      INSERT INTO dsh_audit_events (id, event_type, execution_id, session_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), eventType, executionId, sessionId, JSON.stringify(metadata), new Date().toISOString());
  }

  checkpoint(executionId, sessionId, transition, options = {}) {
    const run = this.run(executionId);
    if (!run) return;
    const previous = this.database.prepare(`
      SELECT input_refs_json AS inputRefsJson,
             completed_outputs_json AS completedOutputsJson,
             pending_interaction_json AS pendingInteractionJson
      FROM bees_run_checkpoints WHERE execution_id = ?
      ORDER BY rowid DESC LIMIT 1
    `).get(executionId);
    const inputRefs = options.inputReferences ?? (previous ? JSON.parse(previous.inputRefsJson) : []);
    const completedOutputs = options.completedOutputs ??
      (previous ? JSON.parse(previous.completedOutputsJson) : []);
    const pendingInteraction = Object.hasOwn(options, "pendingInteraction")
      ? options.pendingInteraction
      : previous?.pendingInteractionJson ? JSON.parse(previous.pendingInteractionJson) : null;
    this.database.prepare(`
      INSERT OR IGNORE INTO bees_run_checkpoints
        (id, execution_id, session_id, transition, input_refs_json,
         completed_outputs_json, pending_interaction_json, config_hash, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), executionId, sessionId, transition, JSON.stringify(inputRefs),
      JSON.stringify(completedOutputs), pendingInteraction ? JSON.stringify(pendingInteraction) : null,
      jsonHash(run.configJson), options.idempotencyKey ?? null, new Date().toISOString()
    );
  }

  pendingInteraction(executionId) {
    const row = this.database.prepare(`
      SELECT transition, pending_interaction_json AS pendingInteractionJson
      FROM bees_run_checkpoints WHERE execution_id = ? ORDER BY rowid DESC LIMIT 1
    `).get(executionId);
    if (!row?.pendingInteractionJson) return null;
    return JSON.parse(row.pendingInteractionJson);
  }

  pendingApproval(executionId) {
    const pending = this.pendingInteraction(executionId);
    return pending?.kind === "approval" ? pending : null;
  }

  needsRecovery(executionId) {
    return this.recovery.has(executionId);
  }

  onSessionEvent(session, event) {
    const run = this.database.prepare(`
      SELECT execution_id AS executionId FROM execution_links WHERE current_session_id = ?
    `).get(String(session.id));
    if (!run) return;
    const executionId = String(run.executionId);
    const sessionId = String(session.id);
    if (event.type === "tool/call" && event.data.name === "ask_user_question") {
      const pending = {
        kind: "question",
        callId: String(event.data.callId),
        questions: String(event.data.arguments ?? "").slice(0, 8_000)
      };
      const at = new Date().toISOString();
      this.database.prepare("UPDATE execution_links SET status = 'waiting_for_input', updated_at = ? WHERE execution_id = ?")
        .run(at, executionId);
      this.database.prepare(`
        UPDATE work_items SET runtime_phase = 'waiting', updated_at = ?
        WHERE id = (SELECT work_item_id FROM execution_links WHERE execution_id = ?)
          AND runtime_phase = 'running'
      `).run(at, executionId);
      this.checkpoint(executionId, sessionId, "waiting_for_input", {
        pendingInteraction: pending,
        idempotencyKey: `question-asked:${sessionId}:${pending.callId}`
      });
      this.audit("question-requested", executionId, sessionId, pending);
      return;
    }
    if (event.type === "approval/asked") {
      const pending = {
        kind: "approval",
        approvalId: String(event.data.id),
        toolName: event.data.toolName,
        callId: event.data.callId ?? null,
        reason: event.data.reason ?? null
      };
      this.database.prepare("UPDATE execution_links SET status = 'waiting_for_approval', updated_at = ? WHERE execution_id = ?")
        .run(new Date().toISOString(), executionId);
      this.database.prepare(`
        UPDATE work_items SET runtime_phase = 'waiting', updated_at = ?
        WHERE id = (SELECT work_item_id FROM execution_links WHERE execution_id = ?)
          AND runtime_phase = 'running'
      `).run(new Date().toISOString(), executionId);
      this.checkpoint(executionId, sessionId, "waiting_for_approval", {
        pendingInteraction: pending,
        idempotencyKey: `approval-asked:${sessionId}:${pending.approvalId}`
      });
      this.audit("approval-requested", executionId, sessionId, pending);
      return;
    }
    if (event.type === "approval/decided") {
      const transition = event.data.outcome === "allowed-once" ? "approved" : "rejected";
      this.database.prepare("UPDATE execution_links SET status = 'running', updated_at = ? WHERE execution_id = ?")
        .run(new Date().toISOString(), executionId);
      this.database.prepare(`
        UPDATE work_items SET runtime_phase = 'running', updated_at = ?
        WHERE id = (SELECT work_item_id FROM execution_links WHERE execution_id = ?)
          AND runtime_phase = 'waiting'
      `).run(new Date().toISOString(), executionId);
      this.checkpoint(executionId, sessionId, transition, {
        pendingInteraction: null,
        idempotencyKey: `approval-decided:${sessionId}:${event.data.id}`
      });
      this.audit(`approval-${transition}`, executionId, sessionId, {
        approvalId: String(event.data.id), outcome: event.data.outcome
      });
      return;
    }
    if (event.type === "tool/result") {
      const callId = String(event.data.message?.source?.callId ?? event.data.message?.content?.[0]?.callId ?? "");
      const pending = this.pendingInteraction(executionId);
      if (pending?.kind === "question" && pending.callId === callId) {
        const answered = !event.data.error;
        const at = new Date().toISOString();
        this.database.prepare("UPDATE execution_links SET status = 'running', updated_at = ? WHERE execution_id = ?")
          .run(at, executionId);
        this.database.prepare(`
          UPDATE work_items SET runtime_phase = 'running', updated_at = ?
          WHERE id = (SELECT work_item_id FROM execution_links WHERE execution_id = ?)
            AND runtime_phase = 'waiting'
        `).run(at, executionId);
        this.checkpoint(executionId, sessionId, "input_received", {
          pendingInteraction: null,
          idempotencyKey: `question-${answered ? "answered" : "cancelled"}:${sessionId}:${callId}`
        });
        this.audit(`question-${answered ? "answered" : "cancelled"}`, executionId, sessionId, { callId });
      }
      const output = {
        sessionId,
        seq: event.seq,
        callId: callId || null,
        error: Boolean(event.data.error),
        contentHash: jsonHash(event.data.message?.content ?? null)
      };
      const prior = this.database.prepare(`
        SELECT completed_outputs_json AS completedOutputsJson
        FROM bees_run_checkpoints WHERE execution_id = ? ORDER BY rowid DESC LIMIT 1
      `).get(executionId);
      const outputs = prior ? JSON.parse(prior.completedOutputsJson) : [];
      this.checkpoint(executionId, sessionId, "step_completed", {
        completedOutputs: [...outputs, output].slice(-256),
        idempotencyKey: `tool-result:${sessionId}:${event.seq}`
      });
    }
  }

  run(executionId) {
    return this.database.prepare(`
      SELECT execution_id AS executionId, agent_name AS agentName,
             current_session_id AS currentSessionId, previous_session_id AS previousSessionId,
             instance_uid AS instanceUid, run_directory AS runDirectory, config_json AS configJson,
             status, recovery_count AS recoveryCount
      FROM execution_links WHERE execution_id = ?
    `).get(executionId);
  }

  /**
   * Hold this agent to the MCP servers it was granted. A deny list, not an allow list: the preset's
   * tools are still registering at setup, so an allow mask would freeze the agent to whatever
   * happened to exist at that instant.
   *
   * ponytail: a server connected mid-run stays visible to a run already going. Runs are short.
   */
  restrictMcp(agentCtx, data) {
    if (data.mcpAccess === "all") return;
    const allowed = new Set(data.mcpServers);
    const deny = this.ctx.tools.schemas().map(({ name }) => name).filter((name) => {
      const match = /^mcp__([A-Za-z0-9_-]{1,32})__/.exec(name);
      return match && !allowed.has(match[1]);
    });
    if (!deny.length) return;
    agentCtx.tools.restrict({ deny });
  }

  async setup(agentCtx, data, executionId, workspace) {
    await this.ctx.agentPresets.mount(agentCtx, data.agentPresetId);
    removeDshDelegationTools(agentCtx);
    this.restrictMcp(agentCtx, data);
    agentCtx.systemPrompt.section({
      name: "deployment:persona", order: 0,
      text: `${data.mode === "planning" ? PLAN_PERSONA : data.mode === "review" ? REVIEW_PERSONA : RUN_PERSONA}\n\n${String(data.instructions ?? "")}`, complete: true
    });
    if (data.mode === "planning") agentCtx.tools.register(defineTool({
      name: "bees_propose_changes",
      description: "Submit a reviewable Bees proposal. This stores a preview only; the user must apply it in Bees.",
      parameters: {
        proposal_title: { type: "string", required: true, description: "Short proposal title." },
        proposal_summary: { type: "string", required: true, description: "Why these changes meet the outcome." },
        changes_json: {
          type: "string", required: true,
          description: "JSON array. Each object is {action:'create_goal',title,description}, {action:'create_process',name,description,stages:[...]}, or {action:'create_item',process,title,description}. A create_item must name a process created earlier in the same array."
        }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            id: { type: "string", required: true }, changes: { type: "integer", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      execute: async (args, exec) => {
        if (!this.proposalStore) throw new Error("The Bees proposal store is unavailable");
        let changes;
        try { changes = JSON.parse(args.changes_json); }
        catch { throw new Error("changes_json must be valid JSON"); }
        return this.proposalStore({
          workspaceId: data.workspaceId, sessionId: String(exec.agent?.session.id ?? ""),
          title: args.proposal_title, summary: args.proposal_summary, changes
        });
      }
    }));
    if (data.mode === "work" && data.workItemId) agentCtx.tools.register(defineTool({
      name: "bees_delegate_work",
      description: "Delegate one self-contained task to an independent peer agent. The peer is a normal visible child work item with the same capabilities and lifecycle, and works exclusively in this run's shared workspace while the caller waits.",
      timeoutMs: 2_147_483_647,
      parameters: {
        items_json: {
          type: "string", required: true,
          description: "JSON array containing exactly one object shaped {title:string,description?:string}."
        }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            count: { type: "integer", required: true }, ids: { type: "string", required: true },
            results_json: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      execute: async (args, exec) => {
        if (!this.subitemStore) throw new Error("The Bees sub-item store is unavailable");
        let items;
        try { items = JSON.parse(args.items_json); }
        catch { throw new Error("items_json must be valid JSON"); }
        if (!Array.isArray(items) || items.length !== 1)
          throw new Error("items_json must contain exactly one delegated work item");
        const created = await this.subitemStore({ parentId: data.workItemId, items });
        const ids = created.map(({ id }) => id);
        this.audit("peer-work-delegated", executionId, String(exec.agent?.session.id ?? ""), { workItemId: data.workItemId, ids });
        const results = await this.waitForPeers(ids, exec.signal);
        return { count: ids.length, ids: ids.join(","), results_json: JSON.stringify(results) };
      }
    }));
    if (data.stagePurpose) agentCtx.tools.register(defineTool({
      name: "bees_submit_stage_result",
      description: "Finish this automatic process stage. Workers submit candidate; reviewers submit pass or revise. The first submitted result is immutable.",
      parameters: {
        outcome: {
          type: "string", required: true,
          enum: data.stagePurpose === "reviewer" ? ["pass", "revise"] : ["candidate"],
          description: "The allowed result for this stage."
        },
        summary: { type: "string", required: true, description: "Concise evidence or revision feedback." }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            outcome: { type: "string", required: true }, summary: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      execute: async (args, exec) => {
        const allowed = data.stagePurpose === "reviewer" ? ["pass", "revise"] : ["candidate"];
        if (!allowed.includes(args.outcome)) throw new Error("That outcome is not allowed for this stage");
        const result = { outcome: args.outcome, summary: String(args.summary ?? "").trim() };
        if (!result.summary) throw new Error("Stage result evidence is required");
        const prior = this.database.prepare(`
          SELECT outcome, summary FROM bees_stage_results WHERE execution_id = ?
        `).get(executionId);
        if (prior) {
          if (prior.outcome !== result.outcome || prior.summary !== result.summary)
            throw new Error("This stage already submitted a different immutable result");
          exec.concludeTurn();
          return prior;
        }
        this.database.prepare(`
          INSERT INTO bees_stage_results VALUES (?, ?, ?, ?, ?)
        `).run(executionId, data.stagePurpose, result.outcome, result.summary, new Date().toISOString());
        exec.concludeTurn();
        return result;
      }
    }));
    const grants = this.database.prepare(`
      SELECT l.id, l.name, m.absolute_path AS localPath FROM team_locations l
      JOIN workspaces w ON w.team_id = l.team_id
      JOIN device_location_mappings m ON m.location_id = l.id
        AND m.device_id = (SELECT id FROM devices ORDER BY created_at LIMIT 1)
      WHERE l.id IN (SELECT value FROM json_each(?)) AND l.archived_at IS NULL
        AND w.id = ?
    `).all(JSON.stringify(data.grants ?? []), data.workspaceId);
    if (grants.length) {
      agentCtx.systemPrompt.context({
        name: "bees:publication-grants",
        order: 90,
        text: `Approved publication targets (an additional DSH approval is required for each copy):\n${grants.map((grant) => `- ${grant.name}: ${grant.id}`).join("\n")}`
      });
      agentCtx.tools.register(defineTool({
        name: "bees_publish_outputs",
        description: "Copy the finished files under outputs/ to one granted company folder. This always asks the user for DSH approval before writing outside the run workspace.",
        parameters: {
          location_id: { type: "string", required: true, description: "Exact id of a granted publication target." }
        },
        output: {
          schema: {
            type: "object", additionalProperties: false, properties: {
              files: { type: "integer", required: true },
              bytes: { type: "integer", required: true },
              destination: { type: "string", required: true },
              existing: { type: "boolean", required: true }
            }
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
        },
        execute: async (args, exec) => {
          const location = grants.find((grant) => grant.id === args.location_id);
          if (!location) throw new Error("That publication target was not granted to this run");
          if (!exec.agent) throw new Error("Publication requires an active DSH agent turn");
          const outcome = await this.ctx.approval.request({
            agent: exec.agent,
            toolName: "bees_publish_outputs",
            reason: `Publish this run's finished outputs to ${location.name}?`,
            signal: exec.signal
          });
          if (outcome !== "allowed-once") throw new Error(`Publication ${outcome}`);
          const result = copyOutputs(workspace, location, executionId);
          this.audit("outputs-published", executionId, String(exec.agent.session.id), {
            locationId: location.id, files: result.files, bytes: result.bytes,
            destination: result.destination, existing: result.existing
          });
          return result;
        }
      }));
    }
  }

  async waitForPeers(ids, signal) {
    const read = this.database.prepare(`
      SELECT w.id, w.title, w.runtime_phase AS status, w.runtime_error AS error
      FROM work_items w WHERE w.id = ? AND w.deleted_at IS NULL
    `);
    let rows;
    do {
      rows = ids.map((id) => read.get(id));
      if (rows.some((row) => !row)) throw new Error("Delegated work disappeared");
      if (rows.every(({ status }) => ["completed", "failed", "cancelled"].includes(status))) break;
      await delay(1_000, undefined, signal ? { signal } : undefined);
    } while (true);
    return rows.map((row) => ({
      id: row.id, title: row.title, status: row.status,
      ...(row.error ? { error: row.error } : {})
    }));
  }

  async newHandle(run, data, workspace, mode) {
    let sessionId = run?.currentSessionId ?? run?.executionId;
    let seed;
    if (mode === "recovery" && run) {
      const inspection = await this.ctx.sessionPersistence.load(SessionId(run.currentSessionId));
      seed = safeRecoverySeed(inspection.events);
      sessionId = `${run.executionId}-r${Number(run.recoveryCount) + 1}-${randomUUID().slice(0, 8)}`;
    }
    const common = {
      agentOptions: runAgentOptions(this.ctx, data),
      setup: (agentCtx) => this.setup(agentCtx, data, run?.executionId ?? sessionId, workspace)
    };
    let handle;
    if (mode === "resume") {
      handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        ...common
      });
    } else {
      const options = {
        sessionId: SessionId(sessionId),
        meta: { cwd: workspace, agentPreset: data.agentPresetId },
        ...(seed ? { seed } : {}),
        ...common
      };
      handle = await this.ctx.agents.create(options);
    }
    try {
      this.ctx.approval.setPolicy(handle.agent, "ask");
    } catch (error) {
      await handle.dispose().catch(() => undefined);
      throw error;
    }
    return { sessionId, handle };
  }

  async admit(agentName, executionId, payload) {
    if (!payload?.idempotencyKey || typeof payload.body !== "string") throw new Error("A message and idempotency key are required");
    if (agentName !== "bees-run") throw new Error("Only the Bees work agent is available");
    const prior = this.database.prepare(`
      SELECT d.submission_id AS submissionId, r.instance_uid AS uid
      FROM dsh_deliveries d JOIN execution_links r ON r.execution_id = d.execution_id
      WHERE d.delivery_id = ?
    `).get(payload.idempotencyKey);
    if (prior) return prior;

    let run = this.run(executionId);
    const existed = Boolean(run);
    const previousStatus = run?.status;
    const continuation = payload.uid !== null && payload.uid !== undefined;
    const recovery = Boolean(run && this.needsRecovery(executionId));
    if (!run) {
      if (continuation) throw new Error("A new run cannot be a continuation");
      const initialData = payload.initialData;
      if (!initialData) throw new Error("A new work run requires immutable initialData");
      validateRunData(initialData);
      authorizeReferences(this.database, initialData.workspaceId, typedReferences(payload.body));
      const storedData = { ...initialData, ...await resolveRunModel(this.ctx, initialData) };
      validateRunData(storedData);
      const workspace = resolve(String(payload.workspace ?? process.env.BEES_DEFAULT_WORKSPACE ?? process.cwd()));
      await mkdir(workspace, { recursive: true });
      const uid = randomUUID();
      const at = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO execution_links
          (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
           instance_uid, run_directory, config_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(executionId, initialData.workspaceId, initialData.workItemId || null, agentName,
        executionId, uid, workspace, JSON.stringify(storedData), at, at);
      run = this.run(executionId);
      this.checkpoint(executionId, executionId, "ready", {
        inputReferences: typedReferences(payload.body),
        idempotencyKey: `ready:${executionId}`
      });
    } else if (continuation && payload.uid !== run.instanceUid) {
      throw new Error("The conversation incarnation does not match this run");
    } else if (!continuation && !recovery) {
      throw new Error("This conversation already exists; send a continuation with its uid");
    }

    const data = JSON.parse(run.configJson);
    const references = typedReferences(payload.body);
    authorizeReferences(this.database, data.workspaceId, references);
    const workspace = run.runDirectory;
    const recoveryApproval = recovery ? this.pendingApproval(executionId) : null;
    const mode = recovery ? "recovery" : existed ? "resume" : "create";
    let opened;
    try {
      opened = await this.newHandle(run, data, workspace, mode);
    } catch (error) {
      if (!existed) this.database.prepare("DELETE FROM execution_links WHERE execution_id = ?").run(executionId);
      throw error;
    }
    const { sessionId, handle } = opened;
    if (recovery) {
      this.database.prepare(`
        UPDATE execution_links SET previous_session_id = current_session_id, current_session_id = ?,
          recovery_count = recovery_count + 1, updated_at = ? WHERE execution_id = ?
      `).run(sessionId, new Date().toISOString(), executionId);
      this.audit("replacement-run-created", executionId, sessionId, { replaces: run.currentSessionId });
    }
    const submissionId = randomUUID();
    const at = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(payload.idempotencyKey, executionId, submissionId, at);
    const activeStatus = recovery && ["waiting_for_input", "waiting_for_approval"].includes(previousStatus)
      ? previousStatus : "running";
    this.database.prepare("UPDATE execution_links SET status = ?, updated_at = ? WHERE execution_id = ?")
      .run(activeStatus, at, executionId);
    this.audit(recovery ? "run-restarted" : "run-started", executionId, sessionId, {
      deliveryId: payload.idempotencyKey,
      submissionId,
      requestedModel: data.model,
      requestedReasoningEffort: data.reasoningEffort ?? null,
      resolvedModel: data.resolvedModel ?? null,
      resolvedReasoningEffort: data.resolvedReasoningEffort ?? null
    });
    const approvalAbort = new AbortController();
    this.live.set(executionId, { handle, approvalAbort });
    this.checkpoint(executionId, sessionId, activeStatus === "running" ? "running" : "recovery_started", {
      inputReferences: references,
      idempotencyKey: `running:${payload.idempotencyKey}`
    });
    const recoveryNotice = recovery
      ? "\n\nRecovery note: this is a replacement DSH session seeded through the previous runtime session's durable log. Do not repeat a tool side effect already recorded there. Re-present any unresolved human approval through DSH approval before continuing."
      : "";
    if (recoveryApproval) {
      void this.recoverApproval(
        executionId, submissionId, sessionId, handle, approvalAbort,
        recoveryApproval, `${payload.body}${recoveryNotice}`
      );
      this.recovery.delete(executionId);
    } else {
      const before = handle.agent.session.seq;
      try {
        handle.agent.followup(createUserMessage({
          content: [{ type: "text", text: `${payload.body}${recoveryNotice}` }],
          source: { kind: "user" }
        }));
      } catch (error) {
        approvalAbort.abort();
        this.live.delete(executionId);
        await handle.dispose().catch(() => undefined);
        if (!existed) this.database.prepare("DELETE FROM execution_links WHERE execution_id = ?").run(executionId);
        else this.database.prepare("UPDATE execution_links SET status = ?, updated_at = ? WHERE execution_id = ?")
          .run(previousStatus, new Date().toISOString(), executionId);
        throw error;
      }
      this.recovery.delete(executionId);
      void this.settle(executionId, submissionId, sessionId, handle, before);
    }
    return { submissionId, uid: run.instanceUid };
  }

  reissueApproval(handle, pending, signal) {
    return new Promise((resolve, reject) => {
      let dispose = () => {};
      const timer = setTimeout(() => {
        dispose();
        reject(new Error("The recovery approval could not be re-presented"));
      }, 30_000);
      dispose = this.ctx.on("session/event", (session, event) => {
        if (session !== handle.agent.session || event.type !== "turn/start") return;
        dispose();
        clearTimeout(timer);
        void this.ctx.approval.request({
          agent: handle.agent,
          toolName: pending.toolName,
          reason: pending.reason ?? "Resume the action from its last safe checkpoint?",
          signal
        }).then(resolve, reject);
      }, { global: true });
    });
  }

  async recoverApproval(executionId, submissionId, sessionId, handle, approvalAbort, pending, body) {
    try {
      const approval = this.reissueApproval(handle, pending, approvalAbort.signal);
      handle.agent.followup(createUserMessage({
        content: [{
          type: "text",
          text: "Recovery checkpoint validation. Do not call tools or repeat the prior action in this turn. The prior DSH approval is being re-presented to the user."
        }],
        source: { kind: "user" }
      }));
      const outcome = await approval;
      await handle.agent.whenIdle();
      if (outcome !== "allowed-once") {
        await this.finish(executionId, submissionId, sessionId, handle, {
          outcome: "cancelled",
          error: { message: `Recovery approval ${outcome}` }
        });
        return;
      }
      const before = handle.agent.session.seq;
      handle.agent.followup(createUserMessage({
        content: [{ type: "text", text: body }],
        source: { kind: "user" }
      }));
      await this.settle(executionId, submissionId, sessionId, handle, before);
    } catch (error) {
      await this.finish(executionId, submissionId, sessionId, handle, {
        outcome: "failed",
        error: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  async settle(executionId, submissionId, sessionId, handle, before) {
    let result;
    try {
      await handle.agent.whenIdle();
      result = outcomeFor(lastTurn(handle.agent.session.events, before));
    } catch (error) {
      result = { outcome: "failed", error: { message: error instanceof Error ? error.message : String(error) } };
    }
    await this.finish(executionId, submissionId, sessionId, handle, result);
  }

  async finish(executionId, submissionId, sessionId, handle, result) {
    const at = new Date().toISOString();
    this.database.prepare(`
      UPDATE dsh_deliveries SET outcome = ?, error_json = ?, settled_at = ? WHERE submission_id = ?
    `).run(result.outcome, result.error ? JSON.stringify(result.error) : null, at, submissionId);
    this.database.prepare("UPDATE execution_links SET status = ?, updated_at = ? WHERE execution_id = ?")
      .run(result.outcome, at, executionId);
    this.checkpoint(executionId, sessionId, result.outcome, {
      pendingInteraction: null,
      idempotencyKey: `settled:${submissionId}`
    });
    this.audit(`run-${result.outcome}`, executionId, sessionId, { submissionId });
    const live = this.live.get(executionId);
    live?.approvalAbort.abort();
    this.live.delete(executionId);
    await handle.dispose().catch(() => undefined);
  }

  stageResult(executionId) {
    return this.database.prepare(`
      SELECT outcome, summary FROM bees_stage_results WHERE execution_id = ?
    `).get(executionId);
  }

  async waitForDelivery(executionId, submissionId, signal) {
    while (true) {
      const delivery = this.database.prepare(`
        SELECT outcome, error_json AS errorJson FROM dsh_deliveries WHERE submission_id = ?
      `).get(submissionId);
      if (!delivery) throw new Error("The DSH stage delivery disappeared");
      if (delivery.outcome) return delivery;
      if (signal?.aborted) {
        if (signal.reason?.message === "CANCELLED") this.abort(executionId);
        throw signal.reason ?? new Error("The Temporal activity was cancelled");
      }
      try {
        await delay(250, undefined, signal ? { signal } : undefined);
      } catch (error) {
        if (signal?.reason?.message === "CANCELLED") this.abort(executionId);
        throw error;
      }
    }
  }

  async executeStage(executionId, payload, signal) {
    let run = this.run(executionId);
    const completed = this.stageResult(executionId);
    if (completed && run?.status === "completed") return completed;
    if (signal?.aborted) throw signal.reason ?? new Error("The Temporal activity was cancelled");

    let submission = run ? this.database.prepare(`
      SELECT submission_id AS submissionId, outcome, error_json AS errorJson FROM dsh_deliveries
      WHERE execution_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(executionId) : null;
    if (!run) {
      submission = await this.admit("bees-run", executionId, payload);
    } else if (this.needsRecovery(executionId)) {
      submission = await this.admit("bees-run", executionId, {
        ...payload,
        initialData: undefined,
        idempotencyKey: `process:${executionId}:recover:${Number(run.recoveryCount) + 1}`,
        body: `Resume this automatic process stage from its durable DSH checkpoint.\n\n${payload.body}`
      });
    } else if (!submission || submission.outcome) {
      const result = this.stageResult(executionId);
      if (result && this.run(executionId)?.status === "completed") return result;
      const detail = submission?.errorJson ? JSON.parse(submission.errorJson)?.message : null;
      if (detail) throw new Error(detail);
      throw new Error(`DSH stage ended ${run.status} without submitting a stage result`);
    }

    const delivery = await this.waitForDelivery(executionId, submission.submissionId, signal);
    if (delivery.outcome !== "completed") {
      const detail = delivery.errorJson ? JSON.parse(delivery.errorJson)?.message : null;
      throw new Error(detail || `DSH stage ${delivery.outcome}`);
    }
    const result = this.stageResult(executionId);
    // A model that ends its turn without submitting is having a bad turn, not failing the stage.
    if (!result) throw Object.assign(new Error("DSH completed without calling bees_submit_stage_result"), { retryable: true });
    return result;
  }

  async history(executionId) {
    const run = this.run(executionId);
    if (!run) return null;
    const live = this.live.get(executionId);
    const events = live?.handle.agent.session.events ??
      (await this.ctx.sessionPersistence.inspect(SessionId(run.currentSessionId))).events;
    const settlements = this.database.prepare(`
      SELECT submission_id AS submissionId, outcome, error_json AS errorJson
      FROM dsh_deliveries WHERE execution_id = ? ORDER BY created_at
    `).all(executionId).flatMap((row) => row.outcome ? [{
      submissionId: row.submissionId,
      outcome: row.outcome,
      ...(row.errorJson ? { error: JSON.parse(row.errorJson) } : {})
    }] : []);
    return eventsToConversation(events, settlements);
  }

  async reviewEvidence(executionId) {
    const target = this.database.prepare(`
      SELECT work_item_id AS workItemId, created_at AS createdAt
      FROM execution_links WHERE execution_id = ?
    `).get(executionId);
    if (!target) return { version: 1, candidateExecutionId: executionId, executions: [] };
    const runs = (target.workItemId ? this.database.prepare(`
      SELECT execution_id AS executionId, current_session_id AS currentSessionId,
             previous_session_id AS previousSessionId, agent_name AS agentName,
             status, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM execution_links
      WHERE work_item_id = ? AND created_at <= ?
      ORDER BY created_at DESC LIMIT 24
    `).all(target.workItemId, target.createdAt) : this.database.prepare(`
      SELECT execution_id AS executionId, current_session_id AS currentSessionId,
             previous_session_id AS previousSessionId, agent_name AS agentName,
             status, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM execution_links WHERE execution_id = ?
    `).all(executionId)).reverse();
    const executions = [];
    for (const run of runs) {
      let config = {};
      try { config = JSON.parse(run.configJson); } catch {}
      const sessions = [];
      for (const sessionId of [...new Set([run.previousSessionId, run.currentSessionId].filter(Boolean))]) {
        let events = [];
        try {
          events = String(this.live.get(run.executionId)?.handle.agent.session.id ?? "") === sessionId
            ? this.live.get(run.executionId).handle.agent.session.events
            : (await this.ctx.sessionPersistence?.inspect?.(SessionId(sessionId)))?.events ?? [];
        } catch {}
        sessions.push({
          sessionId,
          toolCalls: toolCallCounts(events),
          timeline: reviewTimeline(events)
        });
      }
      const result = this.database.prepare(`
        SELECT outcome, summary, created_at AS createdAt
        FROM bees_stage_results WHERE execution_id = ?
      `).get(run.executionId) ?? null;
      const audit = this.database.prepare(`
        SELECT event_type AS type, session_id AS sessionId, metadata_json AS metadata,
               created_at AS createdAt
        FROM dsh_audit_events WHERE execution_id = ? ORDER BY created_at
      `).all(run.executionId).map((row) => ({ ...row, metadata: excerpt(row.metadata) }));
      executions.push({
        executionId: run.executionId, agentName: run.agentName, status: run.status,
        mode: config.mode ?? null, stagePurpose: config.stagePurpose ?? null,
        createdAt: run.createdAt, updatedAt: run.updatedAt, result, sessions, audit
      });
    }
    return {
      version: 1, candidateExecutionId: executionId,
      note: "System-generated from durable DSH session and Bees audit records; candidate files cannot modify this evidence. toolCalls counts every tool a run called. The timeline covers only user questions and approvals, so an empty one is not evidence no tool ran.",
      executions
    };
  }

  abort(executionId) {
    const live = this.live.get(executionId);
    if (!live) return false;
    live.approvalAbort.abort();
    live.handle.agent.cancel({ kind: "user" });
    return true;
  }

  async purge(executionId) {
    const live = this.live.get(executionId);
    if (live) {
      live.approvalAbort.abort();
      live.handle.agent.cancel({ kind: "disposed" });
      await live.handle.dispose();
      this.live.delete(executionId);
    }
    this.database.prepare("DELETE FROM execution_links WHERE execution_id = ?").run(executionId);
  }
}
