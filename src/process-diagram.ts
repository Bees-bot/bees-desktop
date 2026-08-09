/** Mermaid `stateDiagram-v2` source for a process whose states are all valid destinations. */

/** Mermaid takes the label inside quotes, so a stage named `He said "go"` has to lose them. */
const quoted = (value: string): string => value.replace(/["\\]/g, "'");

export function processDiagram(stages: readonly string[]): string {
  const names = stages.map((stage) => stage.trim()).filter(Boolean);
  if (names.length === 0) return "";

  return [
    "stateDiagram-v2",
    ...names.map((name, index) => `  state "${quoted(name)}" as s${index}`),
    "  [*] --> s0",
    "  note right of s0",
    "    Any status may move to any valid status",
    "  end note"
  ].join("\n");
}
