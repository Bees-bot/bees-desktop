import { h, useEffect, useState } from "./runtime.js";
import {
  ask, AuditEvent, Button, confirmAction, Empty, request, runTitle
} from "./shared.js";

export function FilesPage({ ctx, data, teamId, act }) {
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
  return h("div", null,
    h("div", { className: "bees-row" }, h("div", { className: "bees-grow" }),
      h(Button, { disabled: !teamId || team?.role !== "admin", onClick: addFile }, "Add file"),
      h(Button, { className: "primary", disabled: !teamId || team?.role !== "admin", onClick: addFolder }, "Add folder")),
    ...(locations.length ? locations.map((location) => h("div", { className: "bees-row", key: location.id },
      h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, location.name),
        h("div", { className: "bees-muted" }, `${location.kind} · ${location.localPath || "Not mapped on this device"}`),
        h("div", { className: "bees-muted" }, `$[${location.name}] · stable logical id ${location.logicalId}`)),
      h(Button, { onClick: async () => { const path = await pickMapping(location); if (path) await act({ action: "map_location", locationId: location.id, path }); } }, location.mapped ? "Change mapping" : "Map"),
      location.mapped ? h(Button, { onClick: () => act({ action: "unmap_location", locationId: location.id }) }, "Remove mapping") : null,
      h(Button, { className: "danger", disabled: team?.role !== "admin", onClick: async () => (await confirmAction(`Archive “${location.name}”? This will not delete the external folder.`)) && act({ action: "archive_location", locationId: location.id }) }, "Archive")
    )) : [h(Empty, { key: "empty" }, "No shared team locations yet")])
  );
}

function HarnessEvent({ event }) {
  const type = event.type ?? "Unknown event";
  let detail = "";
  try {
    const d = event.data;
    if (d) {
      let parts = [];
      if (typeof d === "string") parts.push(d);
      else {
        if (d.name) parts.push(d.name);
        if (d.id && !d.name) parts.push(`id: ${d.id}`);
        if (d.mode) parts.push(`mode: ${d.mode}`);
        if (d.policy) parts.push(`policy: ${d.policy}`);
        if (d.seq) parts.push(`seq: ${d.seq}`);
        if (d.step) parts.push(`step: ${d.step}`);
        if (d.action) parts.push(`action: ${d.action}`);
        const c = Array.isArray(d.content) ? d.content : Array.isArray(d.message?.content) ? d.message.content : null;
        if (c?.[0]?.text) {
          let t = c[0].text.replace(/\s+/g, " ");
          parts.push(t.length > 80 ? t.slice(0, 80) + "…" : t);
        }
      }
      if (parts.length > 0) detail = parts.join(" · ");
      else {
        const str = JSON.stringify(d);
        detail = str.length > 80 ? str.slice(0, 80) + "…" : str;
      }
    }
  } catch (e) {}

  return h("details", { className: "bees-audit" },
    h("summary", { className: "bees-row" }, h("div", { className: "bees-row-main", style: { minWidth: 0, overflow: "hidden" } },
      h("div", { className: "bees-row-title" }, type),
      h("div", { className: "bees-muted", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: "2px 0 4px 0", fontSize: "13px" } }, detail),
      h("div", { className: "bees-muted", style: { fontSize: "11px" } }, new Date(event.time || Date.now()).toLocaleString()))
    ),
    h("div", { className: "bees-audit-detail" },
      h("pre", null, JSON.stringify(event.data ?? event, null, 2)))
  );
}

export function ActivityPage({ data, route, workspaceIds, setRoute, openWorkItem, openProcess, runId, setRunId }) {
  const runs = data.runs.filter((run) => workspaceIds.includes(run.workspaceId));
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let active = true;
    if (route === "audit") request("/bees-api/audit")
      .then((value) => active && setEvents(value.events ?? []))
      .catch(() => active && setEvents([]));
    return () => { active = false; };
  }, [route]);
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
      ...(history.messages?.length ? history.messages.map((message) => {
        if (message.role === "error") {
          return h("div", { className: "bees-message bees-error-msg", key: message.id, style: { color: "#cf5b5b", display: "flex", gap: "8px", alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
            h("span", { style: { fontSize: "14px", marginTop: "2px" } }, "●"),
            h("div", null, h("strong", null, "This turn failed "), h("span", null, message.parts.map(p => p.text).join(" ")))
          );
        }
        if (message.role === "context") {
          return h("div", { className: "bees-message bees-context-msg", key: message.id, style: { color: "var(--dsw-alias-label-secondary)", display: "flex", gap: "8px", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
            h("span", { style: { fontSize: "16px" } }, "☑"),
            h("span", null, message.parts.map(p => p.text).join(" "))
          );
        }
        return h("div", { className: "bees-message", key: message.id, style: { padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" } },
          h("div", { style: { marginBottom: "6px" } },
            h("strong", { className: `bees-status`, style: { background: "var(--dsw-alias-border-l1)", padding: "2px 6px", borderRadius: "4px" } }, message.role)
          ),
          h("div", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, message.parts.map((part, index) => h("div", { key: index }, part.type === "tool" ? `${part.toolName}: ${part.state}` : part.text ?? "")))
        );
      }) : [h(Empty, { key: "empty" }, "No transcript messages yet")]),
      ...(history.events?.length ? [
        h("section", { className: "bees-box", style: { marginTop: "20px" }, key: "harness-logs" },
          h("h3", null, "DeepSeek Harness Logs"),
          ...history.events.map((event, index) => h(HarnessEvent, { event, key: `event-${index}` }))
        )
      ] : [])
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
  const [searchError, setSearchError] = useState("");
  if (route === "artifacts") {
    const rows = data.runs.filter((run) => run.workspaceId === workspaceId && run.outputs.length);
    return rows.length ? rows.map((run) => h("div", { className: "bees-row", key: run.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, data.items.find(({ id }) => id === run.workItemId)?.title ?? "Run"), h("div", { className: "bees-muted" }, run.outputs.join(", "))))) : h(Empty, null, "No run artifacts yet");
  }
  const locations = data.locations.filter((row) => row.teamId === teamId && !row.archivedAt);
  return h("div", { className: "bees-stack" }, h("form", { className: "bees-search", onSubmit: async (event) => {
    event.preventDefault();
    setSearchError("");
    try { setResults((await request(`/bees-api/search?q=${encodeURIComponent(query)}&workspaceId=${encodeURIComponent(workspaceId)}`)).results ?? []); }
    catch (error) { setResults([]); setSearchError(error instanceof Error ? error.message : String(error)); }
  } },
    h("input", { className: "bees-input", value: query, onChange: (event) => setQuery(event.target.value), disabled: !workspaceId, placeholder: "Search work and approved files", "aria-label": "Search" }), h("button", { className: "bees-btn primary", disabled: !workspaceId }, "Search")),
    searchError ? h("p", { className: "bees-error" }, searchError) : null,
    ...results.map((result) => h("div", { className: "bees-row", key: result.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, result.title), h("div", { className: "bees-muted" }, result.excerpt)))),
    h("section", { className: "bees-box" }, h("h3", null, "Approved sources"),
      ...(locations.length ? locations.map((row) => h("div", { className: "bees-row", key: row.id }, h("div", { className: "bees-row-main" }, h("div", { className: "bees-row-title" }, row.name), h("div", { className: "bees-muted" }, row.mapped ? "Available for bounded on-demand indexing" : "Map on this device to search")))) : [h(Empty, { key: "empty" }, "No approved sources in this team")])),
    h("p", { className: "bees-muted" }, "Run transcripts are available from Activity → Runs."));
}
