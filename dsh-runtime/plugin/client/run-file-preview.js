import { request } from "./shared.js";

const MEDIA_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  pdf: "application/pdf", html: "text/html", htm: "text/html",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime"
};

export const previewType = (path) => MEDIA_TYPES[String(path).split(".").pop().toLowerCase()] ?? null;
export const previewFormat = (type) => type === "application/pdf" ? "pdf" : type === "text/html" ? "html" : type.split("/")[0];
export const documentPreview = (path) => /\.(docx?|xlsx?|pptx?|csv|tsv)$/i.test(path);

export async function loadRunFile(ctx, target, signal) {
  const query = new URLSearchParams({ executionId: target.executionId, path: target.path });
  const type = previewType(target.path);
  // Keep the bounded, formatted text reader for code, Markdown, and large logs.
  if (typeof type !== "string" && !documentPreview(target.path)) return request(`/bees-api/run-file?${query}`, { signal });
  query.set("native", "1");
  const file = await request(`/bees-api/run-file?${query}`, { signal });
  signal.throwIfAborted();
  if (!file.sessionId) throw new Error("This run's file session is unavailable.");
  if (documentPreview(file.path)) return { ...file, format: "document" };
  const result = await ctx.remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal);
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error.message || "The file could not be read.");
  if (!result.value.eof) throw new Error("The file could not be loaded completely.");
  const bytes = result.value.data;
  return { path: file.path, name: file.path.split("/").pop(), size: bytes.length,
    format: previewFormat(type),
    blob: new Blob([bytes], { type }) };
}

export async function loadLocationFile(target, signal) {
  let type = previewType(target.path || target.name);
  const query = new URLSearchParams({ locationId: target.locationId, path: target.path });
  if (!type) {
    const file = await request(`/bees-api/location-file?${query}`, { signal });
    type = previewType(file.name);
    if (!type) return file;
  }
  query.set("native", "1");
  const response = await request(`/bees-api/location-file?${query}`, { signal, binary: true });
  const blob = new Blob([await response.arrayBuffer()], { type });
  const encodedPath = response.headers.get("x-bees-file-path");
  const encodedName = response.headers.get("x-bees-file-name");
  return {
    path: encodedPath ? decodeURIComponent(encodedPath) : target.path,
    name: encodedName ? decodeURIComponent(encodedName) : target.name ?? target.path.split("/").pop(),
    size: blob.size, format: previewFormat(type), blob
  };
}
