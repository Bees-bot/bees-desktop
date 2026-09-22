export const name = "bees-custom-ai";
export const inject = ["webServer", "credentials"];

const PROVIDERS = {
  openrouter: { url: "https://openrouter.ai/api/v1/models" },
  google: { url: "https://generativelanguage.googleapis.com/v1beta/models", queryKey: true },
  groq: { url: "https://api.groq.com/openai/v1/models" },
  cerebras: { url: "https://api.cerebras.ai/v1/models" },
  mistral: { url: "https://api.mistral.ai/v1/models" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/models" },
  deepseek: { url: "https://api.deepseek.com/models" },
  huggingface: { url: "https://router.huggingface.co/v1/models" },
  together: { url: "https://api.together.ai/v1/models" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/models" },
  xai: { url: "https://api.x.ai/v1/models" }
};

// Preserve credentials saved by the earlier combined AI APIs screen.
const refFor = (provider) => `BEES_FREE_${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function requestBody(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 5_000) throw new Error("Request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

// A dead socket reaches the person as "fetch failed" or a bare status, neither of which says what
// to do about it. The host is safe to name: the person typed it.
const unreachable = (url, error) => new Error(
  `Could not reach ${url.host}. Check this computer's internet connection, then test again. (${error.message})`);

// A bad key is 400 from Google and xAI but 401 from the other nine, so the provider's own sentence
// is the only signal covering both. Capped: it goes straight into the settings screen.
async function upstreamReason(response) {
  const text = await response.text().catch(() => "");
  try {
    const value = JSON.parse(text);
    const message = value?.error?.message ?? value?.error ?? value?.message;
    if (typeof message === "string") return message.replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {}
  return "";
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/general-ai/test",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      try {
        const { provider } = await requestBody(req);
        const definition = PROVIDERS[provider];
        if (!definition) throw new Error("Choose a supported provider");
        const key = (await ctx.credentials.resolve(refFor(provider)))?.value;
        if (!key) throw new Error("Add the API key first");
        const url = new URL(definition.url);
        const headers = { accept: "application/json" };
        if (definition.queryKey) url.searchParams.set("key", key);
        else headers.authorization = `Bearer ${key}`;
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) })
          .catch((error) => { throw unreachable(url, error); });
        if (!response.ok) {
          const reason = await upstreamReason(response);
          if ([400, 401, 403].includes(response.status)) throw new Error(
            `${reason || "The provider rejected this API key."} Check the key was copied whole, with no spaces.`);
          if (response.status === 429) throw new Error("The provider is limiting how often this key can be used. Wait a minute, then test again.");
          if (response.status >= 500) throw new Error(`The provider is having trouble of its own (HTTP ${response.status}). Try again in a few minutes.`);
          throw new Error(`The provider returned HTTP ${response.status}`);
        }
        // only the failure path reads the body, so a good response is dropped rather than left open
        await response.body?.cancel();
        json(res, 200, { ok: true, message: "Connection works" });
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees general AI: test route");
}
