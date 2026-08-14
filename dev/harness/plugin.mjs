/**
 * Serves the frontend to an ordinary browser so the UI can be measured and clicked without a Tauri
 * window. Answers the `window.__TAURI_INTERNALS__.invoke` seam: database commands hit an in-memory
 * SQLite through node:sqlite, the rest return canned values, unknown ones log once and answer null.
 * Dev only — BEES_HARNESS=1, which `tauri dev` never sets.
 */

import { readFileSync } from "node:fs";
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

function staticResponses() {
  return {
    api_server_override: "",
    default_workspace_root: "/Users/demo/Bees",
    validate_directory: true,
    ensure_directory: null,
    configured_cli_tools: {},
    plugin_catalog: [],
    search_mcp_registry: [],
    list_agent_files: [],
    list_location_files: [],
    ensure_flue_runtime: null,
    ensure_local_workflow_runtime: null,
    ensure_knowledge_worker: null,
    install_bundled_agent_plugin: {
      manifest: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "bundled-demo" },
      skills: [],
      mcp: null,
      issues: [],
      fileCount: 0
    },
    local_model_status: { state: "idle", models: [] },
    run_is_active: false,
    "plugin:app|version": "0.1.1-harness",
    "plugin:event|listen": 0,
    "plugin:event|unlisten": null,
    "plugin:deep-link|get_current": null,
    "plugin:updater|check": null,
    "plugin:notification|is_permission_granted": true
  };
}

export function harnessPlugin() {
  if (process.env.BEES_HARNESS !== "1") return null;

  const db = createDatabase();
  const canned = staticResponses();
  const reported = new Set();

  function handle(cmd, args, failing) {
    // ?fail=cmd,cmd reproduces a deleted model file or moved team folder without staging either.
    if (failing.includes(cmd)) throw new Error(`Injected failure for ${cmd}`);
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
      server.middlewares.use(ENDPOINT, (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          try {
            const { cmd, args, fail } = JSON.parse(body || "{}");
            res.end(JSON.stringify({ ok: true, value: handle(cmd, args ?? {}, fail ?? []) ?? null }));
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
