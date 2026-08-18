import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("sidecar parent lifecycle", () => {
  it("stops after its parent is hard-killed", async () => {
    const lifecycle = pathToFileURL(resolve("flue-runtime/project/parent-lifecycle.mjs")).href;
    const sidecarScript = `import { bindParentLifecycle } from ${JSON.stringify(lifecycle)};
      bindParentLifecycle((code) => process.exit(code));
      setInterval(() => {}, 1000);`;
    const parentScript = `const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(sidecarScript)}], {
        env: { ...process.env, BEES_PARENT_PIPE: "1" },
        stdio: ["pipe", "ignore", "inherit"]
      });
      process.stdout.write(String(child.pid) + "\\n");
      setInterval(() => {}, 1000);`;
    const parent = spawn(
      process.execPath,
      ["--eval", parentScript],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    const [output] = await once(parent.stdout, "data");
    const sidecarPid = Number.parseInt(String(output), 10);

    try {
      expect(sidecarPid).toBeGreaterThan(0);
      process.kill(parent.pid!, "SIGKILL");
      await once(parent, "exit");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          process.kill(sidecarPid, 0);
          await delay(10);
        } catch {
          return;
        }
      }
      throw new Error(`sidecar ${sidecarPid} survived its parent`);
    } finally {
      for (const pid of [parent.pid, sidecarPid]) {
        if (!pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone is the successful path.
        }
      }
    }
  });
});
