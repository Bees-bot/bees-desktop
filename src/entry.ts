import { invoke } from "@tauri-apps/api/core";

async function openBees(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#status");
  try {
    await invoke("ensure_dsh_runtime");
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

void openBees();
