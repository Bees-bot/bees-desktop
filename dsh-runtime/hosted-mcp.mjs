import { createInterface } from "node:readline";

const {
  BEES_FLEET_URL,
  BEES_FLEET_TOOL_TOKEN,
  BEES_FLEET_JOB,
  BEES_FLEET_LEASE,
} = process.env;
async function call(action, body = {}) {
  const r = await fetch(
    `${BEES_FLEET_URL}/api/runner/jobs/${BEES_FLEET_JOB}/${action}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${BEES_FLEET_TOOL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ leaseToken: BEES_FLEET_LEASE, ...body }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const value = await r.json();
  if (!r.ok)
    throw Error(value.error?.message || "Hosted connection unavailable");
  return value;
}
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) continue;
    let result;
    switch (request.method) {
      case "initialize":
        result = {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "bees-hosted", version: "1.0.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = await call("tools");
        break;
      case "tools/call": {
        const value = await call("tool", {
          name: request.params.name,
          arguments: request.params.arguments ?? {},
        });
        result = {
          content: [{ type: "text", text: JSON.stringify(value.result) }],
        };
        break;
      }
      default:
        throw Error("Unknown method");
    }
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  } catch (error) {
    if (request?.id !== undefined)
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [{ type: "text", text: error.message }],
          },
        }),
      );
  }
}
