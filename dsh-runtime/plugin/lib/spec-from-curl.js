/** An OpenAPI document written from one request that already works. Nothing here is guessed:
 *  a wrong path leaves a tool that 404s on everything and nobody downstream can tell. */

function parseCurl(command) {
  // A pasted markdown link would otherwise land whole in the query string, and the path survives
  // that, so the damage is silent. The label can hold brackets, so match to the first `](http`.
  const text = String(command ?? "").trim()
    .replace(/\[[\s\S]*?\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  if (!text) throw new Error("Paste a curl command.");
  const url = text.match(/--url\s+['"]?(https?:\/\/[^'"\s]+)/)?.[1]
    ?? text.match(/['"](https?:\/\/[^'"]+)['"]/)?.[1]
    ?? text.match(/(https?:\/\/\S+)/)?.[1];
  if (!url) throw new Error("No http address found. Paste a curl command that includes the full URL.");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`"${url}" is not a valid address.`); }
  // A second address inside the first means a mangled paste; refuse rather than guess.
  if (/https?:\/\//.test(parsed.search) || /https?:\/\//.test(parsed.pathname))
    throw new Error("That address has another URL inside it. Paste the plain request URL, without any surrounding link markup.");
  if (/(^|\s)(-F|--form)\b/.test(text))
    throw new Error("Form uploads are not supported. Use an OpenAPI document for multipart endpoints.");

  const headers = {};
  for (const match of text.matchAll(/(?:-H|--header)\s*(['"])(.+?)\1/g)) {
    const raw = match[2] ?? "";
    const at = raw.indexOf(":");
    if (at > 0) headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
  }
  const method = text.match(/-X\s+([A-Za-z]+)/)?.[1]
    ?? (/(^|\s)(-d|--data|--data-raw|--data-binary)\b/.test(text) ? "POST" : "GET");
  const body = text.match(/(?:-d|--data|--data-raw|--data-binary)\s+['"]([\s\S]*?)['"](?:\s|$)/)?.[1];
  // /projects/{project_id}/ is a placeholder the bridge fills in per call; URL parsing had encoded it
  const path = parsed.pathname.replace(/%7B([\w.-]+)%7D/gi, "{$1}");
  return {
    method: method.toLowerCase(),
    origin: parsed.origin,
    path,
    pathParams: [...path.matchAll(/\{([\w.-]+)\}/g)].map(([, name]) => name),
    // a[]=x&a[]=y is one list parameter, and a spec that names it twice is refused
    query: [...parsed.searchParams.keys()].filter((name, at, names) => names.indexOf(name) === at)
      .map((name) => [name, parsed.searchParams.getAll(name)]),
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

/** A curl copied off a docs page arrives with its inner quotes escaped, which is not JSON until undone. */
function parseBody(text) {
  for (const candidate of [text, text.replace(/\\"/g, '"')]) {
    try { return JSON.parse(candidate); } catch { /* try the unescaped form */ }
  }
  return undefined;
}

/** What the endpoint accepts, read from the body the request already sends.
 *  The pasted Content-Type wins over guessing: a body this cannot read is still JSON when the
 *  request says so, and calling it text/plain makes a server that routes on content type refuse it. */
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
  const body = parseBody(request.body);
  if (body !== undefined)
    return { required: true, content: { "application/json": { schema: schemaFromExample(body) } } };
  // Unreadable, so the field list is lost either way. Name the type, keep the endpoint usable.
  const json = declared ? declared.includes("json") : /^\s*[{[]/.test(request.body);
  return { required: true, content: json
    ? { "application/json": { schema: { type: "object" } } }
    : { "text/plain": { schema: { type: "string" } } } };
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

/** A tool name that sends or changes something outside: it holds a word like send or create and does not start with a read. */
export function sendsOut(name) {
  const words = String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return !["get", "list", "search", "read", "fetch", "find", "describe", "show", "count", "view", "lookup", "query"].includes(words[0])
    && words.some((word) => ["send", "post", "put", "patch", "submit", "delete", "remove", "trash", "place", "publish", "reply", "forward", "pay",
      "buy", "purchase", "order", "bid", "transfer", "create", "update", "upload", "share", "invite", "push", "merge", "comment", "book", "cancel",
      "write", "edit", "add", "insert", "apply", "approve", "archive", "move", "modify", "respond", "accept", "decline"].includes(word));
}

export function specFromCurl(command) {
  const request = parseCurl(command);
  const host = new URL(request.origin).hostname.replace(/^www\./, "");
  const body = requestBodyFor(request);
  const shown = request.path.replace(/[^/]+/g, (segment) => (/^(?=.*[a-z])(?=.*\d)[\w.%-]{16,}$/i.test(segment) ? "***" : segment));
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
          operationId: operationId(request.method, shown),
          summary: `${request.method.toUpperCase()} ${shown}`,
          description: `Taken from a working request. Only this endpoint is described.`,
          // No example: a key pasted in the query string would otherwise land in the spec file.
          parameters: [
            ...request.pathParams.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
            ...request.query.map(([name, values]) => ({ name, in: "query", required: false,
              schema: values.length > 1 || name.endsWith("[]") ? { type: "array", items: schemaFor(values[0]) } : schemaFor(values[0]) }))
          ],
          ...(body ? { requestBody: body } : {}),
          responses: { 200: { description: "Success", content: { "application/json": { schema: { type: "object" } } } } }
        }
      }
    }
  };
  return { spec: JSON.stringify(spec, null, 2), request, host };
}
