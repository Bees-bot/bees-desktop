import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { apply as mountMcp } from "@deepseek-ai/dsh-mcp-client";
import { browserTools } from "./browser.js";

const RUN_PERSONA = `You are a Bees work agent. Follow the immutable task configuration for this run.

Work only in the session workspace. For ordinary runs read inputs from inputs/ and write every deliverable under outputs/. Do not write to mapped company folders. Files are staged for explicit review and publication by Bees. Approval prompts are not shown inside Bees runs: never request sandbox escalation; if a confined operation is denied, report the limitation and stop. Every factual claim must come from the task or a tool result; if a source or tool is unavailable, say which one and stop.`;

const ASSISTANT_PERSONA = `You are the assistant inside Bees, a dashboard where work items move through the statuses of a process, and agents run automatically when an item lands on a status.

Reply with a single JSON object and nothing else. No prose outside it, no markdown fence.

{"reply": "one or two sentences for the user", "actions": []}

"actions" is a list of changes you propose. Leave it empty when the user only asked a question. Every action names processes and statuses by their exact name as shown in the context, never by id. Allowed actions:

{"type":"create_process","name":"...","description":"...","stages":["First status","Second status"]}
{"type":"operate_bees","goal":"the exact change to make inside the Bees application"}
{"type":"create_agent","name":"...","purpose":"one line","prompt":"the instructions the agent runs with","process":"process name","stage":"status name that triggers it","browser":"read","skills":[],"mcpConnections":[]}
{"type":"create_item","process":"process name","stage":"status name","title":"...","description":"..."}
{"type":"move_items","process":"process name","fromStage":"status name","toStage":"status name"}

Use the specific typed action when it fits. Use operate_bees for changes to the Bees application itself that are not covered above, such as organizations, teams, preferences, connections, or downloading a local AI model. operate_bees never means using an outside website or doing the user's work.

Any request that requires a browser, external service, research, file work, or other agent tools must become one create_item in the "Goals" process at the "Plan" status. Give it a concrete title and put the complete request, context, and acceptance criteria in its description. Never perform external work from this dashboard assistant.

On create_agent, "browser" is "read" for an agent that reads websites, "write" if it must click and type, and "none" if it never opens one. "skills" and "mcpConnections" name things this team already has, exactly as the context lists them; naming one it does not have fails the action.

stages is ordered: the first status is where work starts, the last status finishes it. move_items moves items between status columns. Never invent a process or status that is not in the context. Nothing you propose is applied until the user approves it, so propose the whole change rather than asking for confirmation.

After an operate_bees proposal is approved, the app will send a prompt beginning "Approved Bees operation". In that mode, control only the Bees UI described in the latest snapshot. Reply with exactly one command and no actions:

{"command":{"op":"click","ref":"u1"}}
{"command":{"op":"fill","ref":"u2","value":"text"}}
{"command":{"op":"select","ref":"u3","value":"option value"}}
{"command":{"op":"toggle","ref":"u4","checked":true}}
{"command":{"op":"wait","milliseconds":500}}
{"command":{"op":"finish","message":"what was completed"}}

Use only refs from the latest snapshot and one command per response. Observe the new snapshot after each command. Never attempt passwords, file-picker dialogs, payments, or work outside Bees; finish with a concise explanation when the user must take over.

Bees also runs a guided onboarding tour, written by an administrator as one step at a time. A prompt beginning "Bees guided tour" asks only which single control in the snapshot that step is about, so a tooltip can point an arrow at it. Reply with the ref and nothing else:

{"target":{"ref":"u1"}}
{"target":null}

Use null when no visible control matches the step — an explanatory step often points at nothing. Never click, fill, or otherwise act in tour mode: you are reading the screen, not driving it.`;

const CURATOR_PERSONA = `You tidy the written skills a team's agents follow.

You are given every skill this team has: its name, its description, and how much it is used. Find skills that say overlapping things and propose folding them into one, and propose retiring skills nothing uses and nothing selects. Leave a skill alone when it is the only one covering its subject, however rarely it runs. Never propose retiring a skill an agent still selects.

Reply with a single JSON object and nothing else. No prose outside it, no markdown fence.

{"summary": "one sentence on what you changed and what you left alone", "actions": []}

Allowed actions, naming every skill exactly as it was given to you:

{"type":"merge_skills","name":"Display name of the skill that absorbs the others","description":"when an agent should reach for it","body":"the merged procedure: imperative rules, keeping every rule that still holds","absorbs":["Exact name of a skill folded in","Another"]}
{"type":"archive_skill","name":"Exact name of an unused skill","reason":"why"}

Propose no action rather than a doubtful one — an empty actions list is a good answer when the skills are already tidy. Nothing you propose is applied until the user approves it, so propose the whole change rather than asking for confirmation.`;

const RUN_DATA_KEYS = new Set([
  "version", "executionId", "agentId", "agentName", "purpose", "model", "thinkingLevel",
  "instructions", "teamId", "browser", "browserWrite", "localTools", "skills",
  "mcpConnections", "delegates", "grants"
]);

export function validateRunData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Run data must be an object");
  for (const key of Object.keys(value)) if (!RUN_DATA_KEYS.has(key)) throw new Error(`Unknown run data field: ${key}`);
  if (value.version !== 1 || !value.executionId || !value.agentId || !value.agentName || !value.teamId)
    throw new Error("Run data is missing its identity");
  if (typeof value.model !== "string" || !value.model.includes("/")) throw new Error("Run data has no provider/model route");
  if (!["instructions", "purpose"].every((key) => typeof value[key] === "string"))
    throw new Error("Run instructions are invalid");
  for (const key of ["skills", "mcpConnections", "delegates", "grants"])
    if (!Array.isArray(value[key])) throw new Error(`Run data field ${key} must be an array`);
  return value;
}

function modelRef(value) {
  const ref = String(value ?? "bees-local/active");
  const separator = ref.indexOf("/");
  if (separator <= 0 || separator === ref.length - 1) return { provider: "bees-local", model: "active" };
  return { provider: ref.slice(0, separator), model: ref.slice(separator + 1).replace(/@.*$/, "") };
}

function modelFromConversationId(id) {
  const hex = String(id).split("--")[1] ?? "";
  if (!hex || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) return modelRef();
  return modelRef(Buffer.from(hex, "hex").toString("utf8"));
}

function textBlocks(content) {
  return Array.isArray(content)
    ? content.flatMap((block) => block?.type === "text" && typeof block.text === "string" ? [block.text] : [])
    : [];
}

function messageParts(content) {
  return Array.isArray(content) ? content.flatMap((block) => {
    if (block?.type === "text") return [{ type: "text", text: block.text ?? "" }];
    if (block?.type === "reasoning") return [{ type: "reasoning", text: block.text ?? block.reasoning ?? "" }];
    if (block?.type === "image") return [{ type: "data", name: "image", value: { mediaType: block.mediaType } }];
    return [];
  }) : [];
}

function eventsToConversation(events, settlements) {
  const messages = [];
  const calls = new Map();
  for (const event of events) {
    if (event.type === "user/message") {
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
  return { v: 1, messages, settlements };
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

function safeSkillName(value, index) {
  const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return normalized || `bees-skill-${index + 1}`;
}

function jsonHash(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return createHash("sha256").update(serialized).digest("hex");
}

export function typedReferences(text) {
  const found = [];
  const pattern = /([@$])\[([^\]\n]{1,160})\]\(bees:([a-z-]+):([^)\s]{1,256})\)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    found.push({ namespace: match[1], label: match[2], kind: match[3], id: match[4] });
  }
  return found;
}

function valuesInSetting(database, key, id) {
  const row = database.prepare("SELECT value_json AS valueJson FROM settings WHERE key = ?").get(key);
  if (!row) return false;
  try {
    const values = JSON.parse(row.valueJson);
    return Array.isArray(values) && values.some((value) => String(value?.id ?? "") === id);
  } catch {
    return false;
  }
}

function registryHasSkill(database, teamId, ref) {
  for (const row of database.prepare("SELECT files_json AS filesJson FROM registries WHERE team_id = ?").all(teamId)) {
    try {
      const files = JSON.parse(row.filesJson);
      if (Array.isArray(files) && files.some((file) => file?.kind === "skill" && String(file.ref) === ref)) return true;
    } catch {
      // An invalid registry is unavailable rather than an authorization bypass.
    }
  }
  return false;
}

export function authorizeReferences(database, teamId, references) {
  if (!references.length) return;
  if (!teamId) throw new Error("Typed Bees references require a team scope");
  for (const reference of references) {
    let allowed = false;
    if (reference.kind === "agent") {
      allowed = ["bees-run", "bees-assistant", "bees-curator"].includes(reference.id);
    } else if (reference.kind === "team") {
      allowed = reference.id === teamId && Boolean(database.prepare(
        "SELECT 1 FROM teams WHERE id = ? AND archived_at IS NULL"
      ).get(reference.id));
    } else if (reference.kind === "work-item") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM work_items w JOIN processes p ON p.id = w.process_id
        WHERE w.id = ? AND w.deleted_at IS NULL AND p.team_id = ?
      `).get(reference.id, teamId));
    } else if (reference.kind === "location") {
      allowed = Boolean(database.prepare(`
        SELECT 1 FROM file_locations l JOIN teams t ON t.organization_id = l.organization_id
        WHERE l.id = ? AND l.deleted_at IS NULL AND t.id = ? AND (l.team_id IS NULL OR l.team_id = ?)
      `).get(reference.id, teamId, teamId));
    } else if (reference.kind === "mcp") {
      allowed = valuesInSetting(database, `mcp_connections:${teamId}`, reference.id);
    } else if (reference.kind === "skill") {
      allowed = registryHasSkill(database, teamId, reference.id);
    }
    if (!allowed) throw new Error(`Bees reference ${reference.namespace}${reference.label} is unavailable in this team`);
  }
}

async function connectionToken(connection, data) {
  if (!connection.secretRef) return "";
  const url = new URL(`/secrets/${encodeURIComponent(connection.secretRef)}`, process.env.BEES_CREDENTIAL_BROKER_URL);
  url.searchParams.set("teamId", data.teamId);
  url.searchParams.set("connectionId", connection.id);
  url.searchParams.set("executionId", data.executionId);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.BEES_CREDENTIAL_BROKER_TOKEN ?? ""}` },
    redirect: "error"
  });
  if (!response.ok) throw new Error(`Credential ${connection.id} is unavailable`);
  return String((await response.json()).token ?? "");
}

export class AgentRuntime {
  constructor(ctx, database) {
    this.ctx = ctx;
    this.database = database;
    this.live = new Map();
    database.exec(`
      CREATE TABLE IF NOT EXISTS dsh_runs (
        execution_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        current_session_id TEXT NOT NULL,
        previous_session_id TEXT,
        instance_uid TEXT NOT NULL,
        workspace TEXT NOT NULL,
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
        FOREIGN KEY (execution_id) REFERENCES dsh_runs(execution_id) ON DELETE CASCADE
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
        definition_version INTEGER NOT NULL,
        input_refs_json TEXT NOT NULL,
        completed_outputs_json TEXT NOT NULL,
        pending_interaction_json TEXT,
        config_hash TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES dsh_runs(execution_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS bees_run_checkpoints_execution
        ON bees_run_checkpoints(execution_id, created_at);
    `);
    const at = new Date().toISOString();
    for (const run of database.prepare(`
      SELECT execution_id, current_session_id FROM dsh_runs
      WHERE status IN ('running', 'waiting_for_approval')
    `).all()) {
      database.prepare("UPDATE dsh_runs SET status = 'interrupted', updated_at = ? WHERE execution_id = ?")
        .run(at, run.execution_id);
      this.checkpoint(String(run.execution_id), String(run.current_session_id), "interrupted", {
        idempotencyKey: `startup-interrupted:${run.current_session_id}`
      });
      this.audit("run-interrupted", String(run.execution_id), String(run.current_session_id), { detectedAt: at });
    }
    ctx.on("session/event", (session, event) => this.onSessionEvent(session, event), { global: true });
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
        (id, execution_id, session_id, transition, definition_version, input_refs_json,
         completed_outputs_json, pending_interaction_json, config_hash, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), executionId, sessionId, transition, JSON.stringify(inputRefs),
      JSON.stringify(completedOutputs), pendingInteraction ? JSON.stringify(pendingInteraction) : null,
      jsonHash(run.configJson), options.idempotencyKey ?? null, new Date().toISOString()
    );
  }

  pendingApproval(executionId) {
    const row = this.database.prepare(`
      SELECT transition, pending_interaction_json AS pendingInteractionJson
      FROM bees_run_checkpoints WHERE execution_id = ? ORDER BY rowid DESC LIMIT 1
    `).get(executionId);
    if (!row?.pendingInteractionJson) return null;
    return JSON.parse(row.pendingInteractionJson);
  }

  onSessionEvent(session, event) {
    const run = this.database.prepare(`
      SELECT execution_id AS executionId FROM dsh_runs WHERE current_session_id = ?
    `).get(String(session.id));
    if (!run) return;
    const executionId = String(run.executionId);
    const sessionId = String(session.id);
    if (event.type === "approval/asked") {
      const pending = {
        kind: "approval",
        approvalId: String(event.data.id),
        toolName: event.data.toolName,
        callId: event.data.callId ?? null,
        reason: event.data.reason ?? null
      };
      this.database.prepare("UPDATE dsh_runs SET status = 'waiting_for_approval', updated_at = ? WHERE execution_id = ?")
        .run(new Date().toISOString(), executionId);
      this.checkpoint(executionId, sessionId, "waiting_for_approval", {
        pendingInteraction: pending,
        idempotencyKey: `approval-asked:${sessionId}:${pending.approvalId}`
      });
      this.audit("approval-requested", executionId, sessionId, pending);
      return;
    }
    if (event.type === "approval/decided") {
      const transition = event.data.outcome === "allowed-once" ? "approved" : "rejected";
      this.database.prepare("UPDATE dsh_runs SET status = 'running', updated_at = ? WHERE execution_id = ?")
        .run(new Date().toISOString(), executionId);
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
      const output = {
        sessionId,
        seq: event.seq,
        callId: event.data.message?.source?.callId ?? null,
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
             instance_uid AS instanceUid, workspace, config_json AS configJson,
             status, recovery_count AS recoveryCount
      FROM dsh_runs WHERE execution_id = ?
    `).get(executionId);
  }

  async setup(agentCtx, agentName, data, executionId) {
    await this.ctx.agentPresets.mount(agentCtx, agentName === "bees-run" ? "standard" : "minimal");
    const persona = agentName === "bees-run"
      ? `${RUN_PERSONA}\n\n${String(data.instructions ?? "")}`
      : agentName === "bees-curator" ? CURATOR_PERSONA : ASSISTANT_PERSONA;
    agentCtx.systemPrompt.section({ name: "deployment:persona", order: 0, text: persona, complete: true });
    if (agentName !== "bees-run") return;
    for (const [index, skill] of (data.skills ?? []).entries()) {
      agentCtx.skills.register({
        name: safeSkillName(skill.name, index),
        description: String(skill.description ?? skill.name ?? "Bees skill"),
        content: String(skill.instructions ?? ""),
        source: "runtime"
      });
    }
    if (data.browser) {
      for (const tool of browserTools(executionId, Boolean(data.browserWrite))) agentCtx.tools.register(tool);
    }
    if (data.localTools && process.env.BEES_CAPABILITY_HOST_URL) {
      await mountMcp(agentCtx, {
        transport: "streamable-http",
        serverName: "bees_local",
        url: `${process.env.BEES_CAPABILITY_HOST_URL}/capabilities/${encodeURIComponent(executionId)}/mcp`,
        headers: { authorization: `Bearer ${process.env.BEES_CAPABILITY_TOKEN ?? ""}` },
        toolCallTimeoutMs: 120_000,
        failOnStartupError: true
      });
    }
    for (const connection of data.mcpConnections ?? []) {
      if (connection.transport === "sse") {
        if (connection.optional) continue;
        throw new Error(`MCP connection ${connection.name} uses legacy SSE; reconnect it with Streamable HTTP`);
      }
      if (Array.isArray(connection.tools) && connection.tools.length === 0) continue;
      try {
        const token = await connectionToken(connection, data);
        const serverName = `bees_${String(connection.id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24)}`;
        await mountMcp(agentCtx, {
          transport: "streamable-http",
          serverName,
          url: connection.url,
          headers: {
            ...(connection.headers ?? {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
          },
          toolCallTimeoutMs: 120_000,
          failOnStartupError: !connection.optional
        });
        if (Array.isArray(connection.tools)) {
          const allowed = new Set(connection.tools.map((name) => `mcp__${serverName}__${name}`));
          agentCtx.tools.guard((execution) =>
            execution.name.startsWith(`mcp__${serverName}__`) && !allowed.has(execution.name)
              ? "This MCP tool was not granted to this run"
              : undefined);
        }
      } catch (error) {
        if (!connection.optional) throw error;
        agentCtx.systemPrompt.context({
          name: `bees:mcp:${connection.id}`,
          order: 90,
          text: `Optional MCP connection ${connection.name} is unavailable.`
        });
      }
    }
  }

  async newHandle(run, agentName, data, workspace, mode) {
    let sessionId = run?.currentSessionId ?? run?.executionId;
    let seed;
    if (mode === "recovery" && run) {
      const inspection = await this.ctx.sessionPersistence.load(SessionId(run.currentSessionId));
      seed = safeRecoverySeed(inspection.events);
      sessionId = `${run.executionId}-r${Number(run.recoveryCount) + 1}-${randomUUID().slice(0, 8)}`;
    }
    const common = {
      agentOptions: modelRef(data.model),
      setup: (agentCtx) => this.setup(agentCtx, agentName, data, run?.executionId ?? sessionId)
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
        meta: { cwd: workspace, agentPreset: agentName === "bees-run" ? "standard" : "minimal" },
        ...(seed ? { seed } : {}),
        ...common
      };
      handle = await this.ctx.agents.create(options);
    }
    if (agentName === "bees-run") this.ctx.approval.setPolicy(handle.agent, "never");
    return { sessionId, handle };
  }

  async admit(agentName, executionId, payload) {
    if (!payload?.idempotencyKey || typeof payload.body !== "string") throw new Error("A message and idempotency key are required");
    const prior = this.database.prepare(`
      SELECT d.submission_id AS submissionId, r.instance_uid AS uid
      FROM dsh_deliveries d JOIN dsh_runs r ON r.execution_id = d.execution_id
      WHERE d.delivery_id = ?
    `).get(payload.idempotencyKey);
    if (prior) return prior;

    let run = this.run(executionId);
    const existed = Boolean(run);
    const continuation = payload.uid !== null && payload.uid !== undefined;
    if (!run) {
      if (continuation) throw new Error("A new run cannot be a continuation");
      const initialData = payload.initialData ?? (agentName === "bees-run" ? null : {
        version: 1,
        executionId,
        model: `${modelFromConversationId(executionId).provider}/${modelFromConversationId(executionId).model}`,
        instructions: ""
      });
      if (!initialData) throw new Error("A new work run requires immutable initialData");
      if (agentName === "bees-run") validateRunData(initialData);
      authorizeReferences(this.database, initialData.teamId, typedReferences(payload.body));
      const workspace = resolve(String(payload.workspace ?? process.env.BEES_DEFAULT_WORKSPACE ?? process.cwd()));
      await mkdir(workspace, { recursive: true });
      const uid = randomUUID();
      const at = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO dsh_runs
          (execution_id, agent_name, current_session_id, instance_uid, workspace, config_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(executionId, agentName, executionId, uid, workspace, JSON.stringify(initialData), at, at);
      run = this.run(executionId);
      this.checkpoint(executionId, executionId, "ready", {
        inputReferences: typedReferences(payload.body),
        idempotencyKey: `ready:${executionId}`
      });
    } else if (continuation && payload.uid !== run.instanceUid) {
      throw new Error("The conversation incarnation does not match this run");
    } else if (!continuation && run.status !== "interrupted") {
      throw new Error("This conversation already exists; send a continuation with its uid");
    }

    const data = JSON.parse(run.configJson);
    const references = typedReferences(payload.body);
    authorizeReferences(this.database, data.teamId, references);
    const workspace = run.workspace;
    const recovery = run.status === "interrupted";
    const interruptedApproval = recovery ? this.pendingApproval(executionId) : null;
    const mode = recovery ? "recovery" : existed ? "resume" : "create";
    const { sessionId, handle } = await this.newHandle(run, agentName, data, workspace, mode);
    if (recovery) {
      this.database.prepare(`
        UPDATE dsh_runs SET previous_session_id = current_session_id, current_session_id = ?,
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
    this.database.prepare("UPDATE dsh_runs SET status = 'running', updated_at = ? WHERE execution_id = ?")
      .run(at, executionId);
    this.audit(recovery ? "run-restarted" : "run-started", executionId, sessionId, {
      deliveryId: payload.idempotencyKey,
      submissionId
    });
    const approvalAbort = new AbortController();
    this.live.set(executionId, { handle, approvalAbort });
    this.checkpoint(executionId, sessionId, "running", {
      inputReferences: references,
      idempotencyKey: `running:${payload.idempotencyKey}`
    });
    const recoveryNotice = recovery
      ? "\n\nRecovery note: this is a replacement DSH session seeded through the interrupted session's durable log. Do not repeat a tool side effect already recorded there. Re-present any unresolved human approval through DSH approval before continuing."
      : "";
    if (interruptedApproval) {
      void this.recoverApproval(
        executionId, submissionId, sessionId, handle, approvalAbort,
        interruptedApproval, `${payload.body}${recoveryNotice}`
      );
    } else {
      const before = handle.agent.session.seq;
      handle.agent.followup(createUserMessage({
        content: [{ type: "text", text: `${payload.body}${recoveryNotice}` }],
        source: { kind: "user" }
      }));
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
          reason: pending.reason ?? "Resume the interrupted action from its last safe checkpoint?",
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
          text: "Recovery checkpoint validation. Do not call tools or repeat the interrupted action in this turn. The prior DSH approval is being re-presented to the user."
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
    this.database.prepare("UPDATE dsh_runs SET status = ?, updated_at = ? WHERE execution_id = ?")
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
    this.database.prepare("DELETE FROM dsh_runs WHERE execution_id = ?").run(executionId);
  }
}
