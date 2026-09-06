import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync, appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const read = (path) => readFileSync(path, "utf8");
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
export function notesFor(changelog, version) {
  const heading = `## ${version}`;
  const lines = changelog.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`Add ${heading} and user-facing notes to CHANGELOG.md first.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const notes = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  if (!notes || /TODO|TBD/.test(notes)) throw new Error("Release notes must be complete.");
  return notes;
}

export function validateAssets(assets) {
  const required = [/aarch64\.dmg$/, /x64\.dmg$/, /amd64\.deb$/, /amd64\.AppImage$/, /x64.*\.msi$/, /x64.*\.exe$/];
  for (const pattern of required) {
    if (!assets.some((asset) => pattern.test(asset.name) && asset.size > 0 && asset.state === "uploaded")) {
      throw new Error(`Missing completed installer: ${pattern}`);
    }
  }
  if (assets.some((asset) => asset.name === "latest.json")) throw new Error("Automatic updates are not migration-safe yet.");
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === "version") {
    const version = argument;
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Use a stable version, e.g. npm run release:prepare -- 0.2.1");
    const changelog = read("CHANGELOG.md");
    if (!changelog.includes("## Unreleased\n")) throw new Error("Add an Unreleased section with release notes first.");
    const updated = changelog.replace("## Unreleased\n", `## ${version}\n`);
    notesFor(updated, version);
    execFileSync("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts", "--allow-same-version"], { stdio: "inherit" });
    const config = JSON.parse(read("src-tauri/tauri.conf.json"));
    config.version = version;
    writeFileSync("src-tauri/tauri.conf.json", `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync("src-tauri/Cargo.toml", read("src-tauri/Cargo.toml").replace(/^(version = ")[^"]+/m, `$1${version}`));
    writeFileSync("src-tauri/Cargo.lock", read("src-tauri/Cargo.lock").replace(/(name = "bees-desktop"\nversion = ")[^"]+/, `$1${version}`));
    writeFileSync("CHANGELOG.md", updated);
    console.log(`Prepared v${version}. Review changes, run checks, then follow docs/releases.md to commit and tag.`);
    return;
  }
  const tag = argument ?? process.env.GITHUB_REF_NAME;
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw new Error("Only stable vMAJOR.MINOR.PATCH tags are supported.");
  const version = tag.slice(1);
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is required.");
  if (command === "draft") {
    const versions = [JSON.parse(read("package.json")).version, JSON.parse(read("package-lock.json")).version,
      JSON.parse(read("package-lock.json")).packages[""].version, JSON.parse(read("src-tauri/tauri.conf.json")).version,
      read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1],
      read("src-tauri/Cargo.lock").match(/name = "bees-desktop"\nversion = "([^"]+)"/)?.[1]];
    if (versions.some((value) => value !== version)) throw new Error("Tag and package/Tauri/Cargo versions must match.");
    const notes = notesFor(read("CHANGELOG.md"), version);
    // A failed request must fail closed, rather than being mistaken for a missing release.
    const releases = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`)).flat();
    let release = releases.find((item) => item.tag_name === tag);
    if (release && !release.draft) throw new Error("This version is already published. Prepare a new version.");
    const directory = mkdtempSync(join(tmpdir(), "bees-notes-"));
    try {
      const file = join(directory, "notes.md");
      writeFileSync(file, `${notes}\n\n## Installation\n\nDownload installers and SHA256SUMS below, or visit https://bees.bot/download/.\nWindows installers are currently unsigned and may show a SmartScreen warning.\nAutomatic in-app updates are disabled; see the upgrade guidance above before replacing an older installation.\n`);
      if (release) gh("release", "edit", tag, "--repo", repo, "--notes-file", file);
      else gh("release", "create", tag, "--repo", repo, "--verify-tag", "--draft", "--title", `Bees ${tag}`, "--notes-file", file);
      release = JSON.parse(gh("api", `repos/${repo}/releases/tags/${tag}`));
      appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  } else if (command === "publish") {
    const release = JSON.parse(gh("api", `repos/${repo}/releases/tags/${tag}`));
    if (!release.draft) throw new Error("Refusing to replace an already published release.");
    const assets = JSON.parse(gh("api", "--paginate", "--slurp", `repos/${repo}/releases/${release.id}/assets?per_page=100`)).flat();
    validateAssets(assets);
    const directory = mkdtempSync(join(tmpdir(), "bees-release-"));
    try {
      gh("release", "download", tag, "--repo", repo, "--dir", directory, "--skip-existing");
      const checksums = [];
      for (const name of readdirSync(directory).sort().filter((name) => name !== "SHA256SUMS")) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
        checksums.push(`${hash.digest("hex")}  ${name}`);
      }
      writeFileSync(join(directory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
      gh("release", "upload", tag, join(directory, "SHA256SUMS"), "--repo", repo, "--clobber");
      gh("release", "edit", tag, "--repo", repo, "--draft=false", "--latest");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  } else if (command === "notify") {
    const webhook = process.env.DISCORD_RELEASE_WEBHOOK;
    if (!webhook) throw new Error("Configure the DISCORD_RELEASE_WEBHOOK Actions secret, then rerun this failed job.");
    const release = JSON.parse(gh("api", `repos/${repo}/releases/tags/${tag}`));
    if (release.draft || release.prerelease) throw new Error("Only published stable releases can be announced.");
    const response = await fetch(`${webhook}${webhook.includes("?") ? "&" : "?"}wait=true`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ username: "Bees Releases", allowed_mentions: { parse: [] },
        embeds: [{ title: `Bees ${tag} is available`, url: release.html_url, color: 15844367,
          description: release.body.slice(0, 3500), fields: [{ name: "Downloads", value: "[Mac, Windows and Linux](https://bees.bot/download/)" }] }] }),
    });
    if (!response.ok) throw new Error(`Discord announcement failed: HTTP ${response.status}. Rerun only this job.`);
    console.log(`Announced ${tag} to Discord.`);
  } else throw new Error("Expected version, draft, publish, or notify.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
