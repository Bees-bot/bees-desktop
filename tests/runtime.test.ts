import { describe, expect, it, vi } from "vitest";
import { FlueRuntime } from "../src/runtime.js";

// Only the deterministic request/response paths are unit-tested here. `execute()` settles
// through the SDK's durable-stream connection, and faking that wire protocol in a unit test
// buys nothing over testing the SDK itself — the live-sidecar probe in

type Call = [string, RequestInit | undefined];

function calls(request: ReturnType<typeof vi.fn>): Call[] {
  return request.mock.calls as unknown as Call[];
}

function header(request: ReturnType<typeof vi.fn>, index = 0): string | undefined {
  const init = calls(request)[index]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

function snapshot(): Response {
  return new Response(
    JSON.stringify({ v: 1, conversationId: "conv-1", offset: "42", messages: [], settlements: [] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("FlueRuntime", () => {
  it("addresses one conversation URL and presents the launch bearer", async () => {
    const request = vi.fn(async () => snapshot());
    const runtime = new FlueRuntime(
      "http://127.0.0.1:9",
      request as unknown as typeof fetch,
      "secret-token"
    );

    const event = await runtime.history("writer", "item-1");

    expect(String(calls(request)[0]?.[0])).toContain("http://127.0.0.1:9/agents/writer/item-1");
    expect(String(calls(request)[0]?.[0])).toContain("view=history");
    expect(header(request)).toBe("Bearer secret-token");
    expect(event).toMatchObject({ type: "history", offset: "42" });
  });

  it("sends no authorization header when the host issued no token", async () => {
    const request = vi.fn(async () => snapshot());
    await new FlueRuntime("http://127.0.0.1:9", request as unknown as typeof fetch).history(
      "writer",
      "item-1"
    );

    expect(header(request)).toBeUndefined();
  });

  it("reports no conversation rather than throwing when one was never started", async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ error: "stream_not_found" }), { status: 404 })
    );
    const runtime = new FlueRuntime("http://127.0.0.1:9", request as unknown as typeof fetch);

    await expect(runtime.history("writer", "never-run")).resolves.toBeNull();
  });

  it("cancels a run that is still being admitted", async () => {
    // A Stop pressed before admission returns must abort the send, not race it.
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/abort")) return new Response("{}", { status: 200 });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const runtime = new FlueRuntime("http://127.0.0.1:9", request as unknown as typeof fetch);

    const pending = runtime.execute({
      executionId: "run-2",
      conversationId: "item-2",
      agentName: "writer",
      prompt: "Draft"
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await runtime.cancel("run-2");

    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    // A durable stop: the runtime was told, not just the local read signal.
    expect(calls(request).some(([url]) => String(url).includes("/abort"))).toBe(true);
  });

  it("submits the Flue 2 message envelope, keyed for idempotent re-admission", async () => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("stop after admission");
      return snapshot();
    });
    const runtime = new FlueRuntime("http://127.0.0.1:9", request as unknown as typeof fetch);

    await expect(
      runtime.execute({
        executionId: "run-3",
        conversationId: "item-3",
        agentName: "writer",
        prompt: "Draft"
      })
    ).rejects.toThrow("Can't reach the local runtime");

    const post = calls(request).find(([, init]) => init?.method === "POST");
    // The SDK flattens the delivered message onto the request body — the shape the Flue 2
    // route validates, and the reason the old `{ message: prompt }` body now 400s.
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      kind: "user",
      body: "Draft",
      idempotencyKey: "run-3"
    });
  });
});
