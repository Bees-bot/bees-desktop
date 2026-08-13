/**
 * What an API will say about itself, asked at one address.
 *
 * Only the API is asked. It either publishes a document, or answers its own root with the resources
 * it offers, or it says nothing and a single request has to describe it instead. Nothing here
 * depends on a third party knowing about it.
 */

export interface Discovery {
  kind: "spec-url" | "endpoint-list" | "none";
  /** Where the document lives, when the API publishes one. */
  specUrl?: string;
  /** The document, when it was written from what the API listed. */
  spec?: string;
  /** How it was found, so a person can see what happened. */
  how: string;
  endpointCount: number;
}

const SPEC_PATHS = [
  "/openapi.json", "/openapi.yaml", "/swagger.json", "/v3/api-docs",
  "/api-docs", "/.well-known/openapi.json"
];

const looksLikeSpec = (text: string): boolean =>
  /"?openapi"?\s*[:=]\s*["']?3|"?swagger"?\s*:\s*["']2/.test(text.slice(0, 2000));

/** Reads an address through whatever can actually reach it. */
export type Reader = (url: string) => Promise<{ status: number; body: string }>;

const body = async (read: Reader, url: string): Promise<string> =>
  read(url).then(answer => answer.status >= 200 && answer.status < 300 ? answer.body : "").catch(() => "");

/** One read per resource the API lists for itself. */
function specFromLinks(origin: string, links: [string, string][], title: string): string {
  const paths: Record<string, unknown> = {};
  for (const [name, href] of links) {
    let path: string;
    try {
      path = new URL(href).pathname;
    }
    catch {
      continue;
    }
    paths[path] = {
      get: {
        operationId: name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resource",
        summary: `List ${name.replace(/[-_]/g, " ")}`,
        description: `Offered by ${origin} at its own root.`,
        parameters: [
          { name: "limit", in: "query", description: "How many to return", schema: { type: "integer" } },
          { name: "offset", in: "query", description: "Where to start", schema: { type: "integer" } }
        ],
        responses: { "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } } }
      }
    };
  }
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title, version: "0.1", description: `Written from what ${origin} lists at its own root.` },
    servers: [{ url: origin }],
    paths
  });
}

/** Anything in the answer that points back into the same API. */
function selfLinks(value: unknown, origin: string): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].startsWith(origin))
    .map(([name, href]) => [name, href.replace(/\{.*?\}/g, "")]);
}

export async function discoverApi(address: string, read: Reader): Promise<Discovery> {
  const url = new URL(address);
  const origin = url.origin;
  const host = url.hostname.replace(/^www\./, "");

  const answer = await body(read, address);

  // The address may be the document itself.
  if (answer && looksLikeSpec(answer)) {
    return { kind: "spec-url", specUrl: address, how: "the address is an OpenAPI document", endpointCount: 0 };
  }

  // Or the document sits where documents usually sit, beside the address or at the host.
  for (const base of [address.replace(/\/+$/, ""), origin]) {
    for (const path of SPEC_PATHS) {
      const candidate = `${base}${path}`;
      if (looksLikeSpec(await body(read, candidate))) {
        return { kind: "spec-url", specUrl: candidate, how: `found a document at ${path}`, endpointCount: 0 };
      }
    }
  }

  // Or the answer is a list of what the API offers, which is a description in everything but name.
  let listed: unknown = null;
  try {
    listed = JSON.parse(answer);
  }
  catch {
    listed = null;
  }
  const links = selfLinks(listed, origin);
  if (links.length >= 2) {
    return {
      kind: "endpoint-list",
      spec: specFromLinks(origin, links, `${host} API`),
      how: `${host} lists ${links.length} resources at this address`,
      endpointCount: links.length
    };
  }

  return {
    kind: "none",
    how: `${host} publishes no document and lists nothing at this address`,
    endpointCount: 0
  };
}
