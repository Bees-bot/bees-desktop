import { describe, expect, it } from "vitest";
import { createMainViews } from "../src/app-views.js";
import type { MainHost } from "../src/main.js";

describe("local model controls", () => {
  it("keeps a completed download checked without exposing deletion as a toggle", () => {
    const host = {
      assistant: { localModelProgress: new Map(), localModelStarting: new Set() },
      localModels: { wantedRunId: null },
      shell: { escapeHtml: (value: string) => value, formatBytes: () => "1 GB" }
    } as unknown as MainHost;
    const row = createMainViews(host).localModelRow({
      id: "model",
      name: "Model",
      fileName: "model.gguf",
      bytes: 1,
      runtime: { modelId: "model", state: "ready", downloadedBytes: 1, totalBytes: 1, running: false }
    });
    const download = row.match(/<input[^>]+data-model-toggle="download"[^>]+>/)?.[0];

    expect(download).toContain("checked");
    expect(download).toContain("disabled");
    expect(download).not.toContain("data-model-downloaded");
  });
});
