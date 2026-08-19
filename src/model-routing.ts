export interface ModelChoice {
  provider: string;
  model: string;
  /** Stable id of a downloaded GGUF, kept with explicit local-model choices. */
  localModelId?: string;
}

export type ModelRoute = "codex" | "claude-cli" | "local" | "api";

/** Discovery owns availability and ordering within a route; this module only applies policy. */
export interface ModelRoutingCandidate {
  choice: ModelChoice;
  route: ModelRoute;
  runnable: boolean;
}

export const AUTO_PROVIDER = "auto";
export const AUTO_BEST_MODEL = "best";
export const AUTO_ALTERNATIVE_MODEL = "alternative";
export const AUTO_MODEL_CHOICE: ModelChoice = { provider: AUTO_PROVIDER, model: AUTO_BEST_MODEL };
export const AUTO_ALTERNATIVE_MODEL_CHOICE: ModelChoice = {
  provider: AUTO_PROVIDER,
  model: AUTO_ALTERNATIVE_MODEL
};
export const DEFAULT_MODEL_CHOICE: ModelChoice = { provider: "bees-local", model: "active" };

const ROUTE_ORDER: Record<ModelRoute, number> = {
  codex: 0,
  "claude-cli": 1,
  local: 2,
  api: 3
};

export function isAutoChoice(config: { provider?: string }): boolean {
  return config.provider?.trim() === AUTO_PROVIDER;
}

/**
 * Best model from each independent runtime/provider comes first, then the remaining models.
 * This makes the alternative useful for comparison while still falling back when only one lane exists.
 */
export function rankedModelChoices(candidates: readonly ModelRoutingCandidate[]): ModelChoice[] {
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.runnable)
    .sort((left, right) =>
      ROUTE_ORDER[left.candidate.route] - ROUTE_ORDER[right.candidate.route] ||
      left.index - right.index
    );
  const primary: ModelChoice[] = [];
  const remaining: ModelChoice[] = [];
  const seen = new Set<string>();
  for (const { candidate } of ordered) {
    const group = candidate.route === "api"
      ? `${candidate.route}:${candidate.choice.provider}`
      : candidate.route;
    (seen.has(group) ? remaining : primary).push(candidate.choice);
    seen.add(group);
  }
  return [...primary, ...remaining];
}

export function preferredModelChoice(candidates: readonly ModelRoutingCandidate[]): ModelChoice {
  return rankedModelChoices(candidates)[0] ?? DEFAULT_MODEL_CHOICE;
}

/** Resolves a standing policy at run admission; pinned choices pass through unchanged. */
export function resolveModelChoice(
  config: { provider?: string; model?: string },
  active: ModelChoice,
  candidates: readonly ModelRoutingCandidate[] = []
): ModelChoice {
  const provider = config.provider?.trim();
  const model = config.model?.trim();
  if (provider === AUTO_PROVIDER) {
    const ranked = rankedModelChoices(candidates);
    const rank = model === AUTO_ALTERNATIVE_MODEL ? 1 : 0;
    return ranked[rank] ?? ranked[0] ?? active;
  }
  return provider && model && !(provider === "bees-local" && model === "active")
    ? { provider, model }
    : active;
}
