import { describe, expect, it, vi } from "vitest";
import {
  localModelRoutes,
  proxyLocalModelRequest
} from "../flue-runtime/project/.flue/local-provider.js";
import app from "../flue-runtime/project/.flue/app.js";

describe("local model provider", () => {
  it("guards every loopback compute and agent route with the launch bearer", async () => {
    process.env.BEES_FLUE_TOKEN = "launch-token";
    for (const route of [
      "/agents/missing/run",
      "/browser/open",
      "/local-model/v1/chat/completions",
      "/cli/missing/v1/chat/completions"
    ]) {
      expect((await app.request(route, { method: "POST" })).status).toBe(401);
    }
    expect(
      (
        await app.request("/cli/missing/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer launch-token" }
        })
      ).status
    ).toBe(404);
    delete process.env.BEES_FLUE_TOKEN;
  });

  it("routes a model id to its server and uses llama-server's active alias", async () => {
    const forward = vi.fn(async () => new Response("ok"));
    const response = await proxyLocalModelRequest(
      new Request("http://127.0.0.1:3000/local-model/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "small", messages: [{ role: "user", content: "Hi" }] })
      }),
      { small: "http://127.0.0.1:4100/v1", large: "http://127.0.0.1:4200/v1" },
      forward
    );

    expect(await response.text()).toBe("ok");
    expect(forward).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"model":"active"')
      })
    );
  });

  it("accepts only loopback llama-server routes", () => {
    expect(
      localModelRoutes(
        JSON.stringify({
          local: "http://127.0.0.1:4100/v1",
          remote: "https://example.com/v1",
          malformed: 7
        })
      )
    ).toEqual({ local: "http://127.0.0.1:4100/v1" });
  });
});
