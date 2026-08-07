"use agent";

import {
  useAgentStart,
  useDataWriter,
  useInitialData,
  useMcpConnection,
  useModel,
  useResponseFinish,
  useResponseStart,
  useSandbox,
  useSkill,
  useSubagent,
  useTool
} from "@flue/runtime";
import type { AgentFunction, AgentProps, SkillDefinition, ThinkingLevel } from "@flue/runtime";
import * as v from "valibot";
import { browserTools } from "../browser.ts";
import { connectionSecret } from "../credentials.ts";
import { compactionFor, declareModel } from "../models.ts";
import { beesWorkspace } from "../sandboxes/bees-workspace.ts";

const text = v.pipe(v.string(), v.minLength(1), v.maxLength(1_000_000));
const fileSchema = v.strictObject({
  encoding: v.picklist(["utf8", "base64"]),
  content: v.string()
});
const skillFilesSchema = v.pipe(
  v.record(v.string(), fileSchema),
  v.check(
    (files) =>
      Object.keys(files).length <= 100 &&
      Object.values(files).reduce((size, file) => size + file.content.length, 0) <= 5_000_000,
    "A skill may contain at most 100 supporting files and 5 MB of content"
  )
);
const skillSchema = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  instructions: text,
  files: skillFilesSchema
});
const thinkingSchema = v.picklist(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const delegateSchema = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  description: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  instructions: text,
  model: v.optional(v.string()),
  thinkingLevel: v.optional(thinkingSchema),
  browser: v.boolean(),
  browserWrite: v.boolean(),
  skills: v.pipe(v.array(skillSchema), v.maxLength(32))
});
const mcpSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  url: v.pipe(v.string(), v.url()),
  transport: v.picklist(["streamable-http", "sse"]),
  secretRef: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  tools: v.pipe(v.array(v.string()), v.maxLength(256)),
  optional: v.boolean()
});

export const beesRunInitialDataSchema = v.strictObject({
  version: v.literal(1),
  executionId: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  agentId: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  agentName: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
  purpose: v.pipe(v.string(), v.maxLength(1_000)),
  model: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  thinkingLevel: v.optional(thinkingSchema),
  instructions: text,
  teamId: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  browser: v.boolean(),
  browserWrite: v.boolean(),
  localTools: v.boolean(),
  skills: v.pipe(v.array(skillSchema), v.maxLength(32)),
  mcpConnections: v.pipe(v.array(mcpSchema), v.maxLength(32)),
  delegates: v.pipe(v.array(delegateSchema), v.maxLength(16)),
  grants: v.pipe(v.array(v.string()), v.maxLength(256))
});

type RunData = v.InferOutput<typeof beesRunInitialDataSchema>;

function skill(value: RunData["skills"][number]): SkillDefinition {
  return {
    name: value.name,
    description: value.description,
    instructions: value.instructions,
    files: Object.fromEntries(
      Object.entries(value.files).map(([path, file]) => [
        path,
        file.encoding === "base64" ? new Uint8Array(Buffer.from(file.content, "base64")) : file.content
      ])
    )
  };
}

function delegate(value: RunData["delegates"][number], instanceId: string): AgentFunction {
  return () => {
    for (const entry of value.skills) useSkill(skill(entry));
    if (value.browser) {
      for (const tool of browserTools(instanceId, value.browserWrite)) useTool(tool);
    }
    return value.instructions;
  };
}

function mcpName(name: string, id: string): string {
  return `${name}-${id.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export function BeesRun({ id }: AgentProps): string {
  const data = useInitialData<RunData>();
  const compaction = compactionFor(data.model);
  useModel(declareModel(data.model), {
    ...(data.thinkingLevel ? { thinkingLevel: data.thinkingLevel as ThinkingLevel } : {}),
    ...(compaction ? { compaction } : {})
  });
  useSandbox(beesWorkspace, { cwd: "/workspace" });

  const writeProgress = useDataWriter("beesProgress", {
    schema: v.strictObject({
      executionId: v.string(),
      state: v.picklist(["working", "settled"]),
      toolCalls: v.optional(v.number())
    })
  });
  useAgentStart(() => writeProgress({ executionId: data.executionId, state: "working" }));
  useResponseStart(() => ({
    bees: { executionId: data.executionId, agentId: data.agentId, agentName: data.agentName }
  }));
  useResponseFinish(({ response }) => {
    writeProgress({ executionId: data.executionId, state: "settled", toolCalls: response.toolCalls.length });
    return {
      bees: {
        executionId: data.executionId,
        agentId: data.agentId,
        toolCalls: response.toolCalls.length,
        remoteConnections: data.mcpConnections.map(({ id: connectionId }) => connectionId)
      }
    };
  });

  for (const entry of data.skills) useSkill(skill(entry));
  if (data.browser) {
    for (const tool of browserTools(id, data.browserWrite)) useTool(tool);
  }
  if (data.localTools) {
    useMcpConnection({
      name: "bees-local-capabilities",
      url: `${process.env.BEES_CAPABILITY_HOST_URL}/capabilities/${encodeURIComponent(id)}/mcp`,
      auth: process.env.BEES_CAPABILITY_TOKEN ?? ""
    });
  }
  for (const connection of data.mcpConnections) {
    if (!connection.tools.length) continue;
    useMcpConnection({
      name: mcpName(connection.name, connection.id),
      url: connection.url,
      transport: connection.transport,
      auth: () => connectionSecret(connection.secretRef, {
        teamId: data.teamId,
        connectionId: connection.id,
        executionId: data.executionId
      }),
      tools: connection.tools,
      optional: connection.optional
    });
  }
  for (const helper of data.delegates) {
    useSubagent({
      name: helper.name,
      description: helper.description,
      agent: delegate(helper, id),
      ...(helper.model ? { model: helper.model } : {}),
      ...(helper.thinkingLevel ? { thinkingLevel: helper.thinkingLevel as ThinkingLevel } : {})
    });
  }
  return data.instructions;
}

BeesRun.agentName = "bees-run";
BeesRun.initialData = beesRunInitialDataSchema;
