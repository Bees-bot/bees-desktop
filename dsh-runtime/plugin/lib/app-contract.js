// Bees app contract v1/v2. Declarative packages only; never evaluate package code.
const keyPattern = /^[a-z][a-z0-9-]{1,63}$/;
const fields = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
};
const text = (value, label, max = 4000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
};
const unique = (rows, label) => {
  if (!Array.isArray(rows) || rows.length > 12 || new Set(rows.map((r) => r.key)).size !== rows.length)
    throw new Error(`Invalid or duplicate ${label}`);
};

export function validateApp(manifest) {
  if (JSON.stringify(manifest).length > 64_000) throw new Error("App package exceeds 64 KB");
  fields(manifest, ["schemaVersion", "id", "version", "name", "description", "author", "license", "permissions", "inputs", "sources", "task", "review", ...(manifest.schemaVersion === 2 ? ["recordTypes"] : [])], "app");
  if (![1, 2].includes(manifest.schemaVersion) || !keyPattern.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error("Unsupported app format, ID or version");
  for (const key of ["name", "description", "author", "license", "task", "review"]) text(manifest[key], key, key === "task" ? 16000 : 4000);
  if (!Array.isArray(manifest.permissions) || new Set(manifest.permissions).size !== manifest.permissions.length ||
      manifest.permissions.some((p) => !["public-sources", "draft-actions", "portfolio-read"].includes(p)))
    throw new Error("Unsupported app permissions");
  unique(manifest.inputs, "inputs");
  for (const input of manifest.inputs) {
    fields(input, ["key", "label", "help", "required"], "input");
    if (!keyPattern.test(input.key) || typeof input.required !== "boolean") throw new Error("Invalid input key or requirement");
    text(input.label, "input label", 120);
    if (input.help !== undefined) text(input.help, "input help", 500);
  }
  unique(manifest.sources, "sources");
  if (manifest.sources.length && !manifest.permissions.includes("public-sources")) throw new Error("Public sources need permission");
  for (const source of manifest.sources) {
    const page = manifest.schemaVersion === 2 && source.type === "page";
    fields(source, page ? ["key", "label", "url", "type", "pathPrefix"] : ["key", "label", "url", "queryParam"], "source");
    if (!keyPattern.test(source.key) || !page && !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(source.queryParam)) throw new Error("Invalid source parameters");
    text(source.label, "source label", 120);
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || source.url.length > 2000)
      throw new Error("Sources must be credential-free public HTTPS URLs");
    for (const key of url.searchParams.keys()) if (/token|secret|password|api.?key|auth/i.test(key)) throw new Error("Do not package credentials");
    if (page && (url.search || url.pathname !== "/" || typeof source.pathPrefix !== "string" || !source.pathPrefix.startsWith("/") || source.pathPrefix.length > 1000 || /[%?#\\\\]/.test(source.pathPrefix) || new URL(source.pathPrefix, url.origin).pathname !== source.pathPrefix))
      throw new Error("Page sources need an origin URL and a normalized pathPrefix (a trailing / permits child paths)");
  }
  if (manifest.recordTypes !== undefined) {
    unique(manifest.recordTypes, "record types");
    for (const record of manifest.recordTypes) {
      fields(record, ["key", "label", "fields"], "record type");
      if (!keyPattern.test(record.key)) throw new Error("Invalid record type key");
      text(record.label, "record type label", 120);
      if (!Array.isArray(record.fields) || record.fields.length > 24 || new Set(record.fields.map((f) => f.key)).size !== record.fields.length) throw new Error("Invalid or duplicate record fields");
      for (const field of record.fields) {
        fields(field, ["key", "label", "type", "required"], "record field");
        if (!keyPattern.test(field.key) || !["text", "number", "boolean"].includes(field.type) || field.required !== undefined && typeof field.required !== "boolean") throw new Error("Invalid record field");
        text(field.label, "record field label", 120);
      }
    }
  }
  return JSON.parse(JSON.stringify(manifest));
}

export function appConfig(manifest, supplied, allowIncomplete = false) {
  fields(supplied, manifest.inputs.map((f) => f.key), "configuration");
  const result = {};
  for (const input of manifest.inputs) {
    const value = supplied[input.key] ?? "";
    if (typeof value !== "string" || value.length > 4000 || !allowIncomplete && input.required && !value.trim()) throw new Error(`${input.label} is required (maximum 4000 characters)`);
    result[input.key] = value.trim();
  }
  return result;
}

export function appRecordData(manifest, kind, value = {}) {
  const definition = manifest.recordTypes?.find((record) => record.key === kind);
  if (manifest.recordTypes?.length && !definition) throw new Error("Record type is not declared by this app");
  fields(value, definition?.fields.map((field) => field.key) ?? [], "record data");
  if (JSON.stringify(value).length > 16000) throw new Error("Record data exceeds 16 KB");
  for (const field of definition?.fields ?? []) {
    const item = value[field.key];
    if (item === undefined) { if (field.required) throw new Error(`${field.label} is required`); continue; }
    if (field.type === "text" ? typeof item !== "string" || item.length > 4000 || field.required && !item.trim()
      : field.type === "number" ? typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 1e15
      : typeof item !== "boolean") throw new Error(`Invalid ${field.label}`);
  }
  return JSON.parse(JSON.stringify(value));
}

export const APP_TOOLS = ["bees_app_read", "bees_app_query", "bees_app_receipt", "bees_app_source", "bees_app_record", "bees_app_draft", "bees_app_review_action", "bees_submit_stage_result", "bees_request_work_review", "ask_user_question"];
export function appToolDenial(name, reviewer = false) {
  if (!APP_TOOLS.includes(name) || reviewer && ["bees_app_record", "bees_app_draft"].includes(name) || !reviewer && name === "bees_app_review_action")
    return "This app is research/draft-only. Shell, browser, MCP, delegation, setup and external execution are not permitted.";
}
