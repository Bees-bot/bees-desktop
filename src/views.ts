/** Tabs inside a kanban card's inline detail panel — see `renderBoard` in app-views.ts. */
export type BoardItemTab = "details" | "approval" | "conversation" | "files";

export type View =
  | "overview"
  | "inbox"
  | "board"
  // One process, three pages: its board (above), its definition and agents, its past runs.
  | "process"
  | "process-runs"
  | "process-library"
  | "item"
  | "item-new"
  | "runs"
  | "run"
  | "schedules"
  | "settings"
  | "org-settings"
  | "preferences"
  | "getting-started";

/**
 * The views worth reopening the app on. Everything else — one item, one run, one process editor —
 * hangs off an id held only in memory, so restoring it would land on a page about nothing. These
 * rebuild from the persisted workspace alone.
 */
export const RESTORABLE_VIEWS = new Set<View>([
  "overview",
  "inbox",
  "board",
  "runs",
  "process-library",
  "settings",
  "org-settings",
  "preferences",
  "getting-started"
]);

export const LAST_VIEW_KEY = "ui_last_view";

/**
 * Where a launch opens. Nothing stored means a first launch, and an empty board teaches a new user
 * nothing, so it starts on Getting Started. A stored view that is no longer restorable — renamed
 * or retired by a later build — falls back to the overview rather than the first-run page.
 */
export function startupView(stored: string): View {
  if (!stored) return "getting-started";
  return RESTORABLE_VIEWS.has(stored as View) ? (stored as View) : "overview";
}
