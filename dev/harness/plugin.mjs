/**
 * Serves the frontend to an ordinary browser so the UI can be measured and clicked without a Tauri
 * window. Answers the `window.__TAURI_INTERNALS__.invoke` seam: database commands hit an in-memory
 * SQLite through node:sqlite, the rest return canned values, unknown ones log once and answer null.
 * Dev only — BEES_HARNESS=1, which `tauri dev` never sets.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { seedStatements } from "./seed.mjs";

const SCHEMA_PATH = fileURLToPath(new URL("../../src-tauri/schema.sql", import.meta.url));
const ENDPOINT = "/__harness/invoke";

/** node:sqlite binds only null/number/string/bigint, so booleans become 0/1 and objects become JSON. */
function bind(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  for (const { sql, params } of seedStatements())
    db.prepare(sql).run(...params.map(bind));
  return db;
}

/**
 * plugin-http is four commands per request; answering them with node fetch makes the app's own
 * tauriFetch work here. Body goes out whole: read_body appends 0 for "more", then 1 to close.
 */
function httpBridge() {
  const requests = new Map();
  const bodies = new Map();
  let nextRid = 1;

  return {
    async "plugin:http|fetch"(args) {
      const rid = nextRid++;
      requests.set(rid, args.clientConfig ?? {});
      return rid;
    },
    async "plugin:http|fetch_send"(args) {
      const config = requests.get(args.rid);
      requests.delete(args.rid);
      if (!config) throw new Error(`Unknown HTTP request ${args.rid}`);
      const response = await fetch(config.url, {
        method: config.method,
        headers: Object.fromEntries(config.headers ?? []),
        ...(config.data ? { body: new Uint8Array(config.data) } : {}),
        redirect: config.maxRedirections === 0 ? "manual" : "follow"
      });
      const rid = nextRid++;
      bodies.set(rid, new Uint8Array(await response.arrayBuffer()));
      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: [...response.headers.entries()],
        rid
      };
    },
    async "plugin:http|fetch_read_body"(args) {
      const body = bodies.get(args.rid);
      if (body === undefined) return [1];
      bodies.delete(args.rid);
      return [...body, 0];
    },
    async "plugin:http|fetch_cancel"(args) { requests.delete(args.rid); return null; },
    async "plugin:http|fetch_cancel_body"(args) { bodies.delete(args.rid); return null; }
  };
}

const KNOWLEDGE_URL = process.env.BEES_HARNESS_KNOWLEDGE_URL ?? "http://127.0.0.1:8791/mcp";
const KNOWLEDGE_TOKEN = process.env.BEES_HARNESS_KNOWLEDGE_TOKEN ?? "";

/** The connection's own tools/list, with whatever bearer the app stored for it. */
async function mcpTools(connection, secrets) {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secrets.get(connection.secretRef) ?? ""}`
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  const listed = (await response.json()).result?.tools;
  if (!Array.isArray(listed)) throw new Error(`${connection.url} listed no tools`);
  return listed.map(({ name, description }) => ({ name, description: description ?? "", readOnly: false }));
}

/** The registry we actually ship, off disk, so the editor lists the real skills. */
function bundledRegistry() {
  const root = fileURLToPath(new URL("../../dsh-runtime/default-registry", import.meta.url));
  const skills = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: entry.name,
      path: `skills/${entry.name}/SKILL.md`,
      contents: readFileSync(join(root, "skills", entry.name, "SKILL.md"), "utf8")
    }));
  return {
    manifest: JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")),
    skills,
    mcp: null,
    issues: [],
    fileCount: skills.length
  };
}

function staticResponses() {
  return {
    api_server_override: "",
    default_workspace_root: "/Users/demo/Bees",
    validate_directory: true,
    ensure_directory: null,
    configured_cli_tools: {},
    plugin_catalog: [],
    search_mcp_registry: [],
    list_location_files: [],
    ensure_local_workflow_runtime: null,
    install_bundled_agent_plugin: bundledRegistry(),
    local_model_status: { state: "idle", models: [] },
    run_is_active: false,
    "plugin:app|version": "0.1.1-harness",
    "plugin:event|listen": 0,
    "plugin:event|unlisten": null,
    "plugin:deep-link|get_current": null,
    "plugin:updater|check": null,
    "plugin:notification|is_permission_granted": true,
    "plugin:dialog|confirm": true,
    "plugin:dialog|ask": true
  };
}

export function harnessPlugin() {
  if (process.env.BEES_HARNESS !== "1") return null;

  const db = createDatabase();
  const canned = staticResponses();
  const reported = new Set();
  // Agents are files, not rows, so the db above can't hold them. Ids are unique across teams;
  // teamRoot is kept so one team's agents don't show up under another.
  const agentFiles = new Map();
  const http = httpBridge();
  // Stands in for local credential storage so discovery can present the same bearer the app stored.
  const secrets = new Map();
  // Skills written in the UI, so they're there when the registry gets re-copied.
  const teamSkills = new Map();
  // Set once vite is listening; the runtime commands hand the app a URL on this origin.
  let origin = null;

  function handle(cmd, args, failing) {
    // ?fail=cmd,cmd reproduces a deleted model file or moved team folder without staging either.
    if (failing.includes(cmd)) throw new Error(`Injected failure for ${cmd}`);
    if (cmd in http) return http[cmd](args);
    if (cmd === "ensure_dsh_runtime") return { baseUrl: `${origin}/__harness/dsh`, token: "harness-token" };
    if (cmd === "ensure_knowledge_worker")
      return { url: KNOWLEDGE_URL, token: KNOWLEDGE_TOKEN };
    if (cmd === "store_connection_secret") { secrets.set(args.secretRef, args.secret); return null; }
    if (cmd === "delete_connection_secret") { secrets.delete(args.secretRef); return null; }
    if (cmd === "ensure_team_skills_plugin") return null;
    if (cmd === "write_team_skill") {
      teamSkills.set(`${args.teamRoot}/${args.slug}`, { teamRoot: args.teamRoot, slug: args.slug, contents: args.contents });
      return `plugins/team-skills/skills/${args.slug}/SKILL.md`;
    }
    if (cmd === "archive_team_skill") {
      teamSkills.delete(`${args.teamRoot}/${args.slug}`);
      return `plugins/team-skills/skills/.archive/${args.slug}`;
    }
    if (cmd === "update_team_skill_rule") return null;
    if (cmd === "install_agent_plugin") return teamSkillsPackage(args.sourcePath, teamSkills);
    if (cmd === "remove_registry") return null;
    if (cmd === "list_agent_files")
      return [...agentFiles.values()].flatMap(({ teamRoot, contents }) => teamRoot === args.teamRoot ? [contents] : []);
    if (cmd === "write_agent_file") { agentFiles.set(args.agentId, { teamRoot: args.teamRoot, contents: args.contents }); return null; }
    if (cmd === "delete_agent_file") { agentFiles.delete(args.agentId); return null; }
    if (cmd === "db_query")
      return db.prepare(args.sql).all(...(args.params ?? []).map(bind));
    if (cmd === "db_execute")
      return db.prepare(args.sql).run(...(args.params ?? []).map(bind)).changes;
    if (cmd === "db_transaction") {
      db.exec("BEGIN");
      try {
        const changes = args.statements.map(
          ({ sql, params = [] }) => db.prepare(sql).run(...params.map(bind)).changes
        );
        db.exec("COMMIT");
        return changes;
      }
      catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    if (cmd in canned) return canned[cmd];
    if (!reported.has(cmd)) {
      reported.add(cmd);
      console.log(`[harness] no stub for "${cmd}" — returning null`);
    }
    return null;
  }

  return {
    name: "bees-harness",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer.address();
        origin = `http://127.0.0.1:${typeof address === "object" ? address.port : address}`;
      });
      // Only DSH route the desktop calls outside a run.
      server.middlewares.use("/__harness/dsh/connections/discover", (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json");
          try {
            res.end(JSON.stringify({ tools: await mcpTools(JSON.parse(body || "{}"), secrets) }));
          }
          catch (error) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: String(error?.message ?? error) }));
          }
        });
      });
      server.middlewares.use(ENDPOINT, (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json");
          try {
            const { cmd, args, fail } = JSON.parse(body || "{}");
            // Awaited: the HTTP bridge answers with a promise, every other command with a value.
            const value = await handle(cmd, args ?? {}, fail ?? []);
            res.end(JSON.stringify({ ok: true, value: value ?? null }));
          }
          catch (error) {
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
          }
        });
      });
    },
    transformIndexHtml() {
      return [{
        tag: "script",
        injectTo: "head-prepend",
        children: `
          (() => {
            const callbacks = new Map();
            let nextCallback = 1;
            const fail = (new URLSearchParams(location.search).get("fail") || "")
              .split(",").filter(Boolean);
            window.__TAURI_INTERNALS__ = {
              async invoke(cmd, args) {
                const response = await fetch(${JSON.stringify(ENDPOINT)}, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cmd, args, fail })
                });
                const result = await response.json();
                if (!result.ok) throw new Error(result.error);
                return result.value;
              },
              transformCallback(callback, once) {
                const id = nextCallback++;
                callbacks.set(id, { callback, once });
                return id;
              },
              unregisterCallback(id) { callbacks.delete(id); },
              convertFileSrc(path) { return path; },
              metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }
            };
            document.documentElement.dataset.harness = "1";
          })();
        `
      }];
    }
  };
}
