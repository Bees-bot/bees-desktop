import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { appDirectory } from "./data-folder.js";

/**
 * Where an organization, a team and a workspace keep their folders on this computer.
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
let namedRoot = "";

const rootsFile = () => join(appDirectory(), "roots.json");

/** The folder the app names at startup, where runs live until a workspace is given one of its own. */
export const setDefaultRoot = (path) => { if (path) namedRoot = path; };

const defaultRoot = () => namedRoot || process.env.BEES_DEFAULT_WORKSPACE;

/** A name safe to be a folder, the same way the folders under a root were always named. */
const folderName = (name, id) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || String(id);

/** A file this computer cannot read is worth less than a Bees that starts, so it reads as nothing set. */
function readRoots() {
  try { return JSON.parse(readFileSync(rootsFile(), "utf8")) ?? {}; } catch { return {}; }
}

/**
 * The three levels for one workspace: the folder picked for each, and the folder it ends up using.
 * `mount` is the picked folder a level sits under, so the level is usable only while that one is here.
 */
function levelsFor(workspace, picks = chosen) {
  let path = "";
  let mount = "";
  return LEVELS.map(([level, idKey, nameKey]) => {
    const picked = picks[`${level}:${workspace[idKey]}`] ?? "";
    if (picked) { path = picked; mount = picked; }
    else if (path) path = join(path, folderName(workspace[nameKey], workspace[idKey]));
    return { level, id: workspace[idKey], name: workspace[nameKey], picked, mount, folder: path || defaultRoot() };
  });
}

/** False when the folder someone set at this level or above is not on this computer. */
const onDisk = (row) => !row.mount || existsSync(row.mount);

/** The folder a person picked for one MCP server: its program runs here, so its folder is this computer's. */
export const serverFolder = (serverId) => chosen[`server:${serverId}`] ?? "";

export function setServerFolder(serverId, directory) {
  const picked = String(directory ?? "").trim();
  const target = picked && resolve(picked);
  if (target && (!existsSync(target) || !statSync(target).isDirectory()))
    throw new Error("That folder is not on this computer. Pick one that exists here.");
  const next = readRoots();
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
    throw new Error(`${gone.mount} is the folder you set for the ${gone.level} ${gone.name}, and it is not on this computer. `
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
  // a whole path is what a build before this one wrote, and it still means what it did on the
  // computer that wrote it, so it is read as it stands rather than hiding the folder it names
  if (isAbsolute(String(stored ?? ""))) return String(stored);
  if (!stored || String(stored).split("/").includes(".."))
    throw new Error(`A stored folder has to be a path inside its workspace, and this one is ${stored || "empty"}`);
  return resolve(workspaceRoot(workspaceId), stored);
}

// every run folder the database names for one workspace, which is what moves with its root
const STORED_RUNS = `SELECT run_directory AS folder FROM execution_links WHERE workspace_id = ?
  UNION
  SELECT 'runs/' || r.root_id FROM bees_run_resources r JOIN work_items w ON w.id = r.root_id
    JOIN processes p ON p.id = w.process_id WHERE p.workspace_id = ?`;

/** Every workspace whose folder moves when `picks` takes effect, with the folder it uses before and after. */
const movingRoots = (database, picks) => database.prepare(WORKSPACES).all()
  .map((row) => ({ id: row.id, from: workspaceRoot(row.id), to: levelsFor(row, picks).at(-1).folder }))
  .filter((row) => row.from !== row.to);

/**
 * Copies the runs already written under the old folder to the new one, so a stored run and its files
 * still meet. Nothing is deleted here: the copies are complete before the folders file changes.
 */
function copyRuns(database, moving) {
  if (!moving.length) return [];
  const busy = database.prepare(`SELECT count(*) AS count FROM execution_links
    WHERE workspace_id IN (${moving.map(() => "?").join(",")})
      AND status IN ('queued', 'running', 'waiting_for_input', 'waiting_for_approval')`)
    .get(...moving.map((row) => row.id)).count;
  if (busy) throw new Error("Wait for what is running to finish, then choose the folder");
  const copied = [];
  for (const row of moving) for (const { folder } of database.prepare(STORED_RUNS).all(row.id, row.id)) {
    const source = join(row.from, folder);
    if (!existsSync(source)) continue;
    const target = join(row.to, folder);
    mkdirSync(dirname(target), { recursive: true });
    // a picked folder is usually another disk, where a rename will not do
    cpSync(source, target, { recursive: true });
    copied.push(source);
  }
  return copied;
}

/** Points a level at a folder on this computer, or clears it back to the level above. */
export function setFolderRoot(database, { level, id, directory }) {
  if (!LEVELS.some(([name]) => name === level)) throw new Error("A folder is set for an organization, a team or a workspace");
  const picked = String(directory ?? "").trim();
  const next = { ...chosen };
  if (!picked) delete next[`${level}:${id}`];
  else {
    const target = resolve(picked);
    if (!existsSync(target) || !statSync(target).isDirectory())
      throw new Error("That folder is not on this computer. Pick one that exists here.");
    next[`${level}:${id}`] = target;
  }
  const copied = copyRuns(database, movingRoots(database, next));
  writeRoots(next);
  for (const path of copied) rmSync(path, { recursive: true, force: true });
  refreshFolderRoots(database);
}
