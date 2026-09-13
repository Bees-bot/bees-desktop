import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";

const { loadRunFile } = createRequire(import.meta.url)("../dsh-runtime/plugin/client/run-file-preview.js");

afterEach(() => vi.unstubAllGlobals());

it("reads text in place without selecting a native session", async () => {
  const file = { path: "outputs/report.md", format: "markdown", content: "# Report" };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => file });
  vi.stubGlobal("fetch", fetch);
  expect(await loadRunFile({}, { executionId: "run", path: file.path }, new AbortController().signal)).toEqual(file);
  expect(fetch.mock.calls[0]?.[0]).toBe("/bees-api/run-file?executionId=run&path=outputs%2Freport.md");
});

it("authorizes a media file before reading its bytes without opening DSH", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionId: "session", path: "outputs/report.pdf" }) });
  vi.stubGlobal("fetch", fetch);
  const readAll = vi.fn().mockResolvedValue({ ok: true, value: { data: btoa("%PDF-test"), eof: true } });
  const ctx = { remote: { workspaceFiles: { readAll } } };
  const signal = new AbortController().signal;
  const file = await loadRunFile(ctx, { executionId: "run", path: "outputs/report.pdf" }, signal);
  expect(fetch.mock.calls[0]?.[0]).toContain("native=1");
  expect(readAll).toHaveBeenCalledWith("session", "outputs/report.pdf", signal);
  expect(file.format).toBe("pdf");
  expect(file.blob.type).toBe("application/pdf");
  expect(await file.blob.text()).toBe("%PDF-test");
});

it("does not read file bytes when authorization fails or the preview closes", async () => {
  const readAll = vi.fn();
  const ctx = { remote: { workspaceFiles: { readAll } } };
  const target = { executionId: "run", path: "outputs/image.png" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Run not found" }) }));
  await expect(loadRunFile(ctx, target, new AbortController().signal)).rejects.toThrow("Run not found");
  const abort = new AbortController();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    abort.abort();
    return { ok: true, json: async () => ({ sessionId: "session", path: target.path }) };
  }));
  await expect(loadRunFile(ctx, target, abort.signal)).rejects.toThrow();
  expect(readAll).not.toHaveBeenCalled();
});
