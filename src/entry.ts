import { invoke } from "@tauri-apps/api/core";

const status = document.querySelector<HTMLElement>("#status");
const retry = document.querySelector<HTMLButtonElement>("#retry");
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
    show("Bees didn't start. Try again, or restart your Mac if it keeps happening.", true);
  } finally {
    starting = false;
  }
}

retry?.addEventListener("click", () => void openBees());
void openBees();
