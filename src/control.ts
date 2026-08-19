import type { ApiClient } from "./api.js";
import type { LocalRepository } from "./repository.js";
import { errorText } from "./domain.js";

const PRIVATE_CONTROL_KEY = "private-control";
const DEFAULT_SYNC_TIME = "02:00";

const METRIC_CATALOG = {
  "agent.inventory": { unit: "agent", dimensions: ["team"] },
  "run.started": { unit: "run", dimensions: ["team", "agent"] },
  "run.completed": { unit: "run", dimensions: ["team", "agent", "outcome"] },
  "run.duration": { unit: "ms", dimensions: ["team", "agent", "outcome"] },
  "review.pending": { unit: "item", dimensions: ["team"] },
  "model.reported_cost": { unit: "currency", dimensions: ["model"] },
  "policy.decisions": { unit: "decision", dimensions: ["policy", "action", "decision"] }
} as const;

export type MetricId = keyof typeof METRIC_CATALOG;
export type PolicyDecision =
  | { decision: "allow"; policyId?: string; reason?: string }
  | { decision: "deny" | "approval_required"; policyId: string; reason: string };

export interface PolicyInput {
  now: string;
  action: string;
  subject: { userId: string; roles: string[]; teamIds: string[] };
  resource: { type: string; id?: string; attributes: Record<string, unknown> };
  context: {
    workspaceId: string;
    teamId?: string;
    deviceId: string;
    agentId?: string;
    dataClassification?: string;
    model?: Record<string, unknown>;
    tool?: Record<string, unknown>;
    run?: Record<string, unknown>;
  };
  activeExceptionPolicyIds: string[];
}

export interface PolicyException {
  id: string;
  policyId: string;
  subjectUserId?: string;
  teamId?: string;
  agentId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  validFrom?: string;
  expiresAt: string;
}

export interface ControlDocument {
  version: number;
  /** Device-local wall clock time. A changed time takes effect after the next successful sync. */
  syncTime: string;
  policy: { source: string; sha256: string };
  exceptions: PolicyException[];
  metrics: {
    enabled: Array<{ metricId: MetricId; dimensions: string[] }>;
    widgets: Array<{
      title: string;
      metricId: MetricId;
      visualization: "number" | "line" | "bar" | "table";
      filter?: Record<string, string>;
      groupBy?: string;
    }>;
  };
}

export interface ReportIdentity {
  organizationId: string;
  deviceId: string;
  userId: string;
  appVersion: string;
  teamId?: string;
}

type ControlRecord =
  | {
      kind: "health";
      appliedVersion: number;
      lastApplyError?: string;
      observedAt: string;
    }
  | {
      kind: "metric";
      metricId: MetricId;
      value: number;
      unit: string;
      dimensions: Record<string, string>;
      observedAt: string;
    }
  | {
      kind: "policy_receipt";
      action: string;
      decision: "allow" | "deny" | "approval_required" | "error";
      policyId?: string;
      appliedExceptionIds: string[];
      policyVersion: number;
      policyHash: string;
      observedAt: string;
    }
  | {
      kind: "exception_request";
      requestId: string;
      policyId: string;
      action: string;
      resourceType: string;
      resourceId?: string;
      agentId?: string;
      reason: string;
      expiresAt: string;
      observedAt: string;
    };

let activeOrganizationId = "";
let activeControl: ControlDocument | null = null;
let lastApplyError = "";
// Set only when a policy document exists and we could not honour it: a bad hash, a source that
// will not evaluate, a cached document that no longer parses. Empty means there is nothing to
// enforce, which is the normal state for a workspace that has never configured one.
let unusableControl = "";

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 10_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${name} must be non-empty text no longer than ${maximum} characters`);
  }
  return value;
}

function optionalText(value: unknown, name: string, maximum = 200): string | undefined {
  return value === undefined ? undefined : text(value, name, maximum);
}

function timestamp(value: unknown, name: string): string {
  const result = text(value, name, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} must be a timestamp`);
  return result;
}

function metricId(value: unknown): MetricId {
  const result = String(value) as MetricId;
  if (!Object.hasOwn(METRIC_CATALOG, result)) throw new Error(`Unknown metric ${result}`);
  return result;
}

function policyException(value: unknown, index: number): PolicyException {
  const input = object(value, `exceptions[${index}]`);
  const status = String(input.status);
  if (!(["pending", "approved", "rejected", "revoked"] as const).includes(status as never)) {
    throw new Error(`exceptions[${index}].status is invalid`);
  }
  return {
    id: text(input.id, `exceptions[${index}].id`, 120),
    policyId: text(input.policyId, `exceptions[${index}].policyId`, 120),
    ...optionalFields(input, index),
    reason: text(input.reason, `exceptions[${index}].reason`, 500),
    requestedBy: text(input.requestedBy, `exceptions[${index}].requestedBy`, 200),
    status: status as PolicyException["status"],
    expiresAt: timestamp(input.expiresAt, `exceptions[${index}].expiresAt`)
  };
}

function optionalFields(input: Record<string, unknown>, index: number): Partial<PolicyException> {
  const field = (key: string) => optionalText(input[key], `exceptions[${index}].${key}`);
  const subjectUserId = field("subjectUserId");
  const teamId = field("teamId");
  const agentId = field("agentId");
  const action = field("action");
  const resourceType = field("resourceType");
  const resourceId = field("resourceId");
  const approvedBy = field("approvedBy");
  return {
    ...(subjectUserId ? { subjectUserId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(approvedBy ? { approvedBy } : {}),
    ...(input.validFrom === undefined
      ? {}
      : { validFrom: timestamp(input.validFrom, `exceptions[${index}].validFrom`) })
  };
}

export function parseControlDocument(value: unknown): ControlDocument {
  const input = object(value, "private-control");
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Control version is invalid");
  const syncTime = text(input.syncTime, "syncTime", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(syncTime)) {
    throw new Error("syncTime must be HH:mm in device-local time");
  }
  const policy = object(input.policy, "policy");
  const metrics = object(input.metrics, "metrics");
  if (!Array.isArray(input.exceptions) || input.exceptions.length > 500) {
    throw new Error("exceptions must be a list of at most 500 records");
  }
  if (!Array.isArray(metrics.enabled) || !Array.isArray(metrics.widgets)) {
    throw new Error("metrics.enabled and metrics.widgets must be lists");
  }
  const policyHash = text(policy.sha256, "policy.sha256", 64);
  if (!/^[a-f0-9]{64}$/i.test(policyHash)) throw new Error("policy.sha256 must be a SHA-256 digest");
  return {
    version,
    syncTime,
    policy: {
      source: text(policy.source, "policy.source", 100_000),
      sha256: policyHash
    },
    exceptions: input.exceptions.map(policyException),
    metrics: {
      enabled: metrics.enabled.map((value, index) => {
        const selection = object(value, `metrics.enabled[${index}]`);
        const id = metricId(selection.metricId);
        if (!Array.isArray(selection.dimensions)) throw new Error("Metric dimensions must be a list");
        const allowed = new Set<string>(METRIC_CATALOG[id].dimensions);
        const dimensions = selection.dimensions.map(String);
        if (dimensions.some((dimension) => !allowed.has(dimension))) {
          throw new Error(`Metric ${id} contains an unsupported dimension`);
        }
        return { metricId: id, dimensions };
      }),
      widgets: metrics.widgets.slice(0, 20).map((value, index) => {
        const widget = object(value, `metrics.widgets[${index}]`);
        const visualization = String(widget.visualization);
        if (!["number", "line", "bar", "table"].includes(visualization)) {
          throw new Error(`metrics.widgets[${index}].visualization is invalid`);
        }
        const filter = widget.filter === undefined ? undefined : object(widget.filter, "widget.filter");
        return {
          title: text(widget.title, `metrics.widgets[${index}].title`, 120),
          metricId: metricId(widget.metricId),
          visualization: visualization as "number" | "line" | "bar" | "table",
          ...(filter
            ? { filter: Object.fromEntries(Object.entries(filter).map(([key, item]) => [key, String(item)])) }
            : {}),
          ...(widget.groupBy === undefined
            ? {}
            : { groupBy: text(widget.groupBy, `metrics.widgets[${index}].groupBy`, 80) })
        };
      })
    }
  };
}

export async function sha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isControlSyncDue(lastSyncAt: string, syncTime: string, at = new Date()): boolean {
  if (!lastSyncAt || !Number.isFinite(Date.parse(lastSyncAt))) return true;
  const [hours, minutes] = syncTime.split(":").map(Number);
  const latest = new Date(at);
  latest.setHours(hours!, minutes!, 0, 0);
  if (latest > at) latest.setDate(latest.getDate() - 1);
  return Date.parse(lastSyncAt) < latest.getTime();
}

function cacheKey(organizationId: string): string {
  return `private_control:${organizationId}`;
}

function syncKey(organizationId: string): string {
  return `private_control_last_sync:${organizationId}`;
}

export async function loadCachedControl(
  repository: LocalRepository,
  organizationId: string
): Promise<void> {
  activeOrganizationId = organizationId;
  activeControl = null;
  lastApplyError = "";
  unusableControl = "";
  const cached = await repository.getSetting<unknown>(cacheKey(organizationId), null);
  if (cached === null) return;
  try {
    activeControl = parseControlDocument(cached);
  } catch (error) {
    lastApplyError = errorText(error);
    unusableControl = errorText(error);
  }
}

async function evaluateSource(source: string, input: PolicyInput, timeoutMs = 250): Promise<PolicyDecision> {
  if (typeof Worker === "undefined") throw new Error("Policy worker is unavailable");
  const wrapper = `\nconst deepFreeze = value => { if (value && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; };\nself.onmessage = event => { try { self.postMessage({ value: evaluate(deepFreeze(event.data)) }); } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); } };`;
  const url = URL.createObjectURL(new Blob([source, wrapper], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  try {
    return await new Promise<PolicyDecision>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("Policy evaluation timed out"));
      }, timeoutMs);
      worker.onmessage = ({ data }: MessageEvent<{ value?: unknown; error?: string }>) => {
        window.clearTimeout(timeout);
        if (data.error) return reject(new Error(data.error));
        try {
          resolve(policyDecision(data.value));
        } catch (error) {
          reject(error);
        }
      };
      worker.onerror = ({ message }) => {
        window.clearTimeout(timeout);
        reject(new Error(message || "Policy worker failed"));
      };
      worker.postMessage(input);
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

function policyDecision(value: unknown): PolicyDecision {
  const result = object(value, "Policy decision");
  const decision = String(result.decision);
  if (decision === "allow") {
    return {
      decision,
      ...(result.policyId === undefined ? {} : { policyId: text(result.policyId, "policyId", 120) }),
      ...(result.reason === undefined ? {} : { reason: text(result.reason, "reason", 500) })
    };
  }
  if (!["deny", "approval_required"].includes(decision)) throw new Error("Policy decision is invalid");
  return {
    decision: decision as "deny" | "approval_required",
    policyId: text(result.policyId, "policyId", 120),
    reason: text(result.reason, "reason", 500)
  };
}

function matchingExceptions(document: ControlDocument, input: PolicyInput): PolicyException[] {
  const now = Date.parse(input.now);
  return document.exceptions.filter(
    (exception) =>
      exception.status === "approved" &&
      Date.parse(exception.expiresAt) > now &&
      (!exception.validFrom || Date.parse(exception.validFrom) <= now) &&
      (!exception.subjectUserId || exception.subjectUserId === input.subject.userId) &&
      (!exception.teamId || exception.teamId === input.context.teamId) &&
      (!exception.agentId || exception.agentId === input.context.agentId) &&
      (!exception.action || exception.action === input.action) &&
      (!exception.resourceType || exception.resourceType === input.resource.type) &&
      (!exception.resourceId || exception.resourceId === input.resource.id)
  );
}

export function activeExceptionPolicyIds(
  document: ControlDocument,
  input: PolicyInput
): string[] {
  return [...new Set(matchingExceptions(document, input).map(({ policyId }) => policyId))];
}

export async function decide(
  repository: LocalRepository,
  identity: ReportIdentity,
  input: Omit<PolicyInput, "now" | "activeExceptionPolicyIds">
): Promise<PolicyDecision> {
  if (activeOrganizationId !== identity.organizationId) return { decision: "allow" };
  if (!activeControl) {
    // A policy we cannot apply is not the same as no policy. Allowing here is how a tampered
    // document or a broken source quietly turns enforcement off for the whole workspace.
    if (!unusableControl) return { decision: "allow" };
    return {
      decision: "approval_required",
      policyId: PRIVATE_CONTROL_KEY,
      reason: `The workspace policy could not be applied, so this needs approval: ${unusableControl}`
    };
  }
  const now = new Date().toISOString();
  const policyInput = { ...input, now, activeExceptionPolicyIds: [] };
  const exceptions = matchingExceptions(activeControl, policyInput);
  let decision: PolicyDecision | { decision: "error"; reason: string };
  try {
    decision = await evaluateSource(activeControl.policy.source, {
      ...input,
      now,
      activeExceptionPolicyIds: activeExceptionPolicyIds(activeControl, policyInput)
    });
  } catch (error) {
    decision = { decision: "error", reason: errorText(error) };
  }
  if (metricEnabled("policy.decisions")) {
    await enqueue(repository, identity, {
      kind: "policy_receipt",
      action: input.action,
      decision: decision.decision,
      ...(decision.decision !== "error" && decision.policyId ? { policyId: decision.policyId } : {}),
      appliedExceptionIds: exceptions.map(({ id }) => id),
      policyVersion: activeControl.version,
      policyHash: activeControl.policy.sha256,
      observedAt: now
    }).catch(() => undefined);
  }
  if (decision.decision === "error") {
    throw new Error(`Policy could not be evaluated: ${decision.reason}`);
  }
  return decision;
}

export async function syncControl(
  repository: LocalRepository,
  api: ApiClient,
  token: string,
  identity: ReportIdentity,
  at = new Date()
): Promise<boolean> {
  if (activeOrganizationId !== identity.organizationId) {
    await loadCachedControl(repository, identity.organizationId);
  }
  const lastSync = await repository.getSetting(syncKey(identity.organizationId), "");
  if (!isControlSyncDue(lastSync, activeControl?.syncTime ?? DEFAULT_SYNC_TIME, at)) return false;
  let applied = false;
  let contacted = false;
  // A network failure and a policy we cannot honour are different problems, and only the second
  // one may tighten what the app allows.
  let validating = false;
  try {
    const policies = (await api.listPolicies(token, identity.organizationId)).policies;
    contacted = true;
    const remote = policies.find(
      ({ key }) => key === PRIVATE_CONTROL_KEY
    );
    if (!remote) {
      unusableControl = "";
    } else {
      validating = true;
      const candidate = parseControlDocument(remote.value);
      if ((await sha256(candidate.policy.source)) !== candidate.policy.sha256) {
        throw new Error("Policy source hash does not match");
      }
      await evaluateSource(candidate.policy.source, {
        now: at.toISOString(),
        action: "policy.self_test",
        subject: { userId: identity.userId, roles: [], teamIds: [] },
        resource: { type: "control", attributes: {} },
        context: {
          workspaceId: identity.organizationId,
          deviceId: identity.deviceId
        },
        activeExceptionPolicyIds: []
      });
      await repository.setSetting(cacheKey(identity.organizationId), candidate);
      activeControl = candidate;
      lastApplyError = "";
      unusableControl = "";
      applied = true;
    }
  } catch (error) {
    lastApplyError = errorText(error);
    if (validating) unusableControl = errorText(error);
  } finally {
    if (contacted) await repository.setSetting(syncKey(identity.organizationId), at.toISOString());
  }
  return applied;
}

export async function reportHealth(
  repository: LocalRepository,
  identity: ReportIdentity
): Promise<void> {
  await enqueue(repository, identity, {
    kind: "health",
    appliedVersion: activeControl?.version ?? 0,
    ...(lastApplyError ? { lastApplyError: lastApplyError.slice(0, 500) } : {}),
    observedAt: new Date().toISOString()
  });
}

function metricEnabled(id: MetricId): boolean {
  return activeControl?.metrics.enabled.some(({ metricId: selected }) => selected === id) ?? false;
}

export async function reportMetric(
  repository: LocalRepository,
  identity: ReportIdentity,
  id: MetricId,
  value: number,
  dimensions: Record<string, string> = {}
): Promise<void> {
  if (!metricEnabled(id)) return;
  if (!Number.isFinite(value)) throw new Error("Metric value must be finite");
  const selection = activeControl!.metrics.enabled.find(({ metricId: selected }) => selected === id)!;
  const accepted = Object.fromEntries(
    Object.entries(dimensions)
      .filter(([key]) => selection.dimensions.includes(key))
      .map(([key, item]) => [key, text(item, `Metric dimension ${key}`, 120)])
  );
  await enqueue(repository, identity, {
    kind: "metric",
    metricId: id,
    value,
    unit: METRIC_CATALOG[id].unit,
    dimensions: accepted,
    observedAt: new Date().toISOString()
  });
}

export async function requestException(
  repository: LocalRepository,
  identity: ReportIdentity,
  input: {
    policyId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    agentId?: string;
    reason: string;
    expiresAt: string;
  }
): Promise<void> {
  await enqueue(repository, identity, {
    kind: "exception_request",
    requestId: crypto.randomUUID(),
    policyId: text(input.policyId, "policyId", 120),
    action: text(input.action, "action", 120),
    resourceType: text(input.resourceType, "resourceType", 120),
    ...(input.resourceId ? { resourceId: text(input.resourceId, "resourceId", 200) } : {}),
    ...(input.agentId ? { agentId: text(input.agentId, "agentId", 200) } : {}),
    reason: text(input.reason, "reason", 500),
    expiresAt: timestamp(input.expiresAt, "expiresAt"),
    observedAt: new Date().toISOString()
  });
}

async function enqueue(
  repository: LocalRepository,
  identity: ReportIdentity,
  record: ControlRecord
): Promise<void> {
  const batchId = crypto.randomUUID();
  await repository.enqueueSync(
    "control_report",
    identity.deviceId,
    {
      schemaVersion: 1,
      batchId,
      deviceId: identity.deviceId,
      userId: identity.userId,
      ...(identity.teamId ? { teamId: identity.teamId } : {}),
      appVersion: identity.appVersion,
      appliedVersion: activeControl?.version ?? 0,
      createdAt: new Date().toISOString(),
      records: [record]
    },
    "upsert"
  );
}

export async function flushControlReports(
  repository: LocalRepository,
  api: ApiClient,
  token: string,
  organizationId: string
): Promise<number> {
  const entries = (await repository.dueSyncEntries(100)).filter(
    ({ recordType }) => recordType === "control_report"
  );
  let sent = 0;
  for (const entry of entries) {
    try {
      await api.reportControl(token, organizationId, entry.payload);
      await repository.completeQueuedEntries([entry.id]);
      sent += 1;
    } catch (error) {
      await repository.deferSyncEntry(
        entry.id,
        entry.attempts,
        errorText(error),
        "control"
      );
    }
  }
  return sent;
}
