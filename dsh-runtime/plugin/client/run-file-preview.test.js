import assert from "node:assert/strict";
import test from "node:test";
import { documentPreview, loadRunFile, previewFormat, previewType } from "./run-file-preview.js";

test("recognizes browser-native previews without treating arbitrary binaries as media", () => {
  assert.equal(previewType("photo.JPEG"), "image/jpeg");
  assert.equal(previewType("report.pdf"), "application/pdf");
  assert.equal(previewType("voice.mp3"), "audio/mpeg");
  assert.equal(previewType("demo.webm"), "video/webm");
  assert.equal(previewType("archive.zip"), null);
  assert.equal(previewFormat("text/html"), "html");
});

test("authorized run files use native bytes or document tabs, and reject truncated/denied reads", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ sessionId: "session", path: new URL(String(url), "http://bees").searchParams.get("path") });
  };
  try {
    let reads = 0, complete = true;
    const bytes = new Uint8Array([0, 127, 255]);
    const ctx = { remote: { workspaceFiles: { readBytes: async (session, path, options, signal) => {
      reads++; assert.equal(session, "session"); assert.equal(path, "outputs/image.png");
      assert.deepEqual(options, {}); assert(signal instanceof AbortSignal);
      return { ok: true, value: { data: bytes, eof: complete } };
    } } } };
    const signal = new AbortController().signal;
    const image = await loadRunFile(ctx, { executionId: "run", path: "outputs/image.png" }, signal);
    assert.deepEqual(new Uint8Array(await image.blob.arrayBuffer()), bytes);
    assert.match(requests[0], /native=1/);
    for (const ext of ["docx", "pptx", "xlsx", "CSV", "tsv"]) {
      const file = await loadRunFile(ctx, { executionId: "run", path: `outputs/report.${ext}` }, signal);
      assert.equal(file.format, "document"); assert.equal(file.sessionId, "session");
    }
    assert.equal(reads, 1);
    assert.equal(documentPreview("archive.zip"), false);
    complete = false;
    await assert.rejects(loadRunFile(ctx, { executionId: "run", path: "outputs/image.png" }, signal), /completely/);
    globalThis.fetch = async () => Response.json({ error: "Only run inputs and outputs can be previewed" }, { status: 409 });
    await assert.rejects(loadRunFile(ctx, { executionId: "run", path: "secret.docx" }, signal), /Only run/);
  } finally { globalThis.fetch = originalFetch; }
});
