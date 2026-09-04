/** DSH names its presets in its own locale, which reaches the one required field on the agent
 *  form. Wording below is what each preset carries, read off its tool list, not translated. */
const SHIPPED = {
  standard: {
    name: "Standard",
    description: "Files, shell, search, skills, plans, goals, subagents and workflows. The right "
      + "choice for most work."
  },
  ptc: {
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

const readable = (value) => typeof value === "string" && value.trim() !== "";

/** One preset, named so an English reader can pick between them. */
export function namePreset(preset) {
  const known = SHIPPED[preset.id];
  return {
    ...preset,
    name: known?.name ?? (readable(preset.name) ? preset.name : preset.id),
    description: known?.description ?? (readable(preset.description) ? preset.description : "")
  };
}
