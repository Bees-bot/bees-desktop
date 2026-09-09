// Bees app contract v1. Declarative packages only; never evaluate package code.
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
  fields(manifest, ["schemaVersion", "id", "version", "name", "description", "author", "license", "permissions", "inputs", "sources", "task", "review"], "app");
  if (manifest.schemaVersion !== 1 || !keyPattern.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version))
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
    fields(source, ["key", "label", "url", "queryParam"], "source");
    if (!keyPattern.test(source.key) || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(source.queryParam)) throw new Error("Invalid source parameters");
    text(source.label, "source label", 120);
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || source.url.length > 2000)
      throw new Error("Sources must be credential-free public HTTPS URLs");
    for (const key of url.searchParams.keys()) if (/token|secret|password|api.?key|auth/i.test(key)) throw new Error("Do not package credentials");
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

export const APP_TOOLS = ["bees_app_read", "bees_app_source", "bees_app_record", "bees_app_draft", "bees_submit_stage_result", "bees_request_work_review", "ask_user_question"];
export function appToolDenial(name, reviewer = false) {
  if (!APP_TOOLS.includes(name) || reviewer && ["bees_app_record", "bees_app_draft"].includes(name))
    return "This app is research/draft-only. Shell, browser, MCP, delegation, setup and external execution are not permitted.";
}
