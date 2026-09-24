import assert from "node:assert/strict";
import test from "node:test";
import { previewFormat, previewType } from "./run-file-preview.js";

test("recognizes browser-native previews without treating arbitrary binaries as media", () => {
  assert.equal(previewType("photo.JPEG"), "image/jpeg");
  assert.equal(previewType("report.pdf"), "application/pdf");
  assert.equal(previewType("voice.mp3"), "audio/mpeg");
  assert.equal(previewType("demo.webm"), "video/webm");
  assert.equal(previewType("archive.zip"), null);
  assert.equal(previewFormat("text/html"), "html");
});
