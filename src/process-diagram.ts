/**
 * Mermaid `stateDiagram-v2` source for a process, so a board can show its shape without adopting
 * a statechart runtime. Rendering is a view concern: the transitions are already data, and this
 * turns them into a picture.
 *
 * A process that never declared transitions is drawn the way it actually behaves today — one step
 * forward per stage, in board order — because that is what `checkpointWorkItem` falls back to.
 */

export interface StageTransition {
  from: string;
  on: string;
  to: string;
}

/** Mermaid takes the label inside quotes, so a stage named `He said "go"` has to lose them. */
const quoted = (value: string): string => value.replace(/["\\]/g, "'");

/** Edge labels sit after a colon on one line, so anything that would break the line goes. */
const inline = (value: string): string => value.replace(/[\s:]+/g, " ").trim();

export function processDiagram(
  stages: readonly string[],
  transitions: readonly StageTransition[] = []
): string {
  const names = stages.map((stage) => stage.trim()).filter(Boolean);
  if (names.length === 0) return "";

  // Stage names are user text and can repeat after a rename, so the first one wins and the
  // diagram stays connected instead of splitting a stage in two.
  const ids = new Map<string, string>();
  names.forEach((name, index) => {
    const key = name.toLowerCase();
    if (!ids.has(key)) ids.set(key, `s${index}`);
  });
  const id = (name: string): string | undefined => ids.get(name.trim().toLowerCase());

  // A transition naming a stage this process no longer has is skipped, not drawn as a dangling
  // node: the stage list is the source of truth for what exists.
  const edges = transitions.length
    ? transitions.flatMap(({ from, on, to }) => {
        const [start, end] = [id(from), id(to)];
        if (!start || !end) return [];
        const label = inline(on);
        return [label ? `  ${start} --> ${end} : ${label}` : `  ${start} --> ${end}`];
      })
    : names.slice(1).map((name, index) => `  s${index} --> ${id(name)}`);

  return [
    "stateDiagram-v2",
    ...names.map((name, index) => `  state "${quoted(name)}" as s${index}`),
    "  [*] --> s0",
    ...edges
  ].join("\n");
}
