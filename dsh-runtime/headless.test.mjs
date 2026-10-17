import assert from "node:assert/strict";
import { test } from "node:test";
import { launchConfig } from "./headless.mjs";

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
