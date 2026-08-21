import { invoke } from "@tauri-apps/api/core";

interface DshRuntime {
  baseUrl: string;
  token: string;
}

async function openBees(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#status");
  try {
    const runtime = await invoke<DshRuntime>("ensure_dsh_runtime");
    location.replace(`${runtime.baseUrl}/bees-auth?token=${encodeURIComponent(runtime.token)}`);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

void openBees();
