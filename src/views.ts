/** Tabs inside a kanban card's inline detail panel — see `renderBoard` in app-views.ts. */
export type BoardItemTab = "details" | "approval" | "conversation" | "files" | "subtasks";

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

/**
 * Where the Back control goes from each nested view. A structural parent rather than a history
 * stack: a stack would have to restore the item, run or process each entry was about, and a Back
 * that lands on a page about nothing is worse than no Back at all. Every destination here is a
 * view that rebuilds from the workspace alone, so it is always somewhere real.
 *
 * Views absent from this map are top level and show no Back control.
 */
export const PARENT_VIEW: Partial<Record<View, View>> = {
  item: "board",
  "item-new": "board",
  run: "board",
  process: "board",
  "process-runs": "process",
  "process-library": "board",
  schedules: "board",
  settings: "overview",
  "org-settings": "overview",
  preferences: "overview"
};

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
