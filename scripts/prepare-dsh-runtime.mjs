import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publishArtifact } from "./publish-artifact.mjs";
import "./check-node.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dshEntry = resolve(
  desktopRoot,
  "dsh-runtime",
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js"
);

if (!existsSync(dshEntry)) {
  throw new Error("DeepSeek Harness is missing. Run npm install first.");
}

const headless = process.argv.includes("--headless");
if (headless && process.platform !== "linux") throw new Error("--headless packaging runs inside the Linux container build");
const hostTarget = headless
  ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`
  : execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const target = process.env.CARGO_BUILD_TARGET || hostTarget;
const extension = target.includes("windows") ? ".exe" : "";
const macTarget = target.endsWith("-apple-darwin");
// the variable the tauri build reads too, and `-` is its spelling of ad-hoc
const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
const adhoc = !identity || identity === "-";
const destination = resolve(
  desktopRoot,
  "src-tauri",
  "binaries",
  `bees-node-${target}${extension}`
);
const temporalDestination = resolve(
  desktopRoot,
  "src-tauri",
  "binaries",
  `temporal-${target}${extension}`
);

mkdirSync(dirname(destination), { recursive: true });
stageExecutable(process.execPath, destination, "Node");

const temporalRelease = "1.8.2";
const temporalAssets = {
  "aarch64-apple-darwin": [
    "temporal_cli_1.8.2_darwin_arm64.tar.gz",
    "dacdc3587682c04cf27e67c8878ca2d755230b6ad63c0c6ebddd7348ae90ed94"
  ],
  "x86_64-apple-darwin": [
    "temporal_cli_1.8.2_darwin_amd64.tar.gz",
    "489d7f5420cae02b559774ac23df035141954c33a51dba96f5759a0ddccdf1b6"
  ],
  "aarch64-unknown-linux-gnu": [
    "temporal_cli_1.8.2_linux_arm64.tar.gz",
    "83600a8fac6e3da54093e5da6918d399f501532b9f1172235603f9606f4ac6e4"
  ],
  "x86_64-unknown-linux-gnu": [
    "temporal_cli_1.8.2_linux_amd64.tar.gz",
    "d8421bda989e6514b4bdb4d63a9012a8a05a806892e881a5aad8510496349a94"
  ],
  "aarch64-pc-windows-msvc": [
    "temporal_cli_1.8.2_windows_arm64.tar.gz",
    "da78339510b1f91a8212ff247940d3b1dd3022ccfa00add400359311f941697e"
  ],
  "x86_64-pc-windows-msvc": [
    "temporal_cli_1.8.2_windows_amd64.tar.gz",
    "c845948aa4ab3b1a3643f9fea6d1cd691188bc31513de5f2dc5f7eceea25f22a"
  ]
};

/**
 * A cached artifact counts as prepared only if the marker names both the revision and the size we
 * last wrote. Version alone let a truncated or quarantined file through, and the next build shipped
 * it untouched. The sha256 in the asset tables covers the download, not what came out of it.
 */
function preparedAlready(marker, artifact, revision) {
  if (!existsSync(artifact) || !existsSync(marker)) return false;
  return readFileSync(marker, "utf8").trim() === `${revision} ${statSync(artifact).size}`;
}

function markPrepared(marker, artifact, revision) {
  writeFileSync(marker, `${revision} ${statSync(artifact).size}\n`);
}

// check a folder's own files before its subfolders
function findFile(root, name) {
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === name)) return join(root, name);
  for (const entry of entries) {
    const found = entry.isDirectory() && findFile(join(root, entry.name), name);
    if (found) return found;
  }
  return undefined;
}

// one retry, because a connection left idle through a long compile can be dead on reuse
const get = (url, init = { headers: { "User-Agent": "Bees build" } }) => fetch(url, init).catch(() => fetch(url, init));

async function downloadVerified(url, expectedSha256) {
  const response = await get(url);
  if (!response.ok) throw new Error(`Could not download ${basename(url)}: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Integrity check failed for ${basename(url)}.`);
  }
  return archive;
}

async function prepareTemporalRuntime() {
  const asset = temporalAssets[target];
  if (!asset) throw new Error(`No embedded Temporal runtime is configured for ${target}.`);
  const marker = resolve(desktopRoot, "src-tauri", "binaries", `.temporal-${target}.version`);
  if (preparedAlready(marker, temporalDestination, temporalRelease)) {
    stageExecutable(temporalDestination, temporalDestination, "Temporal");
    markPrepared(marker, temporalDestination, temporalRelease);
    return;
  }

  const [fileName, expectedSha256] = asset;
  const temporaryRoot = mkdtempSync(join(tmpdir(), "bees-temporal-"));
  try {
    console.log(`Preparing embedded Temporal ${temporalRelease} for ${target}...`);
    const archive = await downloadVerified(
      `https://github.com/temporalio/cli/releases/download/v${temporalRelease}/${fileName}`,
      expectedSha256
    );
    const archivePath = join(temporaryRoot, fileName);
    const extracted = join(temporaryRoot, "extracted");
    writeFileSync(archivePath, archive);
    mkdirSync(extracted);
    execFileSync("tar", ["-xf", archivePath, "-C", extracted]);
    const temporal = findFile(extracted, `temporal${extension}`);
    if (!temporal) throw new Error(`${fileName} did not contain the Temporal executable.`);
    stageExecutable(temporal, temporalDestination, "Temporal");
    // externalBin ships the binary on its own, so the licence rides along in the dsh-runtime
    // resource instead.
    const licence = findFile(extracted, "LICENSE");
    if (!licence) throw new Error(`${fileName} did not contain the Temporal licence.`);
    copyFileSync(licence, resolve(desktopRoot, "dsh-runtime", "LICENSE-temporal"));
    markPrepared(marker, temporalDestination, temporalRelease);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function hasValidMacSignature(path) {
  try {
    execFileSync("codesign", ["--verify", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function signMacBinary(path, label) {
  if (!macTarget) return;
  execFileSync("xattr", ["-c", path]);
  if (adhoc && hasValidMacSignature(path)) return;
  const signArgs = adhoc
    ? ["--force", "--timestamp=none", "--sign", "-"]
    : ["--force", "--timestamp", "--options", "runtime", "--sign", identity];
  console.log(adhoc ? `Signing ${label} ad-hoc.` : `Signing ${label} with ${identity}.`);
  execFileSync("codesign", [...signArgs, path]);
}

function stageExecutable(source, destination, label) {
  const temporaryRoot = mkdtempSync(join(dirname(destination), ".bees-stage-"));
  const staged = join(temporaryRoot, basename(destination));
  try {
    copyFileSync(source, staged);
    if (!target.includes("windows")) chmodSync(staged, 0o755);
    // Publish only a complete, signed executable. Tauri watches externalBin and can otherwise copy
    // the destination while copyFileSync is still writing it, producing a truncated Mach-O.
    signMacBinary(staged, label);
    publishArtifact(staged, destination);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

// linker signatures (flags 0x20002) fail once copied, and this runs every build because a
// runtime cached after signing at fetch time shipped ad-hoc and apple refused the bundle
function signMac(paths, label) {
  // Entitlements live in the binary, not the source, so a plain re-sign silently drops them.
  const signArgs = adhoc
    ? ["--force", "--timestamp=none", "--preserve-metadata=entitlements", "--sign", "-"]
    : ["--force", "--timestamp", "--options", "runtime", "--preserve-metadata=entitlements", "--sign", identity];
  console.log(
    adhoc
      ? `Signing the ${label} ad-hoc. Set APPLE_SIGNING_IDENTITY to notarize.`
      : `Signing the ${label} with ${identity}.`
  );
  // A linker-generated ad-hoc signature passes `codesign --verify`, but macOS can still
  // assess it on every launch and wedge the process before main, so nothing is left as is.
  for (const path of paths) {
    // libreoffice's uno bridge writes code at runtime and ships with no entitlements to preserve,
    // so without allow-jit the hardened runtime kills every word/excel/powerpoint to pdf with SIGTRAP
    const office = /libreoffice-kit-darwin-[^/]+\/bin\/libreoffice-kit$/.test(path);
    execFileSync("codesign", [...signArgs, ...(office ? ["--entitlements", officeEntitlements] : []), path]);
  }
}

const officeEntitlements = resolve(desktopRoot, "src-tauri", "libreoffice-entitlements.plist");

// Thin, fat and both byte orders, read as one big-endian word.
const MACH_O_MAGIC = new Set([0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface, 0xcafebabe, 0xbebafeca]);

// Only Mach-O files can carry a signature, and the notary wants one on every Mach-O in the
// bundle, including the ones the bundler never looks at.
function isMachO(path) {
  const descriptor = openSync(path, "r");
  try {
    const magic = Buffer.alloc(4);
    if (readSync(descriptor, magic, 0, 4, 0) !== 4) return false;
    return MACH_O_MAGIC.has(magic.readUInt32BE(0));
  } finally {
    closeSync(descriptor);
  }
}

// every installer carried every system's native builds plus test, type and build-only files. keep only what this target loads.
function pruneRuntime(runtimeRoot) {
  const nodePlatform = [
    target.includes("apple-darwin") ? "darwin" : target.includes("windows") ? "win32" : "linux",
    target.startsWith("aarch64") ? "arm64" : "x64"
  ].join("-");
  const nodeModules = join(runtimeRoot, "node_modules");
  const keepOnly = (parent, keep) => {
    // Nothing to keep means the package installed no native builds; deleting the rest then
    // would take out the one the app needs.
    if (!existsSync(join(parent, keep))) return;
    for (const entry of readdirSync(parent)) if (entry !== keep) rmSync(join(parent, entry), { recursive: true, force: true });
  };
  keepOnly(join(nodeModules, "@temporalio", "core-bridge", "releases"), target);
  keepOnly(join(nodeModules, "node-pty", "prebuilds"), nodePlatform);
  if (!nodePlatform.startsWith("win32")) rmSync(join(nodeModules, "node-pty", "third_party", "conpty"), { recursive: true, force: true });
  // qmd only loads each grammar's .wasm, the rest is native source and prebuilds
  for (const entry of readdirSync(nodeModules).filter((entry) => entry.startsWith("tree-sitter")))
    for (const file of readdirSync(join(nodeModules, entry)))
      if (!/^(package\.json|LICENSE)$|\.wasm$/.test(file)) rmSync(join(nodeModules, entry, file), { recursive: true, force: true });
  // the sources the native addons were compiled from
  for (const dir of ["better-sqlite3/deps", "@temporalio/core-bridge/sdk-core"])
    rmSync(join(nodeModules, dir), { recursive: true, force: true });
  // musl never loads on our glibc linux and trips linuxdeploy; types and maps are unread except by temporal's bundler
  for (const entry of readdirSync(nodeModules, { recursive: true, withFileTypes: true }))
    if (entry.isDirectory() ? entry.name.includes("musl") : /\.d\.[cm]?ts$|\.[cm]?[jt]s\.map$/.test(entry.name) && !/@temporalio|nexus-rpc/.test(entry.parentPath))
      rmSync(join(entry.parentPath, entry.name), { recursive: true, force: true });
  // tauri copies what each .bin link points at, and fails on links into a package removed above
  const bin = join(nodeModules, ".bin");
  for (const link of readdirSync(bin)) if (!existsSync(join(bin, link))) rmSync(join(bin, link), { force: true });
}

// The bundled runtime ships under the app's Resources with its own native addons and CLIs.
// The bundler signs MacOS, Frameworks, Plugins and the sidecar binaries, not Resources, so
// without this pass the bundle carries ad-hoc signed code and Apple refuses the lot.
function signMacBundledRuntime(runtimeRoot) {
  // reads 46k files, so skip it for ad-hoc builds, which notarization refuses anyway
  if (!macTarget || adhoc) return;
  const binaries = [];
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile() && isMachO(path)) binaries.push(path);
    }
  };
  collect(runtimeRoot);
  // Deepest first: a signature covers the files nested inside it.
  binaries.sort((a, b) => b.split(sep).length - a.split(sep).length);
  signMac(binaries, "bundled runtime");
}

await prepareTemporalRuntime();

// Pruning is in place, so a local cross-build would delete this machine's own native builds and
// break its dev runs. Each runner builds its own target, so nothing ships unpruned.
if (target === hostTarget) pruneRuntime(resolve(desktopRoot, "dsh-runtime"));

signMacBundledRuntime(resolve(desktopRoot, "dsh-runtime"));
