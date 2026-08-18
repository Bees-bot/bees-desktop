import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("sidecar parent lifecycle", () => {
  it("stops when the parent pipe closes", async () => {
    const lifecycle = pathToFileURL(resolve("flue-runtime/project/parent-lifecycle.mjs")).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { bindParentLifecycle } from ${JSON.stringify(lifecycle)};
         bindParentLifecycle((code) => process.exit(code));
         setInterval(() => {}, 1000);`
      ],
      {
        env: { ...process.env, BEES_PARENT_PIPE: "1" },
        stdio: ["pipe", "ignore", "inherit"]
      }
    );

    child.stdin.end();
    const [code, signal] = await once(child, "exit");
    expect({ code, signal }).toEqual({ code: 0, signal: null });
  });
});
