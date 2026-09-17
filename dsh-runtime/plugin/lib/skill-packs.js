import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Suggestions, not a whitelist: any public repository laid out as Agent Skills works. */
export const SKILL_CATALOG = [
  { repo: "anthropics/skills", label: "Anthropic Skills", note: "Documents, artifacts and skill authoring" },
  { repo: "wshobson/agents", label: "wshobson Plugins", note: "Engineering processes across 90+ plugins" },
  { repo: "affaan-m/ECC", label: "ECC", note: "Harness optimization and research processes" },
  { repo: "mattpocock/skills", label: "Matt Pocock", note: "Everyday engineering skills, including grill-me" },
  { repo: "obra/superpowers", label: "Superpowers", note: "A whole dev process: spec, plan, test, review" }
];

/** The byte cap is what stops a hostile repo filling the disk; the file cap only bounds the fetch loop. */
const MAX_FILES = 120;
/** The Agent Skills naming rule, which doubles as the guard keeping a folder inside the skills root. */
const SKILL_NAME = /^[\p{L}\p{N}-]+$/u;
/** owner/name, the only shape GitHub's repository addresses take. */
const REPO_NAME = /^[\w.-]{1,39}\/[\w.-]{1,100}$/;

function repoOrThrow(repo) {
  const name = String(repo ?? "").trim().replace(/^https:\/\/github\.com\/|\.git$|\/+$/g, "");
  if (!REPO_NAME.test(name)) throw new Error("Give a GitHub repository as owner/name");
  return name;
}
const MAX_BYTES = 2_000_000;

export function skillsRoot() {
  const home = process.env.DSH_HOME;
  if (!home) throw new Error("Bees did not provide the harness home directory");
  return join(home, "skills");
}

/** Browsing a collection then installing from it asks for the same listing twice. */
const trees = new Map();
const TREE_TTL = 10 * 60 * 1000;

/**
 * The REST api allows 60 anonymous calls an hour, so this reads the commit off git's own
 * endpoint and the file list off github's file finder, neither of which counts against it.
 */
async function treeOf(repo) {
  const held = trees.get(repo);
  if (held && Date.now() - held.at < TREE_TTL) return held.tree;
  const read = async (url, headers) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
    return response.text();
  };
  // git asks for a login when the repository is missing or private
  const refs = await read(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`)
    .catch((error) => { throw /answered 40[134]/.test(error.message) ? new Error(`GitHub has no public repository called ${repo}`) : error; });
  const commit = refs.match(/([0-9a-f]{40}) HEAD\0/)?.[1];
  if (!commit) throw new Error(`${repo} has no default branch to read`);
  const listing = await read(`https://github.com/${repo}/tree-list/${commit}`, { accept: "application/json" });
  let paths;
  try { paths = JSON.parse(listing).paths; } catch {}
  if (!Array.isArray(paths)) throw new Error(`GitHub did not list the files of ${repo}`);
  const tree = { commit, paths };
  trees.set(repo, { tree, at: Date.now() });
  return tree;
}

/** Frontmatter only; DSH re-reads the body on every load. */
function frontmatter(text, directory) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("SKILL.md has no closed frontmatter");
  const fields = {};
  let key = "";
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && !/^\s/.test(line)) {
      key = line.slice(0, at).trim();
      fields[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    // A block scalar (description: |) leaves the value on the indented lines that follow.
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${/^[|>]-?$/.test(fields[key]) ? "" : `${fields[key]} `}${line.trim()}`.trim();
    }
  }
  const name = (fields.name ?? "").normalize("NFKC");
  if (!name || name !== name.toLowerCase() || !SKILL_NAME.test(name) || [...name].length > 64)
    throw new Error("name does not satisfy the Agent Skills naming rules");
  if (name !== directory.normalize("NFKC")) throw new Error(`name "${name}" does not match its folder`);
  if (!fields.description) throw new Error("description is required");
  return { name, description: fields.description.slice(0, 1024) };
}

/** Read live off the default branch. Nothing is written until a specific skill is installed. */
export async function listPack(repo) {
  repo = repoOrThrow(repo);
  const { paths } = await treeOf(repo);
  return paths.filter((path) => path.endsWith("/SKILL.md"))
    .map((path) => {
      const directory = path.slice(0, -"/SKILL.md".length);
      const name = directory.split("/").pop();
      return { repo, path, directory, name, installed: existsSync(join(skillsRoot(), name)) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function installSkill(repo, directory) {
  repo = repoOrThrow(repo);
  if (!directory || directory.includes("..")) throw new Error("That skill path is unusable");
  const { commit, paths } = await treeOf(repo);
  const files = paths.filter((path) => path.startsWith(`${directory}/`));
  if (!files.includes(`${directory}/SKILL.md`)) throw new Error("That skill has no SKILL.md");
  if (files.length > MAX_FILES) throw new Error(`That skill ships ${files.length} files, more than Bees installs`);

  const folder = directory.split("/").pop();
  if (!SKILL_NAME.test(folder)) throw new Error("That skill path is unusable");
  const target = join(skillsRoot(), folder);
  // Fetch everything before writing anything, so a failure halfway leaves no half-skill on disk.
  const fetched = [];
  let bytes = 0;
  for (const path of files) {
    const relative = path.slice(directory.length + 1);
    const destination = resolve(target, relative);
    if (!destination.startsWith(`${target}/`)) throw new Error(`${relative} escapes the skill folder`);
    // pinned to the listed commit, so a push in between cannot mix two versions of one skill
    const response = await fetch(
      `https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!response.ok) throw new Error(`Could not read ${relative} (${response.status})`);
    // the listing carries no sizes, so the cap is checked before each body is read and again after
    if (bytes + Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("That skill is larger than Bees installs");
    const body = Buffer.from(await response.arrayBuffer());
    if ((bytes += body.length) > MAX_BYTES) throw new Error("That skill is larger than Bees installs");
    fetched.push({ destination, body });
  }
  const skill = fetched.find(({ destination }) => destination === join(target, "SKILL.md"));
  const { name, description } = frontmatter(skill.body.toString("utf8"), folder);

  await rm(target, { recursive: true, force: true });
  for (const { destination, body } of fetched) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);
  }
  return { name, description, path: target, files: fetched.length };
}

export async function removeSkill(name) {
  if (!SKILL_NAME.test(name ?? "")) throw new Error("That skill name is unusable");
  await rm(join(skillsRoot(), name), { recursive: true, force: true });
  return { name, removed: true };
}
