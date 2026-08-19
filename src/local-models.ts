import { invoke } from "@tauri-apps/api/core";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { CEREBRAS_MODELS } from "@earendil-works/pi-ai/providers/cerebras.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { FIREWORKS_MODELS } from "@earendil-works/pi-ai/providers/fireworks.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GROQ_MODELS } from "@earendil-works/pi-ai/providers/groq.models";
import { MISTRAL_MODELS } from "@earendil-works/pi-ai/providers/mistral.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { TOGETHER_MODELS } from "@earendil-works/pi-ai/providers/together.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import type { ThinkingLevel } from "./domain.js";

/** The only local model the runtime declares: whichever one is loaded. */
export const LOCAL_PROVIDER_MODEL = "bees-local/active";
export const DEFAULT_LOCAL_MODEL_ID = "nanbeige-4-2-3b-q6-k";
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.6-sol";

export const LOCAL_PROVIDER = "bees-local";

/**
 * Providers a run can name. The value is the pi-ai provider id Flue resolves against,
 * which is also the id stored for direct provider connections.
 * A provider that isn't listed still works — the agent dropdown keeps whatever its file
 * already had, and custom models can be added through the assistant model picker.
 */
export const MODEL_PROVIDERS: { id: string; label: string; models: string[] }[] = [
  { id: LOCAL_PROVIDER, label: "Bees local", models: ["active"] },
  {
    id: "anthropic",
    label: "Anthropic",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]
  },
  // Claude Code remains a native agent runtime. Codex uses pi-ai's ChatGPT OAuth provider.
  { id: "claude-cli", label: "Claude Code (CLI)", models: ["default", "sonnet", "opus", "haiku"] },
  {
    id: "openai-codex",
    label: "Codex (ChatGPT)",
    models: [
      DEFAULT_CODEX_MODEL_ID,
      ...Object.keys(OPENAI_CODEX_MODELS).filter((id) => id !== DEFAULT_CODEX_MODEL_ID)
    ]
  },
  // Deliberately short: every id the provider's pi-ai catalog carries works, and custom
  // ids can be added through the assistant model picker.
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    models: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "openai/gpt-5.5", "google/gemini-3.1-pro-preview"]
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    models: ["kimi-k3", "glm-5.2", "deepseek-v4-pro", "qwen3.7-max", "minimax-m3", "grok-4.5"]
  },
  { id: "google", label: "Google Gemini", models: Object.keys(GOOGLE_MODELS) },
  { id: "mistral", label: "Mistral", models: Object.keys(MISTRAL_MODELS) },
  { id: "groq", label: "Groq", models: Object.keys(GROQ_MODELS) },
  { id: "deepseek", label: "DeepSeek", models: Object.keys(DEEPSEEK_MODELS) },
  { id: "xai", label: "xAI", models: Object.keys(XAI_MODELS) },
  { id: "cerebras", label: "Cerebras", models: Object.keys(CEREBRAS_MODELS) },
  { id: "together", label: "Together AI", models: Object.keys(TOGETHER_MODELS) },
  { id: "fireworks", label: "Fireworks AI", models: Object.keys(FIREWORKS_MODELS) },
  // Custom ids are added through the model picker and declared to pi-ai at run time.
  { id: "openai-compatible", label: "OpenAI-compatible", models: [] }
];

const PI_MODEL_CATALOGS = {
  anthropic: ANTHROPIC_MODELS,
  cerebras: CEREBRAS_MODELS,
  deepseek: DEEPSEEK_MODELS,
  fireworks: FIREWORKS_MODELS,
  google: GOOGLE_MODELS,
  groq: GROQ_MODELS,
  mistral: MISTRAL_MODELS,
  "openai-codex": OPENAI_CODEX_MODELS,
  openai: OPENAI_MODELS,
  "opencode-go": OPENCODE_GO_MODELS,
  openrouter: OPENROUTER_MODELS,
  together: TOGETHER_MODELS,
  xai: XAI_MODELS
} as unknown as Record<string, Record<string, Model<Api>>>;

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very High",
  max: "Maximum"
};

export interface ThinkingOption {
  label: string;
  value: "" | ThinkingLevel;
}

/** Pi owns cloud-model capabilities; Bees only describes its local and CLI adapters. */
export function thinkingOptionsForModel(config: { provider?: string; model?: string }): ThinkingOption[] {
  const provider = config.provider?.trim() ?? "";
  const modelId = config.model?.trim() ?? "";
  if (provider === LOCAL_PROVIDER) {
    return [
      { label: "Automatic", value: "" },
      { label: "Off", value: "off" },
      { label: "On", value: "medium" }
    ];
  }
  const cliLevels: Record<string, ThinkingLevel[]> = {
    "claude-cli": ["low", "medium", "high", "xhigh", "max"]
  };
  const piModel = PI_MODEL_CATALOGS[provider]?.[modelId];
  const levels = cliLevels[provider] ??
    (piModel?.reasoning
      ? getSupportedThinkingLevels(piModel) as ThinkingLevel[]
      : []);
  return [
    {
      label: piModel && !piModel.reasoning ? "Automatic (thinking not supported)" : "Automatic",
      value: ""
    },
    ...levels.map((value) => ({ label: THINKING_LABELS[value], value }))
  ];
}

/** The `provider/model` pair Flue hands to pi-ai. Falls back to the local model. */
export function modelRef(config: { provider?: string; model?: string }): string {
  const provider = (config.provider ?? "").trim();
  const model = (config.model ?? "").trim();
  return provider && model ? `${provider}/${model}` : LOCAL_PROVIDER_MODEL;
}

/** Reverse of `modelRef`; model ids may themselves contain slashes. */
export function parseModelRef(value: string): { provider: string; model: string } | null {
  const normalized = value.trim();
  const separator = normalized.indexOf("/");
  return separator > 0 && separator < normalized.length - 1
    ? { provider: normalized.slice(0, separator), model: normalized.slice(separator + 1) }
    : null;
}

export interface LocalModel {
  id: string;
  name: string;
  /** File name inside the managed models directory. Empty for a model the user picked off disk. */
  fileName: string;
  url?: string;
  localPath?: string;
  /** Expected size, 0 until a download reports one. */
  bytes: number;
  sha256?: string;
  chatTemplate?: string;
  sourceUrl?: string;
  licenseName?: string;
  licenseUrl?: string;
  /**
   * Context window in tokens, when an administrator pinned one. Left unset, Bees derives it
   * from the model's own GGUF header and this machine's memory — right on hardware it can
   * measure, wrong on hardware it cannot (a shared inference box, memory that is not the
   * system's, or a deployment that wants a smaller window than it could afford).
   */
  contextSize?: number;
}

/** Best-effort parameter count from common GGUF names such as `70B`, `3b`, or `E2B`. */
export function localModelParameterBillions(model: Pick<LocalModel, "name" | "fileName">): number {
  const matches = [...`${model.name} ${model.fileName}`.matchAll(/(?:^|[^0-9.])(?:[ae])?(\d+(?:\.\d+)?)\s*b(?:\b|_)/gi)];
  return Math.max(0, ...matches.map((match) => Number(match[1])));
}

/**
 * Listed on first launch so a fresh install has something to download without hunting for a URL.
 * Nothing is bundled or fetched on its own — the user downloads and runs it from Settings → Local AI.
 * No `chatTemplate`: the GGUFs carry a usable ChatML template, so llama-server uses that one.
 */
export const SEEDED_MODELS: LocalModel[] = [
  {
    id: DEFAULT_LOCAL_MODEL_ID,
    name: "Nanbeige 4.2 3B (Q6_K)",
    fileName: "Nanbeige4.2-3B-Q6_K.gguf",
    url: "https://huggingface.co/owao/Nanbeige4.2-3B-GGUF/resolve/main/Nanbeige4.2-3B-Q6_K.gguf?download=true",
    bytes: 3_424_947_040,
    sha256: "d9382dbca171ff0c5a31eaef84deb645c8882d6bae2a3eccf57006b6fe16e0df",
    sourceUrl: "https://huggingface.co/owao/Nanbeige4.2-3B-GGUF",
    licenseName: "Apache 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0"
  },
  {
    id: "gemma-4-e2b-it-qat-q4-0",
    name: "Gemma 4 E2B (Q4_0)",
    fileName: "gemma-4-E2B_q4_0-it.gguf",
    url: "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf?download=true",
    bytes: 3_349_516_256,
    sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
    sourceUrl: "https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf",
    licenseName: "Gemma Terms",
    licenseUrl: "https://ai.google.dev/gemma/docs/gemma_4_license"
  },
  {
    id: "qwen3-0-6b-q8-0",
    name: "Qwen3 0.6B (Q8_0)",
    fileName: "Qwen3-0.6B-Q8_0.gguf",
    url: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf?download=true",
    bytes: 639_446_688,
    sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF",
    licenseName: "Apache 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0"
  }
];

export type LocalModelRuntimeState = "not-downloaded" | "downloading" | "ready" | "running";

export interface LocalModelRuntimeStatus {
  modelId: string;
  state: LocalModelRuntimeState;
  downloadedBytes: number;
  totalBytes: number;
  running: boolean;
}

export interface LocalModelProgress {
  modelId: string;
  state: "downloading" | "ready" | "cancelled" | "error";
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface LocalModelView extends LocalModel {
  runtime: LocalModelRuntimeStatus;
}

export interface LocalModelSettingsStore {
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
}

export interface LocalModelPort {
  status(spec: LocalModel): Promise<LocalModelRuntimeStatus>;
  ensure(spec: LocalModel): Promise<LocalModelRuntimeStatus>;
  start(spec: LocalModel): Promise<LocalModelRuntimeStatus>;
  stop(modelId: string): Promise<void>;
  cancelDownload(modelId: string): Promise<void>;
  remove(spec: LocalModel): Promise<void>;
}

export class TauriLocalModelPort implements LocalModelPort {
  status(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    return invoke("local_model_status", { spec });
  }

  ensure(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    return invoke("ensure_local_model", { spec });
  }

  start(spec: LocalModel): Promise<LocalModelRuntimeStatus> {
    return invoke("start_local_model", { spec });
  }

  stop(modelId: string): Promise<void> {
    return invoke("stop_local_model", { modelId });
  }

  cancelDownload(modelId: string): Promise<void> {
    return invoke("cancel_local_model_download", { modelId });
  }

  remove(spec: LocalModel): Promise<void> {
    return invoke("delete_local_model", { spec });
  }
}

const MODELS_KEY = "local_models";
/** Seeds the user deleted. Without it `load` would re-add them on the next launch, forever. */
const REMOVED_SEEDS_KEY = "local_models_removed";
const LAST_RUN_KEY = "local_model_last_run_id";
const WANTED_KEY = "local_model_wanted_id";

/** Turn a URL or a picked file path into a model entry. Throws on anything we can't load. */
export function parseModelSource(source: string): LocalModel {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("Enter a model link or choose a file");
  const isUrl = /^https?:\/\//i.test(trimmed);
  if (!isUrl && !/^(\/|[A-Za-z]:[\\/])/.test(trimmed)) {
    throw new Error("Enter an https:// link to a .gguf file, or choose one from this computer");
  }
  const raw = isUrl
    ? decodeURIComponent(new URL(trimmed).pathname.split("/").pop() ?? "")
    : (trimmed.split(/[\\/]/).pop() ?? "");
  if (!raw.toLowerCase().endsWith(".gguf")) throw new Error("Only .gguf model files are supported");
  const name = raw.slice(0, -".gguf".length);
  if (!isUrl) {
    return { id: crypto.randomUUID(), name, fileName: "", localPath: trimmed, bytes: 0 };
  }
  if (!/^https:\/\//i.test(trimmed)) throw new Error("Model downloads must use an https:// link");
  // The name is joined onto the models directory in Rust, which only accepts a plain .gguf name.
  const fileName = raw.replace(/[^A-Za-z0-9._-]/g, "-").slice(-120);
  return { id: crypto.randomUUID(), name, fileName, url: trimmed, bytes: 0 };
}

export class LocalModelService {
  private models: LocalModel[] = [];
  private lastRunId: string | null = null;
  private wantedId: string | null = null;
  private removedSeeds = new Set<string>();
  private loaded = false;

  constructor(
    private readonly store: LocalModelSettingsStore,
    private readonly port: LocalModelPort
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.store.getSetting<LocalModel[] | null>(MODELS_KEY, null);
    // Seeded rows are a catalog, not user data: the shipped definition always wins, and any seed
    // the stored list has never seen is appended. That way an install made before a model was
    // added still sees it, and one that stored a download link the host has since moved gets the
    // working link instead of a permanent 404. Only rows the user added themselves survive as-is.
    const seeded = new Map(SEEDED_MODELS.map((model) => [model.id, model]));
    const seedFiles = new Set(SEEDED_MODELS.map(({ fileName }) => fileName));
    this.removedSeeds = new Set(await this.store.getSetting<string[]>(REMOVED_SEEDS_KEY, []));
    const refreshed = (stored ?? [])
      // The shipped definition wins on everything the catalog owns, but a pinned context
      // window is the administrator's, not the catalog's, and has to survive the refresh.
      .map((model) => {
        const seed = seeded.get(model.id);
        if (!seed) return model;
        return model.contextSize ? { ...seed, contextSize: model.contextSize } : seed;
      })
      // A row the user added by hand for a file a seed already covers is the same download twice.
      .filter((model) => seeded.has(model.id) || !seedFiles.has(model.fileName));
    const missing = SEEDED_MODELS.filter(
      (seed) => !this.removedSeeds.has(seed.id) && !refreshed.some(({ id }) => id === seed.id)
    );
    this.models = [...refreshed, ...missing];
    this.lastRunId = await this.store.getSetting<string | null>(LAST_RUN_KEY, null);
    this.wantedId = await this.store.getSetting<string | null>(WANTED_KEY, null);
    if (missing.length || JSON.stringify(this.models) !== JSON.stringify(stored)) await this.save();
    this.loaded = true;
  }

  /** The model the user last asked to serve, whether or not it is up yet. */
  get wantedRunId(): string | null {
    return this.wantedId;
  }

  /**
   * Remember that the user turned a model's Run toggle on. A multi-GB download outlives page
   * reloads and app restarts, so the intent has to outlive them too — otherwise a model finishes
   * downloading with nothing left waiting to start it.
   */
  async wantRun(modelId: string | null): Promise<void> {
    this.wantedId = modelId;
    await this.save();
  }

  async list(): Promise<LocalModelView[]> {
    const models = await this.loadedModels();
    return Promise.all(
      models.map(async (model) => ({ ...model, runtime: await this.port.status(model) }))
    );
  }

  async add(source: string): Promise<LocalModel> {
    await this.load();
    const model = parseModelSource(source);
    const duplicate = this.models.find(
      (existing) =>
        (model.url && existing.url === model.url) ||
        (model.fileName && existing.fileName === model.fileName) ||
        (model.localPath && existing.localPath === model.localPath)
    );
    if (duplicate) throw new Error(`${duplicate.name} is already in the list`);
    this.models = [...this.models, model];
    await this.save();
    return model;
  }

  /**
   * Pin this model's context window, or clear the pin and go back to the derived one. Takes
   * effect the next time the model starts: the window is the KV cache llama-server allocates
   * at boot and cannot be resized under a running server.
   */
  async setContextSize(modelId: string, tokens: number | null): Promise<void> {
    await this.load();
    this.models = this.models.map((model) => {
      if (model.id !== modelId) return model;
      if (tokens) return { ...model, contextSize: tokens };
      const { contextSize: _cleared, ...rest } = model;
      return rest;
    });
    await this.save();
  }

  /** Download (or verify) the model's file. Local files are only checked, never copied. */
  async download(modelId: string): Promise<void> {
    const model = this.definition(await this.loadedModels(), modelId);
    const status = await this.port.ensure(model);
    await this.recordSize(modelId, status.totalBytes);
  }

  /** Start the model, downloading it first if needed. Returns true when the runtime changed. */
  async run(modelId: string): Promise<boolean> {
    const model = this.definition(await this.loadedModels(), modelId);
    const running = (await this.port.status(model)).running;
    const active = this.lastRunId === modelId;
    if (!running) {
      const status = await this.port.ensure(model);
      await this.recordSize(modelId, status.totalBytes);
    }
    await this.port.start(this.definition(this.models, modelId));
    this.lastRunId = modelId;
    this.wantedId = modelId;
    await this.save();
    return !running || !active;
  }

  /** Stop a running model, or cancel its download if that is what it is doing. */
  async stop(modelId: string): Promise<boolean> {
    const model = this.definition(await this.loadedModels(), modelId);
    const status = await this.port.status(model);
    await this.port.cancelDownload(modelId);
    await this.port.stop(modelId);
    if (this.wantedId === modelId) await this.wantRun(null);
    return status.running;
  }

  /**
   * Delete the downloaded file but keep the entry, so Download works as a toggle: the row stays in
   * the list ready to be fetched again. Returns true when a running model was stopped.
   */
  async removeFile(modelId: string): Promise<boolean> {
    const model = this.definition(await this.loadedModels(), modelId);
    const running = (await this.port.status(model)).running;
    await this.port.remove(model);
    if (this.wantedId === modelId) this.wantedId = null;
    await this.save();
    return running;
  }

  async remove(modelId: string): Promise<boolean> {
    const running = await this.removeFile(modelId);
    this.models = this.models.filter(({ id }) => id !== modelId);
    if (SEEDED_MODELS.some(({ id }) => id === modelId)) this.removedSeeds.add(modelId);
    if (this.lastRunId === modelId) this.lastRunId = null;
    await this.save();
    return running;
  }

  /** Validate that the user already turned on the selected local model. Never starts one. */
  async requireRunning(modelId?: string): Promise<void> {
    const models = await this.loadedModels();
    const statuses = await Promise.all(models.map((model) => this.port.status(model)));
    if (modelId && modelId !== "active") {
      const index = models.findIndex(({ id }) => id === modelId);
      if (statuses[index]?.running) return;
      throw new Error(
        `Turn on local model "${models[index]?.name ?? modelId}" under Settings → Local AI first.`
      );
    }
    if (statuses.some(({ running }) => running)) return;
    throw new Error("Turn on a local AI model under Settings → Local AI first.");
  }

  isLocalModel(model: string | undefined): boolean {
    return (model || LOCAL_PROVIDER_MODEL).startsWith(`${LOCAL_PROVIDER}/`);
  }

  /** Remember the size a download reported, so the list still shows it after a restart. */
  private async recordSize(modelId: string, bytes: number): Promise<void> {
    const model = this.models.find(({ id }) => id === modelId);
    if (!model || !bytes || model.bytes === bytes) return;
    this.models = this.models.map((entry) =>
      entry.id === modelId ? { ...entry, bytes } : entry
    );
    await this.save();
  }

  private async loadedModels(): Promise<LocalModel[]> {
    await this.load();
    return this.models;
  }

  private definition(models: LocalModel[], modelId: string): LocalModel {
    const model = models.find(({ id }) => id === modelId);
    if (!model) throw new Error(`Unknown local model: ${modelId}`);
    return model;
  }

  private async save(): Promise<void> {
    await this.store.setSetting(MODELS_KEY, this.models);
    await this.store.setSetting(REMOVED_SEEDS_KEY, [...this.removedSeeds]);
    await this.store.setSetting(LAST_RUN_KEY, this.lastRunId);
    await this.store.setSetting(WANTED_KEY, this.wantedId);
  }
}
