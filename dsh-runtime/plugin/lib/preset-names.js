/**
 * English names for the presets DSH ships.
 *
 * DSH names and describes its own presets in its locale, and those strings reach the agent form,
 * the preset list and the skill rows, where an English reader cannot choose between them. The ids
 * are stable and already English, so they are what a fallback uses; the wording below describes
 * what each preset actually carries, measured from its own tool list rather than translated.
 */
const SHIPPED = {
  standard: {
    name: "Standard",
    description: "Files, shell, search, skills, plans, goals, subagents and workflows. The right "
      + "choice for most work."
  },
  code: {
    name: "Code mode",
    description: "Everything Standard carries, offered to the model as a TypeScript API so it can "
      + "combine several steps into one program."
  },
  minimal: {
    name: "Minimal",
    description: "Two tools only: a persistent shell and a file editor."
  },
  cordis: {
    name: "Plugin authoring",
    description: "Everything Standard carries, plus tools for inspecting the runtime and building "
      + "your own presets and plugins."
  }
};

const readable = (value) => typeof value === "string" && value.trim() !== "" && !/[^\p{ASCII}]/u.test(value);

/** One preset, named so an English reader can pick between them. */
export function namePreset(preset) {
  const known = SHIPPED[preset.id];
  return {
    ...preset,
    name: known?.name ?? (readable(preset.name) ? preset.name : preset.id),
    description: known?.description ?? (readable(preset.description) ? preset.description : "")
  };
}
