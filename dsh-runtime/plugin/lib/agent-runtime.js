import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { hideAgentBrowser, startAgentBrowser } from "./agent-browser.js";
import { BROWSER_CATALOG, MCP_CATALOG } from "./mcp-catalog.js";
import { mountAppTools } from "./app-tools.js";
import { currentIdentity, message, transaction } from "./product-database.js";
import { authorizeReferences, typedReferences } from "./product-references.js";
export { authorizeReferences, typedReferences } from "./product-references.js";

/** What a run may build for itself; everything else stays with the screens. */
const CONTROL_ACTIONS = {
  product: ["list_items", "create_process", "create_item", "create_goal", "create_recurring_work",
    "add_agent_assignment", "set_stage_route"],
  capability: ["search_mcp_registry", "install_mcp_server", "add_mcp_server", "list_skill_pack", "install_skill"]
};

const RUN_PERSONA = `You are a Bees work agent. Follow the immutable task configuration for this run.

Work only in the session workspace. For ordinary runs read inputs from inputs/ and write every deliverable under outputs/. To change a file that came from inputs/, write the whole updated file under outputs/ at the same relative path; publishing copies it back over the original. Do not write to mapped company folders directly. If you are provided with granted publication targets, you MUST ALWAYS call bees_publish_outputs to copy finished deliverables to the granted folder after the files are ready; Bees will ask the user for approval. Request approval for protected operations; if approval is denied, report the limitation with bees_submit_stage_result blocked when that tool is available, then stop. Every factual claim must come from the task or a tool result. When the task needs information you cannot find, ask the owner for it with ask_user_question and continue from the answer; stop only when a tool you need is unavailable or the owner cannot supply it. When the task gives an API key, token or URL, use that API over HTTP first and open the browser only when there is no API; never ask a person to sign in to a service whose credential the task already gives. Anything behind a sign-in goes through the browser, never fetch: fetch obeys robots and carries no session, so it answers for a signed-in page with a refusal that is not the real answer. If the browser then lands on a login wall, ask the owner with ask_user_question, which offers them the browser to sign in. Neither a robots refusal nor a login wall is a reason to finish the run blocked. When the outcome needs its own process, agents, MCP servers or skills, build them with bees_control when that tool is available. A task or stage that says build, create, set up, schedule or run a process, agent, work item, connection or schedule means calling bees_control; a document that describes one does not complete that stage. A request for a subagent means tracked peer delegation through bees_delegate_work when that tool is available. When Bees has already seated an Agent Team, use its team tools for discussion and follow-up. Once participants have reported and are idle, the lead may assign execution through bees_delegate_work.`;

const CATALOG_IDS = MCP_CATALOG.map(({ id }) => id).join(", ");
const PLAN_PERSONA = `You are Ask Bees, a planning agent. Propose the smallest set of changes that lets Bees carry out the requested outcome. Inspect the existing resources in the brief before proposing anything new.

Use an existing process when the person names it. Otherwise use create_goal to start fresh work in the shipped Goals process. Goals already has two agents planning together in Work, followed by independent Review and Done; keep those stages and routes. Do not create another Goals process or add a planning stage. Recurrence alone does not require a new process: create_goal or create_item first, then create_recurring_work referencing that item. Every new request starts fresh work, even if an earlier item has the same title.

Only propose create_process when the person explicitly asks to create a reusable workflow. Reuse existing agents and routes wherever they fit; add_agent_assignment only for a missing role or an explicit request for a new agent. Give a new agent presetId "standard", a name, and instructions defining its role and boundaries, including that it asks the owner for anything missing rather than stopping. Give it the servers its work needs: mcpAccess "listed" with the installed servers from the brief it will actually use, or "all" when the work is open-ended. An agent left on "none" has no mcp__ tool at all, so one that has to read a file, open a page or call an API cannot do its job. Set routes for a new process using existing or newly proposed agents. Change an existing process's routes only when the person asks to reconfigure it. Preserve any requested human approval points. If an existing process cannot honor them, ask a concise question before proposing it.

Resolved references in the request are stable identities. Use their ids when selecting an existing process or agent. A human or work reference supplies context; it does not authorize a notification or a change to that resource. A file reference already supplies the exact file as an input snapshot; do not attach its whole parent folder. A process-template reference supplies the saved stages: only instantiate it when requested, using create_process with template set to its id. References are preserved through Apply even if you summarize the request.

Keep setup capabilities: propose a missing MCP connection when the outcome requires one, install_skill only when an available pack clearly helps and is not already installed, and a schedule when the person specifies recurrence. A request only to configure a resource does not also need a work item. Reuse the configured model; do not invent a provider/model or require a second provider. Model connections and local model downloads are managed through the model settings screen, not proposal actions. The selected model and tool access follow the resulting work; do not broaden tool access or claim an unavailable connection is usable. Explain any missing access in the proposal.

A run only sees the team folders attached to its item: when the outcome reads or changes files in a team folder listed in the brief, the create_item or create_goal must carry that folder in inputLocations and, if files change, as outputLocation. Attach a folder only when the outcome is about the files in it; most outcomes need none.

MCP servers come from the catalog only, by install_mcp_server with one of these catalogId values: ${CATALOG_IDS}. An API with no server of its own goes through catalogId "openapi-bridge" with inputs {curl: the exact request the person gave} and secrets {API_HEADERS: its auth header}, which turns every endpoint into a tool. Never propose add_mcp_server with a package you have not seen. A credential always goes in an MCP server's secrets, where the credential store holds it. Never put a key, token or auth header in a work item, a goal or a stage: that column is plain text, it is indexed for search, it is shown on screen and it is read back into the prompt on every later run.

A stage is a name and nothing else. What the work is goes in the work item you create for it, and how an agent behaves goes in that agent's instructions, never in a stage. A credential the person gave belongs in the MCP server's secrets, never in a work item and never in a request for the person to sign in.

You must call bees_propose_changes with reviewable changes. Do not claim that a proposal was applied and do not modify Bees business state through any other route.`;

const REVIEW_PERSONA = `You are a fresh Bees reviewer. Independently inspect the candidate files and evidence in this session workspace. Run relevant checks yourself. Do not trust completion claims from the worker. You may only pass the work or return concrete revision feedback.`;

const HUMAN_INTERACTION_PROTOCOL = `Human interaction protocol:
- Use ask_user_question only to obtain missing information or ask the human to take an external action, such as signing in.
- If the task, process, or user asks the human to approve, accept, reject, review, sign off, continue, or stop based on completed work, call bees_request_work_review. This includes approval after each entry, step, or child task.
- Never create Approve, Reject, Continue, or Stop choices with ask_user_question.
- Ask for everything you are missing in one call, one entry per item, not a fresh question after each answer.
- A skipped preference is not a blocker: take the widest safe default, keep every limit the person did set, say what you assumed, and never ask it again. Never fail a stage over a missing preference. Information or a sign-in the work genuinely cannot proceed without is not a preference.
- A skip grants nothing. It does not widen what the task already authorised, and it is never the approval for an action that needs one.
This protocol selects the interaction mechanism; do not invent approval checkpoints that the task or process did not request.`;

const WORK_REVIEW_TOOL = "bees_request_work_review";
const reviewQuestions = (summary) => [{
  id: "work-review", header: "Work review", question: "Approve this work?", detail: summary,
  options: [
    { label: "Approve", description: "Accept the work and let the agent continue." },
    { label: "Reject", description: "Return the work with specific revision feedback." }
  ],
  multiSelect: false
}];
const DSH_ONE_SHOT_DELEGATION_TOOLS = ["subagent", "subagent_fork"];

const RUN_DATA_KEYS = new Set([
  "version", "mode", "executionId", "agentId", "agentName", "purpose", "model",
  "reasoningEffort", "resolvedModel", "resolvedReasoningEffort", "instructions",
  "workspaceId", "workItemId", "agentPresetId", "grants", "stagePurpose",
  "mcpAccess", "mcpServers", "capabilities", "discussionMembers", "requiresHumanApproval"
]);

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
  if (typeof value.agentPresetId !== "string" || !value.agentPresetId) throw new Error("Run data needs an agent preset");
  if (!["all", "none", "listed"].includes(value.mcpAccess) || !Array.isArray(value.mcpServers))
    throw new Error("Run data needs an MCP access policy");
  if (!Array.isArray(value.capabilities ?? []) || !Array.isArray(value.discussionMembers ?? []))
    throw new Error("Run capabilities or discussion members are invalid");
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

export async function resolveRunModel(ctx, data) {
  let selection = data.model ? modelRef(data.model) : ctx.agentDefaultModel.currentSelection();
  if (!selection?.provider || !selection?.model) throw new Error("Choose a system default model first.");
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

const admitsIncompleteCandidate = (summary) =>
  /\b(?:acceptance criteria|requirements?)\b[\s\S]{0,80}\b(?:not (?:fully )?met|unmet|incomplete|outstanding)\b/i.test(summary) ||
  /\b(?:partial|blocked) deliverable\b/i.test(summary);
const MAX_DELEGATION_DEPTH = 1;

/** A model that ends its turn without submitting is having a bad turn, not failing the stage. */
const STAGE_RESULT_COLUMNS = `
        execution_id TEXT PRIMARY KEY REFERENCES execution_links(execution_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('worker', 'reviewer')),
        outcome TEXT NOT NULL CHECK (outcome IN ('candidate', 'blocked', 'pass', 'revise')),
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;`;
const badTurn = (message) => Object.assign(new Error(message), { retryable: true });
// The provider dropping mid-turn is its bad turn, not the stage's, unless pi-ai says it will not change.
const PROVIDER_GAVE_UP = new Set(["AUTH", "INVALID_CREDENTIAL", "QUOTA", "INVALID_REQUEST", "CONTEXT_WINDOW_EXCEEDED"]);
const providerBadTurn = (failure) => Boolean(failure.code) && !PROVIDER_GAVE_UP.has(failure.code);

function reviewTimeline(events) {
  const calls = new Set();
  return events.flatMap((event) => {
    if (event.type === "tool/call" && ["ask_user_question", WORK_REVIEW_TOOL].includes(event.data.name)) {
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

function removeDshOneShotDelegationTools(agentCtx) {
  if (!agentCtx.tools.restrict) return;
  try { agentCtx.tools.restrict({ deny: DSH_ONE_SHOT_DELEGATION_TOOLS }); }
  catch (error) {
    if (!String(error).includes("unknown global tool")) throw error;
    for (const name of DSH_ONE_SHOT_DELEGATION_TOOLS) try { agentCtx.tools.restrict({ deny: [name] }); }
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

const CURL_AUTH_HEADER = /(-H\s+['"])([^'":]*(?:auth|token|key|secret)[^'":]*:\s*)[^'"]+/gi;

/** bees_control installs MCP servers with real API keys in its arguments, and a run's history is
 *  shown on screen. Keep the shape so the call still reads, drop the values. */
function redactSecrets(value) {
  // openapi-bridge is built from a pasted curl, so the credential is inside a string, not a field
  if (typeof value === "string") return value.replace(CURL_AUTH_HEADER, "$1$2hidden");
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) =>
    /secret|token|password|api[_-]?key|authorization/i.test(key)
      ? [key, typeof inner === "object" && inner !== null
          ? Object.fromEntries(Object.keys(inner).map((name) => [name, "hidden"]))
          : "hidden"]
      : [key, redactSecrets(inner)]));
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
      try { input = redactSecrets(JSON.parse(event.data.arguments)); } catch { input = event.data.arguments; }
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
  // DSH wants seq to equal the index, so renumber after dropping team events.
  return last ? events.filter((event) => event.seq <= last.seq &&
    !event.type.startsWith("team/") && event.data?.source?.kind !== "team-message")
    .map((event, seq) => ({ ...event, seq })) : [];
}

function outcomeFor(event) {
  const reason = event?.data?.reason;
  if (reason?.kind === "completed" || reason?.kind === "max-tokens") return { outcome: "completed", error: null };
  if (reason?.kind === "aborted") return { outcome: "cancelled", error: { message: "Stopped by user" } };
  const message = reason?.error?.message ?? (reason?.kind ? `Agent turn ended: ${reason.kind}` : "The agent runtime did not record a terminal turn");
  return { outcome: "failed", error: { message, code: reason?.error?.code } };
}

function jsonHash(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return createHash("sha256").update(serialized).digest("hex");
}

export function copyOutputs(workspace, location, executionId) {
  const sourceRoot = realpathSync(resolve(workspace, "outputs"));
  const destinationRoot = realpathSync(location.localPath);

  // Inputs are staged under "<name>-<id8>[-hash]/"; an output written at that same path replaces the original file.
  const staged = `${location.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${location.id.slice(0, 8)}`;
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
        const [first, ...rest] = relative(sourceRoot, source).split(sep);
        const logical = (first === staged || first.startsWith(`${staged}-`)) && rest.length ? rest.join(sep) : [first, ...rest].join(sep);
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

  // Copy files directly into destinationRoot
  for (const file of pending) {
    const target = resolve(destinationRoot, file.logical);
    if (!target.startsWith(`${destinationRoot}${sep}`)) throw new Error("Output path escaped the publication directory");
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(file.source, target);
  }
  
  return { files: pending.length, bytes, destination: ".", existing: false };
}


export class AgentRuntime {
  constructor(ctx, database, settings = null, notify = () => {}, subscribe = null, capabilities = null) {
    this.ctx = ctx;
    this.database = database;
    this.settings = settings;
    this.notify = notify;
    this.subscribe = subscribe;
    this.live = new Map();
    this.capabilities = capabilities;
    this.starting = new Set();
    this.recovery = new Set();
    this.closing = false;
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
      CREATE TABLE IF NOT EXISTS bees_run_queue (
        execution_id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS bees_stage_results (${STAGE_RESULT_COLUMNS}
    `);
    const stageResultSchema = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bees_stage_results'
    `).get()?.sql ?? "";
    if (!stageResultSchema.includes("'blocked'")) transaction(database, () => database.exec(`
      CREATE TABLE bees_stage_results_next (${STAGE_RESULT_COLUMNS}
      INSERT INTO bees_stage_results_next SELECT * FROM bees_stage_results;
      DROP TABLE bees_stage_results;
      ALTER TABLE bees_stage_results_next RENAME TO bees_stage_results;
    `));
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
      // Every start finds the same stale runs. One row per session says it; one per start buries
      // the rest of the audit trail under hundreds of repeats.
      const noted = this.database.prepare(`
        SELECT 1 FROM dsh_audit_events WHERE event_type = 'session-recovery-needed' AND session_id = ?
      `).get(sessionId);
      if (!noted) this.audit("session-recovery-needed", executionId, sessionId, { status });
    }
    // cordis emits listeners without a catch of its own, so a transient SQLITE_BUSY or one bad
    // stored JSON row would take the whole process down mid-run instead of failing this one event.
    ctx.on("session/event", (session, event) => {
      try { this.onSessionEvent(session, event); }
      catch (error) { ctx.logger.warn(`bees: session event ${event?.type} failed: ${message(error)}`); }
    }, { global: true });
  }

  setProposalStore(store) {
    this.proposalStore = store;
  }

  setKnowledgeSearch(search) {
    this.knowledgeSearch = search;
  }

  setKnowledgeReader(read) {
    this.knowledgeReader = read;
  }

  setSubitemStore(store) {
    this.subitemStore = store;
  }

  setWorkStarter(start) {
    this.workStarter = start;
  }

  audit(eventType, executionId, sessionId, metadata = {}) {
    const createdAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO dsh_audit_events (id, event_type, execution_id, session_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), eventType, executionId, sessionId, JSON.stringify(metadata), createdAt);
    this.notify({ type: eventType, executionId, sessionId, at: createdAt });
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

  pendingQuestion(executionId) {
    const pending = this.pendingInteraction(executionId);
    return ["question", "work-review"].includes(pending?.kind) ? pending : null;
  }

  needsRecovery(executionId) {
    return this.recovery.has(executionId);
  }

  onSessionEvent(session, event) {
    if (this.closing) return;
    const run = this.database.prepare(`
      SELECT execution_id AS executionId FROM execution_links WHERE current_session_id = ?
    `).get(String(session.id));
    if (!run) return;
    const executionId = String(run.executionId);
    const sessionId = String(session.id);
    this.notify({ type: event.type, executionId, sessionId, seq: event.seq });
    if (event.type === "tool/call" && ["ask_user_question", WORK_REVIEW_TOOL].includes(event.data.name)) {
      const pending = {
        kind: event.data.name === WORK_REVIEW_TOOL ? "work-review" : "question",
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
        idempotencyKey: `${pending.kind}-requested:${sessionId}:${pending.callId}`
      });
      this.audit(`${pending.kind}-requested`, executionId, sessionId, pending);
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
      if (["question", "work-review"].includes(pending?.kind) && pending.callId === callId) {
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
          idempotencyKey: `${pending.kind}-${answered ? "answered" : "cancelled"}:${sessionId}:${callId}`
        });
        this.audit(`${pending.kind}-${answered ? "answered" : "cancelled"}`, executionId, sessionId, { callId });
        this.track(hideAgentBrowser());
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
      SELECT execution_id AS executionId, work_item_id AS workItemId, agent_name AS agentName,
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
   * ponytail: a server connected mid-run stays visible to a run already going. An allow mask would
   * close that, at the cost of hiding every tool that registers late, and DSH is explicit that
   * restrict() is tool visibility rather than an authority boundary either way.
   */
  restrictMcp(agentCtx, data) {
    if (data.mcpAccess === "all") return;
    const allowed = new Set(data.mcpServers);
    const deny = this.ctx.tools.schemas().map(({ name }) => name).filter((name) => {
      const match = /^mcp__([A-Za-z0-9_-]{1,32}?)__/.exec(name);
      return match && !allowed.has(match[1]);
    });
    if (!deny.length) return;
    agentCtx.tools.restrict({ deny });
  }

  /** Chrome starts with the first run that can reach it. No Chrome is logged, not fatal: most runs never browse. */
  async startBrowserIfGranted({ mcpAccess, mcpServers }, agentCtx) {
    const browsers = this.database.prepare("SELECT server_name FROM mcp_servers WHERE enabled = 1 AND catalog_id = ?").all(BROWSER_CATALOG);
    if (mcpAccess === "none" || !browsers.some(({ server_name }) => mcpAccess === "all" || mcpServers.includes(server_name))) return;
    // This run's own browser, mounted on its agent context so it dies with the run. Chrome starts
    // alongside it only so a person has somewhere to sign in when a run asks for one.
    await this.capabilities.mountBrowserFor(agentCtx)
      .catch((error) => this.ctx.logger.warn(`bees: this run got no browser: ${message(error)}`));
    await startAgentBrowser().catch((error) => this.ctx.logger.warn(`bees: the agent's browser did not start: ${message(error)}`));
  }

  /**
   * No agent can reach for a tool it has not been told about, and three API bridges all labelled
   * "Any REST API" are indistinguishable without the host they point at.
   */
  connectedTools() {
    const servers = this.database.prepare(`
      SELECT server_name AS name, label, args_json AS args FROM mcp_servers WHERE enabled = 1 ORDER BY server_name
    `).all();
    if (!servers.length) return [];
    const named = servers.map(({ name, label, args }) => {
      const argv = JSON.parse(args);
      const at = argv.indexOf("--api-base-url");
      return `mcp__${name}__ (${at < 0 ? label : `${label}, ${argv[at + 1]}`})`;
    });
    return [`Tools this team has connected, by prefix: ${named.join(", ")}. Use one of these when it covers the task, rather than fetching a page yourself.`];
  }

  /** A folder-bound server takes its folder as its last argument; nothing else tells the model which. */
  boundFolders() {
    const bound = new Set(MCP_CATALOG.filter(({ requiresDirectory }) => requiresDirectory).map(({ id }) => id));
    return this.database.prepare("SELECT server_name AS name, args_json AS args, catalog_id AS catalogId FROM mcp_servers WHERE enabled = 1")
      .all()
      .filter(({ catalogId }) => bound.has(catalogId))
      .map(({ name, args }) => `Every mcp__${name}__ tool takes a path argument. Always pass ${JSON.parse(args).at(-1)}, never your working directory.`);
  }

  async prepareDiscussion(agent, members, signal) {
    for (const member of members ?? []) {
      const resolved = await resolveRunModel(this.ctx, member);
      const agentOptions = runAgentOptions(this.ctx, resolved);
      await this.ctx.agentTeams.spawnTeammate(agent, {
        name: member.name,
        description: member.description,
        prompt: [{ type: "text", text: member.prompt }],
        context: "fresh",
        provider: "spawn",
        ...(agentOptions ? { agentOptions } : {}),
        signal
      });
    }
  }

  assertDiscussionReady(agent, members, executionId) {
    if (!members?.length) return;
    const roster = this.ctx.agentTeams.listMembers(agent);
    const expected = members.map(({ name }) => roster.find((entry) => entry.name === name));
    if (expected.some((entry) => entry?.status === "running" || entry?.status === "provisioning"))
      throw new Error("Discussion participants are still working; wait for their pitches before submitting");
    const leadId = String(agent.session.id);
    if (expected.some((entry) => !entry || entry.status === "failed")) {
      if (!executionId || !members.every((member) => member.planningReviewer))
        throw new Error("A required discussion participant failed to join");
      const noted = this.database.prepare(`SELECT 1 FROM dsh_audit_events
        WHERE execution_id = ? AND session_id = ? AND event_type = 'goal-planning-fallback' LIMIT 1
      `).get(executionId, leadId);
      if (!noted) {
        this.audit("goal-planning-fallback", executionId, leadId, { reason: "Plan reviewer unavailable" });
        throw new Error("The plan reviewer is unavailable. Self-review the approach and completed work for missing requirements, risks, and validation. Disclose the fallback in your summary, then resubmit the completed work.");
      }
      return;
    }
    const events = agent.session.snapshotEvents();
    for (const member of expected) {
      const reported = events.some((event) => event.type === "team/message/queued" &&
        String(event.data.message.senderId) === String(member.id) &&
        String(event.data.message.targetId) === leadId);
      if (!reported) throw new Error(`${member.description || member.name} has not pitched in yet; ask them to report before submitting`);
    }
  }

  async setup(agentCtx, data, executionId, workspace) {
    const installedApp = data.workItemId ? this.apps?.context(data.workItemId) : null;
    await this.ctx.agentPresets.mount(agentCtx, data.agentPresetId);
    removeDshOneShotDelegationTools(agentCtx);
    this.restrictMcp(agentCtx, data);
    if (!installedApp) await this.startBrowserIfGranted(data, agentCtx);
    if (installedApp) mountAppTools(agentCtx, this.apps, installedApp, data);
    const systemInstructions = String(this.settings?.get?.()?.systemInstructions ?? "").trim();
    agentCtx.systemPrompt.section({
      name: "deployment:persona", order: 0,
      text: [
        data.mode === "planning" ? PLAN_PERSONA : data.mode === "review" ? REVIEW_PERSONA : RUN_PERSONA,
        systemInstructions ? `System-wide user instructions:\n${systemInstructions}` : "",
        String(data.instructions ?? ""),
        data.mode === "planning" ? "" : HUMAN_INTERACTION_PROTOCOL,
        installedApp ? "" : "Team knowledge is available independently of attached inputs. When requested information may be in a mapped team source, call bees_search_knowledge and then bees_read_knowledge; do not search only the session workspace or report the source missing first.",
        ...(installedApp ? [] : [...this.connectedTools(), ...this.boundFolders()])
      ].filter(Boolean).join("\n\n"), complete: true
    });
    if (!installedApp) agentCtx.tools.register(defineTool({
      name: "bees_search_knowledge",
      description: "Search work items and files in this Bees team. Results are read-only excerpts and are automatically scoped to the current run. Use bees_read_knowledge with any result id when the full source is needed.",
      parameters: {
        query: { type: "string", required: true, description: "Words or phrase to find." }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            results_json: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: value.results_json }]
      },
      execute: async (args) => {
        if (!this.knowledgeSearch) throw new Error("Bees knowledge search is unavailable");
        const results = await this.knowledgeSearch(args.query, data.workspaceId);
        return { results_json: JSON.stringify(results) };
      }
    }));
    if (!installedApp) agentCtx.tools.register(defineTool({
      name: "bees_read_knowledge",
      description: "Read one work item or file returned by bees_search_knowledge, including freshness and authority metadata for files. Modified dates indicate freshness, not authority; prefer an explicit authority/status marker and surface unresolved conflicts. The result must belong to this Bees team.",
      parameters: {
        result_id: { type: "string", required: true, description: "Exact result id returned by bees_search_knowledge." }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            document_json: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: value.document_json }]
      },
      execute: async (args) => {
        if (!this.knowledgeReader) throw new Error("Bees knowledge reading is unavailable");
        return { document_json: JSON.stringify(await this.knowledgeReader(args.result_id, data.workspaceId)) };
      }
    }));
    if (["work", "review"].includes(data.mode)) agentCtx.tools.register(defineTool({
      name: WORK_REVIEW_TOOL,
      description: "Request human approval of completed work or permission to continue after completed work, including approval after each entry, step, or child task. Use for approve, accept, reject, review, sign-off, continue, or stop decisions. If rejected, revise from the returned feedback and request review again; continue only after approval.",
      timeoutMs: 2_147_483_647,
      parameters: {
        summary: { type: "string", required: true, description: "Concise description of what is ready for review and where to inspect it." }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            outcome: { type: "string", required: true, enum: ["approved", "rejected"] },
            feedback: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error("Work review requires an active agent turn");
        if (exec.agent.session.header.parentSession) throw new Error("Only the lead work agent can request human approval");
        const summary = String(args.summary ?? "").trim();
        if (!summary) throw new Error("Work review needs a summary");
        const answer = await this.ctx.userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: reviewQuestions(summary) });
        const response = answer.answers.find(({ id }) => id === "work-review");
        if (response?.selected?.includes("Approve")) {
          this.audit("human-work-approved", executionId, String(exec.agent.session.id), { summary });
          return { outcome: "approved", feedback: "" };
        }
        const feedback = String(response?.custom ?? "").trim();
        if (!feedback) throw new Error("Rejected work requires revision feedback");
        this.audit("human-work-rejected", executionId, String(exec.agent.session.id), { summary, feedback });
        return { outcome: "rejected", feedback };
      }
    }));
    if (!installedApp && data.mode === "work" && this.command && this.capabilities) agentCtx.tools.register(defineTool({
      name: "bees_control",
      description: "Build Bees itself when the task needs more than this run: processes with stages, work items in them, agents with their own instructions, MCP servers and skills. When a task or stage says build, create, set up, schedule or run one of those, calling this tool is the deliverable; writing a document about it is not. Same actions and inputs the Bees screens send; the team is filled in for you. list_items {} -> the team's work items with title, process, stage, phase and updatedAt; read this before reporting on what the team did. "
        + "create_process {name, description, stages: [\"Stage name\", ...] or [{name, driver?: agent|discussion|review|terminal, requiresHumanApproval?: true}]} -> {id, stages: [{id, name}]}. create_item {processId, title, description, stageId?, agentIds?} -> {id}. create_goal {title, description} -> {id}. "
        + "add_agent_assignment {presetId: \"standard\", name, description, instructions, model?, mcpAccess: all|none|listed, mcpServers?} -> {id}. set_stage_route {stageId, agentIds: [assignment ids]}. "
        + "search_mcp_registry {query}. install_mcp_server {catalogId, inputs?: {curl | apiBaseUrl | openapiSpec}, directory?, secrets: {NAME: value}}, where catalogId openapi-bridge with inputs {curl} turns any REST API into tools and catalogId filesystem or git needs directory, an absolute path; add_mcp_server {serverName, transport: stdio|streamable-http, command?, args?: [one argument per item], url?, secrets: {NAME: value}} -> {id}; a server you install is usable in this run at once as mcp__<serverName>__ tools. "
        + "list_skill_pack {repo}. install_skill {repo, directory}. When the task gives an API key or token, connect that API here or call it over HTTP; never ask a person to sign in for it.",
      parameters: {
        action: { type: "string", required: true, description: "One of the actions above." },
        input_json: { type: "string", required: true, description: "JSON object with that action's input." }
      },
      output: {
        schema: {
          type: "object", additionalProperties: false, properties: {
            result_json: { type: "string", required: true }
          }
        },
        render: (_args, value) => [{ type: "text", text: value.result_json }]
      },
      execute: async (args, exec) => {
        let input;
        try { input = JSON.parse(args.input_json || "{}"); } catch { throw new Error("input_json must be valid JSON"); }
        const capability = CONTROL_ACTIONS.capability.includes(args.action);
        if (!capability && !CONTROL_ACTIONS.product.includes(args.action)) throw new Error(`bees_control cannot ${args.action}`);
        const payload = { ...input, action: args.action, workspaceId: data.workspaceId };
        const result = capability ? await this.capabilities.command(payload) : await this.command(payload);
        if (["install_mcp_server", "add_mcp_server"].includes(args.action)) {
          if (!result?.id) throw new Error(`${args.action} did not return a server`);
          await this.capabilities.mountFor(agentCtx, this.capabilities.row(result.id));
        } else if (args.action === "create_process" && result?.id) {
          // Stage ids are otherwise invisible to the model, which needs them for set_stage_route.
          result.stages = this.database.prepare(
            "SELECT id, name FROM stages WHERE process_id = ? AND archived_at IS NULL ORDER BY position"
          ).all(result.id);
        }
        this.audit("bees-control-used", executionId, String(exec.agent?.session.id ?? ""), { action: args.action, id: result?.id ?? null });
        return { result_json: JSON.stringify(result ?? null) };
      }
    }));
    if (!installedApp && data.mode === "planning") agentCtx.tools.register(defineTool({
      name: "bees_propose_changes",
      description: "Submit a reviewable Bees proposal. This stores a preview only; the user must apply it in Bees.",
      parameters: {
        proposal_title: { type: "string", required: true, description: "Short proposal title." },
        proposal_summary: { type: "string", required: true, description: "Why these changes meet the outcome." },
        changes_json: {
          type: "string", required: true,
          description: "JSON array, applied in order. Kinds: {action:'create_goal',title,description,inputLocations?:[folder name],outputLocation?:folder name}; {action:'create_process',name,description,template?:template name or id,stages:['Stage name'] or [{name,driver?:'agent'|'discussion'|'review'|'terminal',requiresHumanApproval?:true}]}; {action:'create_item',process,title,description,inputLocations?:[folder name],outputLocation?:folder name}; {action:'add_agent_assignment',presetId:'standard',name,description,instructions,model?,mcpAccess?:'all'|'none'|'listed',mcpServers?:[server name]}; {action:'set_stage_route',process,stage,agents:[agent name]}; {action:'install_mcp_server',catalogId,inputs?:{curl|apiBaseUrl|openapiSpec},directory?,secrets:{NAME:value}}; {action:'add_mcp_server',serverName,transport:'stdio'|'streamable-http',command?,args?:[argument],url?,secrets:{NAME:value}}; {action:'install_skill',repo,directory}; {action:'create_recurring_work',item,name,frequency,...} where frequency 'hourly' is an interval and takes everyMinutes (5 for every five minutes), 'daily'|'weekly'|'monthly' take hour, minute?, timezone? and dayOfWeek? or dayOfMonth?, 'advanced' takes cronExpression. A stage is just its name; what the work is goes in the item's description. inputLocations and outputLocation name team folders from the brief; set both when the outcome reads or changes files in one. mcpServers names installed servers from the brief or the catalogId of one installed in this proposal; the filesystem or git server needs directory, an absolute path the person gave. process and agents reference active resources from the brief by exact name or id, or resources created earlier in this array. stage names a stage in that process. item must name a create_goal or create_item earlier in the array; put its schedule afterwards. Default example: [{action:'create_goal',title:'Morning brief',description:'Read the requested sources and summarize them.'},{action:'create_recurring_work',item:'Morning brief',name:'Daily brief',frequency:'daily',hour:9,timezone:'America/Los_Angeles'}]. Only for an explicitly requested new reusable workflow, example: [{action:'add_agent_assignment',presetId:'standard',name:'Researcher',description:'Finds sources',instructions:'Only cite pages you opened.'},{action:'create_process',name:'Weekly brief',description:'...',stages:['Research','Approve','Publish']},{action:'set_stage_route',process:'Weekly brief',stage:'Research',agents:['Researcher']},{action:'create_item',process:'Weekly brief',title:'First brief',description:'...'}]."
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
          title: args.proposal_title, summary: args.proposal_summary, changes, request: data.purpose,
          runSettings: {
            ...(data.model ? { model: data.model, reasoningEffort: data.reasoningEffort } : {}),
            mcpAccess: data.mcpAccess, mcpServers: data.mcpServers
          }
        });
      }
    }));
    if (!installedApp && data.mode === "work" && data.workItemId)
      agentCtx.tools.register(defineTool({
        name: "bees_delegate_work",
        description: "Delegate one self-contained task to an independent peer agent. The peer is a normal visible child work item with the same process lifecycle and works in this run's shared workspace while the caller waits.",
        timeoutMs: 2_147_483_647,
        parameters: {
          items_json: {
            type: "string", required: true,
            description: "JSON array containing exactly one object shaped {title:string,description?:string,agentAssignmentId?:string}. Choose agentAssignmentId from the team roster to assign a specific agent. Omit it to inherit the caller. Include output paths and acceptance criteria in description. After a discussion, wait for all participants to report and become idle before delegating."
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
          if (exec.agent?.session.header?.parentSession) throw new Error("Only the lead work agent can delegate tracked work");
          this.assertDiscussionReady(exec.agent, data.discussionMembers, executionId);
          if (!this.subitemStore) throw new Error("The Bees sub-item store is unavailable");
          let items;
          try { items = JSON.parse(args.items_json); }
          catch { throw new Error("items_json must be valid JSON"); }
          if (!Array.isArray(items) || items.length !== 1)
            throw new Error("items_json must contain exactly one delegated work item");
          if (this.peerDepth(data.workItemId) >= MAX_DELEGATION_DEPTH)
            throw new Error("This work is already delegated as deep as Bees goes; do it in this run");
          const created = await this.subitemStore.create({ parentId: data.workItemId, items });
          const ids = created.map(({ id }) => id);
          const sessionId = String(exec.agent?.session.id ?? "");
          this.audit("peer-work-delegated", executionId, sessionId, { workItemId: data.workItemId, ids });
          try {
            const results = await this.waitForPeers(ids, exec.signal);
            this.audit("peer-work-settled", executionId, sessionId, { workItemId: data.workItemId, results });
            return { count: ids.length, ids: ids.join(","), results_json: JSON.stringify(results) };
          } catch (error) {
            await Promise.allSettled(ids.map((id) => this.subitemStore.cancel(id)));
            throw error;
          }
        }
      }));
    if (!installedApp && data.capabilities?.includes("start-work")) agentCtx.tools.register(defineTool({
      name: "bees_start_work",
      description: "Create a Bees work item in this team and start its process when automatic. Use this after an MCP event or message clearly warrants tracked work; do not create duplicates.",
      parameters: {
        process: { type: "string", required: true, description: "Process id or exact process name in this team." },
        title: { type: "string", required: true, description: "Concise work-item title." },
        description: { type: "string", description: "Event context and the desired outcome. Prefer references over copied payloads." },
        idempotency_key: { type: "string", required: true, description: "Stable source event id; a repeated id returns the same item." }
      },
      output: {
        schema: { type: "object", additionalProperties: false, properties: {
          id: { type: "string", required: true }, status: { type: "string", required: true }
        } },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      execute: async (args, exec) => {
        if (exec.agent?.session.header.parentSession) throw new Error("Only the lead work agent can start another Bees process");
        if (!this.workStarter) throw new Error("Bees work creation is unavailable");
        return this.workStarter({ workspaceId: data.workspaceId, agentId: data.agentId,
          process: args.process, title: args.title, description: args.description,
          idempotencyKey: args.idempotency_key });
      }
    }));
    if (data.stagePurpose) agentCtx.tools.register(defineTool({
      name: "bees_submit_stage_result",
      description: "Finish this automatic process stage. Workers submit candidate when complete or blocked when they cannot continue; reviewers submit pass or revise. The first submitted result is immutable.",
      parameters: {
        outcome: {
          type: "string", required: true,
          enum: data.stagePurpose === "reviewer" ? ["pass", "revise"] : ["candidate", "blocked"],
          description: "The allowed result for this stage."
        },
        ...(data.stagePurpose === "worker" ? {
          acceptance_criteria_met: {
            type: "boolean", required: true,
            description: "True only for a verified candidate; use false when submitting blocked."
          }
        } : {}),
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
        if (exec.agent?.session.header.parentSession)
          throw new Error("Only the lead work agent can submit the stage result");
        const allowed = data.stagePurpose === "reviewer" ? ["pass", "revise"] : ["candidate", "blocked"];
        if (!allowed.includes(args.outcome)) throw new Error("That outcome is not allowed for this stage");
        const result = { outcome: args.outcome, summary: String(args.summary ?? "").trim() };
        if (!result.summary) throw new Error("Stage result evidence is required");
        if (this.database.prepare(`SELECT 1 FROM dsh_audit_events
          WHERE execution_id = ? AND event_type = 'goal-planning-fallback' LIMIT 1
        `).get(executionId)) result.summary = `Planning partner unavailable; lead self-review used. ${result.summary}`;
        const prior = this.database.prepare(`
          SELECT outcome, summary FROM bees_stage_results WHERE execution_id = ?
        `).get(executionId);
        if (prior) {
          if (prior.outcome !== result.outcome || prior.summary !== result.summary)
            throw new Error("This stage already submitted a different immutable result");
          exec.concludeTurn();
          return prior;
        }
        if (data.stagePurpose === "worker" && args.outcome === "candidate" &&
            (args.acceptance_criteria_met !== true || admitsIncompleteCandidate(result.summary)))
          throw new Error("A candidate can be submitted only after every acceptance criterion is met");
        if (["candidate", "pass"].includes(args.outcome) && data.requiresHumanApproval &&
            !this.database.prepare(`SELECT 1 FROM dsh_audit_events
              WHERE execution_id = ? AND event_type = 'human-work-approved' LIMIT 1`).get(executionId))
          throw new Error("This stage requires human approval through bees_request_work_review before it can pass");
        if (["candidate", "pass"].includes(args.outcome)) this.assertDiscussionReady(exec.agent, data.discussionMembers, executionId);
        this.database.prepare(`
          INSERT INTO bees_stage_results VALUES (?, ?, ?, ?, ?)
        `).run(executionId, data.stagePurpose, result.outcome, result.summary, new Date().toISOString());
        exec.concludeTurn();
        return result;
      }
    }));
    // Read again at publish time: a changed target or a location archived mid-run must take effect.
    const grantIds = () => {
      if (data.workItemId) {
        const row = this.database.prepare(`
          SELECT coalesce(w.output_location_id, p.output_location_id) AS locationId
          FROM work_items w JOIN processes p ON p.id = w.process_id WHERE w.id = ?
        `).get(data.workItemId);
        return row?.locationId ? [row.locationId] : [];
      }
      return data.grants ?? [];
    };
    const granted = () => this.database.prepare(`
      SELECT l.id, l.name, m.absolute_path AS localPath FROM team_locations l
      JOIN workspaces w ON w.team_id = l.team_id
      JOIN device_location_mappings m ON m.location_id = l.id
        AND m.device_id = ?
      WHERE l.id IN (SELECT value FROM json_each(?)) AND l.archived_at IS NULL
        AND w.id = ?
    `).all(currentIdentity(this.database).deviceId, JSON.stringify(grantIds()), data.workspaceId);
    const grants = installedApp ? [] : granted();
    if (grants.length) {
      agentCtx.systemPrompt.context({
        name: "bees:publication-grants",
        order: 90,
        text: `Approved publication targets (an additional approval is required for each copy):\n${grants.map((grant) => `- ${grant.name}: ${grant.id}`).join("\n")}`
      });
    }
    if (!installedApp && data.mode === "work") agentCtx.tools.register(defineTool({
        name: "bees_publish_outputs",
        description: "Copy the finished files under outputs/ to one granted company folder. This always asks the user for approval before writing outside the run workspace.",
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
          const location = granted().find((grant) => grant.id === args.location_id);
          if (!location) throw new Error("That publication target was not granted to this run");
          if (!exec.agent) throw new Error("Publication requires an active agent turn");
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

  peerDepth(workItemId) {
    return this.database.prepare(`
      WITH RECURSIVE up(id, parent) AS (
        SELECT id, parent_id FROM work_items WHERE id = ?
        UNION ALL SELECT w.id, w.parent_id FROM work_items w JOIN up ON w.id = up.parent)
      SELECT COUNT(*) - 1 AS depth FROM up
    `).get(workItemId).depth;
  }

  async waitForPeers(ids, signal) {
    const read = this.database.prepare(`
      SELECT w.id, w.title, w.runtime_phase AS status, w.runtime_error AS error,
             w.updated_at AS settledAt
      FROM work_items w WHERE w.id = ? AND w.deleted_at IS NULL
    `);
    const wanted = new Set(ids);
    while (true) {
      let unsubscribe = () => {};
      const changed = this.subscribe
        ? new Promise((resolve) => {
            unsubscribe = this.subscribe((change) => {
              if (wanted.has(change.workItemId)) resolve();
            });
          })
        : delay(1_000, undefined, signal ? { signal } : undefined);
      const rows = ids.map((id) => read.get(id));
      if (rows.some((row) => !row)) {
        unsubscribe();
        throw new Error("Delegated work disappeared");
      }
      if (rows.every(({ status }) => ["completed", "failed", "cancelled"].includes(status))) {
        unsubscribe();
        return rows.map((row) => ({
          id: row.id, title: row.title, status: row.status, settledAt: row.settledAt,
          ...(row.error ? { error: row.error } : {})
        }));
      }
      try {
        await (this.subscribe
          ? Promise.race([changed, delay(5_000, undefined, signal ? { signal } : undefined)])
          : changed);
      } finally {
        unsubscribe();
      }
    }
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

  async queue(agentName, executionId, payload) {
    if (!payload?.idempotencyKey || typeof payload.body !== "string")
      throw new Error("A message and idempotency key are required");
    if (agentName !== "bees-run") throw new Error("Only the Bees work agent is available");
    const queued = this.database.prepare(`
      SELECT q.delivery_id AS deliveryId, r.current_session_id AS sessionId, r.instance_uid AS uid
      FROM bees_run_queue q JOIN execution_links r ON r.execution_id = q.execution_id
      WHERE q.execution_id = ?
    `).get(executionId);
    if (queued) {
      if (queued.deliveryId !== payload.idempotencyKey) throw new Error("This conversation already exists");
      return { executionId, sessionId: queued.sessionId, uid: queued.uid };
    }
    if (this.run(executionId)) throw new Error("This conversation already exists");
    if (payload.uid !== null && payload.uid !== undefined) throw new Error("A new run cannot be a continuation");
    const initialData = payload.initialData;
    if (!initialData) throw new Error("A new work run requires immutable initialData");
    validateRunData(initialData);
    authorizeReferences(this.database, initialData.workspaceId, typedReferences(payload.body));
    const storedData = { ...initialData };
    const workspace = resolve(String(payload.workspace ?? process.env.BEES_DEFAULT_WORKSPACE ?? process.cwd()));
    await mkdir(workspace, { recursive: true });
    const uid = randomUUID();
    const at = new Date().toISOString();
    let created = false;
    transaction(this.database, () => {
      const link = this.database.prepare(`
        INSERT OR IGNORE INTO execution_links
          (execution_id, workspace_id, work_item_id, agent_name, current_session_id,
           instance_uid, run_directory, config_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(executionId, initialData.workspaceId, initialData.workItemId || null, agentName,
        executionId, uid, workspace, JSON.stringify(storedData), at, at);
      const existing = this.database.prepare(
        "SELECT delivery_id AS deliveryId FROM bees_run_queue WHERE execution_id = ?"
      ).get(executionId);
      if (!link.changes && !existing) throw new Error("This conversation already exists");
      const inserted = this.database.prepare(`
        INSERT OR IGNORE INTO bees_run_queue (execution_id, delivery_id, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(executionId, payload.idempotencyKey, JSON.stringify({ ...payload, workspace }), at);
      const stored = this.database.prepare(
        "SELECT delivery_id AS deliveryId FROM bees_run_queue WHERE execution_id = ?"
      ).get(executionId);
      if (stored?.deliveryId !== payload.idempotencyKey)
        throw new Error("This conversation already exists");
      created = Boolean(inserted.changes);
    });
    const run = this.run(executionId);
    if (created) {
      this.checkpoint(executionId, executionId, "ready", {
        inputReferences: typedReferences(payload.body), idempotencyKey: `ready:${executionId}`
      });
      this.audit("run-queued", executionId, executionId, { deliveryId: payload.idempotencyKey });
    }
    return { executionId, sessionId: run.currentSessionId, uid: run.instanceUid };
  }

  startQueued(executionId) {
    if (this.starting.has(executionId)) return;
    const queued = this.database.prepare(`
      SELECT payload_json AS payloadJson FROM bees_run_queue WHERE execution_id = ?
    `).get(executionId);
    if (!queued) return;
    this.starting.add(executionId);
    const start = this.admit("bees-run", executionId, JSON.parse(queued.payloadJson)).catch((error) => {
      const run = this.run(executionId);
      if (run?.status === "queued") {
        const at = new Date().toISOString();
        this.database.prepare("UPDATE execution_links SET status = 'failed', updated_at = ? WHERE execution_id = ?")
          .run(at, executionId);
        this.database.prepare("DELETE FROM bees_run_queue WHERE execution_id = ?").run(executionId);
        this.checkpoint(executionId, run.currentSessionId, "failed", {
          idempotencyKey: `start-failed:${executionId}`
        });
        this.audit("run-failed", executionId, run.currentSessionId, { error: message(error), phase: "starting" });
      }
      this.ctx.logger?.warn?.(`bees: queued run ${executionId} failed to start: ${message(error)}`);
    }).finally(() => this.starting.delete(executionId));
    this.track(start);
  }

  async dispatch(agentName, executionId, payload) {
    const queued = await this.queue(agentName, executionId, { ...payload, background: true });
    this.startQueued(executionId);
    return { ...queued, status: "queued" };
  }

  resumeQueued() {
    for (const { executionId } of this.database.prepare(`
      SELECT execution_id AS executionId FROM bees_run_queue ORDER BY created_at
    `).all()) this.startQueued(executionId);
  }

  async admit(agentName, executionId, payload) {
    if (!payload?.idempotencyKey || typeof payload.body !== "string") throw new Error("A message and idempotency key are required");
    if (agentName !== "bees-run") throw new Error("Only the Bees work agent is available");
    const prior = this.database.prepare(`
      SELECT d.submission_id AS submissionId, r.instance_uid AS uid
      FROM dsh_deliveries d JOIN execution_links r ON r.execution_id = d.execution_id
      WHERE d.delivery_id = ?
    `).get(payload.idempotencyKey);
    if (prior) {
      this.database.prepare("DELETE FROM bees_run_queue WHERE execution_id = ?").run(executionId);
      return prior;
    }

    let run = this.run(executionId);
    const existed = Boolean(run);
    let prepared = Boolean(this.database.prepare(`
      SELECT 1 FROM bees_run_queue WHERE execution_id = ? AND delivery_id = ?
    `).get(executionId, payload.idempotencyKey));
    const previousStatus = run?.status;
    const continuation = payload.uid !== null && payload.uid !== undefined;
    const recovery = Boolean(run && this.needsRecovery(executionId));
    if (!run) {
      await this.queue(agentName, executionId, payload);
      run = this.run(executionId);
      prepared = true;
    } else if (continuation && payload.uid !== run.instanceUid) {
      throw new Error("The conversation incarnation does not match this run");
    } else if (!continuation && !recovery && !prepared) {
      throw new Error("This conversation already exists; send a continuation with its uid");
    }

    let data;
    let references;
    try {
      data = JSON.parse(run.configJson);
      if (!data.resolvedModel && (prepared || !existed)) {
        data = { ...data, ...await resolveRunModel(this.ctx, data) };
        validateRunData(data);
        this.database.prepare("UPDATE execution_links SET config_json = ?, updated_at = ? WHERE execution_id = ?")
          .run(JSON.stringify(data), new Date().toISOString(), executionId);
      }
      references = typedReferences(payload.body);
      authorizeReferences(this.database, data.workspaceId, references);
    } catch (error) {
      if (!existed) this.database.prepare("DELETE FROM execution_links WHERE execution_id = ?").run(executionId);
      throw error;
    }
    const workspace = run.runDirectory;
    const recoveryApproval = recovery ? this.pendingApproval(executionId) : null;
    const recoveryQuestion = recovery ? this.pendingQuestion(executionId) : null;
    const mode = recovery ? "recovery" : prepared || !existed ? "create" : "resume";
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
    const activeStatus = recovery && ["waiting_for_input", "waiting_for_approval"].includes(previousStatus)
      ? previousStatus : "running";
    // One unit: a crash between the delivery and the queue delete used to leave a delivery row with
    // no outcome and no queue row, and the next admit returned that row instead of starting a
    // session. The run then sat at running for ever with nothing able to clear it.
    transaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO dsh_deliveries (delivery_id, execution_id, submission_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(payload.idempotencyKey, executionId, submissionId, at);
      this.database.prepare("UPDATE execution_links SET status = ?, updated_at = ? WHERE execution_id = ?")
        .run(activeStatus, at, executionId);
      this.database.prepare("DELETE FROM bees_run_queue WHERE execution_id = ?").run(executionId);
    });
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
      ? "\n\nRecovery note: this is a replacement runtime session seeded through the previous session's durable log. Do not repeat a tool side effect already recorded there. Re-present any unresolved human approval before continuing."
      : "";
    if (recoveryApproval || recoveryQuestion) {
      this.track(recoveryApproval
        ? this.recoverApproval(executionId, submissionId, sessionId, handle, approvalAbort, recoveryApproval, `${payload.body}${recoveryNotice}`)
        : this.recoverQuestion(executionId, submissionId, sessionId, handle, approvalAbort, recoveryQuestion, `${payload.body}${recoveryNotice}`));
      this.recovery.delete(executionId);
    } else {
      let before;
      let planningFallback = "";
      try {
        if (data.discussionMembers?.length && mode !== "resume") {
          try { await this.prepareDiscussion(handle.agent, data.discussionMembers, approvalAbort.signal); }
          catch (error) {
            if (!data.discussionMembers.every((member) => member.planningReviewer) || approvalAbort.signal.aborted) throw error;
            this.audit("goal-planning-fallback", executionId, sessionId, { reason: message(error) });
            planningFallback = "\n\nThe planning partner could not start. Self-review your proposed approach for missing requirements, risks, and validation, then execute the goal. Disclose this fallback in your stage summary. Do not wait for the unavailable peer.";
          }
        }
        before = handle.agent.session.seq;
        handle.agent.followup(createUserMessage({
          content: [{ type: "text", text: `${payload.body}${recoveryNotice}${planningFallback}` }],
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
      this.track(this.settle(executionId, submissionId, sessionId, handle, before));
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
        // still inside the turn/start publication; appending the approval here makes dsh throw "cannot reenter"
        setTimeout(() => void this.ctx.approval.request({
          agent: handle.agent,
          toolName: pending.toolName,
          reason: pending.reason ?? "Resume the action from its last safe checkpoint?",
          signal
        }).then(resolve, reject), 0);
      }, { global: true });
    });
  }

  async recoverApproval(executionId, submissionId, sessionId, handle, approvalAbort, pending, body) {
    try {
      const approval = this.reissueApproval(handle, pending, approvalAbort.signal);
      handle.agent.followup(createUserMessage({
        content: [{
          type: "text",
          text: "Recovery checkpoint validation. Do not call tools or repeat the prior action in this turn. The prior approval is being re-presented to the user."
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
        error: { message: message(error) }
      });
    }
  }

  /** The model asked before the restart; Bees asks again itself and hands the answer to the resumed run. */
  async recoverQuestion(executionId, submissionId, sessionId, handle, approvalAbort, pending, body) {
    try {
      const args = JSON.parse(pending.questions);
      const review = pending.kind === "work-review";
      const answer = await this.ctx.userQuestions.ask({
        agent: handle.agent, signal: approvalAbort.signal, questions: review ? reviewQuestions(args.summary) : args.questions
      });
      const response = review ? answer.answers.find(({ id }) => id === "work-review") : null;
      const approved = Boolean(response?.selected?.includes("Approve"));
      if (review) this.audit(approved ? "human-work-approved" : "human-work-rejected", executionId, sessionId, { summary: args.summary, feedback: response?.custom ?? "" });
      this.checkpoint(executionId, sessionId, "running", { pendingInteraction: null, idempotencyKey: `${pending.kind}-answered:${sessionId}:${pending.callId}` });
      const outcome = review
        ? `The review you requested before the restart was ${approved ? "approved" : `rejected with this feedback: ${response?.custom ?? ""}`}.`
        : `The user answered the question you asked before the restart:\n${JSON.stringify(answer.answers)}`;
      const before = handle.agent.session.seq;
      handle.agent.followup(createUserMessage({ content: [{ type: "text", text: `${body}\n\n${outcome}` }], source: { kind: "user" } }));
      await this.settle(executionId, submissionId, sessionId, handle, before);
    } catch (error) {
      await this.finish(executionId, submissionId, sessionId, handle, { outcome: "failed", error: { message: message(error) } });
    }
  }

  async settle(executionId, submissionId, sessionId, handle, before) {
    let result;
    try {
      await handle.agent.whenIdle();
      result = outcomeFor(lastTurn(handle.agent.session.snapshotEvents(), before));
    } catch (error) {
      result = { outcome: "failed", error: { message: message(error) } };
    }
    await this.finish(executionId, submissionId, sessionId, handle, result);
  }

  async finish(executionId, submissionId, sessionId, handle, result) {
    if (this.closing) return;
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
    // The reason is already on the delivery row; dropping it here left the audit trail saying a
    // run failed and nothing about why, when the answer was "the model provider is out of quota".
    this.audit(`run-${result.outcome}`, executionId, sessionId,
      result.error ? { submissionId, error: result.error.message, code: result.error.code } : { submissionId });
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

  /** A new attempt replaces the last one, whose session would otherwise sit live for good. */
  supersede(executionId, workItemId) {
    if (!workItemId) return;
    for (const id of [...this.live.keys()])
      if (id !== executionId && this.run(id)?.workItemId === workItemId) this.abort(id);
  }

  async waitForDelivery(executionId, submissionId, signal) {
    while (true) {
      const delivery = this.database.prepare(`
        SELECT outcome, error_json AS errorJson FROM dsh_deliveries WHERE submission_id = ?
      `).get(submissionId);
      if (!delivery) throw new Error("The agent stage delivery disappeared");
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
    this.supersede(executionId, payload.initialData?.workItemId);
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
        body: `Resume this automatic process stage from its durable runtime checkpoint.\n\n${payload.body}`
      });
    } else if (!submission || submission.outcome) {
      const result = this.stageResult(executionId);
      if (result && this.run(executionId)?.status === "completed") return result;
      const failure = submission?.errorJson ? JSON.parse(submission.errorJson) : null;
      if (failure && !providerBadTurn(failure)) throw new Error(failure.message);
      const asked = this.database.prepare("SELECT COUNT(*) AS n FROM dsh_deliveries WHERE execution_id = ?").get(executionId).n;
      submission = await this.admit("bees-run", executionId, {
        ...payload,
        initialData: undefined,
        uid: run.instanceUid,
        idempotencyKey: `process:${executionId}:resubmit:${asked}`,
        body: `${failure ? "Your last turn was cut off by the model provider. Pick up where you left off." : "Your last turn ended without calling bees_submit_stage_result. Submit the result for the work already done."}\n\n${payload.body}`
      });
    }

    const delivery = await this.waitForDelivery(executionId, submission.submissionId, signal);
    if (delivery.outcome !== "completed") {
      const failure = delivery.errorJson ? JSON.parse(delivery.errorJson) : null;
      if (failure && providerBadTurn(failure)) throw badTurn(failure.message);
      throw new Error(failure?.message || `Agent stage ${delivery.outcome}`);
    }
    const result = this.stageResult(executionId);
    if (!result) throw badTurn("The agent runtime completed without calling bees_submit_stage_result");
    return result;
  }

  async history(executionId) {
    const run = this.run(executionId);
    if (!run) return null;
    const live = this.live.get(executionId);
    const events = live?.handle.agent.session.snapshotEvents() ??
      (run.status === "queued" ? []
        : (await this.ctx.sessionPersistence.inspect(SessionId(run.currentSessionId))).events);
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
            ? this.live.get(run.executionId).handle.agent.session.snapshotEvents()
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
        mcpAccess: config.mcpAccess ?? "all", mcpServers: config.mcpServers ?? [],
        createdAt: run.createdAt, updatedAt: run.updatedAt, result, sessions, audit
      });
    }
    return {
      version: 1, candidateExecutionId: executionId,
      note: "System-generated from the durable runtime session and Bees audit records; candidate files cannot modify this evidence. A peer-work-settled audit event is emitted only after delegated work reaches a terminal lifecycle state and includes the system-observed result and settlement time. toolCalls counts every tool a run called. The timeline covers only user questions and approvals, so an empty one is not evidence no tool ran. mcpAccess is what the candidate was granted, not what you can reach: none means it had no mcp__ tool at all, and listed means only mcpServers. Judge the candidate against its own grant.",
      executions
    };
  }

  /** Settling outlives the reply that started it, and an unhandled rejection here takes the runtime down. */
  track(promise) { promise.catch((error) => this.ctx.logger.warn(`bees: a run did not settle: ${message(error)}`)); }

  /** Shutdown leaves a working run alone; it resumes from its DSH checkpoint on the next start. */
  close() { this.closing = true; }

  abort(executionId) {
    // Draining the worker cancels the activity too, and that is a restart, not a person pressing stop.
    if (this.closing) return false;
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
