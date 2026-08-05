import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as v from "valibot";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const token = process.env.BEES_CAPABILITY_TOKEN ?? "";
const stateDirectory = process.env.BEES_STATE_DIR ?? "";
const maximumBody = 1_048_576;

function isTool(value) {
  return Boolean(value && typeof value.name === "string" && typeof value.run === "function");
}

async function toolsFor(instanceId) {
  if (!/^[a-zA-Z0-9-]+$/.test(instanceId)) throw new Error("Invalid execution identifier");
  const pointer = JSON.parse(
    await readFile(join(stateDirectory, "instances", `${instanceId}.json`), "utf8")
  );
  const tools = [];
  for (const capability of pointer.capabilities ?? []) {
    if (!capability.granted) continue;
    const modified = (await stat(capability.path)).mtimeMs;
    const module = await import(`${pathToFileURL(capability.path).href}?v=${modified}`);
    for (const value of Object.values(module)) {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        if (isTool(candidate) && !tools.some(({ name }) => name === candidate.name)) tools.push(candidate);
      }
    }
  }
  return tools;
}

function send(response, status, body, headers = {}) {
  const content = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, {
    ...(content ? { "content-type": "application/json" } : {}),
    "content-length": Buffer.byteLength(content),
    ...headers
  });
  response.end(content);
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}

async function body(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBody) throw new Error("MCP request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handle(instanceId, request) {
  const message = await body(request);
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return { status: 202 };
  }
  if (message.method === "initialize") {
    return {
      status: 200,
      body: rpc(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Bees local capabilities", version: "1" }
      })
    };
  }
  if (message.method === "ping") return { status: 200, body: rpc(message.id, {}) };
  const tools = await toolsFor(instanceId);
  if (message.method === "tools/list") {
    return {
      status: 200,
      body: rpc(message.id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: { type: "object" }
        }))
      })
    };
  }
  if (message.method === "tools/call") {
    const tool = tools.find(({ name }) => name === message.params?.name);
    if (!tool) throw new Error(`Unknown local tool: ${message.params?.name ?? ""}`);
    const data = tool.input ? v.parse(tool.input, message.params?.arguments ?? {}) : {};
    const result = await tool.run({ data });
    const output = result && typeof result === "object" && "output" in result ? result.output : result;
    const text = typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
    return {
      status: 200,
      body: rpc(message.id, {
        content: [{ type: "text", text }],
        ...(typeof output === "object" && output !== null ? { structuredContent: output } : {})
      })
    };
  }
  return {
    status: 200,
    body: { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported method" } }
  };
}

const server = createServer(async (request, response) => {
  if (request.url === "/" && request.method === "GET") return send(response, 200, { ok: true });
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    return send(response, 401, { error: "unauthorized" });
  }
  const match = new URL(request.url ?? "/", "http://127.0.0.1").pathname.match(
    /^\/capabilities\/([^/]+)\/mcp$/
  );
  if (!match || request.method !== "POST") return send(response, 404, { error: "not found" });
  try {
    const result = await handle(decodeURIComponent(match[1]), request);
    send(response, result.status, result.body, { "mcp-session-id": "bees" });
  } catch (error) {
    send(response, 200, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
    });
  }
});

server.listen(port, "127.0.0.1");

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("disconnect", stop);
