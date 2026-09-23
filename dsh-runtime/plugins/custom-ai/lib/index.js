export const name = "bees-custom-ai";
export const inject = ["webServer", "credentials"];

// Every provider is tested with the call an agent will make, a few tokens long. Testing the model
// list instead proved nothing: OpenRouter, NVIDIA and Hugging Face hand that list to any key.
const PROVIDERS = {
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions" },
  google: { url: "https://generativelanguage.googleapis.com/v1beta/models", gemini: true },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions" },
  cerebras: { url: "https://api.cerebras.ai/v1/chat/completions" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions" },
  deepseek: { url: "https://api.deepseek.com/chat/completions" },
  huggingface: { url: "https://router.huggingface.co/v1/chat/completions" },
  together: { url: "https://api.together.ai/v1/chat/completions" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/chat/completions" },
  xai: { url: "https://api.x.ai/v1/chat/completions" }
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
  const parsed = value ? JSON.parse(value) : {};
  return parsed && typeof parsed === "object" ? parsed : {};
}

// A dead socket reaches the person as "fetch failed" or a bare status, neither of which says what
// to do about it. The host is safe to name: the person typed it. A queued model reads as a timeout.
const unreachable = (url, error) => new Error(error.name === "TimeoutError"
  ? `${url.host} did not answer in 30 seconds. Try again, or test a smaller model.`
  : `Could not reach ${url.host}. Check this computer's internet connection, then test again. (${error.cause?.message ?? error.message})`);

// A bad key is 400 from Google and xAI but 401 from the other nine, so the provider's own sentence
// is the only signal covering both. Capped: it goes straight into the settings screen.
function upstreamReason(text) {
  let value;
  try { value = JSON.parse(text); } catch { return ""; }
  const candidates = [value?.error?.message, value?.error, value?.message, value?.detail, value?.title];
  const message = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return message ? message.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

// A 200 alone is not a working key: a captive portal or a proxy error page answers 200 too, and dsh
// would only find out at run time. A real reply is JSON and, unlike an error, carries no error of
// its own. Deliberately not stricter than that, or a thinking model could fail its own key test.
const reply = (text) => {
  try {
    const value = JSON.parse(text);
    return Boolean(value) && !value.error && !value.title;
  } catch { return false; }
};

// 400 is also what a bad model ID looks like, so only the auth statuses get to name the key.
function providerFailure(status, text) {
  const reason = upstreamReason(text) || `The provider returned HTTP ${status}.`;
  if (status === 401 || status === 403) return `${reason} Check the key was copied whole, with no spaces.`;
  if (status === 402) return `${reason} Add credit on the provider's website, then test again.`;
  if (status === 404) return `${reason} Check the model ID.`;
  if (status === 429) return `${reason} Wait a minute, then test again.`;
  if (status >= 500) return `${reason} Try again in a few minutes.`;
  return reason;
}

// A few tokens of a real answer, so a failed key is a failed call and not a refused list request.
async function probe(definition, model, key) {
  const url = new URL(definition.url);
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (definition.gemini) {
    // Google is not OpenAI-shaped: the model is a path segment, and the key goes in a header to stay out of logs.
    url.pathname += `/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`;
    headers["x-goog-api-key"] = key;
  } else headers.authorization = `Bearer ${key}`;
  const body = definition.gemini
    ? { contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 16 } }
    : { model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    // read in here so the same 30 seconds covers the body, and a host that dies mid-answer reads as unreachable
    return { response, text: await response.text() };
  } catch (error) {
    throw unreachable(url, error);
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/bees-api/general-ai/test",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      try {
        const { provider, model, key: pasted } = await requestBody(req);
        const definition = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
        if (!definition) throw new Error("Choose a supported provider");
        if (typeof model !== "string" || !model.trim()) throw new Error("Add a model ID for this provider, then test again.");
        // a key being added is tested before it is saved
        const key = String(pasted ?? "").trim() || (await ctx.credentials.resolve(refFor(provider)))?.value;
        if (!key) throw new Error("Add the API key first");
        const { response, text } = await probe(definition, model.trim(), key);
        if (!response.ok) throw new Error(providerFailure(response.status, text));
        if (!reply(text)) throw new Error(upstreamReason(text)
          || "The provider answered, but not with a model reply. Check the API key and the model ID, then test again.");
        json(res, 200, { ok: true, message: "Connection works" });
      } catch (error) {
        json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "bees general AI: test route");
}
