import { conversationToSnapshotV1 } from "../src/conversation-snapshot.js";
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import type { Agent, Execution, ExecutionOutput, Process, Registry, WorkItem } from "../src/domain.js";
import { runtimeAgentName } from "../src/flue-project.js";
import { registryCapabilities } from "../src/registries.js";
import { buildBeesRunInitialData } from "../src/run-config.js";
import { runReceipt } from "../src/run-receipt.js";
import { inboxView, overviewView, runView } from "../src/launch-views.js";
import { escalationGroups } from "../src/supervision.js";
import { renderMarkdown } from "../src/markdown.js";
import type { RuntimeEvent } from "../src/runtime.js";
import { beesRunInitialDataSchema } from "../flue-runtime/project/.flue/agents/bees-run.js";

describe("lean launch modules", () => {
  it("freezes an editable Bee into one stable Flue agent instance", () => {
    const agent = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Reviewer",
      purpose: "Review things",
      description: "",
      triggerStageId: null,
      config: { prompt: "Review.", provider: "anthropic", model: "test", thinkingLevel: "max" },
      updatedAt: "2026-01-01"
    } satisfies Agent;
    const data = buildBeesRunInitialData({
      executionId: "run-1",
      teamId: "team-1",
      agent,
      capabilities: [],
      skillSnapshots: [],
      mcpConnections: [],
      delegates: []
    });
    expect(runtimeAgentName(agent.id)).toBe("bees-run");
    expect(data).toMatchObject({
      version: 1,
      executionId: "run-1",
      agentId: agent.id,
      model: "anthropic/test",
      thinkingLevel: "max",
      browser: true,
      browserWrite: false
    });
    expect(JSON.stringify(data)).not.toContain("runtimeAgentName");
    expect(v.safeParse(beesRunInitialDataSchema, data).success).toBe(true);
    expect(v.safeParse(beesRunInitialDataSchema, { ...data, credential: "must-not-pass" }).success).toBe(false);
  });

  it("discovers only validated skills from an Agent Plugin", () => {
    const registry = {
      id: "registry",
      teamId: "team",
      name: "Local",
      sourcePath: "/registry",
      plugin: {
        manifest: {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          name: "local"
        },
        skills: [{
          path: "skills/writer/SKILL.md",
          name: "writer",
          description: "Writes",
          instructions: "Write."
        }],
        mcpServers: [],
        issues: [],
        fileCount: 2
      },
      copiedAt: "",
      createdAt: "",
      updatedAt: ""
    } satisfies Registry;
    expect(registryCapabilities([registry]).map(({ kind, name }) => [kind, name])).toEqual([["skill", "writer"]]);
  });

  it("exports a content-free receipt", () => {
    const execution = {
      id: "run",
      agentId: "agent",
      config: { prompt: "SECRET PROMPT" },
      workItemId: "item",
      runtime: "flue",
      status: "completed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: null,
      restartedFromExecutionId: null,
      submissionId: null,
      workspaceRef: null,
      result: null,
      usage: null,
      model: { provider: "anthropic", id: "claude" },
      logs: "SECRET DOCUMENT TEXT",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;
    const item = {
      id: "item",
      processId: "process",
      stageId: "stage",
      parentId: null,
      title: "Review",
      description: "SECRET DESCRIPTION",
      owner: null,
      goal: null,
      isTerminal: false,
      waits: [],
      logicalFiles: [],
      syncVersion: 0,
      checkpointStageId: null,
      checkpointAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: "",
      updatedAt: ""
    } satisfies WorkItem;
    const agent = {
      id: "agent",
      name: "Reviewer",
      purpose: "Review things",
      description: "",
      triggerStageId: null,
      config: { prompt: "SECRET PROMPT" },
      updatedAt: ""
    } satisfies Agent;
    const output = {
      id: "output",
      executionId: "run",
      logicalOutput: "result.md",
      logicalDestination: "approved/result.md",
      status: "approved",
      reason: null,
      createdAt: "",
      decidedAt: ""
    } satisfies ExecutionOutput;
    const receipt = runReceipt(execution, item, agent, [output]);
    expect(receipt).toContain("approved/result.md");
    expect(receipt).not.toContain("SECRET");
  });

  it("dismisses a failed run from attention views without removing its history", () => {
    const execution = {
      id: "failed-run",
      agentId: "agent",
      config: { prompt: "Help" },
      workItemId: "item",
      runtime: "flue",
      status: "failed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: null,
      restartedFromExecutionId: null,
      submissionId: null,
      workspaceRef: null,
      result: null,
      usage: null,
      model: null,
      logs: "",
      error: "Runtime unavailable",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;
    const item = {
      id: "item",
      processId: "process",
      stageId: "stage",
      parentId: null,
      title: "Onboarding campaign",
      description: "",
      owner: null,
      goal: null,
      isTerminal: false,
      waits: [],
      logicalFiles: [],
      syncVersion: 0,
      checkpointStageId: null,
      checkpointAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: "",
      updatedAt: ""
    } satisfies WorkItem;
    const process = {
      id: "process",
      teamId: "team",
      name: "Onboarding",
      description: "",
      archivedAt: null,
      createdAt: "",
      updatedAt: "",
      stages: [],
      definition: { moduleId: null, version: 1, automation: "interactive", renderer: "", stateIds: {}, capabilities: [], roleBindings: [] },
      tags: []
    } satisfies Process;

    const failed = escalationGroups(
      new Map([
        [
          item.id,
          { kind: "stalled", reason: "run-failed", label: "A run failed", detail: "Runtime unavailable" }
        ]
      ]),
      [item]
    );
    expect(inboxView(failed, [execution], [process], "Acme", "Growth", new Set())).toContain('data-action="dismiss-run"');
    // A dismissed failure is one a person has answered for: the sweep stops reporting it, so
    // the inbox has nothing to render rather than filtering runs itself.
    expect(inboxView([], [execution], [process], "Acme", "Growth", new Set())).toContain("Inbox clear");
    // A step only a person can start belongs here too — it produces no run at all, so a
    // run-shaped inbox never mentioned it and the work looked like nothing was wrong.
    const waiting = inboxView(
      escalationGroups(
        new Map([
          [
            item.id,
            { kind: "waiting", reason: "human-step", label: "Waiting on you", detail: "Requirements" }
          ]
        ]),
        [item]
      ),
      [execution],
      [process],
      "Acme",
      "Growth",
      new Set()
    );
    expect(waiting).not.toContain("Inbox clear");
    expect(waiting).toContain("Waiting on you");
    expect(waiting).toContain('data-action="open-item" data-id="item"');
  });

  it("renders the team assistant without context dropdowns", () => {
    const html = overviewView([], []);

    expect(html.indexOf("data-overview-assistant")).toBeLessThan(html.indexOf("Recent runs"));
    expect(html).toContain('class="textarea textarea-bordered min-h-28 w-full resize-y"');
    expect(html).not.toContain("<select");
    expect(html).not.toMatch(/Running|Needs attention|Completed/);
    expect(html).toContain(">Go</button>");
  });

  it("renders a run as a readable conversation with a follow-up box", () => {
    const execution = {
      id: "run",
      agentId: "agent",
      config: { prompt: "Help" },
      workItemId: "item",
      runtime: "flue",
      status: "completed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: null,
      restartedFromExecutionId: null,
      submissionId: null,
      workspaceRef: null,
      result: null,
      usage: null,
      model: null,
      logs: "",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;
    const events = [
      {
        type: "history",
        timestamp: "2026-01-01T00:00:00.000Z",
        offset: "1",
        data: {
          messages: [
            {
              id: "user",
              role: "user",
              parts: [{ type: "text", text: "Please draft the launch note.", state: "done" }]
            }
          ]
        }
      },
      {
        type: "updates",
        timestamp: "2026-01-01T00:00:01.000Z",
        offset: "2",
        data: [
          { type: "message-started", conversationId: "chat", messageId: "assistant" },
          {
            type: "message-delta",
            conversationId: "chat",
            messageId: "assistant",
            kind: "text",
            delta: "Here is a friendlier draft."
          },
          {
            type: "tool-input",
            conversationId: "chat",
            messageId: "assistant",
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "launch.md" }
          },
          {
            type: "tool-output",
            conversationId: "chat",
            toolCallId: "tool-1",
            output: { lines: 12 }
          }
        ]
      }
    ] satisfies RuntimeEvent[];
    const html = runView({
      execution,
      item: null,
      outputs: [],
      snapshot: conversationToSnapshotV1(events),
      previews: new Map()
    });
    expect(html).toContain("Please draft the launch note.");
    expect(html).toContain("Here is a friendlier draft.");
    expect(html).toContain("Path: launch.md");
    expect(html).not.toContain('&quot;path&quot;');
    expect(html).toContain('data-run-followup="run"');
  });

  it("renders Markdown approvals in chat and leaves decisions out of the Files panel", () => {
    const execution = {
      id: "run",
      agentId: "agent",
      config: { prompt: "Help" },
      workItemId: "item",
      runtime: "flue",
      status: "completed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: null,
      restartedFromExecutionId: null,
      submissionId: null,
      workspaceRef: "/workspace/run",
      result: null,
      usage: null,
      model: null,
      logs: "",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;
    const output = {
      id: "output",
      executionId: "run",
      logicalOutput: "approval-request.md",
      logicalDestination: "approval-request.md",
      status: "pending",
      reason: null,
      createdAt: "",
      decidedAt: null
    } satisfies ExecutionOutput;

    const html = runView({
      execution,
      item: null,
      outputs: [output],
      snapshot: null,
      previews: new Map()
    });
    expect(html).toContain("Approval required");
    expect(html).toContain('data-action="view-markdown-output"');
    expect(html).toContain("&gt;</span><span>approval-request.md");
    expect(html.match(/data-action="approve-output"/g)).toHaveLength(1);
    expect(html.match(/data-action="reject-output"/g)).toHaveLength(1);
  });

  it("renders approval Markdown without trusting embedded HTML", () => {
    const html = renderMarkdown("# Decision\n\n- Approve **A**\n- Reject `B`\n\n<script>alert(1)</script>");
    expect(html).toContain("<h1>Decision</h1>");
    expect(html).toContain("<ul><li>Approve <strong>A</strong></li><li>Reject <code>B</code></li></ul>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders a settled run from its stored snapshot, with no runtime events", () => {
    const execution = {
      id: "run",
      agentId: "agent",
      config: { prompt: "Help" },
      workItemId: "item",
      runtime: "flue",
      status: "completed",
      conversationId: "run",
      instanceUid: null,
      conversationSnapshot: {
        version: 1,
        capturedAt: "2026-01-01T00:00:02.000Z",
        messages: [
          { id: "u1", role: "user", parts: [{ kind: "text", text: "Draft the launch note." }] },
          {
            id: "a1",
            role: "assistant",
            parts: [
              { kind: "tool", name: "read_file", state: "output-available", input: { path: "launch.md" } },
              { kind: "text", text: "Here is a friendlier draft." },
              { kind: "error", text: "The model stopped early." }
            ]
          }
        ]
      },
      restartedFromExecutionId: "earlier-run",
      submissionId: null,
      workspaceRef: null,
      result: null,
      usage: null,
      model: null,
      logs: "",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      createdAt: "2026-01-01T00:00:00.000Z"
    } satisfies Execution;

    const html = runView({
      execution,
      item: null,
      outputs: [],
      snapshot: execution.conversationSnapshot,
      previews: new Map()
    });

    expect(html).toContain("Draft the launch note.");
    expect(html).toContain("Here is a friendlier draft.");
    expect(html).toContain("Used tool");
    expect(html).toContain("Path: launch.md");
    expect(html).toContain("The model stopped early.");
    // A settled run offers the clean restart, never a resume of this conversation.
    expect(html).toContain('data-action="restart-run"');
    expect(html).toContain('data-id="earlier-run"');
  });
});
