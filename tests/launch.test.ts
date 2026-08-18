import { conversationToSnapshotV1 } from "../src/conversation-snapshot.js";
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import type { Agent, Execution, ExecutionOutput, Process, Registry, Schedule, WorkItem } from "../src/domain.js";
import { runtimeAgentName } from "../src/flue-project.js";
import { registryCapabilities } from "../src/registries.js";
import { buildBeesRunInitialData } from "../src/run-config.js";
import { runReceipt } from "../src/run-receipt.js";
import { inboxView, overviewView, runsView, runView, schedulesView } from "../src/launch-views.js";
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

  it("shows only in-context task details and inline approvals", () => {
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
    const failedView = inboxView(failed, [execution], [], [process]);
    expect(failedView).toContain("Onboarding campaign");
    expect(failedView).toContain("Runtime unavailable");
    expect(failedView).toContain('data-action="restart-run" data-id="failed-run">Restart</button>');
    expect(failedView).not.toMatch(/<th[^>]*>Org<|<th[^>]*>Team</);
    expect(inboxView([], [execution], [], [process])).toContain("Nothing waiting on you");
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
      [],
      [process]
    );
    expect(waiting).not.toContain("Nothing waiting on you");
    expect(waiting).toContain("Requirements");
    expect(waiting).toContain('data-action="open-item" data-id="item"');
    expect(waiting).toContain("<th>Action</th>");
    expect(waiting).not.toContain("<th>Approval</th>");
    expect(waiting).toContain('data-action="edit-item" data-id="item">Edit</button>');

    const approvalExecution = {
      ...execution,
      id: "approval-run",
      status: "completed",
      conversationSnapshot: {
        version: 1,
        capturedAt: "2026-01-01T00:00:02.000Z",
        messages: [{
          id: "summary",
          role: "assistant",
          parts: [{ kind: "text", text: "The campaign brief is ready for review." }]
        }]
      }
    } satisfies Execution;
    const output = {
      id: "pending-output",
      executionId: approvalExecution.id,
      logicalOutput: "brief.md",
      logicalDestination: "campaign/brief.md",
      status: "pending",
      reason: null,
      createdAt: "",
      decidedAt: null
    } satisfies ExecutionOutput;
    const approval = inboxView(escalationGroups(new Map([[
      item.id,
      { kind: "waiting", reason: "approval-pending", label: "Waiting for your approval", detail: "1 file to review" }
    ]]), [item]), [approvalExecution], [output], [{ ...process, name: "Goals" }]);
    expect(approval).toContain("Goals");
    expect(approval).toContain("The campaign brief is ready for review.");
    expect(approval).toContain("campaign/brief.md");
    expect(approval).toContain('data-action="preview-inbox-output" data-id="pending-output"');
    expect(approval).toContain('id="inbox-output-preview"');
    expect(approval).toContain("data-inbox-output-preview-approve");
    expect(approval).toContain('data-action="approve-output" data-id="pending-output"');
  });

  it("renders the team assistant without context dropdowns", () => {
    const html = overviewView();

    expect(html).toContain("data-overview-assistant");
    expect(html).not.toContain("Needs your approval");
    expect(html).not.toContain("Recent AI work");
    expect(html).toContain('class="textarea w-full resize-none border-none bg-transparent');
    expect(html).not.toContain("<select");
    expect(html).not.toMatch(/Running|Needs attention|Completed/);
    expect(html).toContain(">Go</button>");
  });

  it("groups completed child work under one primary task", () => {
    const root = {
      id: "root", processId: "process", parentId: null, title: "Primary task",
      isTerminal: true, archivedAt: null, createdAt: "2026-01-01T08:00:00.000Z", updatedAt: "2026-01-01T10:00:00.000Z"
    } as WorkItem;
    const child = {
      ...root, id: "child", parentId: root.id, title: "Added task"
    } as WorkItem;
    const execution = {
      id: "execution", workItemId: child.id, status: "completed",
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:30:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z"
    } as Execution;
    const process = { id: "process", name: "Launch process" } as Process;

    const html = runsView([root, child], [execution], [process]);
    expect(html).toContain("Primary task");
    expect(html).toContain("Launch process");
    expect(html).not.toContain("Added task");
    expect(html.match(/<tbody>[\s\S]*?<tr\b/g)).toHaveLength(1);
    expect(html).toContain('<tr class="cursor-pointer hover" data-action="open-item" data-id="root">');
  });

  it("shows an archived task as a finished run after its executions settle", () => {
    const archivedAt = "2026-01-01T11:00:00.000Z";
    const root = {
      id: "root", processId: "process", parentId: null, title: "Archived task",
      isTerminal: false, archivedAt, createdAt: "2026-01-01T08:00:00.000Z", updatedAt: archivedAt
    } as WorkItem;
    const child = {
      ...root, id: "child", parentId: root.id, title: "Archived subtask"
    } as WorkItem;
    const settled = {
      id: "execution", workItemId: child.id, status: "cancelled",
      startedAt: "2026-01-01T09:00:00.000Z", endedAt: "2026-01-01T09:30:00.000Z",
      createdAt: "2026-01-01T09:00:00.000Z"
    } as Execution;
    const process = { id: "process", name: "Launch process" } as Process;

    const html = runsView([root, child], [settled], [process]);
    expect(html).toContain("Archived task");
    expect(html).toContain("Archived</span>");
    expect(html).toContain(new Date(archivedAt).toLocaleString());
    expect(html).toContain('data-action="open-item" data-id="root"');
    expect(html).not.toContain("Archived subtask");

    expect(runsView([root, child], [{ ...settled, status: "running" }], [process]))
      .toContain("No finished runs");
  });

  it("renders scheduled tasks with process names and cron expressions", () => {
    const item = { id: "task", processId: "process", title: "Send update" } as WorkItem;
    const process = { id: "process", name: "Outreach" } as Process;
    const schedule = {
      id: "schedule", workItemId: item.id, name: "Weekday update", recurrence: "weekdays",
      timezone: "UTC", nextRunAt: "2026-01-01T09:15:00.000Z", enabled: true
    } as Schedule;

    const html = schedulesView([item], [schedule], [process]);
    expect(html).toContain("Task name");
    expect(html).toContain("Send update");
    expect(html).toContain("Outreach");
    expect(html).toContain("15 9 * * 1-5");
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
    expect(html).toContain(">approval-request.md</span>");
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
    expect(html).toContain("read_file");
    expect(html).toContain("Path: launch.md");
    expect(html).toContain("The model stopped early.");
    // A settled run offers the clean restart, never a resume of this conversation.
    expect(html).toContain('data-action="restart-run"');
    expect(html).not.toContain('data-action="download-receipt"');
    expect(html).toContain('data-id="earlier-run"');
  });
});
