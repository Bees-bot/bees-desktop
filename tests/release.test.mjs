import { test } from "node:test";
import assert from "node:assert/strict";
import { notesFor, validateAssets } from "../scripts/release.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("version preparation synchronizes all manifests without a git commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "bees-version-test-"));
  try {
    mkdirSync(join(directory, "src-tauri"));
    for (const file of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\nA useful change.\n");
    execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/release.mjs", import.meta.url)), "version", "0.2.1"], { cwd: directory });
    for (const file of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"]) {
      assert.equal(JSON.parse(readFileSync(join(directory, file))).version, "0.2.1");
    }
    assert.equal(JSON.parse(readFileSync(join(directory, "package-lock.json"))).packages[""].version, "0.2.1");
    assert.match(readFileSync(join(directory, "src-tauri/Cargo.toml"), "utf8"), /^version = "0.2.1"/m);
    assert.match(readFileSync(join(directory, "src-tauri/Cargo.lock"), "utf8"), /name = "bees-desktop"\nversion = "0.2.1"/);
    assert.equal(notesFor(readFileSync(join(directory, "CHANGELOG.md"), "utf8"), "0.2.1"), "A useful change.");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("release requires complete notes and all platform installers", () => {
  assert.equal(notesFor("# Changelog\n## 0.2.0\n\nUseful changes.\n\n## 0.1.1\nOld changes.", "0.2.0"), "Useful changes.");
  assert.throws(() => notesFor("## 0.2.0\nTODO", "0.2.0"));
  assert.throws(() => notesFor("## 0.2.1\nChanges", "0.2.0"));
  const assets = ["Bees_0.2.0_aarch64.dmg", "Bees_0.2.0_x64.dmg", "Bees_0.2.0_amd64.deb", "Bees_0.2.0_amd64.AppImage", "Bees_0.2.0_x64_en-US.msi", "Bees_0.2.0_x64-setup.exe"].map((name) => ({ name, size: 100, state: "uploaded" }));
  validateAssets(assets);
  for (let index = 0; index < assets.length; index++) {
    assert.throws(() => validateAssets(assets.filter((_, i) => i !== index)));
    assert.throws(() => validateAssets(assets.map((asset, i) => i === index ? { ...asset, size: 0 } : asset)));
  }
  assert.throws(() => validateAssets([...assets, { name: "latest.json", size: 100, state: "uploaded" }]));
});
