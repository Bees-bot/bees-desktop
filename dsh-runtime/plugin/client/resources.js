import { h, React, useEffect, useState } from "./runtime.js";
import { FilePreview } from "./work.js";
import {
  ask, AuditEvent, Button, confirmAction, Empty, request, runTitle, useBeesChangeRevision
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
    h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
      h(Button, { disabled: !teamId || !["admin", "member"].includes(team?.role), onClick: () => addLocationFromDevice(ctx, act, teamId, "file") }, "Choose file"),
      h(Button, { className: "primary", disabled: !teamId || !["admin", "member"].includes(team?.role), onClick: () => addLocationFromDevice(ctx, act, teamId, "folder") }, "Choose folder")),
    ...(locations.length ? locations.map((location) => h("div", { className: "bees-row", key: location.id },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name),
        h("div", { className: "bees-muted" }, `${location.kind} · ${location.localPath || "Not mapped on this device"}`),
        h("div", { className: "bees-muted" }, `$[${location.name}] · stable logical id ${location.logicalId}`)),
      h(Button, { onClick: async () => { const path = await pickMapping(location); if (path) await act({ action: "map_location", locationId: location.id, path }); } }, location.mapped ? "Change mapping" : "Map"),
      location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null,
      h(Button, { className: "danger", disabled: !["admin", "member"].includes(team?.role), onClick: async () => (await confirmAction(`Archive “${location.name}”? This will not delete the external folder.`)) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
    )) : [h(Empty, { key: "empty" }, "No shared team locations yet")])
  );
}

export function ActivityPage({ data, route, workspaceIds, openWorkItem, openProcess }) {
  const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
  const [events, setEvents] = useState([]);
  const liveRevision = useBeesChangeRevision();
  useEffect(() => {
    let active = true;
    if (route === "audit") request("/bees-api/audit")
      .then((value) => active && setEvents(value.events ?? []), () => active && setEvents([]));
    return () => { active = false; };
  }, [route, liveRevision]);
  if (route === "evaluations") return h(Empty, null, "Evaluations are not available in the current Bees profile.");
  if (route === "audit") return h("div", null, ...(events.length ? events.map((event) => {
    const run = runs.find(({ id }) => id === event.executionId);
    const relatedIds = [event.metadata?.itemId, event.metadata?.parentId, event.metadata?.resultId].filter(Boolean);
    const item = data.items.find(({ id, processId }) => relatedIds.includes(id) &&
      workspaceIds.includes(data.processes.find((process) => process.id === processId)?.workspaceId));
    const process = data.processes.find(({ id, workspaceId }) =>
      workspaceIds.includes(workspaceId) && [event.metadata?.processId, event.metadata?.resultId].includes(id));
    const runItem = run ? data.items.find(({ id }) => id === run.workItemId) : null;
    const detail = runItem?.title ?? item?.title ?? process?.name ?? event.metadata?.action ?? event.metadata?.outcome;
    const onOpen = run ? () => openWorkItem(run.workItemId ?? run.id)
      : item ? () => openWorkItem(item.id) : process ? () => openProcess(process.id) : null;
    return h(AuditEvent, { event, detail, onOpen, key: event.id,
      openLabel: run ? "Open execution" : item ? "Open work item" : "Open process template" });
  }) : [h(Empty, { key: "empty" }, "No audit events yet")]));
  return h("div", null, ...(runs.length ? runs.map((row) => h("button", { className: "bees-row bees-nav-link", key: row.id, onClick: () => openWorkItem(row.workItemId ?? row.id) },
    h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, runTitle(data, row)), h("div", { className: "bees-muted" }, [data.assignments.find(({ id }) => id === row.resolvedAgentId)?.name, new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · "))),
    h("span", { className: `bees-status bees-${row.status}` }, row.status.replaceAll("_", " ")))) : [h(Empty, { key: "empty" }, "No executions yet")]))
  ;
}

export function KnowledgePage({ data, route, workspaceId, teamId }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [viewer, setViewer] = useState(null);
  if (route === "artifacts") {
    const rows = data.runs.filter((run) => run.workspaceId === workspaceId && run.outputs?.length);
    if (!rows.length) return h(Empty, null, "No run artifacts yet");
    return h("div", { className: "bees-stack" }, ...rows.map((run) => h("div", { className: "bees-row", key: run.id },
      h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Run"),
        h("div", { className: "bees-file-list" }, ...run.outputs.map((name) => h(Button, {
          key: name,
          className: viewer?.executionId === run.id && viewer?.path === `outputs/${name}` ? "bees-file-chip active" : "bees-file-chip",
          onClick: () => setViewer({ executionId: run.id, path: `outputs/${name}` })
        }, name)))))),
      viewer ? h(FilePreview, { target: viewer, onClose: () => setViewer(null) }) : null);
  }
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
  return h("div", { className: "bees-stack" },
    h("form", { className: "bees-search", onSubmit: async (event) => {
    event.preventDefault();
    setSearchError("");
    try { setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results ?? []); }
    catch (error) { setResults([]); setSearchError(error instanceof Error ? error.message : String(error)); }
  } },
    h("input", { className: "bees-input bees-grow", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }), h("button", { className: "bees-btn", disabled: !workspaceId }, "Search")),
    searchError ? h("p", { className: "bees-error" }, searchError) : null,
    ...results.map((result) => {
      const source = [result.authority ? `Authority: ${result.authority}` : "",
        result.modifiedAt ? `Updated ${new Date(result.modifiedAt).toLocaleString()}` : ""].filter(Boolean).join(" · ");
      return h("div", { className: "bees-row", key: result.id }, h("div", { className: "bees-row-main" },
        h("div", { className: "bees-row-title" }, result.title),
        source ? h("div", { className: "bees-muted" }, source) : null,
        h("div", { className: "bees-muted" }, result.excerpt)));
    }),
    h("section", { className: "bees-box" }, h("h3", null, "Approved sources"),
      ...(locations.length ? locations.map((row) => h("div", { className: "bees-row", key: row.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, row.name), h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")))) : [h(Empty, { key: "empty" }, "No approved sources in this team")])),
    h("p", { className: "bees-muted" }, "Creation and modification dates travel with exported Google documents. Recency helps rank freshness; it does not by itself make a document authoritative."),
    h("p", { className: "bees-muted" }, "Execution transcripts are available from Activity → Executions."));
}
