import { request } from "./shared.js";

const MEDIA_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  pdf: "application/pdf", html: "text/html", htm: "text/html"
};

export async function loadRunFile(ctx, target, signal) {
  const query = new URLSearchParams({ executionId: target.executionId, path: target.path });
  const type = MEDIA_TYPES[target.path.split(".").pop().toLowerCase()];
  // Keep the bounded, formatted text reader for code, Markdown, and large logs.
  if (typeof type !== "string") return request(`/bees-api/run-file?${query}`, { signal });
  query.set("native", "1");
  const file = await request(`/bees-api/run-file?${query}`, { signal });
  signal.throwIfAborted();
  if (!file.sessionId) throw new Error("This run's file session is unavailable.");
  const result = await ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal);
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error.message || "The file could not be read.");
  if (!result.value.eof) throw new Error("The file could not be loaded completely.");
  const bytes = Uint8Array.from(atob(result.value.data), (character) => character.charCodeAt(0));
  return { path: file.path, name: file.path.split("/").pop(), size: bytes.length,
    format: type.startsWith("image/") ? "image" : type === "application/pdf" ? "pdf" : "html",
    blob: new Blob([bytes], { type }) };
}
