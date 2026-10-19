import { invoke } from "@tauri-apps/api/core";

const status = document.querySelector<HTMLElement>("#status");
const retry = document.querySelector<HTMLButtonElement>("#retry");
const execution = document.querySelector<HTMLFormElement>("#execution");
interface ExecutionPreferences {mode: string; cloud_url: string; allow_local_execution: boolean;}
const SLOW_AFTER_MS = 45_000;
let starting = false;
let slowTimer: number | undefined;

function show(text: string, offerRetry: boolean): void {
  if (status) status.textContent = text;
  if (retry) retry.hidden = !offerRetry;
}

function waitForStart(): void {
  window.clearTimeout(slowTimer);
  show("Starting Bees...", false);
  slowTimer = window.setTimeout(() => show("Still starting. This can take a minute the first time.", true), SLOW_AFTER_MS);
}

async function openBees(): Promise<void> {
  waitForStart();
  // a second invoke would queue behind the running start on the runtime lock, so retry just waits again
  if (starting) return;
  starting = true;
  try {
    await invoke("ensure_dsh_runtime");
    window.clearTimeout(slowTimer);
  } catch (error) {
    window.clearTimeout(slowTimer);
    console.error("Bees runtime failed to start:", error instanceof Error ? error.message : String(error));
    show(`Bees didn't start. ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    starting = false;
  }
}

retry?.addEventListener("click", () => void start());
async function start(): Promise<void> {
  try {
    const preferences = await invoke<ExecutionPreferences>("execution_preferences");
    if (preferences.mode === "cloud") { await invoke("open_cloud"); return; }
    if (preferences.mode === "local") { await openBees(); return; }
    show("Choose your execution location", false);
    document.querySelector<HTMLInputElement>("#cloud-url")!.value = preferences.cloud_url;
    document.querySelector<HTMLInputElement>("#allow-local")!.checked = preferences.allow_local_execution;
    if (execution) execution.hidden = false;
  } catch { show("Could not load execution settings. Try again.", true); }
}
execution?.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const mode = new FormData(execution).get("mode") as string;
      const cloud_url = document.querySelector<HTMLInputElement>("#cloud-url")!.value;
      const allow_local_execution = document.querySelector<HTMLInputElement>("#allow-local")!.checked;
      await invoke("set_execution_preferences", { preferences: { mode, cloud_url, allow_local_execution } });
      execution.hidden = true;
      if (mode === "cloud") await invoke("open_cloud"); else await openBees();
    } catch (error) { show(String(error), false); execution.hidden = false; }
  })();
});
execution?.addEventListener("change", () => {
  if (new FormData(execution).get("mode") === "local") document.querySelector<HTMLInputElement>("#allow-local")!.checked = true;
});
void start();
