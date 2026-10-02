import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { appDirectory, assertNothingRunning, busyWorkspaceIds } from "./data-folder.js";

/**
 * This computer's root folder, overrides per organization, team and MCP server,
 * and stable names for the automatically created folders.
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

/** Legacy installations stay here until the person chooses their root folder. */
const defaultRoot = () => process.env.BEES_DEFAULT_WORKSPACE;

/** A name safe to be a folder, the same way the folders under a root were always named. */
const folderName = (name, id) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || String(id);

/** A file this computer cannot read is worth less than a Bees that starts, so it reads as nothing set. */
function readRoots() {
  try { return JSON.parse(readFileSync(rootsFile(), "utf8")) ?? {}; } catch { return {}; }
}

/**
 * Organization and team folders. The old workspace level is read only until its files can migrate.
 * `anchor` is the folder a person picked at this level or above, so this level works only while that one is here.
 */
function levelsFor(workspace, picks = chosen) {
  let path = picks.root ?? "";
  let anchor = path;
  return LEVELS.filter(([level, idKey]) => workspace[idKey] != null &&
    (level !== "workspace" || !picks[`team-layout:${workspace.teamId}`])).map(([level, idKey, nameKey]) => {
    const picked = picks[`${level}:${workspace[idKey]}`] ?? "";
    if (picked) { path = picked; anchor = picked; }
    else if (path && !picks.root) path = join(path, folderName(workspace[nameKey], workspace[idKey]));
    else if (path && !(picks.root && level === "workspace" && workspace.name === "Default workspace" && !picks[`name:workspace:${workspace.teamId}:${workspace.id}`])) {
      const parent = level === "team" ? workspace.organizationId : level === "workspace" ? workspace.teamId : "";
      const prefix = `name:${level}:${parent}:`;
      const key = prefix + workspace[idKey];
      if (!picks[key]) {
        const name = folderName(workspace[nameKey], workspace[idKey]);
        const taken = Object.entries(picks).some(([key, value]) => key.startsWith(prefix) && value === name);
        picks[key] = taken || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) ? `${name}-${workspace[idKey]}` : name;
      }
      path = join(path, picks[key]);
    }
    return { level, id: workspace[idKey], name: workspace[nameKey], picked, anchor, folder: path || defaultRoot() };
  });
}

/** False when the folder someone set at this level or above is not on this computer. */
const onDisk = (row) => !row.anchor || (existsSync(row.anchor) && statSync(row.anchor).isDirectory());

/** The folder a person picked, as this computer sees it, empty when they are clearing one. */
function pickedFolder(directory) {
  const picked = String(directory ?? "").trim();
  if (!picked) return "";
  if (!isAbsolute(picked)) throw new Error("Choose an absolute folder path on this computer.");
  const target = resolve(picked);
  if (!existsSync(target) || !statSync(target).isDirectory())
    throw new Error("That folder is not on this computer. Pick one that exists here.");
  return realpathSync.native(target);
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
export function refreshFolderRoots(database, live) {
  opened = database;
  chosen = readRoots();
  const before = JSON.stringify(chosen);
  // Reserve names for organizations with no team yet as well, and keep names stable after renaming.
  if (chosen.root) for (const row of database.prepare("SELECT id AS organizationId, name AS organizationName FROM organizations ORDER BY created_at, id").all())
    levelsFor(row);
  roots = new Map(database.prepare(WORKSPACES).all().map((row) => [row.id, levelsFor(row)]));
  if (before !== JSON.stringify(chosen)) writeRoots(chosen);
  // Upgrade one team at a time. An active legacy workspace keeps its path until its work finishes.
  if (live) for (const { teamId } of database.prepare("SELECT DISTINCT team_id AS teamId FROM workspaces").all()) {
    if (chosen[`team-layout:${teamId}`]) continue;
    const next = { ...chosen, [`team-layout:${teamId}`]: true };
    const moving = movingRoots(database, next);
    const busy = busyWorkspaceIds(database, live);
    if (moving.some(({ id, missing }) => missing || busy.has(id) || busy.has(undefined))) continue;
    for (const { id } of moving) delete next[`legacy:${id}`];
    copyRuns(database, moving, live);
    copyWorkspaceFiles(moving);
    writeRoots(next);
    roots = new Map(database.prepare(WORKSPACES).all().map((row) => [row.id, levelsFor(row)]));
  }
}

/** A workspace made after the app opened is not in the map yet, and its folder may be inside one already set. */
const rootOf = (workspaceId) => {
  if (opened && workspaceId != null && !roots.has(workspaceId)) refreshFolderRoots(opened);
  return roots.get(workspaceId);
};

/** The folder a run in this workspace uses on this computer. */
export const workspaceRoot = (workspaceId) => rootOf(workspaceId)?.at(-1).folder ?? defaultRoot();
function nativeDirectory(workspaceId, root) {
  const teamId = rootOf(workspaceId)?.find(({ level }) => level === "team")?.id;
  const first = opened?.prepare("SELECT id FROM workspaces WHERE team_id = ? ORDER BY created_at, id LIMIT 1").get(teamId);
  // DSH requires a unique native directory. Additional workspaces keep session metadata below the
  // team folder, while workspaceRoot (and every run's files) still uses the shared team folder.
  return first && first.id !== workspaceId ? join(root, ".bees-workspaces", workspaceId) : root;
}
export const workspaceDirectory = (workspaceId) => chosen.root && !chosen[`legacy:${workspaceId}`]
  ? nativeDirectory(workspaceId, workspaceRoot(workspaceId)) : join(workspaceRoot(workspaceId), "workspaces", workspaceId);

/** The folder a team being made now will use, which has no workspace row of its own yet. */
export const rootForWorkspace = (workspace) => {
  chosen[`team-layout:${workspace.teamId}`] = true;
  const row = levelsFor(workspace).at(-1);
  if (!onDisk(row)) throw new Error(`${row.anchor} is unavailable. Reconnect it or choose another folder in Settings.`);
  const root = row.folder;
  const folder = chosen.root ? root : join(root, "workspaces", workspace.id);
  writeRoots(chosen);
  return folder;
};

export const rootFolderChoice = () => ({ folder: chosen.root ?? "", missing: !!chosen.root && !onDisk({ anchor: chosen.root }) });

export function organizationFolderChoice(database, organizationId) {
  const row = database.prepare("SELECT id AS organizationId, name AS organizationName FROM organizations WHERE id = ?").get(organizationId);
  if (!row) return null;
  const choice = levelsFor(row)[0];
  return { ...choice, missing: !onDisk(choice) };
}

/** False when a folder a person set is not on this computer, which stops its runs. */
export const rootOnDisk = (workspaceId) => {
  const row = rootOf(workspaceId)?.at(-1);
  return !row || onDisk(row);
};

export function assertRootOnDisk(workspaceId) {
  const row = rootOf(workspaceId)?.at(-1);
  const gone = row && !onDisk(row) ? row : null;
  if (gone)
    throw new Error(`${gone.anchor} is the folder you set for the ${gone.level} ${gone.name}, and it is not on this computer. `
      + "Reconnect it, or choose another folder in root, organization or team settings.");
}

/** Only organization and team settings; workspaces share their team's folder. */
export function folderChoices(database, workspaceId) {
  const workspace = database.prepare(`${WORKSPACES} WHERE w.id = ?`).get(workspaceId);
  return workspace ? levelsFor(workspace).filter(({ level }) => level !== "workspace")
    .map((row) => ({ ...row, missing: !onDisk(row) })) : [];
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
  SELECT c.directory FROM bees_context_results c JOIN bees_context_runs r ON r.execution_id = c.execution_id
    JOIN bees_work_contexts x ON x.id = r.context_id JOIN work_items w ON w.id = x.root_id
    JOIN processes p ON p.id = w.process_id
    WHERE p.workspace_id = ? AND c.directory IS NOT NULL
  UNION
  SELECT r.directory FROM bees_run_resources r JOIN work_items w ON w.id = r.root_id
    JOIN processes p ON p.id = w.process_id WHERE p.workspace_id = ? AND r.directory IS NOT NULL`;

/** Every workspace whose folder moves when `picks` takes effect, with the folder it uses before and after. */
const movingRoots = (database, picks) => database.prepare(WORKSPACES).all()
  .map((row) => {
    const target = levelsFor(row, picks).at(-1);
    return { id: row.id, teamId: row.teamId, name: row.name, from: workspaceRoot(row.id), to: target.folder, missing: !onDisk(target) };
  })
  .filter((row) => row.from !== row.to);

/**
 * Copies the runs already written under the old folder to the new one, so a stored run and its files
 * still meet. The old folder is left alone: it may be a synced folder another computer still reads.
 */
function copyRuns(database, moving, live) {
  if (!moving.length) return;
  assertNothingRunning(database, live, moving.map(({ id }) => id));
  for (const row of moving) for (const { folder } of database.prepare(STORED_RUNS).all(row.id, row.id, row.id)) {
    const source = resolveStored(row.id, folder);
    if (!existsSync(source)) continue;
    const target = join(row.to, folder);
    mkdirSync(dirname(target), { recursive: true });
    // a picked folder is usually another disk, so copy, and keep the newer file so neither computer's work is undone
    cpSync(source, target, { recursive: true, preserveTimestamps: true,
      filter: (from, to) => !existsSync(to) || statSync(from).isDirectory() || statSync(from).mtimeMs > statSync(to).mtimeMs });
  }
}

/** Copy workspace files without removing originals or copying a nested destination into itself. */
function copyWorkspaceFiles(moving) {
  const copy = (source, target, destination) => {
    mkdirSync(target, { recursive: true });
    source = realpathSync.native(source);
    target = realpathSync.native(target);
    destination ??= target;
    if (source === target) return;
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = join(source, entry.name), to = join(target, entry.name);
      if (from === destination) continue;
      if (entry.isDirectory()) copy(from, to, destination);
      else cpSync(from, to, { preserveTimestamps: true,
        filter: (from, to) => !existsSync(to) || statSync(from).mtimeMs > statSync(to).mtimeMs });
    }
  };
  for (const row of moving) {
    const source = workspaceDirectory(row.id);
    const target = nativeDirectory(row.id, row.to);
    if (existsSync(source)) copy(source, target);
    mkdirSync(row.to, { recursive: true });
  }
}

/** Points a level at a folder on this computer, or clears it back to the level above. */
export function setFolderRoot(database, { level, id, directory, live }) {
  if (!["root", "organization", "team"].includes(level)) throw new Error("Choose a root, organization or team folder. Workspaces use their team's folder.");
  const target = pickedFolder(directory);
  if (level === "root" && !target) throw new Error("Choose a root folder to keep your organization and team files.");
  const next = { ...chosen };
  const key = level === "root" ? "root" : `${level}:${id}`;
  if (target) next[key] = target;
  else delete next[key];
  if (level === "team") next[`team-layout:${id}`] = true;
  if (!chosen.root && next.root) {
    const busy = busyWorkspaceIds(database, live);
    const workspaces = database.prepare(WORKSPACES).all();
    for (const workspace of workspaces) {
      const levels = rootOf(workspace.id) ?? levelsFor(workspace);
      const pickedAt = levels.findLastIndex(({ picked }) => picked);
      if (pickedAt < 0 && !busy.has(workspace.id) && !busy.has(undefined)) continue;
      // Keep legacy overrides independent of global setup, including their native workspace directory.
      next[`legacy:${workspace.id}`] = true;
      // Retain the effective old folder as a team override, independent of the new global root.
      // ponytail: quadratic only on first root setup; group roots by team if installations grow large.
      if (new Set(workspaces.filter(({ teamId }) => teamId === workspace.teamId).map(({ id }) => workspaceRoot(id))).size === 1) {
        next[`team:${workspace.teamId}`] = workspaceRoot(workspace.id);
        next[`team-layout:${workspace.teamId}`] = true;
      } else next[`workspace:${workspace.id}`] = workspaceRoot(workspace.id);
    }
  }
  // A deliberate change to a legacy branch adopts the current layout; global setup leaves it alone.
  for (const row of movingRoots(database, next)) if (chosen[`legacy:${row.id}`]) {
    delete next[`legacy:${row.id}`];
    if (row.name === "Default workspace") delete next[`name:workspace:${row.teamId}:${row.id}`];
  }
  const moving = movingRoots(database, next);
  if (moving.some(({ missing }) => missing)) throw new Error("The inherited folder is unavailable. Reconnect it or choose an available folder.");
  copyRuns(database, moving, live);
  copyWorkspaceFiles(moving);
  writeRoots(next);
  refreshFolderRoots(database);
}
