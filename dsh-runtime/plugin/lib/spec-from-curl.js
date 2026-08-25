/**
 * An OpenAPI document for an API that publishes none, written from a request that already works.
 *
 * The URL, method, query, headers and body are parsed, never inferred: a guessed path leaves a tool
 * that answers 404 to everything, and nothing downstream can tell the difference. Names are derived
 * from the method and path rather than invented, so the same curl always yields the same document.
 */

function parseCurl(command) {
  const text = String(command ?? "").trim();
  if (!text) throw new Error("Paste a curl command.");
  const url = text.match(/--url\s+['"]?(https?:\/\/[^'"\s]+)/)?.[1]
    ?? text.match(/['"](https?:\/\/[^'"]+)['"]/)?.[1]
    ?? text.match(/(https?:\/\/\S+)/)?.[1];
  if (!url) throw new Error("No http address found. Paste a curl command that includes the full URL.");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`"${url}" is not a valid address.`); }
  if (/(^|\s)(-F|--form)\b/.test(text))
    throw new Error("Form uploads are not supported. Use an OpenAPI document for multipart endpoints.");

  const headers = {};
  for (const match of text.matchAll(/-H\s+['"]([^'"]+)['"]/g)) {
    const raw = match[1] ?? "";
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  const method = text.match(/-X\s+([A-Za-z]+)/)?.[1]
    ?? (/(^|\s)(-d|--data|--data-raw|--data-binary)\b/.test(text) ? "POST" : "GET");
  const body = text.match(/(?:-d|--data|--data-raw|--data-binary)\s+['"]([\s\S]*?)['"](?:\s|$)/)?.[1];
  return {
    method: method.toLowerCase(),
    origin: parsed.origin,
    path: parsed.pathname,
    query: [...parsed.searchParams.entries()],
    headers,
    ...(body ? { body } : {})
  };
}

/** From the example value, since the request carries no types of its own. */
function schemaFor(value) {
  if (/^-?\d+$/.test(value)) return { type: "integer" };
  if (/^-?\d*\.\d+$/.test(value)) return { type: "number" };
  if (/^(true|false)$/i.test(value)) return { type: "boolean" };
  return { type: "string" };
}

function schemaFromExample(value, depth = 0) {
  if (depth > 6) return {};
  if (Array.isArray(value)) return { type: "array", items: value.length ? schemaFromExample(value[0], depth + 1) : {} };
  if (value === null) return {};
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "object") {
    const properties = {};
    for (const [key, inner] of Object.entries(value)) properties[key] = schemaFromExample(inner, depth + 1);
    return { type: "object", properties };
  }
  return { type: "string" };
}

/** What the endpoint accepts, read from the body the request already sends. */
function requestBodyFor(request) {
  if (!request.body) return undefined;
  const declared = Object.entries(request.headers)
    .find(([name]) => name.toLowerCase() === "content-type")?.[1];
  if (declared?.includes("x-www-form-urlencoded")) {
    const form = [...new URLSearchParams(request.body).entries()];
    return {
      required: true,
      content: { "application/x-www-form-urlencoded": { schema: {
        type: "object", properties: Object.fromEntries(form.map(([key, value]) => [key, schemaFor(value)]))
      } } }
    };
  }
  try {
    return { required: true, content: { "application/json": { schema: schemaFromExample(JSON.parse(request.body)) } } };
  } catch {
    // Not JSON and not a form: describe it as text rather than refuse the endpoint.
    return { required: true, content: { "text/plain": { schema: { type: "string" } } } };
  }
}

function operationId(method, path) {
  const parts = path.split("/").filter(Boolean)
    .map((part) => part.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .map((part, index) => part.split(/\s+/).map((word, inner) =>
      index === 0 && inner === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join(""));
  const name = `${method}${parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("")}`;
  return name.replace(/[^A-Za-z0-9]/g, "") || `${method}Resource`;
}

export function specFromCurl(command) {
  const request = parseCurl(command);
  const host = new URL(request.origin).hostname.replace(/^www\./, "");
  const body = requestBodyFor(request);
  const spec = {
    openapi: "3.0.3",
    info: {
      title: `${host} API`,
      version: "0.1",
      description: `Written from one working request to ${request.origin}.`
    },
    servers: [{ url: request.origin }],
    paths: {
      [request.path]: {
        [request.method]: {
          operationId: operationId(request.method, request.path),
          summary: `${request.method.toUpperCase()} ${request.path}`,
          description: `Taken from a working request. Only this endpoint is described.`,
          parameters: request.query.map(([name, value]) => ({
            name, in: "query", required: false, example: value, schema: schemaFor(value)
          })),
          ...(body ? { requestBody: body } : {}),
          responses: { 200: { description: "Success", content: { "application/json": { schema: { type: "object" } } } } }
        }
      }
    }
  };
  return { spec: JSON.stringify(spec, null, 2), request, host };
}
