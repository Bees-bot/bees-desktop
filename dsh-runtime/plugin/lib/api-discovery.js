/** What an API says about itself. Only the API is asked, never a third party. */
import { lookup } from "node:dns/promises";
import { publicIPv4 } from "./app-source.js";

const SPEC_PATHS = [
  "/openapi.json", "/openapi.yaml", "/swagger.json", "/v3/api-docs",
  "/api-docs", "/.well-known/openapi.json"
];

const looksLikeSpec = (text) =>
  /"?openapi"?\s*[:=]\s*["']?3|"?swagger"?\s*:\s*["']2/.test(text.slice(0, 2000));

async function read(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
  return { status: response.status, body: await response.text() };
}

const body = (reader, url) => reader(url)
  .then((answer) => (answer.status >= 200 && answer.status < 300 ? answer.body : ""))
  .catch(() => "");

/** Anything in the answer that points back into the same API. */
function selfLinks(value, origin) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, href]) => typeof href === "string" && href.startsWith(origin));
}

/** The single-item read an href template advertises, so a lookup by id or name is possible. */
function itemRead(name, path, origin) {
  const key = (path.match(/\{(.*?)\}/) ?? [, "id"])[1];
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resource";
  return { get: {
    operationId: `${slug}-read`,
    summary: `Read one ${name.replace(/[-_]/g, " ")} by ${key}`,
    description: `Offered by ${origin} at its own root.`,
    parameters: [{ name: key, in: "path", required: true, description: "Which one to read", schema: { type: "string" } }],
    responses: { 200: { description: "Success", content: { "application/json": { schema: { type: "object" } } } } }
  } };
}

/** One read per resource the API lists for itself. */
function specFromLinks(origin, links, title) {
  const paths = {};
  for (const [name, href] of links) {
    let path;
    // URL() percent-encodes the braces, so decode before looking for a template.
    try { path = decodeURIComponent(new URL(href).pathname); } catch { continue; }
    // An href like /pokemon/{id}/ names its lookup. A plain collection still reads one by convention.
    const item = /\{.*?\}/.test(path) ? path : `${path.replace(/\/$/, "")}/{name}`;
    path = path.replace(/\{.*?\}/g, "").replace(/\/{2,}/g, "/");
    paths[item] = itemRead(name, item, origin);
    paths[path] = {
      get: {
        operationId: name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resource",
        summary: `List ${name.replace(/[-_]/g, " ")}`,
        description: `Offered by ${origin} at its own root.`,
        parameters: [
          { name: "limit", in: "query", description: "How many to return", schema: { type: "integer" } },
          { name: "offset", in: "query", description: "Where to start", schema: { type: "integer" } }
        ],
        responses: { 200: { description: "Success", content: { "application/json": { schema: { type: "object" } } } } }
      }
    };
  }
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title, version: "0.1", description: `Written from what ${origin} lists at its own root.` },
    servers: [{ url: origin }],
    paths
  }, null, 2);
}

/** Loopback, link-local and the private ranges. A bridge is built from an address a model proposed,
 *  so without this it could be pointed at something only this machine can reach. */
// ponytail: checked once when the bridge is added, so a name that later points elsewhere or a redirect still gets through; pin like app-source if that matters
export async function privateAddress(address) {
  let host;
  // localhost. with the root dot is still localhost
  try { host = new URL(address).hostname.replace(/\.$/, ""); } catch { return false; }
  // an ipv6 literal is never a hosted api, and ::1 or ::ffff:127.0.0.1 hide in many spellings
  if (host.startsWith("[")) return true;
  if (/^[\d.]+$/.test(host)) return !publicIPv4(host);
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/i.test(host)) return true;
  // a name like 127.0.0.1.nip.io reads as public, so check where it points
  const found = await lookup(host, { all: true }).catch(() => []);
  // only 2000::/3 is public ipv6, so ::1, fd00:: and a mapped 127.0.0.1 all count as private
  return found.some(({ address: ip, family }) => family === 4 ? !publicIPv4(ip) : !/^[23][0-9a-f]{3}:/i.test(ip));
}

export async function discoverApi(address, reader = read) {
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http or https address");
  const origin = url.origin;
  const host = url.hostname.replace(/^www\./, "");

  const answer = await body(reader, address);
  if (answer && looksLikeSpec(answer))
    return { kind: "spec-url", specUrl: address, how: "the address is an OpenAPI document", endpointCount: 0 };

  for (const base of [address.replace(/\/+$/, ""), origin]) {
    for (const path of SPEC_PATHS) {
      const candidate = `${base}${path}`;
      if (looksLikeSpec(await body(reader, candidate)))
        return { kind: "spec-url", specUrl: candidate, how: `found a document at ${path}`, endpointCount: 0 };
    }
  }

  let listed = null;
  try { listed = JSON.parse(answer); } catch { listed = null; }
  const links = selfLinks(listed, origin);
  if (links.length >= 2) return {
    kind: "endpoint-list",
    spec: specFromLinks(origin, links, `${host} API`),
    how: `${host} lists ${links.length} resources at this address`,
    endpointCount: links.length
  };

  return {
    kind: "none",
    how: `${host} publishes no document and lists nothing at this address`,
    endpointCount: 0
  };
}
