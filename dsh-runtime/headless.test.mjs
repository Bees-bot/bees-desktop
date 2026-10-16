import assert from "node:assert/strict";
import { test } from "node:test";
import { launchConfig } from "./headless.mjs";
import { LocalMemory } from "./plugin/lib/local-memory.js";
import { apply as freeAI } from "./plugins/free-ai/lib/index.js";

test("headless configuration validates paths, network binding and credentials before startup", () => {
  const env = { BEES_DSH_TOKEN: "a".repeat(64) }, config = { stateDir: "/tmp/bees-config-test" };
  assert.deepEqual(launchConfig(config, env), { ...config, host: "127.0.0.1", port: 8080,
    temporalBinary: "temporal", token: env.BEES_DSH_TOKEN });
  for (const value of [null, [], { stateDir: "/" }, { stateDir: "relative" }, { ...config, typo: true },
    { ...config, port: 1.5 }, { ...config, port: 0 }, { ...config, port: 65536 },
    { ...config, host: "example.com" }, { ...config, temporalBinary: "" }])
    assert.throws(() => launchConfig(value, env));
  for (const token of [undefined, "short", "a".repeat(32) + "\n"])
    assert.throws(() => launchConfig(config, { BEES_DSH_TOKEN: token }), /BEES_DSH_TOKEN/);
});

test("headless memory skips the desktop installer", () => {
  const previous = process.env.BEES_HEADLESS;
  process.env.BEES_HEADLESS = "1";
  try {
    const memory = new LocalMemory({}, {}, "/unused", {});
    memory.launch = () => assert.fail("Must not install local memory in a cloud runner");
    memory.ensure();
    assert.equal(memory.pending, undefined);
    assert.equal(memory.status, "Local memory is disabled in headless mode");
  } finally {
    if (previous === undefined) delete process.env.BEES_HEADLESS;
    else process.env.BEES_HEADLESS = previous;
  }
});

test("fleet jobs never start the embedded free-model server", async () => {
  const previous=process.env.BEES_FLEET_JOB;process.env.BEES_FLEET_JOB='fixture';
  try {await freeAI({});}
  finally {if(previous===undefined)delete process.env.BEES_FLEET_JOB;else process.env.BEES_FLEET_JOB=previous;}
});
