import { afterEach, expect, it, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ApiClient, ApiError } from "../src/api";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(tauriFetch).mockReset();
});

it("reports an unreachable server instead of the webview's opaque TypeError", async () => {
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Load failed")));
  await expect(new ApiClient("http://127.0.0.1:1").createWorkspace("t", "Acme")).rejects.toThrow(
    new ApiError("Can't reach server", 0)
  );
});

it("keeps HTTP errors and their status", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "Sign in required" } }), { status: 401 })
    )
  );
  await expect(new ApiClient("http://127.0.0.1:1").createWorkspace("t", "Acme")).rejects.toThrow(
    "Sign in required"
  );
});

// A dev build's webview origin (127.0.0.1:1420) is not in prod's CORS allowlist, so those
// requests have to go through Rust. A packaged build stays on the webview's own fetch.
it("routes through Tauri's HTTP plugin only inside a dev build's webview", async () => {
  const webviewFetch = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", webviewFetch);
  vi.mocked(tauriFetch).mockResolvedValue(new Response("{}"));

  await new ApiClient("https://app.bees.bot").createWorkspace("t", "Acme");
  expect(webviewFetch).toHaveBeenCalledOnce();
  expect(webviewFetch).toHaveBeenCalledWith("https://app.bees.bot/api/workspaces", expect.anything());
  expect(tauriFetch).not.toHaveBeenCalled();

  vi.stubGlobal("__TAURI_INTERNALS__", {});
  await new ApiClient("https://app.bees.bot").createWorkspace("t", "Acme");
  expect(webviewFetch).toHaveBeenCalledOnce();
  expect(tauriFetch).toHaveBeenCalledOnce();
});

it("scopes workspace requests with the workspace header", async () => {
  const webviewFetch = vi.fn(() => Promise.resolve(new Response('{"teams":[]}')));
  vi.stubGlobal("fetch", webviewFetch);

  await new ApiClient("https://app.bees.bot").listTeams("t", "workspace-1");

  expect(webviewFetch).toHaveBeenCalledWith("https://app.bees.bot/api/teams", expect.objectContaining({
    headers: expect.objectContaining({ "x-workspace-id": "workspace-1" })
  }));
});

it("maps the workspace runtime contract into the local runtime model", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({
    runtime: { workspaceId: "workspace-1", phase: "ready" }
  }))));

  const { runtime } = await new ApiClient("https://app.bees.bot")
    .workItemRuntime("t", "workspace-1", "item-1");

  expect(runtime).toMatchObject({ organizationId: "workspace-1", phase: "ready" });
  expect(runtime).not.toHaveProperty("workspaceId");
});
