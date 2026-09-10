#!/usr/bin/env node
// Read-only: provider-reported usage and structural metadata, never prompt/tool content.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(`Usage: node scripts/inspect-token-usage.mjs SESSION_DIRECTORY [SESSION_DIRECTORY ...]
Recursively reads session.jsonl and session.jsonl.zstd; compressed logs require zstd on PATH.
Outputs JSON grouped by Bees workspace run, otherwise by session ID. No model calls or writes.
Counts reported usage, including failed attempts when usage exists. Missing usage is not estimated.
Recovery copies are deduplicated by provider response ID, falling back to hashed message identity.
Per-session totals include copied history; group totals deduplicate it. Header sizes are peak characters.
No prompts, results, model output, or credentials are printed.`);
  process.exit(args.length ? 0 : 1);
}

const files = new Set();
function visit(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true }))
      if (!entry.isSymbolicLink()) visit(join(path, entry.name));
  } else if (/[/\\]session\.jsonl(?:\.zstd)?$/.test(path)) files.add(path);
}
const identity = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const messageIdentity = (event) => {
  const source = event.data.message.source ?? {};
  const responseId = source.replayState?.response?.responseId;
  return responseId ? `${source.provider}/${source.model}/${responseId}`
    : identity([event.time, event.data.turn, event.data.step, event.data.message]);
};
const groups = new Map();

function summarize(attempts) {
  const result = { reportedTokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0,
    cacheWriteTokens: 0, outputTokens: 0, successfulModelCalls: 0, callsWithoutUsage: 0,
    failedAttemptsWithUsage: 0, toolCalls: {} };
  for (const attempt of attempts) {
    if (attempt.success) result.successfulModelCalls++;
    if (!attempt.usage) { if (attempt.success) result.callsWithoutUsage++; }
    else {
      const u = attempt.usage;
      result.uncachedInputTokens += u.inputTokens ?? 0;
      result.cachedInputTokens += u.cacheReadTokens ?? 0;
      result.cacheWriteTokens += u.cacheWriteTokens ?? 0;
      result.outputTokens += u.outputTokens ?? 0;
      if (!attempt.success) result.failedAttemptsWithUsage++;
    }
    for (const name of attempt.tools ?? []) result.toolCalls[name] = (result.toolCalls[name] ?? 0) + 1;
  }
  result.reportedTokens = result.uncachedInputTokens + result.cachedInputTokens
    + result.cacheWriteTokens + result.outputTokens;
  result.toolCalls = Object.fromEntries(Object.entries(result.toolCalls).sort((a, b) => b[1] - a[1]));
  return result;
}

function inspect(file) {
  // zstdDecompressSync only reads the first frame; DSH appends many frames per file.
  const text = file.endsWith(".zstd")
    ? execFileSync("zstd", ["-d", "-c", file], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString()
    : readFileSync(file, "utf8");
  const events = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const session = events.find((event) => event.type === "session");
  if (!session?.id) throw new Error("Missing session identity");
  const groupId = session.cwd?.match(/(?:^|[/\\])runs[/\\]([^/\\]+)/)?.[1].replace(/-stage-.*/, "") ?? session.id;
  const attempts = [];
  let current;
  const flush = () => {
    if (current?.usage || current?.success) attempts.push(current);
    current = undefined;
  };
  const headers = { systemCharacters: 0, toolSchemaCharacters: 0, toolCount: 0 };
  for (const event of events) {
    const data = event.data ?? {};
    if (["step/start", "llm/retry-started", "step/end", "turn/end"].includes(event.type)) flush();
    if (event.type === "request/header") {
      const h = data.header ?? {};
      headers.systemCharacters = Math.max(headers.systemCharacters, h.system?.length ?? 0);
      headers.toolSchemaCharacters = Math.max(headers.toolSchemaCharacters, JSON.stringify(h.tools ?? []).length);
      headers.toolCount = Math.max(headers.toolCount, h.tools?.length ?? 0);
    }
    const usage = event.type === "assistant/chunk" && data.chunk?.type === "usage"
      ? data.chunk.usage : event.type === "assistant/message" ? data.usage : undefined;
    if (usage) {
      current ??= {};
      current.usage = usage;
      current.key = identity([event.time, data.turn, data.step, usage]);
    }
    if (event.type === "assistant/message") {
      current ??= {};
      current.key = messageIdentity(event);
      current.success = true;
      current.tools = (data.message.content ?? []).filter((block) => block.type === "tool-call").map((block) => block.name);
    }
  }
  flush();
  const group = groups.get(groupId) ?? { id: groupId, attempts: new Map(), sessions: [] };
  for (const attempt of attempts) group.attempts.set(attempt.key, attempt);
  group.sessions.push({ id: session.id, ...summarize(attempts), peakHeader: headers });
  groups.set(groupId, group);
}

try {
  for (const path of args) visit(resolve(path));
  if (!files.size) throw new Error("No session logs found");
  for (const file of files) {
    try { inspect(file); }
    catch { throw new Error(`Cannot inspect ${file}; check log integrity and that zstd is installed`); }
  }
  const report = [...groups.values()].map((group) => ({ id: group.id, sessionCount: group.sessions.length,
    ...summarize(group.attempts.values()), sessions: group.sessions.sort((a, b) => b.reportedTokens - a.reportedTokens) }))
    .sort((a, b) => b.reportedTokens - a.reportedTokens);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
