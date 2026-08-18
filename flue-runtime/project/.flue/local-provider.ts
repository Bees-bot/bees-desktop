import { envObject } from "./env-json.ts";
type Forward = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function localModelRoutes(raw = process.env.BEES_LOCAL_AI_URLS): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envObject("BEES_LOCAL_AI_URLS", raw)).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(entry[1])
    )
  );
}

function error(message: string, status: number): Response {
  return Response.json({ error: { message, type: "local_model_error" } }, { status });
}

/** Route a `bees-local/<model-id>` request to that model's llama-server process. */
export async function proxyLocalModelRequest(
  request: Request,
  routes: Record<string, string>,
  forward: Forward = fetch
): Promise<Response> {
  if (request.method !== "POST") return error("Local model requests must use POST", 405);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("The local model request body is not valid JSON", 400);
  }
  const model = typeof payload.model === "string" ? payload.model : "";
  const baseUrl = routes[model];
  if (!baseUrl) return error(`Local model "${model || "unknown"}" is not running`, 503);

  const source = new URL(request.url);
  const suffix = source.pathname.slice("/local-model/v1".length);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  try {
    return await forward(`${baseUrl}${suffix}${source.search}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, model: "active" }),
      signal: request.signal
    });
  } catch (cause) {
    return error(
      `Local model "${model}" is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      502
    );
  }
}
