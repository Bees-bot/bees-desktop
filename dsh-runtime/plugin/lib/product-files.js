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

function walkLocation(location, onFile) {
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
    if (files >= 1_000 || bytes >= 250_000_000) return false;
    const stat = lstatSync(source);
    const target = resolve(destination, logical);
    if (!logical || logical === ".." || logical.startsWith(`..${sep}`) || !target.startsWith(`${destination}${sep}`)) return;
    if (stat.size > 20_000_000 || bytes + stat.size > 250_000_000) return;
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(source, target);
    files += 1;
    bytes += stat.size;
  });
}

function stagedLocation(location, relativePath) {
  const relativeName = String(relativePath ?? "").trim();
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

export function stageInputs(database, itemId, runDirectory) {
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
    )
    SELECT l.id, l.name, l.kind, r.relative_path AS relativePath, m.absolute_path AS localPath
    FROM refs r
    JOIN team_locations l ON l.id = r.location_id
    JOIN work_items w ON w.id = ?
    JOIN processes p ON p.id = w.process_id
    JOIN workspaces ws ON ws.id = p.workspace_id AND ws.team_id = l.team_id
    LEFT JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.archived_at IS NULL ORDER BY l.name
  `).all(itemId, itemId, itemId, deviceId);
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
  }
  return locations;
}

export function outputFiles(runDirectory) {
  const root = resolve(runDirectory, "outputs");
  try {
    const canonical = realpathSync(root);
    const files = [];
    const stack = [canonical];
    while (stack.length && files.length < 100) {
      const directory = stack.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile()) files.push(relative(canonical, path));
        if (files.length >= 100) break;
      }
    }
    return files;
  } catch { /* a run may not have created this directory yet */
    return [];
  }
}

export function previewFiles(runDirectory) {
  const files = [];
  for (const rootName of ["inputs", "outputs"]) {
    try {
      const root = realpathSync(resolve(runDirectory, rootName));
      const stack = [root];
      while (stack.length && files.length < 200) {
        const directory = stack.pop();
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) stack.push(path);
          else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(path).toLowerCase()) && lstatSync(path).size <= 1_000_000)
            files.push(`${rootName}/${relative(root, path)}`);
          if (files.length >= 200) break;
        }
      }
    } catch { /* a run may not have created this directory yet */ }
  }
  return files.sort();
}
