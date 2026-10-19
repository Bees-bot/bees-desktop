import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sendsOut } from "./spec-from-curl.js";

/** Every operation in an OpenAPI document becomes a call to the API. Ours, because the bridge we used
 *  joined a list into "3,17", which an API reading jobs[]=3&jobs[]=17 silently ignores. */
const flag = (name) => { const at = process.argv.indexOf(name); return at < 0 ? "" : process.argv[at + 1] ?? ""; };
const base = flag("--api-base-url").replace(/\/+$/, "");
const source = flag("--openapi-spec");
if (!base || !source) {
  console.error("The API bridge needs --api-base-url and --openapi-spec");
  process.exit(1);
}
const text = /^https?:/.test(source)
  ? await fetch(source, { signal: AbortSignal.timeout(30_000) }).then((response) => response.text())
  : await readFile(source, "utf8");
let spec;
try { spec = JSON.parse(text); } catch { spec = parse(text); }
// configFor writes Name:value pairs joined by commas, and a value may hold a comma of its own.
// names are lowercased so a later Authorization replaces an earlier authorization instead of both going out
const auth = Object.fromEntries((process.env.API_HEADERS ?? "").split(/,(?=\s*[\w-]+\s*:)/)
  .map((pair) => [pair.slice(0, pair.indexOf(":")).trim().toLowerCase(), pair.slice(pair.indexOf(":") + 1).trim()]).filter(([name]) => name));

const pointer = (ref) => ref.slice(2).split("/").reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
// refs expand only when an endpoint is asked for, and stop 8 deep, so a schema that names itself still ends
const expand = (node, depth = 0) => {
  if (Array.isArray(node)) return node.map((one) => expand(one, depth));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") return depth > 8 || !node.$ref.startsWith("#/") ? {} : expand(pointer(node.$ref) ?? {}, depth + 1);
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, expand(value, depth)]));
};

const used = new Set();
const operations = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
  ["get", "post", "put", "patch", "delete", "head", "options"].filter((method) => item?.[method]).map((method) => {
    const given = String(item[method].operationId || `${method}-${path}`);
    // the approval gate goes by the name, so a POST called getOrCreate or a GET called createReport says what it does
    const fix = /^(get|head|options)$/.test(method) ? sendsOut(given) && "get" : !sendsOut(given) && method;
    const stem = (fix ? `${fix}-${given}` : given).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || method;
    let name = stem;
    for (let n = 2; used.has(name); n++) name = `${stem}-${n}`;
    used.add(name);
    return { name, method, path, item };
  }));

function shape({ method, path, item }) {
  const op = expand(item[method]);
  const params = new Map([...expand(item.parameters ?? []), ...(op.parameters ?? [])]
    .filter((param) => param?.name && param.in !== "cookie").map((param) => [`${param.in}:${param.name}`, param]));
  const properties = {}, required = [], fields = [];
  let body = null, bodyRequired = false, type = "application/json";
  for (const param of params.values()) {
    if (param.in === "body") { body = param.schema ?? {}; bodyRequired = param.required; continue; }
    // most model apis refuse an argument called jobs[], so it is offered as jobs and sent under its real name
    let key = param.name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "param";
    while (properties[key]) key += "_";
    // swagger 2 keeps the type on the parameter itself
    const schema = param.schema ?? { type: param.type, items: param.items, enum: param.enum };
    properties[key] = { ...schema, ...(param.description ? { description: param.description } : {}) };
    if (param.required || param.in === "path") required.push(key);
    fields.push({ key, name: param.name, in: param.in, list: schema.type === "array", // a list is key=a&key=b unless the spec says otherwise, and swagger 2 defaults to a,b
      explode: param.explode ?? (spec.swagger ? param.collectionFormat === "multi" : true) });
  }
  const content = op.requestBody?.content ?? {};
  const types = Object.keys(content);
  if (types.length) {
    type = types.find((one) => one.includes("json")) ?? types[0];
    body = content[type].schema ?? {};
  }
  let bodyKey = "body";
  while (properties[bodyKey]) bodyKey += "_";
  if (body) {
    properties[bodyKey] = body;
    if (op.requestBody?.required || bodyRequired) required.push(bodyKey);
  }
  return {
    fields, type, bodyKey,
    description: ([op.summary, op.description].filter(Boolean).join("\n") || `${method.toUpperCase()} ${path}`).slice(0, 1000),
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) }
  };
}

async function call(entry, args) {
  const { fields, type, bodyKey } = shape(entry);
  let path = entry.path;
  const query = [], form = new URLSearchParams(), headers = { ...auth };
  for (const field of fields) {
    let value = args[field.key] ?? args[field.name];
    if (value === undefined || value === null || value === "") continue;
    // models often write a list as "3,17", which the api would read as one value
    if (field.list && typeof value === "string") value = value.split(",").map((one) => one.trim()).filter(Boolean);
    const values = (Array.isArray(value) ? (field.explode ? value : [value.join(",")]) : [value])
      .map((one) => typeof one === "object" ? JSON.stringify(one) : String(one));
    if (field.in === "path") path = path.replaceAll(`{${field.name}}`, encodeURIComponent(values.join(",")));
    // brackets stay literal, since some apis only read jobs[] written that way
    else if (field.in === "query") for (const one of values) query.push(`${encodeURIComponent(field.name).replace(/%5B/gi, "[").replace(/%5D/gi, "]")}=${encodeURIComponent(one)}`);
    else if (field.in === "formData") for (const one of values) form.append(field.name, one);
    else if (field.in === "header") headers[field.name.toLowerCase()] = values.join(",");
  }
  const missing = path.match(/\{([^{}]+)\}/)?.[1];
  if (missing) throw new Error(`Give ${missing}, which is part of the address`);
  let body;
  const given = args[bodyKey];
  if (given !== undefined) {
    body = typeof given === "string" ? given : type.includes("x-www-form-urlencoded") ? new URLSearchParams(given).toString() : JSON.stringify(given);
    headers["content-type"] = type;
  } else if (form.size) {
    body = form.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const address = `${base}${path}${query.length ? `?${query.join("&")}` : ""}`;
  const response = await fetch(address, { method: entry.method.toUpperCase(), headers, body, signal: AbortSignal.timeout(120_000) });
  let answer = await response.text();
  // one line per field, since a run reads a big answer back from its overflow file only 2000 characters per line
  try { answer = JSON.stringify(JSON.parse(answer), null, 1); } catch { /* not json, sent as it came */ }
  // the run only sees the first 2000 tokens inline and reads the rest from its overflow file, so a big page costs one call not ten
  const cap = 1_000_000;
  return {
    content: [{ type: "text", text: `${entry.method.toUpperCase()} ${address} answered HTTP ${response.status}\n\n${answer.length > cap
      ? `${answer.slice(0, cap)}\n[Cut at ${cap} of ${answer.length} characters. Ask for fewer results to see the rest.]` : answer}` }],
    ...(response.ok ? {} : { isError: true })
  };
}

// a big api as three lookup tools, or its tool list alone would fill the model's context
const dynamic = flag("--tools") !== "all";
const say = (words) => ({ content: [{ type: "text", text: words }] });
const server = new Server({ name: "api", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: dynamic ? [
    { name: "list-api-endpoints", description: "List this API's endpoints by name, optionally only those matching a word.",
      inputSchema: { type: "object", properties: { search: { type: "string" } } } },
    { name: "get-api-endpoint-schema", description: "The parameters one endpoint takes, named as list-api-endpoints gave it.",
      inputSchema: { type: "object", properties: { endpoint: { type: "string" } }, required: ["endpoint"] } },
    { name: "invoke-api-endpoint", description: "Call one endpoint with the parameters its schema lists. Pass a list as an array.",
      inputSchema: { type: "object", properties: { endpoint: { type: "string" }, params: { type: "object" } }, required: ["endpoint"] } }
  ] : operations.map((entry) => { const { description, inputSchema } = shape(entry); return { name: entry.name, description, inputSchema }; })
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
  try {
    if (!dynamic) {
      const entry = operations.find((one) => one.name === name);
      if (!entry) throw new Error(`This API has no tool called ${name}`);
      return await call(entry, args);
    }
    if (name === "list-api-endpoints") {
      const word = String(args.search ?? "").toLowerCase();
      const found = operations.filter(({ name: id, method, path, item }) => `${id} ${method} ${path} ${item[method].summary ?? ""}`.toLowerCase().includes(word));
      return say(found.slice(0, 200).map(({ name: id, method, path, item }) => `${id}: ${method.toUpperCase()} ${path}${item[method].summary ? `, ${item[method].summary}` : ""}`).join("\n")
        + (found.length > 200 ? `\n[${found.length - 200} more; search with a word to narrow]` : "") || "No endpoint matches that word");
    }
    const entry = operations.find((one) => one.name === args.endpoint);
    if (!entry) throw new Error(`No endpoint is called ${args.endpoint}; list-api-endpoints names them`);
    if (name === "get-api-endpoint-schema") return say(JSON.stringify(shape(entry).inputSchema));
    if (name !== "invoke-api-endpoint") throw new Error(`This API has no tool called ${name}`);
    return await call(entry, typeof args.params === "string" ? JSON.parse(args.params) : args.params ?? {});
  } catch (error) {
    return { ...say(error?.message ?? String(error)), isError: true };
  }
});

await server.connect(new StdioServerTransport());
