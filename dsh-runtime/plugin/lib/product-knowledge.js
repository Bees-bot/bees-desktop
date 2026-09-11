import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { createStore, extractSnippet } from "@tobilu/qmd";
import { DocumentExports } from "./document-extractor.js";
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

function frontmatter(body) {
  if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) return {};
  const end = body.search(/\n---[ \t]*(?:\r?\n|$)/);
  if (end < 0 || end > 10_000) return {};
  const values = {};
  for (const line of body.slice(4, end).split(/\r?\n/)) {
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1].toLocaleLowerCase().replaceAll("-", "_")] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function validTime(value, fallback) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback.toISOString();
}

function metadata(body, stat) {
  const source = frontmatter(body);
  return {
    createdAt: validTime(source.created_at ?? source.createdtime, stat.birthtime),
    modifiedAt: validTime(source.modified_at ?? source.modifiedtime, stat.mtime),
    authority: source.authority ?? source.status ?? null,
    supersedes: source.supersedes ?? null,
    sourceId: source.source_id ?? source.google_doc_id ?? null,
    sourceName: source.source_name ?? null
  };
}

function knowledgeFile(location, relativePath) {
  if (String(relativePath).replaceAll("\\", "/").split("/").some((part) => part.startsWith(".")))
    throw new Error("Hidden knowledge files are not readable");
  const root = realpathSync(location.localPath);
  const selected = location.kind === "file" ? root : realpathSync(resolve(root, relativePath));
  if (location.kind === "folder" && selected !== root && !selected.startsWith(`${root}${sep}`))
    throw new Error("The knowledge result left its mapped folder");
  if (!TEXT_EXTENSIONS.has(extname(selected).toLowerCase())) throw new Error("That knowledge file is not readable text");
  return selected;
}

export class TeamKnowledgeSearch {
  constructor(root, googleDrive = null, documents = new DocumentExports(root)) {
    this.root = root;
    this.googleDrive = googleDrive;
    this.documents = documents;
    this.indexedAt = new Map();
    this.exportedLocations = new Map();
    // ponytail: one queue avoids QMD's process-global config race; split by team if search throughput demands it.
    this.queue = Promise.resolve();
  }

  search(query, teamId, locations) {
    const pending = this.queue.then(() => this.searchNow(query, teamId, locations));
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async searchNow(query, teamId, locations) {
    const google = this.googleDrive
      ? (await Promise.all(locations.map((location) =>
          this.googleDrive.exportLocation(teamId, location).catch(() => null)))).filter(Boolean)
      : [];
    const documents = [];
    for (const location of locations) {
      const exported = await this.documents.exportLocation(teamId, location).catch(() => null);
      if (exported) documents.push(exported);
    }
    const exported = [...google, ...documents];
    this.exportedLocations.set(teamId, exported);
    const indexed = [...locations, ...exported].map(indexedLocation).filter(Boolean);
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
          let source = {};
          try {
            const path = knowledgeFile(location, relativePath);
            source = metadata(result.body, statSync(path));
          } catch { /* A search excerpt is still useful if a file changed after indexing. */ }
          return {
            kind: "file",
            id: `${location.id}:${relativePath}`,
            title: `${location.name}/${source.sourceName ?? relativePath}`,
            excerpt: extractSnippet(result.body, query, 240).snippet.replace(/\s+/g, " ").trim(),
            ...source,
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

  read(resultId, teamId, locations) {
    const separator = String(resultId).indexOf(":");
    if (separator < 1) throw new Error("Knowledge result not found");
    const locationId = String(resultId).slice(0, separator);
    const relativePath = String(resultId).slice(separator + 1);
    const location = [...locations, ...(this.exportedLocations.get(teamId) ?? [])]
      .find(({ id }) => id === locationId);
    if (!location || !teamId) throw new Error("Knowledge result is not available in this team");
    const path = knowledgeFile(location, relativePath);
    const stat = statSync(path);
    if (stat.size > 1_000_000) throw new Error("Knowledge documents must be smaller than 1 MB");
    const body = readFileSync(path, "utf8");
    const source = metadata(body, stat);
    return {
      kind: "file", id: resultId, title: `${location.name}/${source.sourceName ?? relativePath}`,
      content: body.slice(0, 200_000), truncated: body.length > 200_000,
      ...source
    };
  }
}
