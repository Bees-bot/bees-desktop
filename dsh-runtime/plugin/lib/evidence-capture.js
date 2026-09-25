import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasSpillNotice } from "@deepseek-ai/dsh-spill-policy/notice";

// An MCP list endpoint answers with hundreds of KB. The model cannot hold that and cannot
// combine two of them, so a stage asked to build a pool file does the only thing left to it
// and retypes a truncated preview, inventing the fields it cannot see. Bees does the copying
// instead: every raw response lands in the run's own evidence folder and the model gets a
// receipt. Nothing here needs code execution, so no new way to run commands appears.
const MIN_BYTES = 16_000;
const EVIDENCE = join("outputs", "evidence");
const CALLS = join(EVIDENCE, "api_calls.json");
const POOL = join(EVIDENCE, "raw_projects_pool.json");
const REJECTED = join(EVIDENCE, "excluded_projects.json");

const plainText = (content) => {
  const blocks = Array.isArray(content) ? content : [];
  return blocks.length && blocks.every((block) => block.type === "text")
    ? blocks.map((block) => block.text).join("") : undefined;
};

const json = (value) => { try { return JSON.parse(value); } catch { return undefined; } };
const readJson = (path) => { try { return json(readFileSync(path, "utf8")); } catch { return undefined; } };

/** The list an endpoint returns: the first array of objects, wherever the payload nests it. */
function listOf(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  if (Array.isArray(value)) return value.length && value.every((row) => row && typeof row === "object") ? value : undefined;
  for (const child of Object.values(value)) {
    const found = listOf(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

const keyOf = (row) => (row && typeof row.id === "object" ? JSON.stringify(row.id) : row?.id);

// Over the inline cap the spill policy keeps a head/tail preview and files the whole text.
// That preview is not valid JSON, so the payload has to come from the file it points at.
const LOCATOR = " Full formatted result stored at: ";
function spillPath(text) {
  const at = text.lastIndexOf("\n\n(");
  const notice = at < 0 ? "" : text.slice(at + 2);
  const from = hasSpillNotice(notice) ? notice.indexOf(LOCATOR) + LOCATOR.length : 0;
  return from > LOCATOR.length ? notice.slice(from, notice.indexOf(". ", from)) : undefined;
}

const save = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

/** Read-modify-write one evidence file. */
function update(directory, file, change) {
  const path = join(directory, file);
  const next = change(readJson(path));
  save(path, next);
  return next;
}

// The owner's own filter, applied to the whole pool. A stage handed an 817 KB file cannot run
// these rules in its head, so Bees writes the answer and the stage writes the report.
const FILTER = join("outputs", "filter_params.json");
const CANDIDATES = join("outputs", "candidates.json");

const bound = (list) => (Array.isArray(list) ? list : []).map((word) => ({
  word, re: new RegExp(`\\b${String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
}));
const setting = (field, fallback) => {
  const raw = typeof field === "object" ? field?.default : field;
  return raw === undefined || raw === null || raw === "" ? fallback : raw;
};
const truthy = (value) => value === true || value === "true" || value === "True";

function shortlist(directory, pool) {
  const params = readJson(join(directory, FILTER));
  if (!params) return undefined;
  const rate = Number(setting(params.rate, 20));
  const price = Number(setting(params.total_price, 250));
  const language = setting(params.language, "en");
  const allowed = bound(params.keywords?.allowed);
  const banned = bound(params.keywords?.excluded);
  const included = [];
  const excluded = [];
  for (const row of pool) {
    const text = `${row.title ?? ""} ${row.preview_description ?? ""}`;
    const ratio = Number(row.currency?.exchange_rate);
    const top = row.budget?.maximum > 0 && ratio > 0 ? row.budget.maximum * ratio : undefined;
    const floor = row.type === "hourly" ? rate : price;
    const upgrade = row.upgrades ?? {};
    const keyword = banned.find(({ re }) => re.test(text))?.word;
    const blocked = ["pf_only", "sealed", "NDA", "featured"]
      .filter((key) => truthy(upgrade[key]) || (key === "featured" && truthy(row.featured)));
    // Ordered as the stage brief lists them, so the first hit is the deciding rule.
    const rules = [
      [top !== undefined && top < floor, "budget below owner floor", `${(top ?? 0).toFixed(2)} USD max, floor ${floor}`],
      [row.language !== language, "language not English", `language is ${row.language}`],
      [keyword !== undefined, "prohibited keyword", keyword],
      [!allowed.some(({ re }) => re.test(text)), "no allowed keyword", ""],
      [row.status !== "active" || truthy(row.deleted), "not an open project", `status is ${row.status}`],
      [blocked.length > 0, "not biddable by a free account", blocked.join(", ")]
    ];
    const hit = rules.find(([fires]) => fires);
    const lowest = Number(row.budget?.minimum) * ratio;
    const flags = ["premium", "enterprise", "qualified", "nonpublic"].filter((key) => truthy(upgrade[key]));
    if (truthy(row.local)) flags.push("local freelancers only");
    if (hit) excluded.push({ project_id: row.id, rule: hit[1], reason: hit[2] ? `${hit[1]}: ${hit[2]}` : hit[1] });
    else included.push({
      project_id: row.id, title: row.title, type: row.type, language: row.language,
      currency: row.currency?.code ?? null, usd_maximum: top === undefined ? null : Number(top.toFixed(2)),
      usd_minimum: Number.isFinite(lowest) ? Number(lowest.toFixed(2)) : null,
      // Kept but flagged: the advertised floor is under the owner's, so the owner judges it.
      partial: top !== undefined && lowest < floor, flags
    });
  }
  const counts = {};
  for (const { rule } of excluded) counts[rule] = (counts[rule] ?? 0) + 1;
  // The shortlist travels with the run; the rejects stay in evidence, where a model never pages them.
  save(join(directory, REJECTED), excluded);
  return {
    filter_criteria: {
      hourly_floor_usd: rate, fixed_floor_usd: price, language, budget_read_from: "maximum",
      allowed_keywords: allowed.map(({ word }) => word), excluded_keywords: banned.map(({ word }) => word)
    },
    totals: { unique_pool: pool.length, included: included.length, excluded: excluded.length },
    included_projects: included,
    excluded_by_reason: counts,
    excluded_detail: join("outputs", "evidence", "excluded_projects.json")
  };
}

const directoryOf = (exec, database) => database.prepare(
  "SELECT resolved(run_directory, workspace_id) AS directory FROM execution_links WHERE current_session_id IN (?, ?)")
  .get(String(exec.agent?.session.id), String(exec.agent?.session.header?.parentSession ?? ""))?.directory;

const stampOf = (path) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

/** Bees wrote the pool, so Bees keeps the shortlist in step with it. A run that starts at the
 *  filter stage makes no big call, so this cannot hang off capture. The stat is the cheap gate. */
function refresh(exec, database) {
  const directory = directoryOf(exec, database);
  if (!directory) return;
  const pool = join(directory, POOL);
  const written = stampOf(pool);
  if (!written) return;
  const out = join(directory, CANDIDATES);
  if (stampOf(out) >= Math.max(written, stampOf(join(directory, FILTER)))) return;
  const rows = readJson(pool);
  const list = Array.isArray(rows) ? shortlist(directory, rows) : undefined;
  if (list) save(out, list);
}

/** The pool is Bees' own file and runs to hundreds of KB. A stage told to filter it pages
 *  through instead, six thousand characters a turn, and never finishes. Point it at the answer. */
function poolReceipt(exec, result, database) {
  const path = exec.name === "read" ? exec.arguments?.file_path : undefined;
  if (typeof path !== "string" || !path.endsWith(POOL)) return undefined;
  const directory = directoryOf(exec, database);
  const list = directory && readJson(join(directory, CANDIDATES));
  if (!list?.totals) return undefined;
  const { unique_pool: pool, included, excluded } = list.totals;
  return `raw_projects_pool.json holds every raw API response (${pool} unique projects) and is too big to read a page at a time. Bees already applied filter_params.json to it: ${included} candidates, ${excluded} excluded, every exclusion carrying its single deciding rule. Read outputs/candidates.json instead, not this file; it holds the whole shortlist and is a fraction of the size.`;
}

function capture(exec, result, database) {
  if (!exec.name?.startsWith("mcp__") || exec.parent !== undefined) return undefined;
  const text = plainText(result?.content);
  if (text === undefined) return undefined;
  const file = spillPath(text);
  if (!file && Buffer.byteLength(text, "utf8") < MIN_BYTES) return undefined;
  const directory = directoryOf(exec, database);
  if (!directory) return undefined;
  const payload = file ? readJson(file) : json(text);
  if (!payload) return undefined;
  const requestId = String(payload.request_id ?? "");
  // The generated tool name is the only name this layer knows. Recording it beats guessing a path.
  const endpoint = exec.name.replace(/^mcp__[^_]+__/, "");
  const name = `${endpoint}${requestId ? `-${requestId}` : ""}.json`;
  const where = join(EVIDENCE, "calls", name);
  save(join(directory, where), payload);
  const rows = listOf(payload);
  const matched = rows ? (payload.total_count ?? payload.result?.total_count ?? rows.length) : null;
  const calls = update(directory, CALLS, (current) => ({
    calls: [...(current?.calls ?? []), {
      endpoint,
      tool: exec.name,
      params: exec.arguments ?? {},
      request_id: requestId || null,
      total_count: matched,
      timestamp_utc: new Date().toISOString()
    }]
  }));
  if (!rows) return `Saved the full response to ${where}. It carries no list, so the pool is unchanged.`;
  const pool = update(directory, POOL, (current) => {
    const merged = new Map((Array.isArray(current) ? current : []).map((row) => [keyOf(row), row]));
    for (const row of rows) if (row && typeof row === "object") merged.set(keyOf(row), row);
    return [...merged.values()];
  });
  const list = shortlist(directory, pool);
  if (list) save(join(directory, CANDIDATES), list);
  const filtered = list ? ` Filtered to ${list.totals.included} candidates of ${list.totals.unique_pool}.` : "";
  // A returned page is capped by the request's limit; saying so stops a stage reporting a sample as the market.
  return `Saved the full response to ${where}. request_id ${requestId || "none"}, ${rows.length} records this call${matched > rows.length ? ` of ${matched} that matched` : ""}, pool now holds ${pool.length} unique records from ${calls.calls.length} calls.${filtered} Bees wrote the pool and the shortlist; never retype either.`;
}

/** Bees copies the payload; the model only ever sees where it went. */
export function mountEvidenceCapture(ctx, database, logger) {
  if (!ctx.tools || typeof ctx.on !== "function") return;
  ctx.on("tools/post-execute", async (exec, result, next) => {
    let receipt;
    try { refresh(exec, database); receipt = poolReceipt(exec, result, database) ?? capture(exec, result, database); }
    catch (error) { logger?.warn?.(`bees: evidence capture failed: ${error?.message ?? error}`); }
    const decision = await next();
    return receipt && decision.kind === "accept" && !Object.hasOwn(decision, "value")
      ? { ...decision, content: [{ type: "text", text: receipt }] } : decision;
  }, { prepend: true });
}
