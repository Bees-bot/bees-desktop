import { h, React, useEffect, useState } from "./runtime.js";
import { FilePreview } from "./work.js";
import {
  artifactRuns, ask, AuditEvent, Button, confirmAction, Empty, request, runTitle, useBeesChangeRevision, when
} from "./shared.js";
import { addLocationFromDevice } from "./location-fields.js";

export function FilesPage({ ctx, data, teamId, act }) {
  const team = data.teams.find(({ id }) => id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
  const pickFolder = async () => ctx.uiWorkspace.pickDirectory();
  const pickMapping = async (location) => location.kind === "folder"
    ? pickFolder()
    : ask(`Absolute path for ${location.name} on this device`, location.localPath ?? "");
  return h("div", null,
    h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "16px", marginTop: "4px" } },
      h(Button, { disabled: !teamId || !["admin", "member"].includes(team?.role), onClick: () => addLocationFromDevice(ctx, act, teamId, "file") }, "Choose file"),
      h(Button, { className: "primary", disabled: !teamId || !["admin", "member"].includes(team?.role), onClick: () => addLocationFromDevice(ctx, act, teamId, "folder") }, "Choose folder")),
    h("div", { className: "bees-grid" },
      ...(locations.length ? locations.map((location) => h("div", { className: "bees-box", key: location.id, style: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } },
          h("div", { className: "bees-empty-icon", style: { width: "36px", height: "36px", flex: "none" } },
            location.kind === "folder" 
              ? h("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
                  h("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" }))
              : h("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
                  h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), h("polyline", { points: "14 2 14 8 20 8" }))
          ),
          h("div", { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, location.name),
            h("div", { className: "bees-muted" }, `${location.kind} · ${location.localPath || "Not mapped on this device"}`)
          )
        ),
        h("div", { className: "bees-card-actions", style: { marginTop: "auto", borderTop: "1px solid var(--dsw-alias-border-l1)", paddingTop: "10px" } },
          h(Button, { onClick: async () => { const path = await pickMapping(location); if (path) await act({ action: "map_location", locationId: location.id, path }); } }, location.mapped ? "Change mapping" : "Map"),
          location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null,
          h(Button, { className: "danger", disabled: !["admin", "member"].includes(team?.role), onClick: async () => (await confirmAction(`Archive “${location.name}”? This will not delete the ${location.kind} on your device.`)) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
        )
      )) : [h(Empty, { key: "empty" }, "No files or folders shared with this team yet")])
    )
  );
}

export function ActivityPage({ data, route, workspaceIds, openWorkItem, openProcess }) {
  const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
  const [events, setEvents] = useState([]);
  const liveRevision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    if (route === "audit") request(`/bees-api/audit?workspaceId=${encodeURIComponent(workspaceIds[0] ?? "")}`)
      .then((value) => active && setEvents(value.events ?? []), () => active && setEvents([]));
    return () => { active = false; };
  }, [route, liveRevision, workspaceIds[0]]);
  if (route === "audit") return h("div", null, ...(events.length ? events.map((event) => {
    const run = runs.find(({ id }) => id === event.executionId);
    const relatedIds = [event.metadata?.itemId, event.metadata?.parentId, event.metadata?.resultId].filter(Boolean);
    const item = data.items.find(({ id, processId }) => relatedIds.includes(id) &&
      workspaceIds.includes(data.processes.find((process) => process.id === processId)?.workspaceId));
    const process = data.processes.find(({ id, workspaceId }) =>
      workspaceIds.includes(workspaceId) && [event.metadata?.processId, event.metadata?.resultId].includes(id));
    const detail = [(run && runTitle(data, run)) ?? item?.title ?? process?.name, event.metadata?.outcome === "error" && "Failed"].filter(Boolean).join(" · ");
    const onOpen = run ? () => openWorkItem(run.workItemId ?? run.id)
      : item ? () => openWorkItem(item.id) : process ? () => openProcess(process.id) : null;
    return h(AuditEvent, { event, detail, onOpen, key: event.id,
      openLabel: run ? "Open execution" : item ? "Open work item" : "Open process template" });
  }) : [h(Empty, { key: "empty" }, "No audit events yet")]));
  return h("div", null, ...(runs.length ? runs.map((row) => h("button", { className: "bees-row bees-work-item-row", key: row.id, onClick: () => openWorkItem(row.workItemId ?? row.id) },
    h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, runTitle(data, row)), h("div", { className: "bees-muted" }, [data.assignments.find(({ id }) => id === row.resolvedAgentId)?.name, when(row.updatedAt)].filter(Boolean).join(" · "))),
    h("span", { className: `bees-status bees-${row.status}` }, row.status.replaceAll("_", " ")))) : [h(Empty, { key: "empty" }, "No executions yet")]))
  ;
}

export function KnowledgePage({ data, route, workspaceId, teamId, openWorkItem }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [viewer, setViewer] = useState(null);
  if (route === "artifacts") {
    const rows = artifactRuns(data.runs, workspaceId);
    if (!rows.length) return h(Empty, null, "No run artifacts yet");
    return h("div", { className: "bees-stack" }, ...rows.flatMap((run) => [h("div", { className: "bees-row", key: run.id },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, runTitle(data, run)),
        h("div", { className: "bees-muted" }, when(run.updatedAt)),
        h("div", { className: "bees-file-list" }, ...run.outputs.map((name) => h(Button, {
          key: name, title: name,
          className: viewer?.executionId === run.id && viewer?.path === `outputs/${name}` ? "bees-file-chip active" : "bees-file-chip",
          onClick: () => setViewer({ executionId: run.id, path: `outputs/${name}` })
        }, name))))),
      viewer?.executionId === run.id ? h(FilePreview, { key: `${run.id}:preview`, target: viewer, onClose: () => setViewer(null) }) : null]));
  }
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
  return h("div", { className: "bees-stack" },
    h("form", { className: "bees-search", onSubmit: async (event) => {
    event.preventDefault();
    setSearchError("");
    try { setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results ?? []); }
    catch (error) { setResults(null); setSearchError(error instanceof Error ? error.message : String(error)); }
  } },
    h("input", { className: "bees-input bees-grow", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }), h("button", { className: "bees-btn", disabled: !workspaceId }, "Search")),
    searchError ? h("p", { className: "bees-error" }, searchError) : null,
    results?.length === 0 ? h(Empty, null, "Nothing matched that search") : null,
    ...(results ?? []).map((result) => {
      const source = [result.authority ? `Authority: ${result.authority}` : "",
        result.modifiedAt ? `Updated ${when(result.modifiedAt)}` : ""].filter(Boolean).join(" · ");
      const item = result.kind === "item";
      return h(item ? "button" : "div", { className: item ? "bees-row bees-work-item-row" : "bees-row", key: result.id,
        onClick: item ? () => openWorkItem(result.id) : undefined }, h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, result.title),
        source ? h("div", { className: "bees-muted" }, source) : null,
        result.excerpt ? h("div", { className: "bees-muted" }, result.excerpt) : null));
    }),
    h("h3", { className: "bees-section-title", style: { marginTop: "24px" } }, "Approved sources"),
    h("div", { className: "bees-grid" },
      ...(locations.length ? locations.map((row) => 
        h("div", { className: "bees-box", key: row.id, style: { padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" } },
          h("div", { className: "bees-empty-icon", style: { width: "36px", height: "36px", flex: "none" } },
            h("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
              h("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })
            )
          ),
          h("div", { className: "bees-row-main" },
            h("div", { className: "bees-row-title" }, row.name),
            h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")
          )
        )
      ) : [h(Empty, { key: "empty" }, "No approved sources in this team. Add a folder in Files & folders to search it here.")])
    ));
}
