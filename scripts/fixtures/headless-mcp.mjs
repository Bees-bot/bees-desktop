import { createInterface } from "node:readline";

// A real stdio MCP transport with synthetic data; no credentials or network access.
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: "stage1", version: "1.0.0" } };
  else if (request.method === "tools/list") result = { tools: [{ name: "calendar_summary",
    description: "Read the synthetic sales calendar", inputSchema: { type: "object", properties: {} } }] };
  else if (request.method === "tools/call" && request.params.name === "calendar_summary")
    result = { content: [{ type: "text", text: "STAGE1_CALENDAR: One sales meeting with Acme at 09:00." }] };
  else if (request.method === "ping") result = {};
  else { console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } })); continue; }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}
