import { describe, expect, it } from "vitest";
import {
  AUTO_ALTERNATIVE_MODEL_CHOICE,
  AUTO_MODEL_CHOICE,
  rankedModelChoices,
  resolveModelChoice,
  type ModelRoutingCandidate
} from "../src/model-routing.js";

const candidate = (
  provider: string,
  model: string,
  route: ModelRoutingCandidate["route"],
  runnable = true
): ModelRoutingCandidate => ({ choice: { provider, model }, route, runnable });

describe("model routing", () => {
  it("ranks runnable provider lanes and keeps the alternative independent", () => {
    const candidates = [
      candidate("bees-local", "large-70b", "local"),
      candidate("bees-local", "small-3b", "local"),
      candidate("anthropic", "opus", "api"),
      candidate("anthropic", "sonnet", "api"),
      candidate("openai", "gpt", "api"),
      candidate("claude-cli", "default", "claude-cli"),
      candidate("openai-codex", "best", "codex")
    ];

    expect(rankedModelChoices(candidates)).toEqual([
      { provider: "openai-codex", model: "best" },
      { provider: "claude-cli", model: "default" },
      { provider: "bees-local", model: "large-70b" },
      { provider: "anthropic", model: "opus" },
      { provider: "openai", model: "gpt" },
      { provider: "bees-local", model: "small-3b" },
      { provider: "anthropic", model: "sonnet" }
    ]);
    expect(resolveModelChoice(AUTO_MODEL_CHOICE, candidates[0]!.choice, candidates)).toEqual(
      candidates[6]!.choice
    );
    expect(resolveModelChoice(AUTO_ALTERNATIVE_MODEL_CHOICE, candidates[0]!.choice, candidates)).toEqual(
      candidates[5]!.choice
    );
  });

  it("skips stopped models and lets the alternative fall back to the only runnable model", () => {
    const fallback = { provider: "bees-local", model: "active" };
    const candidates = [
      candidate("bees-local", "stopped-70b", "local", false),
      candidate("anthropic", "opus", "api")
    ];

    expect(resolveModelChoice(AUTO_MODEL_CHOICE, fallback, candidates)).toEqual(candidates[1]!.choice);
    expect(resolveModelChoice(AUTO_ALTERNATIVE_MODEL_CHOICE, fallback, candidates)).toEqual(
      candidates[1]!.choice
    );
  });
});
