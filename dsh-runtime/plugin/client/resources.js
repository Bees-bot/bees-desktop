import { h, useEffect, useState } from "./runtime.js";
import {
  ask, AuditEvent, Button, confirmAction, Empty, request, runTitle
} from "./shared.js";

export function FilesPage({ ctx, data, route, teamId, act }) {
  const team = data.teams.find(({ id }) => id === teamId);
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
  const pickFolder = async () => ctx.workspaces.pickDirectory();
  const addFolder = async () => {
    const path = await pickFolder(); if (!path) return;
    const name = await ask("Team location name", path.split(/[\\/]/).filter(Boolean).pop() ?? "Files");
    if (name) await act({ action: "add_location", teamId, name, kind: "folder", path });
  };
  const addFile = async () => {
    const path = typeof ctx.workspaces.pickFile === "function"
      ? await ctx.workspaces.pickFile()
      : await ask("Absolute path to a file on this device", "");
    if (!path) return;
    const name = await ask("Team file name", path.split(/[\\/]/).filter(Boolean).pop() ?? "File");
    if (name) await act({ action: "add_location", teamId, name, kind: "file", path });
  };
  const pickMapping = async (location) => location.kind === "folder"
    ? pickFolder()
    : ask(`Absolute path for ${location.name} on this device`, location.localPath ?? "");
  if (route === "references") return h("div", { className: "bees-grid" },
    ...locations.map((location) => h("section", { className: "bees-box", key: location.id }, h("h3", null, `$[${location.name}]`), h("p", { className: "bees-muted" }, `Stable logical id ${location.logicalId}. Add /relative/path when referencing a child.`))),
    locations.length ? null : h(Empty, null, "Create a location before using logical references"));
  if (route === "mappings") return h("div", null, ...locations.map((location) => h("div", { className: "bees-row", key: location.id },
    h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, location.localPath || "Not mapped on this device")),
    h(Button, { onClick: async () => { const path = await pickMapping(location); if (path) await act({ action: "map_location", locationId: location.id, path }); } }, location.mapped ? "Change" : "Map"),
    location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null
  )), locations.length ? null : h(Empty, null, "No team locations to map"));
  return h("div", null,
    h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
      h(Button, { disabled: !teamId || team?.role !== "admin", onClick: addFile }, "Add file"),
      h(Button, { className: "primary", disabled: !teamId || team?.role !== "admin", onClick: addFolder }, "Add folder")),
    ...(locations.length ? locations.map((location) => h("div", { className: "bees-row", key: location.id },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name), h("div", { className: "bees-muted" }, `${location.kind} · ${location.mapped ? "mapped on this device" : "mapping needed"}`)),
      h(Button, { className: "danger", disabled: team?.role !== "admin", onClick: async () => (await confirmAction(`Archive “${location.name}”? This will not delete the external folder.`)) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
    )) : [h(Empty, { key: "empty" }, "No shared team locations yet")])
  );
}

export function ActivityPage({ data, route, workspaceIds, setRoute, openWorkItem, openProcess, runId, setRunId }) {
  const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState(null);
  useEffect(() => { if (route === "audit") void request("/bees-api/audit").then((value) => setEvents(value.events)); }, [route]);
  useEffect(() => {
    let active = true;
    if (!runId) { setHistory(null); return () => { active = false; }; }
    request(`/bees-api/run-history?executionId=${encodeURIComponent(runId)}`)
      .then((value) => active && setHistory(value.history))
      .catch((error) => active && setHistory({ error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, [runId]);
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
    const onOpen = run ? () => { setRunId(run.id); setRoute("runs"); }
      : item ? () => openWorkItem(item.id) : process ? () => openProcess(process.id) : null;
    return h(AuditEvent, { event, detail, onOpen, key: event.id,
      openLabel: run ? "Open run" : item ? "Open work item" : "Open process" });
  }) : [h(Empty, { key: "empty" }, "No audit events yet")]));
  const run = runs.find(({ id }) => id === runId);
  if (run) return h("div", null,
    h("div", { className: "bees-row" }, h(Button, { onClick: () => setRunId("") }, "← Runs"), h("strong", null, runTitle(data, run)), h("div", { className: "bees-grow" }), h("span", { className: `bees-status bees-${run.status}` }, run.status)),
    run.resolvedAgentId ? h("section", { className: "bees-box" }, h("h3", null, "Agent dispatch"),
      h("p", null, data.assignments.find(({ id }) => id === run.resolvedAgentId)?.name ?? "Unavailable agent"),
      h("p", { className: "bees-muted" }, run.dispatchReason)) : null,
    run.outputs.length ? h("section", { className: "bees-box" }, h("h3", null, "Outputs"), h("p", null, run.outputs.join(", "))) : null,
    history?.error ? h(Empty, null, history.error) : history ? h("div", { className: "bees-transcript" },
      ...(history.messages?.length ? history.messages.map((message) => h("div", { className: "bees-message", key: message.id },
        h("strong", null, message.role),
        message.parts.map((part, index) => h("div", { key: index }, part.type === "tool" ? `${part.toolName}: ${part.state}` : part.text ?? ""))
      )) : [h(Empty, { key: "empty" }, "No transcript messages yet")])
    ) : h(Empty, null, "Loading transcript…")
  );
  return h("div", null, ...(runs.length ? runs.map((row) => h("button", { className: "bees-row bees-nav-link", key: row.id, onClick: () => setRunId(row.id) },
    h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, runTitle(data, row)), h("div", { className: "bees-muted" }, [data.assignments.find(({ id }) => id === row.resolvedAgentId)?.name, new Date(row.updatedAt).toLocaleString()].filter(Boolean).join(" · "))),
    h("span", { className: `bees-status bees-${row.status}` }, row.status))) : [h(Empty, { key: "empty" }, "No runs yet")]))
  ;
}

export function KnowledgePage({ data, route, workspaceId, teamId }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  if (route === "sources") {
    const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
    return locations.length ? locations.map((row) => h("div", { className: "bees-row", key: row.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, row.name), h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")))) : h(Empty, null, "No approved sources in this team");
  }
  if (route === "artifacts") {
    const rows = data.runs.filter((run) => run.workspaceId === workspaceId && run.outputs.length);
    return rows.length ? rows.map((run) => h("div", { className: "bees-row", key: run.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Run"), h("div", { className: "bees-muted" }, run.outputs.join(", "))))) : h(Empty, null, "No run artifacts yet");
  }
  return h("div", null, h("form", { className: "bees-search", onSubmit: async (event) => { event.preventDefault(); setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results); } },
    h("input", { className: "bees-input", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }), h("button", { className: "bees-btn primary", disabled: !workspaceId }, "Search")),
    ...results.map((result) => h("div", { className: "bees-row", key: result.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, result.title), h("div", { className: "bees-muted" }, result.excerpt)))),
    h("p", { className: "bees-muted" }, "Run transcripts are available from Activity → Runs."));
}

