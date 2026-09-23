import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { appDirectory, assertNothingRunning } from "./data-folder.js";

/**
 * The folders a person picked for this computer: one per organization, team, workspace and MCP server.
 *
 * The database is shared between computers, so it never holds a path: it holds the part below the
 * workspace's folder. The folders themselves differ per computer, so they live in a file beside the
 * app instead of in the shared database. A level with no folder of its own sits inside the one above.
 */
const LEVELS = [
  ["organization", "organizationId", "organizationName"],
  ["team", "teamId", "teamName"],
  ["workspace", "id", "name"]
];

const WORKSPACES = `SELECT w.id, w.name, w.team_id AS teamId, t.name AS teamName,
       t.organization_id AS organizationId, o.name AS organizationName
  FROM workspaces w
  JOIN teams t ON t.id = w.team_id
  JOIN organizations o ON o.id = t.organization_id`;

let chosen = {};
let roots = new Map();
let opened = null;

const rootsFile = () => join(appDirectory(), "roots.json");

/** Where runs live until a workspace is given a folder of its own. */
const defaultRoot = () => process.env.BEES_DEFAULT_WORKSPACE;

/** A name safe to be a folder, the same way the folders under a root were always named. */
const folderName = (name, id) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || String(id);

/** A file this computer cannot read is worth less than a Bees that starts, so it reads as nothing set. */
function readRoots() {
  try { return JSON.parse(readFileSync(rootsFile(), "utf8")) ?? {}; } catch { return {}; }
}

/**
 * The three levels for one workspace: the folder picked for each, and the folder it ends up using.
 * `anchor` is the folder a person picked at this level or above, so this level works only while that one is here.
 */
function levelsFor(workspace, picks = chosen) {
  let path = "";
  let anchor = "";
  return LEVELS.map(([level, idKey, nameKey]) => {
    const picked = picks[`${level}:${workspace[idKey]}`] ?? "";
    if (picked) { path = picked; anchor = picked; }
    else if (path) path = join(path, folderName(workspace[nameKey], workspace[idKey]));
    return { level, id: workspace[idKey], name: workspace[nameKey], picked, anchor, folder: path || defaultRoot() };
  });
}

/** False when the folder someone set at this level or above is not on this computer. */
const onDisk = (row) => !row.anchor || existsSync(row.anchor);

/** The folder a person picked, as this computer sees it, empty when they are clearing one. */
function pickedFolder(directory) {
  const picked = String(directory ?? "").trim();
  if (!picked) return "";
  const target = resolve(picked);
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer. Pick one that exists here.");
  return target;
}

/** The folder a person picked for one MCP server: its program runs here, so its folder is this computer's. */
export const serverFolder = (serverId) => chosen[`server:${serverId}`] ?? "";

/** Points one MCP server at a folder here, or clears it so the server stays unmounted. */
export function setServerFolder(serverId, directory) {
  const target = pickedFolder(directory);
  const next = { ...chosen };
  if (target) next[`server:${serverId}`] = target;
  else delete next[`server:${serverId}`];
  writeRoots(next);
}

/** Renamed in last, so a write that dies halfway never leaves a file the next boot cannot read. */
function writeRoots(next) {
  writeFileSync(`${rootsFile()}.writing`, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(`${rootsFile()}.writing`, rootsFile());
  chosen = next;
}

/** Reads the roots file and works out where every workspace keeps its folders on this computer. */
export function refreshFolderRoots(database) {
  opened = database;
  chosen = readRoots();
  roots = new Map(database.prepare(WORKSPACES).all().map((row) => [row.id, levelsFor(row)]));
}

/** A workspace made after the app opened is not in the map yet, and its folder may be inside one already set. */
const rootOf = (workspaceId) => {
  if (opened && workspaceId != null && !roots.has(workspaceId)) refreshFolderRoots(opened);
  return roots.get(workspaceId);
};

/** The folder a run in this workspace uses on this computer. */
export const workspaceRoot = (workspaceId) => rootOf(workspaceId)?.at(-1).folder ?? defaultRoot();

/** The folder a team being made now will use, which has no workspace row of its own yet. */
export const rootForWorkspace = (workspace) => levelsFor(workspace).at(-1).folder;

/** False when a folder a person set is not on this computer, which stops its runs. */
export const rootOnDisk = (workspaceId) => (rootOf(workspaceId) ?? []).every(onDisk);

export function assertRootOnDisk(workspaceId) {
  const gone = (rootOf(workspaceId) ?? []).find((row) => !onDisk(row));
  if (gone)
    throw new Error(`${gone.anchor} is the folder you set for the ${gone.level} ${gone.name}, and it is not on this computer. `
      + "Reconnect it, or clear it in Settings, Folders.");
}

/** The three levels for the Settings screen, and nothing for a workspace that is not there. */
export function folderChoices(database, workspaceId) {
  const workspace = database.prepare(`${WORKSPACES} WHERE w.id = ?`).get(workspaceId);
  return workspace ? levelsFor(workspace).map((row) => ({ ...row, missing: !onDisk(row) })) : [];
}

/** What goes into the database: the part of a path below the workspace's folder, which every computer reads the same. */
export function shortPath(workspaceId, path) {
  const root = workspaceRoot(workspaceId);
  const below = relative(root, path);
  if (!below || below.startsWith(`..${sep}`) || below === ".." || isAbsolute(below))
    throw new Error(`${path} is not inside ${root}, the folder this workspace uses`);
  return below.split(sep).join("/");
}

/** What comes back out: the same stored value read against this computer's own folder. */
export function resolveStored(workspaceId, stored) {
  if (!stored || isAbsolute(stored) || String(stored).split("/").includes(".."))
    throw new Error(`A stored folder has to be a path inside its workspace, and this one is ${stored || "empty"}`);
  return resolve(workspaceRoot(workspaceId), stored);
}

// every run folder the database names for one workspace, which is what moves with its root
const STORED_RUNS = `SELECT run_directory AS folder FROM execution_links WHERE workspace_id = ?
  UNION
  SELECT r.directory FROM bees_run_resources r JOIN work_items w ON w.id = r.root_id
    JOIN processes p ON p.id = w.process_id WHERE p.workspace_id = ? AND r.directory IS NOT NULL`;

/** Every workspace whose folder moves when `picks` takes effect, with the folder it uses before and after. */
const movingRoots = (database, picks) => database.prepare(WORKSPACES).all()
  .map((row) => ({ id: row.id, from: workspaceRoot(row.id), to: levelsFor(row, picks).at(-1).folder }))
  .filter((row) => row.from !== row.to);

/**
 * Copies the runs already written under the old folder to the new one, so a stored run and its files
 * still meet. The old folder is left alone: it may be a synced folder another computer still reads.
 */
function copyRuns(database, moving, live) {
  if (!moving.length) return;
  assertNothingRunning(database, live);
  for (const row of moving) for (const { folder } of database.prepare(STORED_RUNS).all(row.id, row.id)) {
    const source = resolveStored(row.id, folder);
    if (!existsSync(source)) continue;
    const target = join(row.to, folder);
    mkdirSync(dirname(target), { recursive: true });
    // a picked folder is usually another disk, so copy, and keep the newer file so neither computer's work is undone
    cpSync(source, target, { recursive: true, preserveTimestamps: true,
      filter: (from, to) => !existsSync(to) || statSync(from).isDirectory() || statSync(from).mtimeMs > statSync(to).mtimeMs });
  }
}

/** Points a level at a folder on this computer, or clears it back to the level above. */
export function setFolderRoot(database, { level, id, directory, live }) {
  if (!LEVELS.some(([name]) => name === level)) throw new Error("A folder is set for an organization, a team or a workspace");
  const target = pickedFolder(directory);
  const next = { ...chosen };
  if (target) next[`${level}:${id}`] = target;
  else delete next[`${level}:${id}`];
  copyRuns(database, movingRoots(database, next), live);
  writeRoots(next);
  refreshFolderRoots(database);
}
