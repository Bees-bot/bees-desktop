import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runnerConfig, executionAllowed } from "./runner.mjs";
import { serviceFile } from "./runner-service.mjs";
import { fenced } from "./plugin/lib/data-folder.js";
import { FleetBridge } from "./plugin/lib/fleet-bridge.js";

test("remote continuation reaches the active native run once and rejects ended stages", async () => {
  const commands = [];
  let runs = [{ id: "native-run", workItemId: "item", status: "running" }];
  const bridge = new FleetBridge({ on() {}, effect() {} }, {
    snapshot: async () => ({ runs }), command: async value => { commands.push(value); },
  });
  bridge.item = { id: "item" };
  await Promise.all([bridge.prompt({ requestId: "one", text: "More detail" }), bridge.prompt({ requestId: "one", text: "More detail" })]);
  assert.deepEqual(commands, [{ action: "continue_run", executionId: "native-run", text: "More detail" }]);
  runs = [];
  await assert.rejects(bridge.prompt({ requestId: "two", text: "Late" }), /no longer/);
});

test("remote questions preserve separate answers and stop on cancellation", async () => {
  const handlers = {};
  const request = (value, next) =>
    handlers["user-questions/request"](value, next);
  const bridge = new FleetBridge(
    {
      on: (event, fn) => {
        handlers[event] = fn;
      },
      effect: () => {},
      userQuestions: { ask: (value) => request(value, () => {}) },
    },
    {},
  );
  const pending = request(
    {
      agent: {},
      questions: [
        { id: "one", question: "Which?", options: [{ label: "A" }] },
        { id: "two", question: "When?" },
      ],
    },
    () => {},
  );
  const [{ id }] = bridge.questions().questions;
  assert.throws(
    () => bridge.answer({ questionId: id, text: "A" }),
    /separately/,
  );
  bridge.answer({
    questionId: id,
    answers: [
      { id: "two", text: "Tomorrow" },
      { id: "one", text: "A" },
    ],
  });
  assert.deepEqual(await pending, {
    answers: [
      { id: "one", selected: ["A"], custom: "A" },
      { id: "two", selected: [], custom: "Tomorrow" },
    ],
  });
  assert.throws(
    () => bridge.answer({ questionId: id, text: "Again" }),
    /no longer/,
  );
  const controller = new AbortController(),
    cancelled = request(
      {
        agent: {},
        signal: controller.signal,
        questions: [{ id: "q", question: "Continue?" }],
      },
      () => {},
    );
  controller.abort();
  await assert.rejects(cancelled, /stopped/);
  assert.deepEqual(bridge.questions(), { questions: [] });
  for (const [text, outcome] of [
    ["Approve once", "allowed-once"],
    ["Maybe", "rejected"],
  ]) {
    const pendingApproval = handlers["approval/request"](
      {
        agent: {},
        toolName: "synthetic_action",
        reason: "Review this exact action",
      },
      () => {},
    );
    const [question] = bridge.questions().questions;
    assert.match(question.questions[0].question, /synthetic_action/);
    bridge.answer({ questionId: question.id, text });
    assert.equal(await pendingApproval, outcome);
  }
});

test("local execution requires both the runner and installed desktop permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "bees-runner-test-"));
  try {
    const config = runnerConfig({
      serverUrl: "https://bees.example",
      stateDir: root,
      token: "x".repeat(43),
      allowExecution: true,
      desktopPreferences: join(root, "execution.json"),
    });
    assert(await executionAllowed(config));
    await writeFile(
      config.desktopPreferences,
      JSON.stringify({ allow_local_execution: false }),
    );
    assert.equal(await executionAllowed(config), false);
    await writeFile(
      config.desktopPreferences,
      JSON.stringify({ allow_local_execution: true }),
    );
    assert.equal(
      await executionAllowed({ ...config, allowExecution: false }),
      false,
    );
    assert(await executionAllowed(config));
    await writeFile(config.desktopPreferences, "broken");
    await assert.rejects(executionAllowed(config));
    for (const serverUrl of [
      "http://public.example",
      "https://user:password@bees.example",
      "https://bees.example/path",
    ])
      assert.throws(() => runnerConfig({ ...config, serverUrl }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("runner files are fenced while the current admitted workspace remains readable", () => {
  const keys = [
      "BEES_RUNNER_PRIVATE_ROOT",
      "BEES_DEFAULT_WORKSPACE",
      "BEES_RUNNER_CONFIG",
    ],
    before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.BEES_RUNNER_PRIVATE_ROOT = "/tmp/fleet-private";
    process.env.BEES_RUNNER_CONFIG = "/tmp/fleet-token.json";
    process.env.BEES_DEFAULT_WORKSPACE = "/tmp/fleet-private/current/workspace";
    assert(fenced("/tmp/fleet-token.json"));
    assert(fenced("/tmp/fleet-private/other/credentials"));
    assert(!fenced("/tmp/fleet-private/current/workspace/inputs/doc.txt"));
  } finally {
    for (const key of keys)
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
  }
});
test("service files quote paths and never include the enrollment secret", () => {
  assert.match(serviceFile("darwin", "/tmp/a&b/runner.json"), /a&amp;b/);
  assert.match(serviceFile("linux", "/tmp/a%folder/runner.json"), /a%%folder/);
  assert.throws(() => serviceFile("linux", "relative"));
  assert.throws(() => serviceFile("linux", "/tmp/bad\nExecStart=bad"));
});
