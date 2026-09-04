import { h, MarkdownText, React, useEffect, useRef, useState } from "./runtime.js";
import { ask, Button, request } from "./shared.js";
import { FilesIcon, FileIcon, ExpandIcon, CollapseIcon, CloseIcon } from "./icons.js";

export async function addLocationFromDevice(ctx, act, teamId, kind) {
  const path = kind === "folder" ? await ctx.uiWorkspace.pickDirectory()
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
    viewer ? h(FilePreview, { target: viewer, onClose: () => setViewer(null) }) : null);
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

// Viewing work never changes its inputs or output destination.
export function WorkLocations({ data, references, inherited = [], outputId, defaultOutputId }) {
  const [viewer, setViewer] = useState(null);
  const inputs = new Map();
  for (const ref of [...references, ...inherited]) {
    const key = JSON.stringify([ref.locationId, ref.relativePath || ""]);
    const row = inputs.get(key) ?? { ...ref, key, sources: new Set() };
    row.sources.add(ref.source || "Work item");
    inputs.set(key, row);
  }
  const locationRow = ({ locationId, relativePath = "", sources }, fallback) => {
    const location = data.locations.find(({ id }) => id === locationId);
    const label = `${location?.name || fallback}${relativePath ? `/${relativePath}` : ""}`;
    const path = location?.localPath ? `${location.localPath}${relativePath ? `/${relativePath}` : ""}` : "Not mapped on this device";
    return h("li", { key: JSON.stringify([locationId, relativePath]) },
      h(LocationEntry, { locationId, path: relativePath, name: label,
        kind: relativePath ? undefined : location?.kind, viewer, onOpen: setViewer,
        disabled: !location?.mapped || Boolean(location?.archivedAt),
        title: `${path} · ${[...sources].join(" + ")}${location?.archivedAt ? " · Archived" : ""}` }));
  };
  if (!inputs.size && !outputId && !defaultOutputId) return null;
  return h("section", { className: `bees-work-files bees-work-locations${viewer ? " bees-editor-open" : ""}`, "aria-label": "Work locations" },
    inputs.size ? h("div", null,
      h("h3", null, "Input files & folders"),
      h("ul", { className: "bees-file-tree bees-location-tree" },
        ...[...inputs.values()].map((ref) => locationRow(ref, "Unavailable input")))) : null,
    outputId || defaultOutputId ? h("div", null,
      h("h3", null, outputId ? "Output folder" : "Default output folder"),
      h("ul", { className: "bees-file-tree bees-location-tree" },
        locationRow({ locationId: outputId || defaultOutputId,
          sources: [outputId ? "Selected for this work" : "From process"] }, "Unavailable output folder"))) : null,
    viewer ? h(FilePreview, { target: viewer, onClose: () => setViewer(null) }) : null);
}

export function LocationEntry({ locationId, path, name, kind, disabled, title, viewer, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!expanded || disabled || kind === "file") return;
    let current = true;
    setFile(null); setError("");
    const query = new URLSearchParams({ locationId, path });
    request(`/bees-api/location-file?${query}`).then((value) => {
      if (!current) return;
      setFile(value);
      // A reference into a folder can point at a file rather than a subfolder.
      if (!value.entries) { setExpanded(false); onOpen({ locationId, path }); }
    }).catch((reason) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { current = false; };
  }, [locationId, path, kind, expanded, disabled, revision, onOpen]);
  const selected = viewer?.locationId === locationId && viewer?.path === path;
  if (disabled || kind === "file" || file && !file.entries) return h(Button, {
    className: `bees-directory-file${selected ? " active" : ""}`, disabled, title,
    "aria-pressed": selected, onClick: () => onOpen({ locationId, path })
  }, h(kind === "folder" ? FilesIcon : FileIcon), name);
  return h("details", { open: expanded, onToggle: (event) => {
    if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
  } },
    h("summary", { title }, h(FilesIcon), name),
    expanded ? error ? h("div", { role: "alert", className: "bees-error" }, error,
      h(Button, { onClick: () => setRevision((value) => value + 1) }, "Retry"))
      : !file ? h("p", { className: "bees-muted", role: "status" }, "Loading folder…")
      : h(React.Fragment, null,
        h("ul", { className: "bees-file-tree" }, ...file.entries.map((entry) =>
          h("li", { key: entry.path }, h(LocationEntry, { ...entry, locationId, viewer, onOpen, title: entry.path })))),
        !file.entries.length ? h("p", { className: "bees-muted" }, "This folder is empty.") : null,
        file.truncated ? h("p", { className: "bees-muted" }, "Showing the first 200 entries.") : null) : null);
}

export function WorkFiles({ runs, filesRef }) {
  const [viewer, setViewer] = useState(null);
  const outputRuns = runs.filter((run) => run.outputs?.length);
  return h("section", { className: `bees-work-files${viewer ? " bees-editor-open" : ""}`, "aria-label": "Generated files" },
    outputRuns.length ? h("div", { ref: filesRef, className: "bees-output-directory" }, ...outputRuns.map((run) => {
      const files = [...new Set(run.outputs.map((path) => path.replaceAll("\\", "/")))];
      return h("section", { key: run.id, className: "bees-output-run" },
        h("header", { className: "bees-output-run-head" },
          h("h3", { title: new Date(run.updatedAt).toLocaleString() }, `Run ${runs.length - runs.indexOf(run)} · ${files.length} ${files.length === 1 ? "file" : "files"}`),
          h("span", { className: `bees-status bees-${run.status}` }, run.status)),
        h(OutputDirectory, { files, executionId: run.id, viewer, onOpen: setViewer }));
    }))
      : h("p", { className: "bees-muted" }, "Generated files will appear here after a run creates them."),
    viewer ? h(FilePreview, { target: { ...viewer, updatedAt: runs.find(r => r.id === viewer.executionId)?.updatedAt }, onClose: () => setViewer(null) })
      : null);
}

function OutputDirectory({ files, executionId, viewer, onOpen, prefix = "" }) {
  const folders = new Map();
  const leaves = [];
  for (const path of files) {
    const name = path.slice(prefix.length);
    const slash = name.indexOf("/");
    if (slash === -1) leaves.push(path);
    else {
      const folder = name.slice(0, slash);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(path);
    }
  }
  return h("ul", { className: `bees-file-tree${prefix ? "" : " bees-location-tree"}` },
    ...[...folders.keys()].sort().map((name) => h("li", { key: `folder:${name}` },
      h("details", null, h("summary", null, h(FilesIcon), name),
        h(OutputDirectory, { files: folders.get(name), executionId, viewer, onOpen, prefix: `${prefix}${name}/` })))),
    ...leaves.sort().map((name) => {
      const path = `outputs/${name}`;
      const selected = viewer?.executionId === executionId && viewer?.path === path;
      return h("li", { key: `file:${name}` }, h(Button, { className: `bees-directory-file${selected ? " active" : ""}`,
        title: name, "aria-pressed": selected, onClick: () => onOpen({ executionId, path }) }, h(FileIcon), name.slice(prefix.length)));
    }));
}

export function FilePreview({ target, onClose }) {
  return h(FileContents, { key: JSON.stringify({ executionId: target.executionId, locationId: target.locationId, path: target.path }), target, onClose });
}

function FileContents({ target, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [path, setPath] = useState(target.path);
  const dialog = useRef(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expanded) dialog.current.showModal();
  }, [expanded]);
  useEffect(() => {
    let current = true;
    setFile(null); setError("");
    const query = new URLSearchParams(target.locationId
      ? { locationId: target.locationId, path } : { executionId: target.executionId, path });
    request(`/bees-api/${target.locationId ? "location-file" : "run-file"}?${query}`)
      .then((value) => { if (current) setFile(value); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; };
  }, [target.executionId, target.locationId, path, target.updatedAt]);
  const title = file?.path || file?.name || path || "Folder";
  const contents = error ? h("div", { className: "bees-error", role: "alert" }, error)
      : !file ? h("div", { className: "bees-loading" }, "Opening file…")
        : file.entries ? h("div", { className: "bees-resource-list" },
          ...file.entries.map((entry) => h(Button, { key: entry.path, title: entry.path,
            onClick: () => setPath(entry.path) }, h(entry.kind === "folder" ? FilesIcon : FileIcon), entry.name)),
          !file.entries.length ? h("p", { className: "bees-muted" }, "This folder is empty.") : null,
          file.truncated ? h("p", { className: "bees-muted" }, "Showing the first 200 entries.") : null)
          : h(React.Fragment, null,
            file.truncated ? h("div", { className: "bees-muted" }, `Showing the first ${Math.round(file.content.length / 1024)} KB of ${(file.size / 1_000_000).toFixed(1)} MB.`) : null,
            file.format === "markdown" ? h(MarkdownText, { text: file.content }) : h("pre", null, file.content));
  const header = (fullScreen) => h("div", { className: "bees-file-preview-head" }, h(FileIcon), h("strong", { title }, title),
    target.locationId && path !== target.path ? h(Button, {
      onClick: () => setPath(path.split("/").slice(0, -1).join("/"))
    }, "Back") : null,
    h(Button, { className: "bees-editor-action", autoFocus: fullScreen,
      title: fullScreen ? "Exit full screen" : "Full screen", "aria-label": fullScreen ? "Exit full screen" : "Full screen",
      onClick: () => fullScreen ? dialog.current.close() : setExpanded(true) }, h(fullScreen ? CollapseIcon : ExpandIcon)),
    onClose ? h(Button, { className: "bees-editor-action", onClick: onClose, title: "Close file", "aria-label": "Close file preview" }, h(CloseIcon)) : null);
  return h(React.Fragment, null,
    h("section", { className: "bees-file-preview", "aria-label": "File contents" }, header(false),
      h("div", { className: "bees-file-preview-body", tabIndex: 0, "aria-label": "File content" }, contents)),
    h("dialog", { ref: dialog, className: "bees-file-dialog", "aria-label": "Full-screen file preview",
      onKeyDown: (event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.current.close(); }
      },
      onClose: () => setExpanded(false) }, expanded ? h(React.Fragment, null, header(true),
      h("div", { className: "bees-file-preview-body", tabIndex: 0, "aria-label": "File content" }, contents)) : null));
}
