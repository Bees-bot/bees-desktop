import { basename } from "node:path";
import { existsSync } from "node:fs";
import { currentIdentity, workspaceContext } from "./product-database.js";
import { canonicalMapping, logicalRelativePath, mappedLocation, stagedLocation, walkLocation } from "./product-files.js";

const KINDS = { agent: "agent", human: "human", work: "work-item", "work-item": "work-item", template: "process-template", "process-template": "process-template",
  file: "file", process: "process", location: "location", org: "organization", organization: "organization",
  team: "team", workspace: "workspace" };
export const referenceSlug = (value) => String(value).normalize("NFKD").toLocaleLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "");
export const referenceText = ({ namespace = "$", label, kind, id }) =>
  `${namespace}[${String(label).replace(/[\[\]\r\n]/g, " ").trim().slice(0, 160)}](bees:${kind}:${id})`;

/** Keep code and escaped dollars literal. Bare dollar names always mean user-created agents. */
function tokens(value) {
  const pattern = /```[\s\S]*?```|`[^`\n]*`|(?<![\p{Letter}\p{Number}_\\])([@$])\[([^\]\n]{1,160})\]\(bees:([a-z-]+):([^)\s]{1,2048})\)|(?<![\p{Letter}\p{Number}_\\])\$([\p{Letter}_][\p{Letter}\p{Number}_-]{0,79})(?::("[^"\n]+"|[\p{Letter}\p{Number}_.%/\\-]+))?/gu;
  return [...String(value ?? "").matchAll(pattern)].filter((match) => match[1] || match[5]);
}

export function typedReferences(value) {
  return tokens(value).filter((match) => match[1]).map((match) =>
    ({ namespace: match[1], label: match[2], kind: match[3], id: match[4] }));
}

/** Shared by autocomplete, shorthand resolution, and runtime authorization. */
export function referenceRows(database, workspaceId) {
  const workspace = workspaceContext(database, workspaceId);
  return [
    ...database.prepare(`SELECT id, name AS label, 'agent' AS kind, description
      FROM agent_assignments WHERE workspace_id = ? AND enabled = 1`).all(workspaceId),
    ...database.prepare(`SELECT DISTINCT u.id, u.name AS label, 'human' AS kind FROM users u
      LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = ? AND tm.status = 'active'
      LEFT JOIN teams t ON t.id = ? LEFT JOIN organization_memberships om ON om.user_id = u.id
        AND om.organization_id = t.organization_id AND om.status = 'active'
      WHERE tm.user_id IS NOT NULL OR om.role IN ('owner', 'admin')`).all(workspace.teamId, workspace.teamId),
    ...database.prepare(`SELECT w.id, w.title AS label, 'work-item' AS kind, w.description,
        w.runtime_phase AS phase, p.name AS process FROM work_items w JOIN processes p ON p.id = w.process_id
      WHERE p.workspace_id = ? AND w.deleted_at IS NULL`).all(workspaceId),
    ...database.prepare(`SELECT id, name AS label, 'process' AS kind, description
      FROM processes WHERE workspace_id = ? AND archived_at IS NULL`).all(workspaceId),
    ...database.prepare(`SELECT id, name AS label, 'process-template' AS kind, description, stages_json AS stagesJson
      FROM process_templates WHERE workspace_id = ? AND archived_at IS NULL`).all(workspaceId),
    ...database.prepare(`SELECT id, name AS label, 'location' AS kind, description
      FROM team_locations WHERE team_id = ? AND archived_at IS NULL`).all(workspace.teamId),
    ...database.prepare(`SELECT id, name AS label, 'team' AS kind FROM teams WHERE id = ?`).all(workspace.teamId),
    ...database.prepare(`SELECT o.id, o.name AS label, 'organization' AS kind
      FROM organizations o JOIN teams t ON t.organization_id = o.id WHERE t.id = ?`).all(workspace.teamId),
    { id: workspaceId, label: workspace.name, kind: "workspace" }
  ];
}

function fileTarget(database, workspaceId, id) {
  const split = id.indexOf("/");
  if (split < 1) throw new Error("A file reference needs a mapped location and relative file path");
  const locationId = id.slice(0, split);
  const relativePath = logicalRelativePath(decodeURIComponent(id.slice(split + 1)));
  if (relativePath.split("/").some((part) => part.startsWith("."))) throw new Error("Hidden files cannot be referenced");
  const workspace = workspaceContext(database, workspaceId);
  const location = mappedLocation(database, locationId);
  if (!location || location.teamId !== workspace.teamId) throw new Error("File reference is unavailable in this workspace");
  if (!location.localPath) throw new Error(`${location.name} is not mapped on this device`);
  canonicalMapping(location.localPath, location.kind);
  const selected = stagedLocation(location, relativePath);
  if (selected.kind !== "file") throw new Error("Choose a file inside the mapped folder");
  return { ...location, relativePath };
}

/** File identity is a mapped location id plus an encoded relative path, never an absolute path. */
export function fileReferences(database, workspaceId, query) {
  const workspace = workspaceContext(database, workspaceId);
  const { deviceId } = currentIdentity(database);
  const locations = database.prepare(`SELECT l.id, l.name, l.kind, m.absolute_path AS localPath
    FROM team_locations l JOIN device_location_mappings m ON m.location_id = l.id AND m.device_id = ?
    WHERE l.team_id = ? AND l.archived_at IS NULL`).all(deviceId, workspace.teamId);
  const wanted = String(query).toLocaleLowerCase();
  const rows = [];
  let scanned = 0;
  for (const location of locations) {
    const prefix = [location.name, referenceSlug(location.name), location.id].find((name) => wanted.startsWith(`${name.toLocaleLowerCase()}/`));
    if (prefix) {
      const relativePath = logicalRelativePath(query.slice(prefix.length + 1));
      const id = `${location.id}/${encodeURIComponent(relativePath)}`;
      fileTarget(database, workspaceId, id);
      rows.push({ id, kind: "file", label: `${location.name}/${relativePath}` });
      continue;
    }
    if (wanted.includes("/")) continue;
    if (!existsSync(location.localPath)) continue;
    walkLocation(location, (_path, logical) => {
      if (++scanned > 10_000) throw new Error("Too many files to match by name; use $file:folder/relative/path");
      if (![basename(logical), location.kind === "file" ? location.name : ""].some((name) => name.toLocaleLowerCase() === wanted)) return;
      const relativePath = location.kind === "file" ? "" : logical.replaceAll("\\", "/");
      rows.push({ id: `${location.id}/${encodeURIComponent(relativePath)}`, kind: "file", label: location.kind === "file" ? location.name : `${location.name}/${relativePath}` });
    });
  }
  return rows;
}

export function resolveReference(database, workspaceId, kind, value, byId = false) {
  if (kind === "file" && byId) {
    const location = fileTarget(database, workspaceId, value);
    return { kind, id: `${location.id}/${encodeURIComponent(location.relativePath)}`,
      label: location.relativePath ? `${location.name}/${location.relativePath}` : location.name };
  }
  const candidates = kind === "file" ? fileReferences(database, workspaceId, value)
    : referenceRows(database, workspaceId).filter((row) => row.kind === kind);
  const exact = candidates.find((row) => row.id === value);
  const matches = exact ? [exact] : byId ? [] : candidates.filter((row) => kind === "file" || referenceSlug(row.label) === referenceSlug(value));
  if (!matches.length) throw new Error(`The ${kind} reference "${value}" is unavailable in this workspace`);
  if (matches.length > 1) throw new Error(`The ${kind} reference "${value}" is ambiguous. Choose one: ${matches.map(referenceText).join(", ")}`);
  return matches[0];
}

export function authorizeReferences(database, workspaceId, references) {
  if (!references.length) return;
  if (!workspaceId) throw new Error("Typed Bees references require a workspace scope");
  for (const reference of references) resolveReference(database, workspaceId, reference.kind, reference.id, true);
}

export function resolveReferences(database, workspaceId, value) {
  const source = String(value ?? "");
  const matches = tokens(source);
  if (matches.length > 32) throw new Error("Use at most 32 Bees references in one request");
  let text = "";
  let end = 0;
  const references = [];
  for (const match of matches) {
    if (!match[1] && !match[6] && KINDS[match[5].toLocaleLowerCase()] && source[match.index + match[0].length] === ":")
      throw new Error(`Add a name after $${match[5]}:`);
    const kind = match[1] ? match[3] : match[6] ? KINDS[match[5].toLocaleLowerCase()] : "agent";
    if (!kind) throw new Error(`Unknown reference type: ${match[5]}`);
    const value = match[1] ? match[4] : (match[6] ?? match[5]).replace(/^"|"$/g, "").replace(/\.+$/, "");
    const row = resolveReference(database, workspaceId, kind, value, Boolean(match[1]));
    const reference = { namespace: match[1] ?? "$", label: row.label, kind, id: row.id };
    const length = match[1] || match[6]?.startsWith('"') ? match[0].length : match[0].replace(/\.+$/, "").length;
    text += source.slice(end, match.index) + referenceText(reference);
    end = match.index + length;
    if (!references.some((prior) => prior.kind === kind && prior.id === row.id)) references.push(reference);
  }
  return { text: text + source.slice(end), references };
}

export function referenceInputs(database, workspaceId, references) {
  return references.filter(({ kind }) => ["file", "location"].includes(kind)).map((reference) => {
    if (reference.kind === "file") return fileTarget(database, workspaceId, reference.id);
    resolveReference(database, workspaceId, "location", reference.id, true);
    return { ...mappedLocation(database, reference.id), relativePath: "" };
  });
}

export function referenceContext(database, workspaceId, references) {
  if (!references.length) return "";
  const rows = references.map(({ kind, id }) => resolveReference(database, workspaceId, kind, id, true));
  return `\n\nReferenced Bees resources (context only; a reference does not authorize notifications or changes):\n${JSON.stringify(rows.map(({ stagesJson, ...row }) => ({
    ...row, ...(stagesJson ? { stages: JSON.parse(stagesJson) } : {})
  })))}`;
}

export function preserveReferences(text, references) {
  const present = typedReferences(text);
  const missing = references.filter((ref) => !present.some((row) => row.kind === ref.kind && row.id === ref.id));
  return String(text ?? "") + (missing.length ? `\n\nReferenced resources:\n${missing.map(referenceText).join("\n")}` : "");
}

/** Assignment uses the same resolved agent identities as every other reference. */
export function leadingAgentInvocation(value) {
  let rest = String(value ?? "");
  const agents = [];
  while (true) {
    const match = rest.match(/^\s*[$@]\[([^\]\n]{1,160})\]\(bees:agent:([^)\s]{1,2048})\)(?:\s*(?:[,;:\-]|(?:\band\b|&)(?=\s*[$@]))\s*|\s+|$)/u);
    if (!match) break;
    const agent = { id: match[2], name: match[1] };
    if (agents.some(({ id }) => id === agent.id)) throw new Error(`${agent.name} is mentioned more than once`);
    agents.push(agent);
    rest = rest.slice(match[0].length);
  }
  if (!agents.length) return null;
  if (agents.length > 8) throw new Error("Mention at most eight agents");
  if (!rest.trim()) throw new Error(`Tell ${agents.map(({ name }) => name).join(", ")} what you want done`);
  return { agents, request: rest.trim(), reference: agents.map(({ id, name }) => referenceText({ kind: "agent", id, label: name })).join(" ") };
}
