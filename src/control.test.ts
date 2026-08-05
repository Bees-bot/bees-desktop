import { describe, expect, it } from "vitest";
import {
  activeExceptionPolicyIds,
  isControlSyncDue,
  parseControlDocument,
  type ControlDocument,
  type PolicyInput
} from "./control.js";

const hash = "a".repeat(64);

function document(exceptions: ControlDocument["exceptions"] = []): ControlDocument {
  return parseControlDocument({
    version: 3,
    syncTime: "02:30",
    policy: { source: "export function evaluate() { return { decision: 'allow' }; }", sha256: hash },
    exceptions,
    metrics: {
      enabled: [{ metricId: "policy.decisions", dimensions: ["policy", "decision"] }],
      widgets: []
    }
  });
}

describe("private control", () => {
  it("syncs once after the configured device-local time", () => {
    const before = new Date(2026, 7, 2, 2, 29);
    const after = new Date(2026, 7, 2, 2, 31);
    const yesterday = new Date(2026, 7, 1, 2, 31).toISOString();
    expect(isControlSyncDue(yesterday, "02:30", before)).toBe(false);
    expect(isControlSyncDue(yesterday, "02:30", after)).toBe(true);
    expect(isControlSyncDue(after.toISOString(), "02:30", after)).toBe(false);
  });

  it("accepts only scoped, approved, active exceptions", () => {
    const base = {
      policyId: "restricted-model",
      subjectUserId: "maya",
      teamId: "legal",
      agentId: "reviewer",
      action: "model.invoke",
      resourceType: "model",
      resourceId: "external/demo-model",
      reason: "Acquisition review",
      requestedBy: "maya",
      approvedBy: "ravi"
    };
    const control = document([
      { ...base, id: "valid", status: "approved", expiresAt: "2026-08-03T00:00:00.000Z" },
      { ...base, id: "expired", status: "approved", expiresAt: "2026-08-01T00:00:00.000Z" },
      { ...base, id: "revoked", status: "revoked", expiresAt: "2026-08-03T00:00:00.000Z" },
      { ...base, id: "other-agent", agentId: "writer", status: "approved", expiresAt: "2026-08-03T00:00:00.000Z" }
    ]);
    const input: PolicyInput = {
      now: "2026-08-02T00:00:00.000Z",
      action: "model.invoke",
      subject: { userId: "maya", roles: ["member"], teamIds: ["legal"] },
      resource: { type: "model", id: "external/demo-model", attributes: {} },
      context: { organizationId: "northstar", teamId: "legal", deviceId: "device", agentId: "reviewer" },
      activeExceptionPolicyIds: []
    };
    expect(activeExceptionPolicyIds(control, input)).toEqual(["restricted-model"]);
    expect(activeExceptionPolicyIds(control, {
      ...input,
      resource: { ...input.resource, id: "external/other-model" }
    })).toEqual([]);
  });

  it("rejects unknown metric dimensions", () => {
    expect(() => parseControlDocument({
      ...document(),
      metrics: {
        enabled: [{ metricId: "run.duration", dimensions: ["filename"] }],
        widgets: []
      }
    })).toThrow(/unsupported dimension/i);
  });
});
