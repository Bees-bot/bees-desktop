import { h, useEffect, useRef, useState } from "./runtime.js";
import { request, Button } from "./shared.js";

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

export function AppsPage({ workspaceId, connectionId = '', openWorkItem }) {
  const [view, setView] = useState(null);
  const [catalog, setCatalog] = useState({ apps: [], loaded: false });
  const [opened, setOpened] = useState(null);
  const openApp = (id) => setOpened((prior) => ({ id, revision: (prior?.revision ?? 0) + 1 }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const load = async () => {
    const version = generation.current;
    if (!workspaceId) return;
    try {
      const next = await request(`/bees-api/apps?workspaceId=${encodeURIComponent(workspaceId)}&connectionId=${encodeURIComponent(connectionId)}`);
      if (version === generation.current) setView(next);
    } catch (reason) { if (version === generation.current) setError(reason.message); }
  };
  useEffect(() => {
    generation.current += 1; setView(null); setOpened(null); setError("");
    void load();
    const changed = () => void load();
    window.addEventListener("bees-change", changed);
    const timer = setInterval(changed, 15_000);
    return () => { generation.current += 1; clearInterval(timer); window.removeEventListener("bees-change", changed); };
  }, [workspaceId, connectionId]);
  const loadCatalog = async () => {
    try { setCatalog({ ...await request('/bees-api/app-catalog'), loaded: true }); }
    catch (reason) { setCatalog((prior) => ({ ...prior, error: reason.message, stale: true })); }
  };
  useEffect(() => { void loadCatalog(); }, []);
  const act = async (input) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError("");
    const version = generation.current;
    try {
      const result = await request("/bees-api/apps", { method: "POST", body: JSON.stringify({ ...input, workspaceId, connectionId }) });
      if (version === generation.current) { await load(); return result; }
    } catch (reason) { if (version === generation.current) setError(reason.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const inputFields = (definition, values, change) => (definition.inputs ?? []).map((field) =>
    h("label", { key: field.key }, blankInput(field, values) ? `${field.label} · blank` : field.label,
      h("textarea", { className: "bees-textarea", rows: 2, required: field.required, maxLength: 4000,
        value: values[field.key] ?? "", onChange: (event) => change({ ...values, [field.key]: event.target.value }) }),
      field.help ? h("small", { className: "bees-muted" }, field.help) : null));

  return h("div", { className: "bees-stack", style: { maxWidth: 880, margin: "0 auto" } },
    h("header", null, h("h1", null, "Apps"), h("p", { className: "bees-muted" }, "Small apps. One place for results and decisions.")),
    h("p", { className: "bees-callout" }, view?.sendingEnabled ? "An action connector is available. Every external action still needs independent review and the designated approver's exact approval. Model charges are not capped here." : "Apps research and write drafts. Nothing is sent: no account connector is configured, so an approved draft still waits for a person to post it. Model charges are not capped here."),
    error ? h("p", { className: "bees-error", role: "alert" }, error) : null,
    !workspaceId ? h("p", null, "Choose a workspace to install apps.") : null,
    h("section", { className: "bees-box bees-stack" },
      h("div", { className: "bees-card-actions" }, h("h2", null, "App directory"), h(Button, { onClick: loadCatalog }, "Refresh")),
      catalog.error ? h("p", { role: "status", className: "bees-muted" }, catalog.error) : null,
      ...catalog.apps.map((entry) => {
        const installed = view?.apps.find((app) => app.package_id === entry.id && app.status !== 'removed');
        return h("article", { key: entry.id, className: "bees-box bees-stack" },
          h("strong", null, entry.name), h("p", null, entry.description),
          h("small", { className: "bees-muted" }, `${entry.author} · ${entry.version} · ${entry.license}`),
          h("small", null, `Access: ${entry.permissions.join(', ') || 'own app records'}`),
          entry.sources.length ? h("details", null, h("summary", null, "Public sources"), ...entry.sources.map((source) =>
            h("p", { key: source.url, style: { overflowWrap: "anywhere" } }, `${source.label}: ${source.url}`))) : null,
          installed ? h(Button, { onClick: () => openApp(installed.id) }, installed.needsSetup ? "Finish setup" : "Open") :
            h(Button, { primary: true, disabled: busy || !view || catalog.stale || ![1, 2].includes(entry.schemaVersion), onClick: async () => {
              const result = await act({ action: 'install', appId: entry.id, version: entry.version, checksum: entry.sha256 });
              if (result?.id) openApp(result.id);
            } }, [1, 2].includes(entry.schemaVersion) ? "Install" : "Requires newer Bees"),
          installed?.status === 'active' && installed.version !== entry.version ? h("details", null,
            h("summary", null, `Update available: ${installed.version} → ${entry.version}`),
            h("p", null, `New access: ${entry.permissions.filter((p) => !installed.manifest.permissions.includes(p)).join(', ') || 'none'}. Review the publisher and access above. Pause schedules and finish or cancel active work before updating. Existing results are kept; new schedules stay off.`),
            h(Button, { disabled: busy || catalog.stale || ![1, 2].includes(entry.schemaVersion), onClick: () => act({ action: 'update', installationId: installed.id, appId: entry.id, version: entry.version, checksum: entry.sha256 }) }, "Approve update")) : null);
      }),
      !catalog.apps.length && !catalog.error ? h("p", { role: "status", className: "bees-muted" }, catalog.loaded ? "No apps published yet." : "Loading app directory…") : null),
    workspaceId ? h("section", { className: "bees-box bees-stack" },
      h("h2", null, "Your apps"),
      ...(view?.apps ?? []).filter((app) => app.status !== "removed").map((app) => h(InstalledApp, { key: app.id, app, busy, act, inputFields, openWorkItem, opened: opened?.id === app.id ? opened.revision : 0 })),
      view && !view.apps.some((app) => app.status !== "removed") ? h("p", { className: "bees-muted" }, "Choose an app from the directory above.") : null) : null,
    view ? h("section", { className: "bees-box bees-stack" },
      h("h2", null, "Needs your review"),
      h("p", { className: "bees-muted" }, "The independent reviewer checks the exact draft first. Only the designated human can then approve it for 48 hours. Approval does not send it; editing requires a new draft and decision."),
      h("p", null, view.portfolio.approver_user_id ? `Designated approver: ${view.portfolio.approver_user_id === view.actorUserId ? "you" : view.portfolio.approver_user_id}` : "No designated approver. A team admin must opt in before approving actions."),
      !view.portfolio.approver_user_id ? h(Button, { primary: true, disabled: busy, onClick: () => act({ action: "set_approver" }) }, "I will approve external actions") : null,
      ...view.actions.filter((a) => a.status === "draft").map((action) => h("article", { key: action.id, className: "bees-box bees-stack" },
        h("strong", null, action.payload.destination), h("div", null, `From: ${action.payload.account} · Proposed commitment: ${dollars(action.cost_cents)}`),
        h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, action.payload.content),
        h("small", null, action.payload.rationale),
        action.item_id ? h(Button, { onClick: () => openWorkItem(action.item_id) }, "Open review work") : null,
        h("small", { role: "status" }, action.reviewed_digest === action.digest ? "Independent review passed for this exact draft." : "Waiting for independent review."),
        h("div", { className: "bees-card-actions" },
          h(Button, { primary: true, disabled: busy || action.reviewed_digest !== action.digest || view.portfolio.approver_user_id !== view.actorUserId, onClick: () => act({ action: "decide", actionId: action.id, digest: action.digest, decision: "approve" }) }, "Approve draft"),
          h(Button, { disabled: busy || view.portfolio.approver_user_id !== view.actorUserId, onClick: () => act({ action: "decide", actionId: action.id, digest: action.digest, decision: "reject" }) }, "Reject"),
          h(Button, { disabled: busy, onClick: () => act({ action: "suppress", destination: action.payload.destination }) }, "Do not contact")))),
      !view.actions.some((a) => a.status === "draft") ? h("p", { className: "bees-muted" }, "No drafts waiting. Research can continue independently.") : null,
      view.portfolio.approver_user_id === view.actorUserId ? h("details", null, h("summary", null, "Change approver"),
        h(Button, { disabled: busy, onClick: () => act({ action: "clear_approver" }) }, "Stop being approver; cancel outstanding approvals")) : null) : null,
    view ? h(AppRecords, { apps: view.apps, recordCounts: view.recordCounts, act, busy, openWorkItem }) : null,
    view ? h("section", { className: "bees-box bees-stack" }, h("h2", null, "Action history and outcomes"),
      !view.sendingEnabled ? h("p", null, "No external-action connector is configured. Approved drafts are not sent.") : null,
      ...view.actions.filter((a) => a.status !== "draft").map((action) => h("article", { key: action.id, className: "bees-box bees-stack" },
        h("strong", null, `${action.payload.destination} · ${action.status}`),
        action.item_id ? h(Button, { onClick: () => openWorkItem(action.item_id) }, "Open source work") : null,
        h("small", null, action.status === "succeeded" ? "Provider accepted the action; this is not proof of recipient delivery." :
          ["executing", "unknown"].includes(action.status) ? "Provider acceptance may be uncertain. Do not retry or create a replacement action until reconciled." : "Not sent by this action."),
        action.execution?.receipt ? h("p", null, `Provider receipt: ${action.execution.receipt.id}`) : null,
        action.status === "approved" ? h(Button, { disabled: busy || !view.sendingEnabled || !action.payload.connectorId || view.actorUserId !== view.portfolio.approver_user_id,
          onClick: () => act({ action: "execute_action", actionId: action.id, digest: action.digest }) }, "Execute this approved action") : null,
        action.status === "executing" ? h(Button, { disabled: busy || view.actorUserId !== view.portfolio.approver_user_id || Date.now() - Date.parse(action.execution.claimedAt) < 60_000,
          onClick: () => act({ action: "mark_unknown", actionId: action.id, attemptId: action.execution.attemptId }) }, "Mark interrupted attempt unresolved; do not retry") : null,
        action.status === "unknown" ? h("form", { onSubmit: (event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
          void act({ action: "reconcile_action", actionId: action.id, attemptId: action.execution.attemptId, evidence: form.get("evidence") }); } },
          h("label", null, "Reconciliation evidence (does not retry)", h("textarea", { className: "bees-textarea", name: "evidence", required: true, maxLength: 4000, defaultValue: action.execution.reconciliation?.evidence ?? "" })),
          h("button", { className: "bees-btn", disabled: busy || view.actorUserId !== view.portfolio.approver_user_id }, "Save evidence")) : null))) : null,
    view ? h("details", { className: "bees-box" }, h("summary", null, "Portfolio goal and limits"),
      h("form", { className: "bees-stack", key: JSON.stringify(view.portfolio), onSubmit: (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void act({ action: "portfolio", goal: form.get("goal"), capCents: Math.round(Number(form.get("cap")) * 100), maxRuns: Number(form.get("runs")) });
      } }, h("label", null, "Shared goal", h("textarea", { className: "bees-textarea", name: "goal", maxLength: 4000, defaultValue: view.portfolio.goal })),
        h("label", null, "Commitment cap (USD; does not cap model charges)", h("input", { className: "bees-input", name: "cap", type: "number", min: 0, step: "0.01", required: true, defaultValue: view.portfolio.cap_cents / 100 })),
        h("label", null, "New app work items per UTC day, shared across apps", h("input", { className: "bees-input", name: "runs", type: "number", min: 1, max: 50, required: true, defaultValue: view.portfolio.max_runs })),
        h("p", null, `${dollars(view.reservedCents)} committed across approved, in-flight, accepted or uncertain actions. Model charges are separate.`),
        h("button", { className: "bees-btn", type: "submit", disabled: busy }, "Save limits"))) : null);
}

const blankInput = (field, values) => !field.required && !String(values[field.key] ?? "").trim();

function InstalledApp({ app, busy, act, inputFields, openWorkItem, opened }) {
  const card = useRef(null);
  const [config, setConfig] = useState(app.config);
  useEffect(() => setConfig(app.config), [JSON.stringify(app.config)]);
  useEffect(() => { if (opened) { card.current?.scrollIntoView({ block: 'start' }); card.current?.focus({ preventScroll: true }); } }, [opened]);
  const blank = (app.manifest.inputs ?? []).filter((field) => blankInput(field, app.config));
  return h("article", { ref: card, tabIndex: -1, className: "bees-box bees-stack" },
    h("strong", null, app.manifest.name), h("p", { className: "bees-muted" }, app.manifest.description),
    app.needsSetup ? h("p", { role: "status" }, "Needs setup — add the details below before running.") : null,
    !app.needsSetup && blank.length ? h("p", { role: "status" }, `Blank settings: ${blank.map((field) => field.label).join(" · ")}. A blank setting changes what a run does; each field below says how.`) : null,
    h("div", { className: "bees-card-actions" },
      h(Button, { primary: true, disabled: busy || app.status !== "active" || app.needsSetup, onClick: async () => {
        const result = await act({ action: "run", installationId: app.id }); if (result?.id) openWorkItem(result.id);
      } }, "Run once"),
      app.status === "installing" ? h(Button, { disabled: busy, onClick: () => act({ action: "repair", installationId: app.id }) }, "Repair installation") : null),
    h("details", { open: Boolean(opened || app.needsSetup || blank.length) || undefined },
      h("summary", null, blank.length ? `Settings · ${blank.length} blank` : "Settings"),
      h("form", { className: "bees-stack", onSubmit: (event) => { event.preventDefault(); void act({ action: "configure", installationId: app.id, config }); } },
        ...inputFields(app.manifest, config, setConfig), h("button", { type: "submit", className: "bees-btn", disabled: busy }, "Save settings"))),
    h("details", null, h("summary", null, "Version and removal"),
      h("p", { className: "bees-muted" }, `Version ${app.version}. Schedules are off on installation. After a successful run, use its existing Bees schedule controls. Pause schedules and finish or cancel work before removal. Records, uncertain action history and its commitments are retained.`),
      h(Button, { disabled: busy, onClick: () => act({ action: "remove", installationId: app.id }) }, "Remove app; keep data")));
}

function AppRecords({ apps, recordCounts, act, busy, openWorkItem }) {
  const [installationId, setInstallationId] = useState("");
  const [kind, setKind] = useState(""); const [query, setQuery] = useState("");
  const [page, setPage] = useState(null); const [selected, setSelected] = useState(null);
  const [importText, setImportText] = useState(""); const [preview, setPreview] = useState(null);
  const [error, setError] = useState(""); const [receipt, setReceipt] = useState(null);
  const requestId = useRef(0);
  const pendingLoad = useRef(false);
  const app = apps.find((entry) => entry.id === installationId);
  const definition = app?.manifest.recordTypes?.find((record) => record.key === kind);
  const counts = {}; let held = 0;
  for (const row of recordCounts ?? []) if (row.installation_id === installationId) { counts[row.kind] = row.n; held += row.n; }
  useEffect(() => {
    if (!apps.some((entry) => entry.id === installationId)) setInstallationId(apps[0]?.id ?? "");
  }, [apps.map((entry) => entry.id).join(","), installationId]);
  const load = async (offset = 0) => {
    if (!installationId) return;
    const id = ++requestId.current;
    const result = await act({ action: "query_records", installationId, kind, query, offset, limit: 25 });
    if (id === requestId.current && result) setPage(result);
  };
  useEffect(() => { setPage(null); setSelected(null); setPreview(null); setReceipt(null); pendingLoad.current = true; return () => { requestId.current++; }; }, [installationId, kind]);
  useEffect(() => {
    if (!busy && pendingLoad.current && installationId) { pendingLoad.current = false; void load(); }
  }, [installationId, kind, busy]);
  const readImport = () => {
    const value = JSON.parse(importText);
    if (!value || value.schemaVersion !== 1 || value.packageId !== app.package_id || !Array.isArray(value.records)) throw new Error("Choose a version-1 record export for this app's package ID");
    return value.records;
  };
  const previewImport = async () => {
    setError(""); setPreview(null);
    try { const result = await act({ action: "preview_import", installationId, records: readImport() }); if (result) setPreview(result); }
    catch (reason) { setError(reason.message); }
  };
  const exportPage = async () => {
    const result = await act({ action: "export_records", installationId, kind, query, offset: page?.offset ?? 0, limit: 25 });
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${app.package_id}-records-page-${page?.offset ?? 0}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return h("section", { className: "bees-box bees-stack" }, h("h2", null, "App records"),
    h("p", { className: "bees-muted" }, "Each app defines its own fields. Imported or manually edited records are not verified source evidence, approvals or delivery receipts."),
    h("label", null, "App", h("select", { className: "bees-input", value: installationId, onChange: (event) => { setInstallationId(event.target.value); setKind(""); setQuery(""); setImportText(""); } },
      h("option", { value: "" }, "Choose an app"), ...apps.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.manifest.name)))),
    app ? h("div", { className: "bees-card-actions" },
      h(Button, { primary: kind === "", onClick: () => setKind("") }, `Everything · ${held}`),
      ...(app.manifest.recordTypes ?? []).map((record) => h(Button, { key: record.key, primary: kind === record.key, onClick: () => setKind(record.key) },
        `${record.label} · ${counts[record.key] ?? 0}`))) : null,
    app ? h("form", { className: "bees-card-actions", onSubmit: (event) => { event.preventDefault(); void load(); } },
      h("label", null, "Search fields and notes", h("input", { className: "bees-input", value: query, maxLength: 1000, onChange: (event) => setQuery(event.target.value) })),
      h("button", { className: "bees-btn", disabled: busy }, "Search / refresh")) : null,
    page ? h("div", { style: { overflowX: "auto" } },
      h("p", { role: "status" }, `${page.total} records · showing ${page.records.length ? page.offset + 1 : 0}–${page.offset + page.records.length}`),
      h("table", { className: "bees-table", style: { width: "100%", textAlign: "left" } },
        h("thead", null, h("tr", null, h("th", null, "Record"), h("th", null, "Provenance"), ...(definition?.fields ?? []).map((field) => h("th", { key: field.key }, field.label)))),
        h("tbody", null, ...page.records.map((record) => h("tr", { key: record.id },
          h("td", null, h(Button, { onClick: () => { setSelected(record); setReceipt(null); } }, record.title), h("small", null, ` ${record.kind}`)),
          h("td", null, record.provenance), ...(definition?.fields ?? []).map((field) => h("td", { key: field.key, style: { overflowWrap: "anywhere", maxWidth: 260 } }, String(record.data[field.key] ?? "—"))))))),
      h("div", { className: "bees-card-actions" }, h(Button, { disabled: busy || page.offset === 0, onClick: () => load(Math.max(0, page.offset - page.limit)) }, "Previous"),
        h(Button, { disabled: busy || page.nextOffset === null, onClick: () => load(page.nextOffset) }, "Next"),
        h(Button, { disabled: busy || !page.records.length, onClick: exportPage }, "Export this page (JSON)"))) : null,
    selected ? h("article", { className: "bees-box bees-stack", key: selected.id }, h("h3", null, selected.title),
      h("small", null, `Canonical key: ${selected.record_key}`), h("p", { style: { whiteSpace: "pre-wrap" } }, selected.body),
      selected.item_id ? h(Button, { onClick: () => openWorkItem(selected.item_id) }, "Open source work") : null,
      h("div", { className: "bees-card-actions" }, ...selected.evidence.map((id) => h(Button, { key: id, disabled: busy, onClick: async () => {
        const result = await act({ action: "receipt", installationId, receiptId: id }); if (result) setReceipt(result);
      } }, `Source receipt ${id.slice(0, 8)}`))),
      receipt ? h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" } }, JSON.stringify(receipt, null, 2)) : null,
      app.status === "active" ? h("details", null, h("summary", null, "Edit this record"), h("form", { className: "bees-stack", onSubmit: async (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget); const data = {};
        for (const field of app.manifest.recordTypes?.find((record) => record.key === selected.kind)?.fields ?? []) {
          const value = form.get(`field-${field.key}`);
          if (field.type === "boolean") { if (value !== "") data[field.key] = value === "true"; }
          else if (value !== "") data[field.key] = field.type === "number" ? Number(value) : value;
        }
        const result = await act({ action: "edit_record", installationId, digest: selected.digest,
          record: { key: selected.record_key, kind: selected.kind, title: form.get("record-title"), body: form.get("record-body"), data } });
        if (result) { setSelected(null); await load(page?.offset ?? 0); }
      } }, h("label", null, "Title", h("input", { className: "bees-input", name: "record-title", required: true, maxLength: 200, defaultValue: selected.title })),
        h("label", null, "Notes", h("textarea", { className: "bees-textarea", name: "record-body", required: true, maxLength: 8000, defaultValue: selected.body })),
        ...(app.manifest.recordTypes?.find((record) => record.key === selected.kind)?.fields ?? []).map((field) => h("label", { key: field.key }, field.label,
          field.type === "boolean" ? h("select", { className: "bees-input", name: `field-${field.key}`, required: field.required, defaultValue: selected.data[field.key] === undefined ? "" : String(selected.data[field.key]) },
            h("option", { value: "" }, "Unknown / unset"), h("option", { value: "true" }, "True"), h("option", { value: "false" }, "False")) :
            h("input", { className: "bees-input", name: `field-${field.key}`, type: field.type === "number" ? "number" : "text", step: field.type === "number" ? "any" : undefined,
              maxLength: 4000, required: field.required, defaultValue: selected.data[field.key] ?? "" }))),
        h("button", { className: "bees-btn", disabled: busy }, "Save manual edit"))) : null) : null,
    app?.status === "active" ? h("details", null, h("summary", null, "Import records with a preview"),
      h("p", null, "Import up to 200 records / 1 MB. Existing canonical keys are updated. Approval and delivery state cannot be imported."),
      h("input", { type: "file", accept: ".json,application/json", "aria-label": "Choose app record JSON", onChange: async (event) => {
        setError(""); setPreview(null); const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 1_000_000) { setError("Import file exceeds 1 MB"); return; }
        try { setImportText(await file.text()); } catch (reason) { setError(reason.message); }
      } }),
      h("label", null, "Record JSON", h("textarea", { className: "bees-textarea", rows: 6, value: importText, maxLength: 1_000_000, onChange: (event) => { setImportText(event.target.value); setPreview(null); } })),
      h(Button, { disabled: busy || !importText, onClick: previewImport }, "Preview import"),
      error ? h("p", { role: "alert", className: "bees-error" }, error) : null,
      preview ? h("div", { className: "bees-stack" }, h("p", null, `${preview.creates} new; ${preview.updates} updates. All will be marked user-import. No approvals or sends.`),
        h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" } }, JSON.stringify(preview.records, null, 2)),
        h(Button, { disabled: busy, onClick: async () => {
          const result = await act({ action: "import_records", installationId, records: preview.records, previewDigest: preview.digest });
          if (result) { setPreview(null); setImportText(""); await load(); }
        } }, "Confirm this import")) : null) : null);
}
