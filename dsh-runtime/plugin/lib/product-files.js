import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync
} from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { currentIdentity, required } from "./product-database.js";

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".html", ".css", ".js", ".ts", ".py", ".rs", ".toml"
]);

export function mappedLocation(database, locationId) {
  const { deviceId } = currentIdentity(database);
  return database.prepare(`
    SELECT l.id, l.name, l.kind, l.team_id AS teamId, m.absolute_path AS localPath
    FROM team_locations l
    LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.id = ? AND l.archived_at IS NULL
  `).get(deviceId, locationId);
}

export function canonicalMapping(path, kind) {
  const canonical = realpathSync(required(path, kind === "file" ? "File" : "Folder"));
  const stat = lstatSync(canonical);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory())
    throw new Error(`The selected path is not a ${kind}`);
  return canonical;
}

export function logicalRelativePath(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  if (!raw) return "";
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw) || raw.includes("\0"))
    throw new Error("A location reference must be a relative path");
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new Error("A location reference cannot leave its mapped location");
  return parts.join("/");
}

export function walkLocation(location, onFile) {
  const root = realpathSync(location.localPath);
  const rootStat = lstatSync(root);
  if (location.kind === "file") {
    if (!rootStat.isFile()) throw new Error(`${location.name} is not available as a file on this device`);
    onFile(root, basename(root));
    return;
  }
  if (!rootStat.isDirectory()) throw new Error(`${location.name} is not available as a folder on this device`);
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && onFile(path, relative(root, path)) === false) return;
    }
  }
}

export function stageLocation(location, destination) {
  let files = 0;
  let bytes = 0;
  walkLocation(location, (source, logical) => {
    if (files >= 1_000 || bytes >= 250_000_000)
      throw new Error(`${location.name} exceeds the 1,000 file or 250 MB input limit`);
    const stat = lstatSync(source);
    const target = resolve(destination, logical);
    if (!logical || logical === ".." || logical.startsWith(`..${sep}`) || !target.startsWith(`${destination}${sep}`)) return;
    if (stat.size > 20_000_000 || bytes + stat.size > 250_000_000)
      throw new Error(`${location.name} contains a file larger than 20 MB or exceeds the 250 MB input limit`);
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(source, target);
    files += 1;
    bytes += stat.size;
  });
}

export function stagedLocation(location, relativePath) {
  const relativeName = logicalRelativePath(relativePath);
  if (!relativeName) return location;
  if (location.kind === "file") throw new Error(`${location.name} is already a file and cannot use a child path`);
  const root = realpathSync(location.localPath);
  const selected = realpathSync(resolve(root, relativeName));
  if (selected !== root && !selected.startsWith(`${root}${sep}`))
    throw new Error(`The reference for ${location.name} escaped its mapped folder`);
  const stat = lstatSync(selected);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`The reference for ${location.name} is unavailable`);
  return { ...location, localPath: selected, kind: stat.isFile() ? "file" : "folder" };
}

export function stageInputs(database, itemId, runDirectory, agentId = null) {
  const inputRoot = resolve(runDirectory, "inputs");
  mkdirSync(inputRoot, { recursive: true });
  mkdirSync(resolve(runDirectory, "outputs"), { recursive: true });
  const { deviceId } = currentIdentity(database);
  const locations = database.prepare(`
    WITH refs(location_id, relative_path) AS (
      SELECT location_id, relative_path FROM work_item_locations WHERE work_item_id = ?
      UNION
      SELECT pl.location_id, pl.relative_path FROM process_locations pl
      JOIN work_items wi ON wi.process_id = pl.process_id WHERE wi.id = ?
      UNION
      SELECT location_id, relative_path FROM agent_locations WHERE agent_assignment_id = ?
    )
    SELECT l.id, l.name, l.kind, r.relative_path AS relativePath, m.absolute_path AS localPath
    FROM refs r
    JOIN team_locations l ON l.id = r.location_id
    JOIN work_items w ON w.id = ?
    JOIN processes p ON p.id = w.process_id
    JOIN workspaces ws ON ws.id = p.workspace_id AND ws.team_id = l.team_id
    LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.archived_at IS NULL ORDER BY l.name
  `).all(itemId, itemId, agentId, itemId, deviceId);
  return stageInputLocations(locations, runDirectory);
}

export function stageInputLocations(locations, runDirectory) {
  const inputRoot = resolve(runDirectory, "inputs");
  for (const location of locations) {
    if (!location.localPath) throw new Error(`${location.name} is not mapped on this device`);
    // realpathSync below reports a bare "ENOENT ... lstat <path>", which tells a person nothing
    // about which mapped folder went missing or that a mapping is what broke their run.
    if (!existsSync(location.localPath))
      throw new Error(`${location.name} is mapped to ${location.localPath}, which is not on this device any more`);
    const selected = stagedLocation(location, location.relativePath);
    const suffix = location.relativePath
      ? `-${createHash("sha256").update(location.relativePath).digest("hex").slice(0, 8)}`
      : "";
    const directory = resolve(inputRoot, `${location.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${location.id.slice(0, 8)}${suffix}`);
    mkdirSync(directory, { recursive: true });
    stageLocation(selected, directory);
    location.stagedPath = relative(runDirectory, directory).replaceAll("\\", "/");
  }
  return locations;
}

export function inputManifest(locations) {
  if (!locations.length) return "";
  return `Available input snapshots:\n${locations.map(({ name, stagedPath }) => `- ${name}: ${stagedPath}`).join("\n")}`;
}

export function outputLocation(database, itemId) {
  return database.prepare(`
    SELECT coalesce(w.output_location_id, p.output_location_id) AS id
    FROM work_items w JOIN processes p ON p.id = w.process_id WHERE w.id = ?
  `).get(itemId)?.id ?? null;
}

/** Regular files under root, symlinks skipped, at most `limit` of the ones `keep` accepts. */
function walk(root, limit, keep = () => true) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < limit) {
    const directory = stack.pop();
    // Agents write these folders while we read them. One unreadable subfolder must cost that
    // subfolder, not every file already found, which reached a reviewer as "produced nothing".
    let entries = [];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && keep(path)) files.push(path);
      if (files.length >= limit) break;
    }
  }
  return files;
}

export function outputFiles(runDirectory) {
  try {
    const root = realpathSync(resolve(runDirectory, "outputs"));
    return walk(root, 100).map((path) => relative(root, path));
  } catch { /* a run may not have created this directory yet */
    return [];
  }
}

export function previewFiles(runDirectory) {
  const files = [];
  // A file replaced between listing it and sizing it is one file to skip, not a failed preview.
  const text = (path) => {
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return false;
    try { return lstatSync(path).size <= 1_000_000; } catch { return false; }
  };
  for (const rootName of ["inputs", "outputs"]) {
    try {
      const root = realpathSync(resolve(runDirectory, rootName));
      files.push(...walk(root, 200 - files.length, text).map((path) => `${rootName}/${relative(root, path)}`));
    } catch { /* a run may not have created this directory yet */ }
  }
  return files.sort();
}
