/**
 * An OpenAPI document for an API that publishes none, written from a request that already works.
 *
 * The URL, method, query and headers are parsed, never inferred. A model asked to reproduce a path
 * will drop a version segment and leave a tool that answers 404 to everything, which nothing
 * downstream can detect. It is asked only for a name and prose, and the result is proved against
 * the real API before anyone is offered it.
 */

export interface ParsedRequest {
  method: string;
  origin: string;
  path: string;
  query: [string, string][];
  headers: Record<string, string>;
  /** The body exactly as the request sends it, for anything that carries one. */
  body?: string;
}

export function parseCurl(command: string): ParsedRequest {
  const text = command.trim();
  if (!text) throw new Error("Paste a curl command.");
  // `--url https://…` is as common as the bare form, and either may be quoted or not.
  const url = text.match(/--url\s+['"]?(https?:\/\/[^'"\s]+)/)?.[1]
    ?? text.match(/['"](https?:\/\/[^'"]+)['"]/)?.[1]
    ?? text.match(/(https?:\/\/\S+)/)?.[1];
  if (!url) throw new Error("No http address found. Paste a curl command that includes the full URL.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch {
    throw new Error(`"${url}" is not a valid address.`);
  }
  const headers: Record<string, string> = {};
  for (const match of command.matchAll(/-H\s+['"]([^'"]+)['"]/g)) {
    const raw = match[1] ?? "";
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  const method = text.match(/-X\s+([A-Za-z]+)/)?.[1]
    ?? (/(^|\s)(-d|--data|--data-raw|--data-binary|-F|--form)\b/.test(text) ? "POST" : "GET");
  const body = text.match(/(?:-d|--data|--data-raw|--data-binary)\s+['"]([\s\S]*?)['"](?:\s|$)/)?.[1];
  if (/(^|\s)(-F|--form)\b/.test(text)) {
    throw new Error("Form uploads are not supported. Use an OpenAPI document for multipart endpoints.");
  }
  return {
    method: method.toLowerCase(),
    origin: parsed.origin,
    path: parsed.pathname,
    query: [...parsed.searchParams.entries()],
    headers,
    ...(body ? { body } : {})
  };
}

/** The shape of an example, since the request carries no schema of its own. */
function schemaFromExample(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6) return {};
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? schemaFromExample(value[0], depth + 1) : {} };
  }
  if (value === null) return {};
  switch (typeof value) {
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const properties: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        properties[key] = schemaFromExample(inner, depth + 1);
      }
      return { type: "object", properties };
    }
    default:
      return { type: "string" };
  }
}

/** What the endpoint accepts, read from the body the request already sends. */
function requestBodyFor(request: ParsedRequest): Record<string, unknown> | undefined {
  if (!request.body) return undefined;
  const declared = Object.entries(request.headers)
    .find(([name]) => name.toLowerCase() === "content-type")?.[1];
  if (declared?.includes("x-www-form-urlencoded")) {
    const form = [...new URLSearchParams(request.body).entries()];
    return {
      required: true,
      content: {
        "application/x-www-form-urlencoded": {
          schema: {
            type: "object",
            properties: Object.fromEntries(form.map(([k, v]) => [k, schemaFor(v)]))
          }
        }
      }
    };
  }
  try {
    return {
      required: true,
      content: { "application/json": { schema: schemaFromExample(JSON.parse(request.body)) } }
    };
  }
  catch {
    // Not JSON and not a form: describe it as text rather than refuse the endpoint.
    return { required: true, content: { "text/plain": { schema: { type: "string" } } } };
  }
}

/** From the example value, since the request carries no types of its own. */
function schemaFor(value: string): { type: string } {
  if (/^-?\d+$/.test(value)) return { type: "integer" };
  if (/^-?\d*\.\d+$/.test(value)) return { type: "number" };
  if (/^(true|false)$/i.test(value)) return { type: "boolean" };
  return { type: "string" };
}

interface Described {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Record<string, string>;
}

/** Names and prose only. Anything else it returns is ignored, and failure is not fatal. */
async function describe(request: ParsedRequest, modelUrl: string, send: typeof fetch): Promise<Described> {
  const shape = `{"operationId":"camelCaseName","summary":"one short line","description":"one or two sentences","parameters":{${
    request.query.map(([name]) => `"${name}":"what it does"`).join(",")
  }}}`;
  try {
    const response = await send(`${modelUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "active",
        temperature: 0,
        messages: [
          { role: "system", content: "You name and describe API endpoints. Reply with JSON only, no prose, no markdown fence." },
          { role: "user", content: `Endpoint: ${request.method.toUpperCase()} ${request.origin}${request.path}\nQuery parameters: ${request.query.map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n\nReply with exactly this shape:\n${shape}` }
        ]
      })
    });
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = (body.choices?.[0]?.message?.content ?? "")
      .trim().replace(/^```(json)?/, "").replace(/```$/, "").trim();
    return JSON.parse(text) as Described;
  }
  catch {
    return {};
  }
}

function fallbackId(path: string): string {
  const parts = path.split("/").filter(Boolean).slice(-2);
  const id = parts.join("-").replace(/[^A-Za-z0-9-]/g, "");
  return id || "request";
}

/**
 * A tool name has to survive being one. The model returns prose often enough that an unchecked
 * name becomes a tool nothing can call, and the failure appears far from here.
 */
function safeOperationId(candidate: string | undefined, path: string): string {
  const cleaned = (candidate ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return /^[A-Za-z]/.test(cleaned) ? cleaned : fallbackId(path);
}

export function buildSpec(request: ParsedRequest, described: Described): unknown {
  return {
    openapi: "3.0.3",
    info: {
      title: described.summary ?? `${request.origin} endpoint`,
      version: "0.1",
      description: "Written from a working request. The path and parameters come from it, not from a guess."
    },
    servers: [{ url: request.origin }],
    paths: {
      [request.path]: {
        [request.method]: {
          operationId: safeOperationId(described.operationId, request.path),
          summary: described.summary ?? `${request.method.toUpperCase()} ${request.path}`,
          description: described.description ?? "",
          parameters: request.query.map(([name, value]) => ({
            name,
            in: "query",
            description: described.parameters?.[name] ?? "",
            schema: schemaFor(value)
          })),
          ...(requestBodyFor(request) ? { requestBody: requestBodyFor(request) } : {}),
          responses: {
            "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } }
          }
        }
      }
    }
  };
}

export interface GeneratedSpec {
  spec: string;
  baseUrl: string;
  headerName: string | undefined;
  secret: string | undefined;
  operationId: string;
  /** False for a write, which is described from the request rather than repeated. */
  verified: boolean;
}

/**
 * Prove the request before writing a document for it. A spec that describes an endpoint which does
 * not answer is worse than none: it produces a tool that fails every call, and reads as a broken
 * bridge rather than a wrong address.
 */
export async function specFromCurl(
  command: string,
  modelUrl: string,
  /** Answers with the status the endpoint returned, or throws if it could not be reached. */
  probe: (request: ParsedRequest, url: URL) => Promise<number>,
  send: typeof fetch
): Promise<GeneratedSpec> {
  const request = parseCurl(command);
  const url = new URL(request.origin + request.path);
  for (const [name, value] of request.query) url.searchParams.set(name, value);
  // Only a read is repeated. Sending the write again to see whether it works would do the thing it
  // does: create the record, send the message, take the payment. The person pasting it has already
  // run it once, and that is the only safe evidence available.
  if (request.method.toUpperCase() === "GET") {
    let status: number;
    try {
      status = await probe(request, url);
    }
    catch (error) {
      // Reaching nothing at all reads as "load failed", which says neither what was called nor why.
      throw new Error(
        `Could not reach ${url.host}. Check the address is right and this machine can reach it. (${
          error instanceof Error ? error.message : String(error)})`
      );
    }
    if (status < 200 || status >= 300) {
      throw new Error(`${url.host} answered ${status}. Run the curl yourself until it works, then paste it.`);
    }
  }
  const described = await describe(request, modelUrl, send);
  const spec = buildSpec(request, described);
  const document = JSON.stringify(spec);
  // The document travels in an environment variable. A runaway one would fail at spawn, far from
  // the paste that caused it.
  if (document.length > 512_000) {
    throw new Error("That request describes far more than one endpoint. Use an OpenAPI document instead.");
  }
  // Whichever header carried the credential is the one the bridge has to send.
  const [headerName, secret] = Object.entries(request.headers).find(
    ([name]) => /^(authorization|x-api-key)$/i.test(name) || /token|key|oauth/i.test(name)
  ) ?? [];
  const operation = (spec as { paths: Record<string, Record<string, { operationId: string }>> })
    .paths[request.path]?.[request.method];
  return {
    spec: document,
    baseUrl: request.origin,
    headerName,
    secret,
    operationId: operation?.operationId ?? fallbackId(request.path),
    verified: request.method.toUpperCase() === "GET"
  };
}
