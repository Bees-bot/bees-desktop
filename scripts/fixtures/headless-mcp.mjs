import { createInterface } from "node:readline";
import assert from "node:assert/strict";

assert.equal(process.env.BEES_PROOF_SECRET, 'synthetic-mcp-credential');

// A real stdio MCP transport with synthetic data; no credentials or network access.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: "stage1", version: "1.0.0" } };
  else if (request.method === "tools/list") result = { tools: [{ name: "read_calendar_summary",
    description: "Read the synthetic sales calendar", inputSchema: { type: "object", properties: {} } },
    { name: "add_calendar_event", description: "Simulate adding an event; never contacts a real calendar",
      inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }] };
  else if (request.method === "tools/call" && request.params.name === "read_calendar_summary")
    result = { content: [{ type: "text", text: "STAGE1_CALENDAR: One sales meeting with Acme at 09:00." }] };
  else if (request.method === "tools/call" && request.params.name === "add_calendar_event")
    result = { content: [{ type: "text", text: "STAGE1_CALENDAR_UPDATED: Synthetic event accepted." }] };
  else if (request.method === "ping") result = {};
  else { console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } })); continue; }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}
