import { describe, expect, it, vi } from "vitest";
import type { MainHost } from "./main.js";
import { createRunController } from "./run-controller.js";

describe("process running", () => {
  it("toggles from loaded state without reloading the workspace", async () => {
    const refresh = vi.fn();
    const render = vi.fn();
    const setSetting = vi.fn();
    const process = {
      id: "process-1",
      definition: { automation: "automatic" }
    };
    const host = {
      repository: { setSetting },
      shell: { render, showNotice: vi.fn() },
      workspaceController: {
        processes: [process],
        teamItems: [],
        refresh
      }
    } as unknown as MainHost;

    const runs = createRunController(host);
    await runs.setProcessRunning(process.id, true);
    await runs.setProcessRunning(process.id, false);

    expect(setSetting).toHaveBeenCalledWith("running_processes", [process.id]);
    expect(setSetting).toHaveBeenLastCalledWith("running_processes", []);
    expect(render).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });
});
