import { invoke } from "@tauri-apps/api/core";

const status = document.querySelector<HTMLElement>("#status");
const retry = document.querySelector<HTMLButtonElement>("#retry");
const starting = status?.textContent ?? "";

async function openBees(): Promise<void> {
  if (retry) retry.hidden = true;
  if (status) status.textContent = starting;
  try {
    await invoke("ensure_dsh_runtime");
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
    // Without this the only way out of a failed start is quitting the app.
    if (retry) retry.hidden = false;
  }
}

retry?.addEventListener("click", () => void openBees());
void openBees();
