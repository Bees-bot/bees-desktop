// The dashboard assistant: it proposes, the user applies.
//
// Nothing here writes. A turn goes model -> JSON -> `parseTurn` -> `resolveActions`, which
// matches every process and status name against what actually exists right now. The user sees
// the resolved hit list and presses Apply, and only then does `applyActions` call the same
// repository methods the buttons in the UI call. That is the whole safety story: a model that
// answers with nonsense produces an empty or errored preview, never a bad row.
//
// It also means the model never has to see the work items. Bulk intent arrives as a selector
// ("everything in Review"), which we resolve here — so a process with 5,000 items costs the
// same context as one with five, and the preview is exact rather than the model's guess.

import {
  AI_PROVIDER_LABEL,
  type AiConnection,
  type AiProvider
} from "./ai-connections.js";
import { CLI_TOOLS } from "./cli-tools.js";
import type { Agent, Process, WorkItem } from "./domain.js";
import { errorText } from "./domain.js";
import {
  LOCAL_PROVIDER,
  MODEL_PROVIDERS,
  localModelParameterBillions,
  modelRef,
  type LocalModelView
} from "./local-models.js";

/**
 * Name of the bundled agent in `.flue/agents/bees-assistant.ts`. Not "assistant": an older
 * release shipped a bundled agent under that name, and a copy of it is still sitting in the
 * project root of every install made before this one.
 */
export const ASSISTANT_AGENT = "bees-assistant";
export const ASSISTANT_MODEL_KEY = "assistant_model";
/** Model ids the user typed in for a provider that ships no catalog (OpenAI, OpenRouter). */
export const ASSISTANT_EXTRA_MODELS_KEY = "assistant_extra_models";

export interface ModelChoice {
  provider: string;
  model: string;
  /** Stable id of a downloaded GGUF, kept for persisted choices from older releases. */
  localModelId?: string;
}

export const DEFAULT_MODEL_CHOICE: ModelChoice = { provider: LOCAL_PROVIDER, model: "active" };

export const AUTO_PROVIDER = "auto";

/**
 * "Let Bees pick." A stage carrying this is resolved at run time by `preferredModelChoice`
 * against whatever this machine can run right now, so a workflow keeps working on a computer
 * that has a different set of CLIs, keys, and downloaded models than the one it was built on.
 */
export const AUTO_MODEL_CHOICE: ModelChoice = { provider: AUTO_PROVIDER, model: AUTO_PROVIDER };

export function isAutoChoice(config: { provider?: string; model?: string }): boolean {
  return config.provider?.trim() === AUTO_PROVIDER;
}

/**
 * Hex payload between "--" separators: the agent name and a team UUID both contain single
 * dashes, and base64url's alphabet contains one as well — but none of the three ever contains
 * a double dash. Decoded by `modelForInstance` in .flue/models.ts.
 */
export function instanceModelId(
  agentName: string,
  teamId: string,
  choice: ModelChoice
): string {
  const hex = [...new TextEncoder().encode(modelRef(choice))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${agentName}--${hex}--${teamId}`;
}

export function assistantInstanceId(teamId: string, choice: ModelChoice): string {
  return instanceModelId(ASSISTANT_AGENT, teamId, choice);
}

// ---- What the model is allowed to propose ----
// Keep in sync with the INSTRUCTIONS block in .flue/agents/assistant.ts — tests/assistant.test.ts
// fails if the two lists drift apart.

export type AssistantAction =
  | {
      type: "create_process";
      name: string;
      description: string;
      /** In order: the first status starts the work, the last one is terminal. */
      stages: string[];
    }
  | { type: "operate_bees"; goal: string }
  | {
      type: "create_agent";
      name: string;
      purpose: string;
      prompt: string;
      process: string;
      stage: string;
    }
  | { type: "create_item"; process: string; stage: string; title: string; description: string }
  | { type: "move_items"; process: string; fromStage: string; toStage: string };

export const ACTION_TYPES: AssistantAction["type"][] = [
  "create_process",
  "operate_bees",
  "create_agent",
  "create_item",
  "move_items"
];

export interface AssistantTurn {
  reply: string;
  actions: AssistantAction[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/**
 * Small models wrap JSON in fences and in apologies. Rather than fight that with a retry, take
 * the outermost braces and try those — and if there is no usable JSON at all, treat the whole
 * answer as prose. A chatty reply is still a useful reply; it just proposes nothing.
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One action, or null when it is missing a field we would have to invent. */
function parseAction(value: unknown): AssistantAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const process = text(raw.process);
  switch (text(raw.type)) {
    case "create_process": {
      const name = text(raw.name);
      const stages = textList(raw.stages);
      return name && stages.length
        ? { type: "create_process", name, description: text(raw.description), stages }
        : null;
    }
    case "operate_bees": {
      const goal = text(raw.goal);
      return goal ? { type: "operate_bees", goal } : null;
    }
    case "create_agent": {
      const name = text(raw.name);
      const stage = text(raw.stage) || text(raw.triggerStage);
      return name && process && stage
        ? {
            type: "create_agent",
            name,
            purpose: text(raw.purpose) || name,
            prompt: text(raw.prompt) || text(raw.instructions),
            process,
            stage
          }
        : null;
    }
    case "create_item": {
      const title = text(raw.title);
      const stage = text(raw.stage);
      return title && process && stage
        ? { type: "create_item", process, stage, title, description: text(raw.description) }
        : null;
    }
    case "move_items": {
      const fromStage = text(raw.fromStage);
      const toStage = text(raw.toStage);
      return process && fromStage && toStage
        ? { type: "move_items", process, fromStage, toStage }
        : null;
    }
    default:
      return null;
  }
}

export function parseTurn(raw: string): AssistantTurn {
  const parsed = extractJson(raw);
  if (!parsed) return { reply: raw.trim(), actions: [] };
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map(parseAction).filter((action): action is AssistantAction => action !== null)
    : [];
  return { reply: text(parsed.reply) || (actions.length ? "" : raw.trim()), actions };
}

// ---- Resolving names against what exists ----

export interface ResolvedAction {
  action: AssistantAction;
  /** What the user reads on the card. */
  summary: string;
  /** Exactly the items this would change. Empty for creates. */
  items: WorkItem[];
  /** Set when the action names something that does not exist — the card cannot be applied. */
  error?: string;
  processId?: string | undefined;
  stageId?: string | undefined;
  targetStageId?: string | undefined;
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findProcess(processes: Process[], name: string): Process | undefined {
  return processes.find((process) => sameName(process.name, name));
}

function findStage(process: Process, name: string) {
  return process.stages.find((stage) => sameName(stage.name, name));
}

function itemsIn(items: WorkItem[], processId: string, stageId?: string): WorkItem[] {
  return items.filter(
    (item) => item.processId === processId && (!stageId || item.stageId === stageId)
  );
}

function plural(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export function resolveActions(
  actions: AssistantAction[],
  processes: Process[],
  items: WorkItem[]
): ResolvedAction[] {
  return actions.map((action): ResolvedAction => {
    if (action.type === "create_process") {
      return findProcess(processes, action.name)
        ? {
            action,
            summary: `Create process "${action.name}"`,
            items: [],
            error: `A process called "${action.name}" already exists`
          }
        : {
            action,
            summary: `Create process "${action.name}" with statuses: ${action.stages.join(", ")}`,
            items: []
          };
    }

    if (action.type === "operate_bees") {
      return {
        action,
        summary: `Operate Bees: ${action.goal}`,
        items: []
      };
    }

    const process = findProcess(processes, action.process);
    if (!process) {
      return {
        action,
        summary: `Process "${action.process}"`,
        items: [],
        error: `No process called "${action.process}"`
      };
    }

    if (action.type === "create_agent") {
      const stage = findStage(process, action.stage);
      return {
        action,
        summary: `Create agent "${action.name}", running on "${action.stage}" in ${process.name}`,
        items: [],
        processId: process.id,
        stageId: stage?.id,
        ...(stage ? {} : { error: `"${action.stage}" is not a status of ${process.name}` })
      };
    }

    if (action.type === "create_item") {
      const stage = findStage(process, action.stage);
      return {
        action,
        summary: `Add "${action.title}" to "${action.stage}" in ${process.name}`,
        items: [],
        processId: process.id,
        stageId: stage?.id,
        ...(stage ? {} : { error: `"${action.stage}" is not a status of ${process.name}` })
      };
    }

    if (action.type === "move_items") {
      const from = findStage(process, action.fromStage);
      const to = findStage(process, action.toStage);
      const missing = !from ? action.fromStage : !to ? action.toStage : "";
      const hits = from ? itemsIn(items, process.id, from.id) : [];
      return {
        action,
        summary: `Move ${plural(hits.length)} from "${action.fromStage}" to "${action.toStage}" in ${process.name}`,
        items: hits,
        processId: process.id,
        stageId: from?.id,
        targetStageId: to?.id,
        ...(missing ? { error: `"${missing}" is not a status of ${process.name}` } : {})
      };
    }

    return { action, summary: "Unsupported action", items: [], error: "Unsupported action" };
  });
}

export function applicable(resolved: ResolvedAction[]): ResolvedAction[] {
  return resolved.filter(
    (entry) =>
      !entry.error &&
      (entry.items.length > 0 ||
        entry.action.type.startsWith("create_") ||
        entry.action.type === "operate_bees")
  );
}

// ---- Applying ----

/** The slice of the repository the assistant writes through. Every call is one the UI already makes. */
export interface AssistantRepository {
  createProcess(
    teamId: string,
    input: { name: string; description?: string; stages: Array<{ name: string; isTerminal: boolean }> }
  ): Promise<string>;
  createWorkItem(
    processId: string,
    input: { stageId: string; title: string; description?: string }
  ): Promise<string>;
}

export interface ApplyContext {
  repository: AssistantRepository;
  teamId: string;
  moveWorkItem?(id: string, stageId: string): Promise<void>;
  /** Runs only after Apply; the desktop app drives its own visible semantic controls. */
  operateBees(goal: string): Promise<void>;
  /** Agents are files in the team folder, not rows — main.ts owns that write and the restart. */
  saveAgent(input: {
    name: string;
    purpose: string;
    prompt: string;
    triggerStageId: string;
  }): Promise<void>;
}

/**
 * Applies what the user approved, one action at a time. A failing action is reported and the
 * rest still run: a half-applied batch the user can see beats an all-or-nothing rollback we
 * would have to invent, since every action here is individually undoable from the UI.
 */
export async function applyActions(
  resolved: ResolvedAction[],
  context: ApplyContext
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;
  for (const entry of applicable(resolved)) {
    const { action } = entry;
    try {
      if (action.type === "operate_bees") {
        await context.operateBees(action.goal);
      } else if (action.type === "create_process") {
        await context.repository.createProcess(context.teamId, {
          name: action.name,
          description: action.description,
          stages: action.stages.map((name, index) => ({
            name,
            isTerminal: index === action.stages.length - 1
          }))
        });
      } else if (action.type === "create_agent") {
        await context.saveAgent({
          name: action.name,
          purpose: action.purpose,
          prompt: action.prompt,
          triggerStageId: entry.stageId!
        });
      } else if (action.type === "create_item") {
        await context.repository.createWorkItem(entry.processId!, {
          stageId: entry.stageId!,
          title: action.title,
          description: action.description
        });
      } else if (action.type === "move_items") {
        if (!context.moveWorkItem) throw new Error("The workflow runtime is unavailable");
        for (const item of entry.items) {
          await context.moveWorkItem(item.id, entry.targetStageId!);
        }
      }
      applied += 1;
    } catch (error) {
      errors.push(`${entry.summary}: ${errorText(error)}`);
    }
  }
  return { applied, errors };
}

// ---- Approved semantic UI control ----

export type BeesUiCommand =
  | { op: "click"; ref: string }
  | { op: "fill"; ref: string; value: string }
  | { op: "select"; ref: string; value: string }
  | { op: "toggle"; ref: string; checked: boolean }
  | { op: "wait"; milliseconds: number }
  | { op: "finish"; message: string };

/**
 * The dashboard model gets no host tools. After Apply, it emits one constrained command at a
 * time; the renderer resolves opaque refs against the latest visible Bees UI snapshot.
 */
export function parseBeesUiCommand(raw: string): BeesUiCommand | null {
  const parsed = extractJson(raw);
  const value = parsed?.command;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  const op = text(command.op);
  const ref = text(command.ref);
  if (op === "click" && ref) return { op, ref };
  if (op === "fill" && ref && typeof command.value === "string") {
    return { op, ref, value: command.value };
  }
  if (op === "select" && ref && typeof command.value === "string") {
    return { op, ref, value: command.value };
  }
  if (op === "toggle" && ref && typeof command.checked === "boolean") {
    return { op, ref, checked: command.checked };
  }
  if (op === "wait" && typeof command.milliseconds === "number") {
    return {
      op,
      milliseconds: Math.max(100, Math.min(5_000, Math.round(command.milliseconds)))
    };
  }
  if (op === "finish") return { op, message: text(command.message) || "Done." };
  return null;
}

// ---- Context sent to the model ----

export interface AssistantContext {
  processes: Process[];
  items: WorkItem[];
  agents: Agent[];
  /** What the user is looking at, so "this process" resolves without them naming it. */
  viewing?: string | undefined;
}

/**
 * The whole picture of the team in a few hundred tokens: names and counts only. Work items
 * never appear — that is what selectors are for, and the local default only has 8k of context.
 */
export function contextPrompt(context: AssistantContext): string {
  const lines = context.processes.map((process) => {
    const count = context.items.filter(({ processId }) => processId === process.id).length;
    const wired = context.agents
      .filter((agent) =>
        process.stages.some(({ id }) => id === agent.triggerStageId)
      )
      .map((agent) => {
        const stage = process.stages.find(({ id }) => id === agent.triggerStageId);
        return `${agent.name} (runs on "${stage?.name}")`;
      });
    const statuses = process.stages.map(({ name }) => `"${name}"`).join(", ");
    return [
      `- Process "${process.name}" — statuses: ${statuses}; ${plural(count)}`,
      wired.length ? `  agents: ${wired.join(", ")}` : "  agents: none"
    ].join("\n");
  });
  return [
    lines.length ? `Processes in this team:\n${lines.join("\n")}` : "This team has no processes yet.",
    context.viewing ? `The user is currently looking at ${context.viewing}.` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function turnPrompt(message: string, context: AssistantContext): string {
  return `${contextPrompt(context)}\n\nUser: ${message}`;
}

// ---- The model picker ----

export interface ModelOption {
  group: string;
  label: string;
  choice: ModelChoice;
  /** Shown in small text on the row — why it is or is not instant. */
  note?: string;
}

export function sameChoice(left: ModelChoice, right: ModelChoice): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.localModelId ?? "") === (right.localModelId ?? "")
  );
}

/**
 * Everything this machine can actually run right now: downloaded local models, models from
 * providers with a stored key, and CLIs that are installed. Anything the user typed in for a
 * provider that ships no catalog (OpenAI, OpenRouter) rides along in `extras`.
 */
export function modelCatalog(input: {
  local: LocalModelView[];
  connections: AiConnection[];
  /** Keyed by CLI tool id. Missing, or switched off by hand, means runs cannot use it. */
  cliInstalled: Record<string, { enabled?: boolean } | undefined>;
  extras: ModelChoice[];
}): ModelOption[] {
  const options: ModelOption[] = [];

  const local = input.local
    .filter(({ runtime }) => runtime.state !== "not-downloaded" && runtime.state !== "downloading")
    .sort(
      (left, right) =>
        localModelParameterBillions(right) - localModelParameterBillions(left) ||
        right.bytes - left.bytes
    );
  for (const model of local) {
    options.push({
      group: "On this computer",
      label: model.name,
      choice: { provider: LOCAL_PROVIDER, model: model.id, localModelId: model.id },
      note: model.runtime.running ? "running" : "not running"
    });
  }

  const connected = new Set(input.connections.map(({ provider }) => provider));
  for (const provider of MODEL_PROVIDERS) {
    if (provider.id === LOCAL_PROVIDER || !connected.has(provider.id as AiConnection["provider"]))
      continue;
    for (const model of provider.models) {
      options.push({
        group: AI_PROVIDER_LABEL[provider.id as AiConnection["provider"]] ?? provider.label,
        label: model,
        choice: { provider: provider.id, model }
      });
    }
  }

  for (const tool of CLI_TOOLS) {
    if (!input.cliInstalled[tool.id]?.enabled) continue;
    const models = MODEL_PROVIDERS.find(({ id }) => id === tool.provider)?.models ?? ["default"];
    for (const model of models) {
      options.push({ group: tool.label, label: model, choice: { provider: tool.provider, model } });
    }
  }

  for (const extra of input.extras) {
    if (options.some((option) => sameChoice(option.choice, extra))) continue;
    const provider = MODEL_PROVIDERS.find(({ id }) => id === extra.provider);
    options.push({
      group: provider?.label ?? extra.provider,
      label: extra.model,
      choice: extra
    });
  }

  return options;
}

/**
 * What "Auto" means, and the first-run default: Codex, then Claude Code, then any other agent
 * CLI installed here, then the biggest downloaded local model, then the biggest remote one.
 * `modelCatalog` already lists local models largest-first and each provider's own models
 * largest-first, so "first match wins" is the size order without a second sort.
 */
export function preferredModelChoice(catalog: ModelOption[]): ModelChoice {
  const isCli = (provider: string): boolean => CLI_TOOLS.some((tool) => tool.provider === provider);
  return (
    catalog.find(({ choice }) => choice.provider === "codex-cli" && choice.model === "default")
      ?.choice ??
    catalog.find(({ choice }) => choice.provider === "claude-cli" && choice.model === "default")
      ?.choice ??
    catalog.find(({ choice }) => isCli(choice.provider))?.choice ??
    catalog.find(({ choice }) => choice.provider === LOCAL_PROVIDER)?.choice ??
    catalog.find(({ choice }) => !isCli(choice.provider) && choice.provider !== LOCAL_PROVIDER)
      ?.choice ??
    DEFAULT_MODEL_CHOICE
  );
}

/**
 * Missing models and `bees-local/active` follow the user's current global choice; `auto/auto`
 * follows this machine's catalog instead, falling back to the global choice when nothing is
 * installed yet.
 */
export function resolveModelChoice(
  config: { provider?: string; model?: string },
  active: ModelChoice,
  catalog: ModelOption[] = []
): ModelChoice {
  const provider = config.provider?.trim();
  const model = config.model?.trim();
  if (provider === AUTO_PROVIDER)
    return catalog.length ? preferredModelChoice(catalog) : active;
  return provider && model && !(provider === LOCAL_PROVIDER && model === "active")
    ? { provider, model }
    : active;
}

export interface MachineModelAvailability {
  localModelIds: readonly string[];
  connectedProviders: readonly string[];
  cliProviders: readonly string[];
}

/** The one ineligibility the user chose, so callers can tell it from a real problem. */
export const DISABLED_ON_THIS_MACHINE = "Disabled on this machine";

export interface EffectiveAgentEligibility {
  active: boolean;
  reason: string;
  model: ModelChoice;
}

/**
 * Whether an agent can accept new work on this machine. Cloud connections and CLI installs prove
 * the local route exists; the provider still has final say on account access to a named model.
 */
export function effectiveAgentEligibility(
  agent: Pick<Agent, "name" | "config">,
  activeModel: ModelChoice,
  enabledOnMachine: boolean,
  availability: MachineModelAvailability,
  catalog: ModelOption[] = []
): EffectiveAgentEligibility {
  const model = resolveModelChoice(agent.config, activeModel, catalog);
  if (!enabledOnMachine) return { active: false, reason: DISABLED_ON_THIS_MACHINE, model };

  if (model.provider === LOCAL_PROVIDER) {
    const running =
      model.model === "active"
        ? availability.localModelIds.length > 0
        : availability.localModelIds.includes(model.model);
    return running
      ? { active: true, reason: "Enabled on this machine", model }
      : {
          active: false,
          reason: `Local model "${model.model}" is not running on this machine`,
          model
        };
  }

  const cli = CLI_TOOLS.find(({ provider }) => provider === model.provider);
  if (cli && !availability.cliProviders.includes(model.provider)) {
    return {
      active: false,
      reason: `${cli.label} is not installed on this machine`,
      model
    };
  }

  const cloudLabel =
    model.provider in AI_PROVIDER_LABEL
      ? AI_PROVIDER_LABEL[model.provider as AiProvider]
      : undefined;
  if (cloudLabel && !availability.connectedProviders.includes(model.provider)) {
    return {
      active: false,
      reason: `Connect ${cloudLabel} on this machine`,
      model
    };
  }

  return { active: true, reason: "Enabled on this machine", model };
}

export function modelLabel(choice: ModelChoice, catalog: ModelOption[]): string {
  return catalog.find((option) => sameChoice(option.choice, choice))?.label ?? modelRef(choice);
}
