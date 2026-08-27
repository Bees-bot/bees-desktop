import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { createStore, extractSnippet } from "@tobilu/qmd";
import { TEXT_EXTENSIONS } from "./product-files.js";

const INDEX_INTERVAL = 60_000;
const FOLDER_PATTERN = `**/*.{${[...TEXT_EXTENSIONS].map((extension) => extension.slice(1)).join(",")}}`;

function stableName(prefix, value) {
  return `${prefix}-${createHash("sha256").update(String(value)).digest("hex")}`;
}

function escapeGlob(value) {
  return value.replace(/[*?[\]{}()!+@]/g, (character) => `\\${character}`);
}

function indexedLocation(location) {
  try {
    const stat = lstatSync(location.localPath);
    if (location.kind === "folder" && !stat.isDirectory()) return null;
    if (location.kind === "file" && (!stat.isFile() || !TEXT_EXTENSIONS.has(extname(location.localPath).toLowerCase())))
      return null;
    return {
      name: stableName("location", location.id),
      location,
      config: location.kind === "folder"
        ? { path: location.localPath, pattern: FOLDER_PATTERN }
        : { path: dirname(location.localPath), pattern: escapeGlob(basename(location.localPath)) }
    };
  } catch {
    return null;
  }
}

export class TeamKnowledgeSearch {
  constructor(root) {
    this.root = root;
    this.indexedAt = new Map();
    // ponytail: one queue avoids QMD's process-global config race; split by team if search throughput demands it.
    this.queue = Promise.resolve();
  }

  search(query, teamId, locations) {
    const pending = this.queue.then(() => this.searchNow(query, teamId, locations));
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async searchNow(query, teamId, locations) {
    const indexed = locations.map(indexedLocation).filter(Boolean);
    if (!indexed.length) return [];
    const directory = resolve(this.root, "knowledge", stableName("team", teamId));
    mkdirSync(directory, { recursive: true });
    const store = await createStore({
      dbPath: resolve(directory, "qmd.sqlite"),
      config: {
        global_context: "Files explicitly mapped to this Bees team on this device.",
        collections: Object.fromEntries(indexed.map(({ name, config }) => [name, config]))
      }
    });
    try {
      const now = Date.now();
      const stale = indexed.filter(({ location }) => now - (this.indexedAt.get(location.id) ?? 0) >= INDEX_INTERVAL);
      if (stale.length) {
        await store.update({ collections: stale.map(({ name }) => name) });
        for (const { location } of stale) this.indexedAt.set(location.id, now);
      }
      const groups = await Promise.all(indexed.map(async ({ name, location }) => {
        const prefix = `qmd://${name}/`;
        return (await store.searchLex(query, { collection: name, limit: 50 })).map((result) => {
          const relativePath = result.filepath.startsWith(prefix)
            ? result.filepath.slice(prefix.length)
            : result.displayPath.slice(name.length + 1);
          return {
            kind: "file",
            id: `${location.id}:${relativePath}`,
            title: `${location.name}/${relativePath}`,
            excerpt: extractSnippet(result.body, query, 240).snippet.replace(/\s+/g, " ").trim(),
            score: result.score
          };
        });
      }));
      return groups.flat().sort((left, right) => right.score - left.score).slice(0, 50)
        .map(({ score: _score, ...result }) => result);
    } finally {
      await store.close();
    }
  }
}
