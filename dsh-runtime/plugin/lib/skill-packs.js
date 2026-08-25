import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Public collections of Agent Plugins. Each publishes a marketplace manifest naming its skills. */
export const SKILL_CATALOG = [
  { repo: "anthropics/skills", label: "Anthropic Skills", note: "Documents, artifacts and skill authoring" },
  { repo: "wshobson/agents", label: "wshobson Plugins", note: "Engineering processes across 90+ plugins" },
  { repo: "affaan-m/ECC", label: "ECC", note: "Harness optimization and research processes" }
];

/** One skill bundle is small. These caps stop a hostile repo filling the disk. */
const MAX_FILES = 40;
const MAX_BYTES = 2_000_000;

export function skillsRoot() {
  return join(process.env.DSH_HOME, "skills");
}

async function json(url) {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
  return response.json();
}

/** Frontmatter only; DSH re-reads the body on every load. */
function frontmatter(text, directory) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("SKILL.md has no closed frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && !/^\s/.test(line)) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const name = (fields.name ?? "").normalize("NFKC");
  if (!name || name !== name.toLowerCase() || !/^[\p{L}\p{N}-]+$/u.test(name) || [...name].length > 64)
    throw new Error("name does not satisfy the Agent Skills naming rules");
  if (name !== directory.normalize("NFKC")) throw new Error(`name "${name}" does not match its folder`);
  if (!fields.description) throw new Error("description is required");
  return { name, description: fields.description.slice(0, 1024) };
}

/** Read live off the default branch. Nothing is written until a specific skill is installed. */
export async function listPack(repo) {
  const source = SKILL_CATALOG.find((entry) => entry.repo === repo);
  if (!source) throw new Error("That skill collection is unavailable");
  const { tree = [] } = await json(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`);
  return tree.map(({ path }) => path).filter((path) => path?.endsWith("/SKILL.md"))
    .map((path) => {
      const directory = path.slice(0, -"/SKILL.md".length);
      const name = directory.split("/").pop();
      return { repo, path, directory, name, installed: existsSync(join(skillsRoot(), name)) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function installSkill(repo, directory) {
  if (!SKILL_CATALOG.some((entry) => entry.repo === repo)) throw new Error("That skill collection is unavailable");
  if (!directory || directory.includes("..")) throw new Error("That skill path is unusable");
  const { tree = [] } = await json(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`);
  const files = tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(`${directory}/`));
  if (!files.some(({ path }) => path === `${directory}/SKILL.md`)) throw new Error("That skill has no SKILL.md");
  if (files.length > MAX_FILES) throw new Error(`That skill ships ${files.length} files, more than Bees installs`);
  if (files.reduce((sum, { size }) => sum + (size ?? 0), 0) > MAX_BYTES) throw new Error("That skill is larger than Bees installs");

  const folder = directory.split("/").pop();
  const target = join(skillsRoot(), folder);
  // Fetch everything before writing anything, so a failure halfway leaves no half-skill on disk.
  const fetched = [];
  for (const file of files) {
    const relative = file.path.slice(directory.length + 1);
    const destination = resolve(target, relative);
    if (!destination.startsWith(`${target}/`)) throw new Error(`${relative} escapes the skill folder`);
    const response = await fetch(
      `https://raw.githubusercontent.com/${repo}/HEAD/${file.path.split("/").map(encodeURIComponent).join("/")}`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!response.ok) throw new Error(`Could not read ${relative} (${response.status})`);
    fetched.push({ destination, body: Buffer.from(await response.arrayBuffer()) });
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
  if (!name || name.includes("/") || name.includes("..")) throw new Error("That skill name is unusable");
  await rm(join(skillsRoot(), name), { recursive: true, force: true });
  return { name, removed: true };
}
