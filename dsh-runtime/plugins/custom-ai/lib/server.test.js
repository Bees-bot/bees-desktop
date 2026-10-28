import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { apply } from "./index.js";

test("connection probes attribute OpenRouter requests to Bees without changing other providers", async () => {
  const routes = new Map(), calls = [], original = globalThis.fetch;
  apply({ effect: (run) => run(), webServer: { register: (route) => routes.set(route.path, route.handler) } });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: new Headers(options.headers) });
    return Response.json({ choices: [] });
  };
  try {
    for (const provider of ["openrouter", "groq"]) {
      const req = Readable.from([JSON.stringify({ provider, key: "test-key", model: "test/model" })]);
      req.method = "POST";
      await routes.get("/bees-api/general-ai/test")(req, {
        writeHead: (status) => assert.equal(status, 200),
        end: (body) => assert.equal(JSON.parse(body).ok, true)
      });
    }
    assert.equal(calls[0].headers.get("HTTP-Referer"), "https://bees.bot");
    assert.equal(calls[0].headers.get("X-OpenRouter-Title"), "Bees.bot");
    assert.equal(calls[1].headers.get("HTTP-Referer"), null);
    assert.equal(calls[1].headers.get("X-OpenRouter-Title"), null);
  } finally { globalThis.fetch = original; }
});
