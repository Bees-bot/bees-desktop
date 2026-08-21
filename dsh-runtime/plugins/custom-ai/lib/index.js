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
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
        await response.body?.cancel();
        if (!response.ok) {
          if ([401, 403].includes(response.status)) throw new Error("The provider rejected this API key");
          throw new Error(`The provider returned HTTP ${response.status}`);
        }
        json(res, 200, { ok: true, message: "Connection works" });
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees general AI: test route");
}
