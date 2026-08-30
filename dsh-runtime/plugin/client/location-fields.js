import { h, MarkdownText, useEffect, useState } from "./runtime.js";
import { ask, Button, request } from "./shared.js";

export async function addLocationFromDevice(ctx, act, teamId, kind) {
  const path = kind === "folder" ? await ctx.workspaces.pickDirectory()
    : typeof ctx.workspaces.pickFile === "function" ? await ctx.workspaces.pickFile()
      : await ask("Absolute path to a file on this device", "");
  if (!path) return null;
  const fallback = path.split(/[\\/]/).filter(Boolean).pop() ?? (kind === "folder" ? "Files" : "File");
  const name = await ask(kind === "folder" ? "Folder name in Bees" : "File name in Bees", fallback);
  return name ? act({ action: "add_location", teamId, name, kind, path }) : null;
}

export function inheritedInputs(data, processId, agentId) {
  return [
    ...(data.processAttachments ?? []).filter((row) => row.processId === processId)
      .map((row) => ({ ...row, source: "Process" })),
    ...(data.agentAttachments ?? []).filter((row) => row.agentAssignmentId === agentId)
      .map((row) => ({ ...row, source: "Agent" }))
  ];
}

export function ResourceFields({
  ctx, data, teamId, act, inputIds, onInputIds, outputId = "", onOutputId,
  inputReferences = [], inherited = [], onRemoveReference, defaultOutputName = "", defaultOutputId = "", allowOutput = true, disabled = false
}) {
  const team = data.teams.find(({ id }) => id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId);
  const selected = new Set(inputIds);
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async (callback) => {
    setBusy(true); setError("");
    try { await callback(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const add = async (kind, output = false) => {
    const created = await addLocationFromDevice(ctx, act, teamId, kind);
    if (!created?.id) return;
    if (output) await onOutputId(created.id);
    else await onInputIds([...selected, created.id]);
  };
  const refs = [
    ...inherited,
    ...inputIds.flatMap((locationId) => {
      const refs = inputReferences.filter((row) => row.locationId === locationId);
      return refs.length ? refs : [{ locationId, relativePath: "" }];
    })
  ];
  const rows = new Map();
  for (const ref of refs) {
    const key = JSON.stringify([ref.locationId, ref.relativePath || ""]);
    const row = rows.get(key) ?? { ...ref, key, sources: new Set(), own: false };
    if (ref.source) row.sources.add(ref.source);
    else row.own = true;
    rows.set(key, row);
  }
  const available = locations.filter((row) => !row.archivedAt && row.mapped && !selected.has(row.id) &&
    !inherited.some((ref) => ref.locationId === row.id && !ref.relativePath));
  const output = locations.find(({ id }) => id === (outputId || defaultOutputId));
  const locked = disabled || busy || !["admin", "member"].includes(team?.role);
  return h("section", { className: "bees-resource-fields" },
    h("h3", null, "Inputs"),
    h("p", { className: "bees-muted" }, "Read-only copies for each run. Originals stay unchanged."),
    rows.size ? h("div", { className: "bees-resource-list" }, ...[...rows.values()].map((row) => {
      const sources = [...row.sources];
      const location = locations.find(({ id }) => id === row.locationId);
      const label = `${location?.name ?? "Unavailable input"}${row.relativePath ? `/${row.relativePath}` : ""}`;
      const own = row.own;
      return h("div", { key: row.key, className: "bees-resource-option" },
        h("label", { className: "bees-resource-copy" },
          h("input", { type: "checkbox", checked: true, disabled: locked || !own,
            "aria-label": `${label}${sources.length ? ` · From ${sources.join(" + ")}` : ""}`,
            onChange: () => change(() => onRemoveReference ? onRemoveReference(row)
              : onInputIds(inputIds.filter((id) => id !== row.locationId))) }),
          h("span", null, h("strong", { title: label }, label),
            h("span", { className: "bees-muted", title: location?.localPath ?? "Not mapped on this device" }, [location?.kind,
              sources.length ? `From ${sources.join(" + ")}${own ? " · Also selected here" : ""}` : "Selected here",
              location?.archivedAt ? "Archived" : !location?.mapped ? "Not mapped on this device" : location.localPath
            ].filter(Boolean).join(" · ")))),
        h(Button, { disabled: !location?.mapped || Boolean(location?.archivedAt),
          title: `View ${label}`, "aria-label": `View ${label}`,
          onClick: () => setViewer({ locationId: row.locationId, path: row.relativePath }) }, "View"));
    })) : h("p", { className: "bees-muted" }, "No inputs selected."),
    h("div", { className: "bees-resource-controls" },
      h("select", { className: "bees-select", value: "", disabled: locked || !available.length,
        "aria-label": "Select input file or folder", onChange: (event) => {
          const id = event.target.value;
          if (id) void change(() => onInputIds([...selected, id]));
        } }, h("option", { value: "" }, "Select file or folder…"),
        ...available.map((location) => h("option", { value: location.id, key: location.id },
          `${location.name} · ${location.kind} · ${location.localPath}`))),
      h(Button, { disabled: locked || team?.role !== "admin", onClick: () => change(() => add("file")) }, "Add file"),
      h(Button, { disabled: locked || team?.role !== "admin", onClick: () => change(() => add("folder")) }, "Add folder")),
    allowOutput ? h("div", { className: "bees-output-field" },
      h("h3", null, "Output folder"),
      h("p", { className: "bees-muted" }, "Results stay in Bees. Choose a folder for an approved copy."),
      h("div", { className: "bees-resource-controls" },
        h("select", { className: "bees-select", value: outputId, disabled: locked,
          onChange: (event) => { const id = event.target.value; void change(() => onOutputId(id)); }, "aria-label": "Output folder" },
          h("option", { value: "" }, defaultOutputName
            ? `Use process result folder (${defaultOutputName})` : "Keep results in Bees only"),
          ...locations.filter((row) => row.id === outputId || row.kind === "folder" && !row.archivedAt && row.mapped)
            .map((location) => h("option", { value: location.id, key: location.id,
              disabled: Boolean(location.archivedAt) || !location.mapped },
              `${location.name}${location.archivedAt ? " · Archived" : !location.mapped ? " · Not mapped" : ""}`)),
          outputId && !output ? h("option", { value: outputId, disabled: true }, "Unavailable output folder") : null),
        output ? h(Button, { disabled: !output.mapped || Boolean(output.archivedAt), "aria-label": "View output folder",
          onClick: () => setViewer({ locationId: output.id, path: "" }) }, "View") : null,
        h(Button, { disabled: locked || team?.role !== "admin", onClick: () => change(() => add("folder", true)) }, "Add folder"))) : null,
    error ? h("div", { className: "bees-error", role: "alert" }, error) : null,
    viewer ? h("div", null,
      h(Button, { onClick: () => setViewer(null) }, "Close preview"), h(FilePreview, { target: viewer })) : null);
}

// Existing owners save one changed selection at a time, preserving other references' child paths.
export function AttachedResourceFields({ owner, references, ...props }) {
  const inputIds = [...new Set(references.map(({ locationId }) => locationId))];
  return h(ResourceFields, { ...props, inputIds, inputReferences: references,
    onInputIds: async (next) => {
      for (const id of new Set([...inputIds, ...next])) {
        if (inputIds.includes(id) === next.includes(id)) continue;
        const adding = next.includes(id);
        const location = props.data.locations.find((row) => row.id === id);
        const relativePath = adding && location?.kind === "folder"
          ? await ask("Relative file or folder (leave blank for the whole folder)", "") : "";
        if (relativePath === null) return;
        const result = await props.act({ ...owner, locationId: id,
          ...(relativePath ? { relativePath } : {}), action: adding ? "attach_location" : "detach_location" });
        if (!result) throw new Error("Inputs could not be saved.");
      }
    },
    onRemoveReference: async ({ locationId, relativePath = "" }) => {
      if (!await props.act({ ...owner, action: "detach_location", locationId, relativePath }))
        throw new Error("Input could not be removed.");
    },
    onOutputId: async (locationId) => {
      if (!await props.act({ ...owner, action: "set_output_location", locationId }))
        throw new Error("Output folder could not be saved.");
    }
  });
}

export function FilePreview({ target }) {
  return h(FileContents, { key: JSON.stringify(target), target });
}

function FileContents({ target }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(target.path);
  useEffect(() => {
    let current = true;
    setFile(null); setError("");
    const query = new URLSearchParams(target.locationId
      ? { locationId: target.locationId, path } : { executionId: target.executionId, path });
    request(`/bees-api/${target.locationId ? "location-file" : "run-file"}?${query}`)
      .then((value) => { if (current) setFile(value); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; };
  }, [target.executionId, target.locationId, path]);
  return h("section", { className: "bees-file-preview", "aria-label": "File contents" },
    h("div", { className: "bees-file-preview-head" }, h("strong", null, file?.path || file?.name || path),
      target.locationId && path !== target.path ? h(Button, {
        onClick: () => setPath(path.split("/").slice(0, -1).join("/"))
      }, "Back") : null),
    error ? h("div", { className: "bees-error", role: "alert" }, error)
      : !file ? h("div", { className: "bees-loading" }, "Opening file…")
        : file.entries ? h("div", { className: "bees-resource-list" },
          ...file.entries.map((entry) => h(Button, { key: entry.path, title: entry.path,
            onClick: () => setPath(entry.path) }, `${entry.name}${entry.kind === "folder" ? "/" : ""}`)),
          !file.entries.length ? h("p", { className: "bees-muted" }, "This folder is empty.") : null,
          file.truncated ? h("p", { className: "bees-muted" }, "Showing the first 200 entries.") : null)
          : file.format === "markdown" ? h(MarkdownText, { text: file.content }) : h("pre", null, file.content));
}
