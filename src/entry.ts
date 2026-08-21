import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

interface WorkspaceRow {
  organizationId?: string;
  teamId?: string;
}

async function openDsh(): Promise<void> {
  const rows = await invoke<WorkspaceRow[]>("db_query", {
    statement: {
      sql: `SELECT o.id AS organizationId, COALESCE(t.id, '') AS teamId
              FROM organizations o
              LEFT JOIN teams t ON t.organization_id = o.id AND t.archived_at IS NULL
             ORDER BY o.created_at, t.created_at LIMIT 1`,
      params: []
    }
  }).catch(() => []);
  const workspace = rows[0];
  const runtime = await invoke<{ baseUrl: string; token: string }>("ensure_dsh_runtime", {
    organizationId: workspace?.organizationId ?? "",
    teamId: workspace?.teamId ?? ""
  });
  location.assign(`${runtime.baseUrl}/bees-auth?token=${encodeURIComponent(runtime.token)}`);
}

async function boot(): Promise<void> {
  const dsh = document.querySelector<HTMLButtonElement>("#dsh-conversations");
  if (dsh) {
    dsh.hidden = false;
    dsh.addEventListener("click", () => {
      dsh.disabled = true;
      void openDsh().catch((error: unknown) => {
        dsh.disabled = false;
        dsh.title = error instanceof Error ? error.message : String(error);
      });
    });
  }
  await import("./main.js");
}

void boot().catch((error: unknown) => {
  document.body.textContent = error instanceof Error ? error.message : String(error);
});
