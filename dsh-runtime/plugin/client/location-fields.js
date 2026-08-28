import { h } from "./runtime.js";
import { ask, Button } from "./shared.js";

export async function addLocationFromDevice(ctx, act, teamId, kind) {
  const path = kind === "folder" ? await ctx.workspaces.pickDirectory()
    : typeof ctx.workspaces.pickFile === "function" ? await ctx.workspaces.pickFile()
      : await ask("Absolute path to a file on this device", "");
  if (!path) return null;
  const fallback = path.split(/[\\/]/).filter(Boolean).pop() ?? (kind === "folder" ? "Files" : "File");
  const name = await ask(kind === "folder" ? "Folder name in Bees" : "File name in Bees", fallback);
  return name ? act({ action: "add_location", teamId, name, kind, path }) : null;
}

export function ResourceFields({
  ctx, data, teamId, act, inputIds, onInputIds, outputId, onOutputId,
  inheritedInputIds = [], defaultOutputName = "", allowOutput = true
}) {
  const team = data.teams.find(({ id }) => id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt && row.mapped);
  const inherited = new Set(inheritedInputIds);
  const selected = new Set(inputIds);
  const add = async (kind, output = false) => {
    const created = await addLocationFromDevice(ctx, act, teamId, kind);
    if (!created?.id) return;
    if (output) onOutputId(created.id);
    else onInputIds([...selected, created.id]);
  };
  return h("section", { className: "bees-resource-fields" },
    h("h3", null, "Input files and folders"),
    h("p", { className: "bees-muted" }, "Bees copies a read-only snapshot into each run. Original files are never modified."),
    inherited.size ? h("p", { className: "bees-muted" }, `Inherited from the process: ${locations.filter(({ id }) => inherited.has(id)).map(({ name }) => name).join(", ")}`) : null,
    locations.length ? h("div", { className: "bees-resource-list" }, ...locations.filter(({ id }) => !inherited.has(id)).map((location) =>
      h("label", { key: location.id, className: "bees-resource-option" },
        h("input", { type: "checkbox", checked: selected.has(location.id), onChange: (event) => onInputIds(event.target.checked
          ? [...selected, location.id] : [...selected].filter((id) => id !== location.id)) }),
        h("span", null, h("strong", null, location.name), h("span", { className: "bees-muted" }, location.localPath))))
    ) : h("p", { className: "bees-muted" }, "No approved files or folders are mapped on this device yet."),
    h("div", { className: "bees-detail-actions" },
      h(Button, { disabled: team?.role !== "admin", onClick: () => add("file") }, "+ Add file"),
      h(Button, { disabled: team?.role !== "admin", onClick: () => add("folder") }, "+ Add folder")),
    allowOutput ? h("div", { className: "bees-output-field" },
      h("h3", null, "Results"),
      h("p", { className: "bees-muted" }, "Results always stay in Bees. Optionally choose one folder for an approved copy."),
      h("select", { className: "bees-select", value: outputId, onChange: (event) => onOutputId(event.target.value), "aria-label": "Output folder" },
        h("option", { value: "" }, defaultOutputName
          ? `Use process result folder (${defaultOutputName})` : "Keep results in Bees only"),
        ...locations.filter(({ kind }) => kind === "folder").map((location) =>
          h("option", { value: location.id, key: location.id }, location.name))),
      h(Button, { disabled: team?.role !== "admin", onClick: () => add("folder", true) }, "+ Choose new output folder")) : null);
}
