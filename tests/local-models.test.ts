import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_MODEL_ID,
  LocalModelService,
  parseModelSource,
  SEEDED_MODELS,
  type LocalModel,
  type LocalModelPort,
  type LocalModelRuntimeStatus,
  type LocalModelSettingsStore
} from "../src/local-models.js";

class MemorySettings implements LocalModelSettingsStore {
  readonly values = new Map<string, unknown>();

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    return this.values.has(key) ? (this.values.get(key) as T) : fallback;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

class MemoryRuntime implements LocalModelPort {
  readonly states = new Map<string, LocalModelRuntimeStatus>();
  readonly ensured: string[] = [];
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  readonly removed: string[] = [];
  readonly cancelled: string[] = [];

  async status(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    return (
      this.states.get(spec.id) ?? {
        modelId: spec.id,
        state: "not-downloaded",
        downloadedBytes: 0,
        totalBytes: spec.bytes,
        running: false
      }
    );
  }

  async ensure(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    this.ensured.push(spec.id);
    const status: LocalModelRuntimeStatus = {
      ...(await this.status(spec)),
      state: "ready",
      downloadedBytes: 100,
      totalBytes: 100
    };
    this.states.set(spec.id, status);
    return status;
  }

  async start(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    this.started.push(spec.id);
    const status: LocalModelRuntimeStatus = {
      ...(await this.status(spec)),
      state: "running",
      running: true
    };
    this.states.set(spec.id, status);
    return status;
  }

  async stop(modelId: string): Promise<void> {
    this.stopped.push(modelId);
    const status = this.states.get(modelId);
    if (status) this.states.set(modelId, { ...status, state: "ready", running: false });
  }

  async cancelDownload(modelId: string): Promise<void> {
    this.cancelled.push(modelId);
  }

  async remove(spec: LocalModel): Promise<void> {
    this.removed.push(spec.id);
    this.states.delete(spec.id);
  }
}

const REMOTE = "https://huggingface.co/acme/Qwen-GGUF/resolve/main/qwen2.5-0.5b-q4_k_m.gguf";

describe("model sources", () => {
  it("reads a name and a plain file name out of a download link", () => {
    expect(parseModelSource(`  ${REMOTE}?download=true `)).toMatchObject({
      name: "qwen2.5-0.5b-q4_k_m",
      fileName: "qwen2.5-0.5b-q4_k_m.gguf",
      url: `${REMOTE}?download=true`,
      bytes: 0
    });
  });

  it("keeps a picked file where it is instead of naming a managed download", () => {
    expect(parseModelSource("/Users/me/models/my model.gguf")).toMatchObject({
      name: "my model",
      fileName: "",
      localPath: "/Users/me/models/my model.gguf"
    });
  });

  it("refuses sources it cannot load", () => {
    expect(() => parseModelSource("")).toThrow();
    expect(() => parseModelSource("qwen2.5")).toThrow();
    expect(() => parseModelSource("https://example.com/model.bin")).toThrow();
    expect(() => parseModelSource("http://example.com/model.gguf")).toThrow(/https/);
  });

  it("strips path separators out of the managed file name", () => {
    const model = parseModelSource("https://example.com/a/%2E%2E%2Fescape.gguf");
    expect(model.fileName).toBe("..-escape.gguf");
  });
});

describe("local model list", () => {
  it("lists the seeded models without downloading them on first launch", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    expect((await service.list()).map(({ id }) => id)).toEqual(SEEDED_MODELS.map(({ id }) => id));
    await expect(service.requireRunning()).rejects.toThrow(/Turn on a local AI model/);
    expect(runtime.ensured).toEqual([]);
    expect(runtime.started).toEqual([]);
  });

  it("adds seeded models an older install has never seen, keeping the user's own", async () => {
    const settings = new MemorySettings();
    const mine: LocalModel = { id: "mine", name: "mine", fileName: "", localPath: "/m.gguf", bytes: 0 };
    // A stored seed carrying a download link that has since moved, plus the user's own row.
    const stale: LocalModel = { ...SEEDED_MODELS[0]!, url: "https://example.com/gone.gguf" };
    settings.values.set("local_models", [stale, mine]);
    const service = new LocalModelService(settings, new MemoryRuntime());
    const listed = await service.list();

    expect(listed.map(({ id }) => id)).toEqual([
      DEFAULT_LOCAL_MODEL_ID,
      "mine",
      ...SEEDED_MODELS.slice(1).map(({ id }) => id)
    ]);
    // The shipped definition replaced the stale one, and the user's row was left alone.
    expect(listed[0]?.url).toBe(SEEDED_MODELS[0]?.url);
    expect(listed[1]).toMatchObject(mine);
  });

  it("keeps a deleted seed gone and drops a hand-added copy of a seeded file", async () => {
    const settings = new MemorySettings();
    const seed = SEEDED_MODELS[1]!;
    // Same file as a seed, added by hand before the seed existed: one download, two rows.
    const copy: LocalModel = { id: "copy", name: seed.fileName, fileName: seed.fileName, bytes: 0 };
    settings.values.set("local_models", [...SEEDED_MODELS, copy]);

    const service = new LocalModelService(settings, new MemoryRuntime());
    expect((await service.list()).map(({ id }) => id)).toEqual(SEEDED_MODELS.map(({ id }) => id));
    await service.remove(seed.id);

    const restarted = new LocalModelService(settings, new MemoryRuntime());
    expect((await restarted.list()).map(({ id }) => id)).toEqual(
      SEEDED_MODELS.filter(({ id }) => id !== seed.id).map(({ id }) => id)
    );
  });

  it("requires the user to turn on a downloaded model", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    await service.download(DEFAULT_LOCAL_MODEL_ID);
    await expect(service.requireRunning(DEFAULT_LOCAL_MODEL_ID)).rejects.toThrow(/Turn on local model/);
    expect(runtime.started).toEqual([]);
    await service.run(DEFAULT_LOCAL_MODEL_ID);
    await expect(service.requireRunning(DEFAULT_LOCAL_MODEL_ID)).resolves.toBeUndefined();
    await expect(service.requireRunning()).resolves.toBeUndefined();
    expect(runtime.started).toEqual([DEFAULT_LOCAL_MODEL_ID]);
  });

  it("remembers a Run asked for mid-download and brings it up after a restart", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);
    await service.load();

    // Toggled on while the file was still downloading, then the page reloaded.
    await service.wantRun(DEFAULT_LOCAL_MODEL_ID);
    const restored = new LocalModelService(settings, new MemoryRuntime());
    await restored.load();
    expect(restored.wantedRunId).toBe(DEFAULT_LOCAL_MODEL_ID);

    await service.download(DEFAULT_LOCAL_MODEL_ID);
    await service.run(DEFAULT_LOCAL_MODEL_ID);
    expect(runtime.started).toEqual([DEFAULT_LOCAL_MODEL_ID]);

    expect(await service.stop(DEFAULT_LOCAL_MODEL_ID)).toBe(true);
    expect(service.wantedRunId).toBeNull();
  });

  it("adds a model, remembers it, and refuses the same source twice", async () => {
    const settings = new MemorySettings();
    const service = new LocalModelService(settings, new MemoryRuntime());

    const added = await service.add(REMOTE);
    await expect(service.add(REMOTE)).rejects.toThrow(/already in the list/);

    const restored = new LocalModelService(settings, new MemoryRuntime());
    expect((await restored.list()).map(({ id }) => id)).toEqual([
      ...SEEDED_MODELS.map(({ id }) => id),
      added.id
    ]);
  });

  it("records the size a download reported so the row still shows it later", async () => {
    const settings = new MemorySettings();
    const service = new LocalModelService(settings, new MemoryRuntime());

    const added = await service.add(REMOTE);
    await service.download(added.id);

    const restored = new LocalModelService(settings, new MemoryRuntime());
    expect((await restored.list()).find(({ id }) => id === added.id)?.bytes).toBe(100);
  });

  it("keeps multiple models running at the same time", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    const added = await service.add(REMOTE);
    await service.run(DEFAULT_LOCAL_MODEL_ID);
    await service.run(added.id);

    const views = await service.list();
    expect(views.find(({ id }) => id === added.id)?.runtime.running).toBe(true);
    expect(views.find(({ id }) => id === DEFAULT_LOCAL_MODEL_ID)?.runtime.running).toBe(true);
    // Already active, so its route does not change.
    expect(await service.run(added.id)).toBe(false);
  });

  it("stops a model and cancels whatever it was downloading", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    await service.run(DEFAULT_LOCAL_MODEL_ID);
    expect(await service.stop(DEFAULT_LOCAL_MODEL_ID)).toBe(true);
    expect(runtime.cancelled).toContain(DEFAULT_LOCAL_MODEL_ID);
    expect((await service.list())[0]?.runtime.running).toBe(false);
  });

  it("deletes a model and stops treating it as the one to bring back", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    const added = await service.add(REMOTE);
    await service.run(added.id);
    expect(await service.remove(added.id)).toBe(true);

    expect(runtime.removed).toEqual([added.id]);
    expect(settings.values.get("local_model_last_run_id")).toBeNull();
    expect((await service.list()).map(({ id }) => id)).toEqual(SEEDED_MODELS.map(({ id }) => id));
  });

  it("removes the file but keeps the row so Download can be toggled back on", async () => {
    const settings = new MemorySettings();
    const runtime = new MemoryRuntime();
    const service = new LocalModelService(settings, runtime);

    await service.run(DEFAULT_LOCAL_MODEL_ID);
    expect(await service.removeFile(DEFAULT_LOCAL_MODEL_ID)).toBe(true);

    expect(runtime.removed).toEqual([DEFAULT_LOCAL_MODEL_ID]);
    expect(settings.values.get("local_model_wanted_id")).toBeNull();
    const row = (await service.list()).find(({ id }) => id === DEFAULT_LOCAL_MODEL_ID);
    expect(row?.runtime.state).toBe("not-downloaded");

    await service.download(DEFAULT_LOCAL_MODEL_ID);
    expect((await service.list())[0]?.runtime.state).toBe("ready");
  });

  it("asks for a model when the list is empty", async () => {
    const settings = new MemorySettings();
    const service = new LocalModelService(settings, new MemoryRuntime());
    await service.remove(DEFAULT_LOCAL_MODEL_ID);
    await expect(service.requireRunning()).rejects.toThrow(/Turn on a local AI model/);
  });
});
