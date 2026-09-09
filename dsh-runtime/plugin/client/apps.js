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
    h("label", { key: field.key }, field.label,
      h("textarea", { className: "bees-textarea", rows: 2, required: field.required, maxLength: 4000,
        value: values[field.key] ?? "", onChange: (event) => change({ ...values, [field.key]: event.target.value }) }),
      field.help ? h("small", { className: "bees-muted" }, field.help) : null));

  return h("div", { className: "bees-stack", style: { maxWidth: 880, margin: "0 auto" } },
    h("header", null, h("h1", null, "Apps"), h("p", { className: "bees-muted" }, "Small apps. One place for results and decisions.")),
    h("p", { className: "bees-muted" }, "Install apps in the selected workspace. These apps prepare research and drafts; no sending or paid execution. Model-provider charges are separate."),
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
            h(Button, { primary: true, disabled: busy || !view || catalog.stale || entry.schemaVersion !== 1, onClick: async () => {
              const result = await act({ action: 'install', appId: entry.id, version: entry.version, checksum: entry.sha256 });
              if (result?.id) openApp(result.id);
            } }, entry.schemaVersion === 1 ? "Install" : "Requires newer Bees"),
          installed?.status === 'active' && installed.version !== entry.version ? h("details", null,
            h("summary", null, `Update available: ${installed.version} → ${entry.version}`),
            h("p", null, `New access: ${entry.permissions.filter((p) => !installed.manifest.permissions.includes(p)).join(', ') || 'none'}. Review the publisher and access above. Pause schedules and finish or cancel active work before updating. Existing results are kept; new schedules stay off.`),
            h(Button, { disabled: busy || catalog.stale || entry.schemaVersion !== 1, onClick: () => act({ action: 'update', installationId: installed.id, appId: entry.id, version: entry.version, checksum: entry.sha256 }) }, "Approve update")) : null);
      }),
      !catalog.apps.length && !catalog.error ? h("p", { role: "status", className: "bees-muted" }, catalog.loaded ? "No apps published yet." : "Loading app directory…") : null),
    workspaceId ? h("section", { className: "bees-box bees-stack" },
      h("h2", null, "Your apps"),
      ...(view?.apps ?? []).filter((app) => app.status !== "removed").map((app) => h(InstalledApp, { key: app.id, app, busy, act, inputFields, openWorkItem, opened: opened?.id === app.id ? opened.revision : 0 })),
      view && !view.apps.some((app) => app.status !== "removed") ? h("p", { className: "bees-muted" }, "Choose an app from the directory above.") : null) : null,
    view ? h("section", { className: "bees-box bees-stack" },
      h("h2", null, "Needs your review"),
      h("p", { className: "bees-muted" }, "Approval accepts this exact draft for 48 hours. It does not send it. Editing requires a new draft and decision."),
      ...view.actions.filter((a) => a.status === "draft").map((action) => h("article", { key: action.id, className: "bees-box bees-stack" },
        h("strong", null, action.payload.destination), h("div", null, `From: ${action.payload.account} · Proposed commitment: ${dollars(action.cost_cents)}`),
        h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, action.payload.content),
        h("small", null, action.payload.rationale),
        h("div", { className: "bees-card-actions" },
          h(Button, { primary: true, disabled: busy, onClick: () => act({ action: "decide", actionId: action.id, digest: action.digest, decision: "approve" }) }, "Approve draft"),
          h(Button, { disabled: busy, onClick: () => act({ action: "decide", actionId: action.id, digest: action.digest, decision: "reject" }) }, "Reject"),
          h(Button, { disabled: busy, onClick: () => act({ action: "suppress", destination: action.payload.destination }) }, "Do not contact")))),
      !view.actions.some((a) => a.status === "draft") ? h("p", { className: "bees-muted" }, "No drafts waiting. Research can continue independently.") : null) : null,
    view ? h("section", { className: "bees-box bees-stack" },
      h("h2", null, "Results"),
      ...view.records.map((record) => h("details", { key: record.id },
        h("summary", null, record.title), h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, record.body),
        h("small", { className: "bees-muted" }, `${record.kind} · ${record.evidence.length} source receipts · ${record.updated_at}`),
        h(Button, { onClick: () => openWorkItem(record.item_id) }, "Open work"))),
      !view.records.length ? h("p", { className: "bees-muted" }, "Run an app to collect real evidence. No sample leads are counted as results.") : null,
      h("details", null, h("summary", null, "Decision history"), ...view.actions.filter((a) => a.status !== "draft").map((a) =>
        h("p", { key: a.id }, `${a.payload.destination} · ${a.status} · not sent`)))) : null,
    view ? h("details", { className: "bees-box" }, h("summary", null, "Portfolio goal and limits"),
      h("form", { className: "bees-stack", key: JSON.stringify(view.portfolio), onSubmit: (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void act({ action: "portfolio", goal: form.get("goal"), capCents: Math.round(Number(form.get("cap")) * 100), maxRuns: Number(form.get("runs")) });
      } }, h("label", null, "Shared goal", h("textarea", { className: "bees-textarea", name: "goal", maxLength: 4000, defaultValue: view.portfolio.goal })),
        h("label", null, "Commitment cap (USD; does not cap model charges)", h("input", { className: "bees-input", name: "cap", type: "number", min: 0, step: "0.01", required: true, defaultValue: view.portfolio.cap_cents / 100 })),
        h("label", null, "New app work items per UTC day, shared across apps", h("input", { className: "bees-input", name: "runs", type: "number", min: 1, max: 50, required: true, defaultValue: view.portfolio.max_runs })),
        h("p", null, `${dollars(view.reservedCents)} reserved for approved drafts. No payment or delivery receipts exist in this preview.`),
        h("button", { className: "bees-btn", type: "submit", disabled: busy }, "Save limits"))) : null);
}

function InstalledApp({ app, busy, act, inputFields, openWorkItem, opened }) {
  const card = useRef(null);
  const [config, setConfig] = useState(app.config);
  useEffect(() => setConfig(app.config), [JSON.stringify(app.config)]);
  useEffect(() => { if (opened) { card.current?.scrollIntoView({ block: 'start' }); card.current?.focus({ preventScroll: true }); } }, [opened]);
  return h("article", { ref: card, tabIndex: -1, className: "bees-box bees-stack" },
    h("strong", null, app.manifest.name), h("p", { className: "bees-muted" }, app.manifest.description),
    app.needsSetup ? h("p", { role: "status" }, "Needs setup — add the details below before running.") : null,
    h("div", { className: "bees-card-actions" },
      h(Button, { primary: true, disabled: busy || app.status !== "active" || app.needsSetup, onClick: async () => {
        const result = await act({ action: "run", installationId: app.id }); if (result?.id) openWorkItem(result.id);
      } }, "Run once"),
      app.status === "installing" ? h(Button, { disabled: busy, onClick: () => act({ action: "repair", installationId: app.id }) }, "Repair installation") : null),
    h("details", { open: Boolean(opened || app.needsSetup) || undefined }, h("summary", null, "Settings"),
      h("form", { className: "bees-stack", onSubmit: (event) => { event.preventDefault(); void act({ action: "configure", installationId: app.id, config }); } },
        ...inputFields(app.manifest, config, setConfig), h("button", { type: "submit", className: "bees-btn", disabled: busy }, "Save settings")),
      h("p", { className: "bees-muted" }, `Version ${app.version}. Schedules are off on installation. After a successful run, use its existing Bees schedule controls. Pause schedules and finish or cancel work before removal. Data is retained.`),
      h(Button, { disabled: busy, onClick: () => act({ action: "remove", installationId: app.id }) }, "Remove app; keep data")));
}
