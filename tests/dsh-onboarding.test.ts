import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Runtime JavaScript.
import { onboardingAiKey, onboardingProgress, planningAgents, starterDescription, GettingStarted } from "../dsh-runtime/plugin/client/getting-started.js";
// @ts-expect-error Runtime JavaScript.
import { configureRuntime } from "../dsh-runtime/plugin/client/runtime.js";
// @ts-expect-error Runtime JavaScript.
import { testOnboardingModel, testPlanningModels } from "../dsh-runtime/plugin/lib/onboarding.js";

const require = createRequire(new URL("../dsh-runtime/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const data = { teams: [{ id: "team" }], locations: [], items: [], runs: [] };

describe("Getting started", () => {
  it("shows both Work agents and invalidates the test when either AI or team changes", () => {
    configureRuntime((id: string) => id === "react" ? React : {});
    const snapshot = { ...data, systemDefaultModel: { provider: "local", model: "active" },
      processes: [{ id: "goals", workspaceId: "workspace", kind: "goals" }],
      stages: [{ id: "work", processId: "goals", position: 0, agentIds: ["worker", "reviewer"] }],
      assignments: [{ id: "worker", model: null, enabled: true }, { id: "reviewer", model: null, enabled: true }] };
    expect(planningAgents(snapshot, "workspace").map((agent: any) => agent.id)).toEqual(["worker", "reviewer"]);
    const key = onboardingAiKey(snapshot, "workspace", {});
    expect(onboardingAiKey(snapshot, "another-team", {})).not.toBe(key);
    expect(onboardingAiKey({ ...snapshot, assignments: [snapshot.assignments[0],
      { ...snapshot.assignments[1], model: "other/model" }] }, "workspace", {})).not.toBe(key);
    const html = renderToStaticMarkup(React.createElement(GettingStarted, {
      data: snapshot, parts: { teamId: "team", workspaceId: "workspace" }, state: { step: 1 },
      update: vi.fn(), aiReady: false, busy: false
    }));
    expect(html).toContain("Planner and executor");
    expect(html).toContain("Plan and result reviewer");
    expect(html).toContain("One model is enough");
    expect(html.match(/Change AI \(optional\)/g)).toHaveLength(2);
    expect(starterDescription("Make a brief", "sample")).toContain("then execute");
  });

  it("uses real setup state and requires a completed task with an output", () => {
    expect(onboardingProgress(data, "team", {}, false)).toEqual([true, false, false, false]);
    const snapshot = { ...data, locations: [{ id: "file", teamId: "other", mapped: true }],
      items: [{ id: "first", runtimePhase: "failed" }], runs: [{ workItemId: "first", outputs: ["result.md"] }] };
    expect(onboardingProgress(snapshot, "team", { workItemId: "first" }, true)).toEqual([true, true, false, false]);
    snapshot.items[0]!.runtimePhase = "completed";
    expect(onboardingProgress(snapshot, "team", { workItemId: "first", filesChoice: "sample" }, true)).toEqual([true, true, true, true]);
    snapshot.items[0]!.runtimePhase = "cancelled";
    expect(onboardingProgress(snapshot, "team", { workItemId: "first" }, true)[3]).toBe(false);
  });

  it("includes sample context only when selected or no file decision was made", () => {
    expect(starterDescription("Make a plan", "sample")).toContain("repair café");
    expect(starterDescription("Make a plan", "")).toContain("repair café");
    expect(starterDescription("Review my files", "none")).not.toContain("repair café");
    expect(starterDescription("Review my files", "none")).toContain("outputs/first-result.md");
  });

  it("renders all four steps, gates starting on a tested AI, and resumes an existing task", () => {
    configureRuntime((id: string) => id === "react" ? React : {});
    const props = { data, parts: { teamId: "team" }, state: { step: 3 }, update: vi.fn(),
      aiReady: false, aiStatus: "Not tested", busy: false, go: vi.fn(), start: vi.fn(), navigate: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(GettingStarted, props));
    expect(html).toContain("✓ Complete");
    expect(html).toContain("2 of 4");
    expect(html).toContain("Create your first result");
    expect(html).toMatch(/disabled="">Create my first result/);
    const resumed = renderToStaticMarkup(React.createElement(GettingStarted, { ...props,
      data: { ...data, items: [{ id: "first" }] }, state: { step: 3, workItemId: "first" } }));
    expect(resumed).toContain("Open first task");
    expect(resumed).not.toContain("Create my first result");
  });
});

describe("AI connection probe", () => {
  const context = (chunks: any[]) => ({ agentDefaultModel: { currentSelection: () => ({ provider: "local", model: "active" }) },
    llm: { stream: vi.fn(async function* () { yield* chunks; }) } });
  it("only succeeds after an actual text response and a terminal event", async () => {
    const ctx = context([{ type: "text-delta", text: "Hello" }, { type: "finish", reason: { kind: "stop" } }]);
    await expect(testOnboardingModel(ctx)).resolves.toEqual({ provider: "local", model: "active" });
    expect(ctx.llm.stream).toHaveBeenCalledWith(expect.objectContaining({ tools: [], signal: expect.any(AbortSignal) }));
    await expect(testOnboardingModel(context([{ type: "text-delta", text: "Hello" }]))).rejects.toThrow("did not return");
    await expect(testOnboardingModel(context([{ type: "finish", reason: { kind: "stop" } }]))).rejects.toThrow("did not return");
  });
  it("reports authentication errors instead of treating an advertised model as ready", async () => {
    await expect(testOnboardingModel(context([{ type: "finish", reason: { kind: "error", failure: { message: "Sign in again" } } }]))).rejects.toThrow("Sign in again");
  });
  it("tests a shared model once and never probes an unselected provider", async () => {
    const ctx = context([{ type: "text-delta", text: "Hello" }, { type: "finish", reason: { kind: "stop" } }]);
    await expect(testPlanningModels(ctx, { reviewerModel: "local/active" })).resolves.toMatchObject({
      plannerModel: "local/active", reviewerModel: "local/active", fallback: false
    });
    expect(ctx.llm.stream).toHaveBeenCalledTimes(1);
    expect(ctx.llm.stream).toHaveBeenCalledWith(expect.objectContaining({ provider: "local", model: "active" }));
  });
  it("deduplicates resolved aliases and tests distinct reviewer models", async () => {
    const ctx: any = context([{ type: "text-delta", text: "Hello" }, { type: "finish", reason: { kind: "stop" } }]);
    ctx.llm.listModels = async () => [{ id: "gpt-5.6-sol" }];
    await expect(testPlanningModels(ctx, { plannerModel: "openai-codex/__bees_latest_sol__", reviewerModel: "openai-codex/gpt-5.6-sol" }))
      .resolves.toMatchObject({ fallback: false });
    expect(ctx.llm.stream).toHaveBeenCalledTimes(1);
    ctx.llm.stream.mockClear();
    await expect(testPlanningModels(ctx, { reviewerModel: "other/reviewer" })).resolves.toMatchObject({
      plannerModel: "local/active", reviewerModel: "other/reviewer", fallback: false
    });
    expect(ctx.llm.stream).toHaveBeenCalledTimes(2);
  });
  it("falls back to the working lead model and still rejects a broken lead", async () => {
    const ctx = context([]);
    ctx.llm.stream = vi.fn(async function* (options: any) {
      if (options.provider === "broken") throw new Error("Sign in again");
      yield { type: "text-delta", text: "Hello" };
      yield { type: "finish", reason: { kind: "stop" } };
    }) as any;
    await expect(testPlanningModels(ctx, { reviewerModel: "broken/reviewer" })).resolves.toMatchObject({
      reviewerModel: "local/active", fallback: true
    });
    await expect(testPlanningModels(ctx, { plannerModel: "broken/lead" })).rejects.toThrow("Sign in again");
  });
});

it("recommends only models within memory and disk budgets, preferring installed models", () => {
  let plugin: any;
  runInNewContext(readFileSync(new URL("../dsh-runtime/plugins/local-ai/lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load: ({ factory }: any) => { plugin = factory(() => React); } } }
  });
  const gib = 1024 ** 3;
  const hardware = { totalMemory: 16 * gib, availableMemory: 10 * gib, availableDisk: 20 * gib };
  const pick = (specs: any, statuses = {}) => plugin.recommendedLocalModel(specs, plugin.LOCAL_MODELS, statuses);
  expect(pick(hardware).id).toBe(plugin.DEFAULT_LOCAL_MODEL.id);
  expect(pick({ ...hardware, availableMemory: gib })).toBeNull();
  expect(pick({ ...hardware, availableDisk: null })).toBeNull();
  const installed = plugin.LOCAL_MODELS[1];
  expect(pick({ ...hardware, availableDisk: 0 }, { [installed.id]: { state: "ready" } }).id).toBe(installed.id);
});
