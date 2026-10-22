import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publishArtifact } from "./publish-artifact.mjs";
import { prepareMemoryInstaller } from "./prepare-memory-runtime.mjs";
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

mkdirSync(dirname(destination), { recursive: true });
stageExecutable(process.execPath, destination, "Node");

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
  keepOnly(join(nodeModules, "node-pty", "prebuilds"), nodePlatform);
  if (!nodePlatform.startsWith("win32")) rmSync(join(nodeModules, "node-pty", "third_party", "conpty"), { recursive: true, force: true });
  // musl never loads on our glibc linux and trips linuxdeploy; types and maps are unread
  for (const entry of readdirSync(nodeModules, { recursive: true, withFileTypes: true }))
    if (entry.isDirectory() ? entry.name.includes("musl") : /\.d\.[cm]?ts$|\.[cm]?[jt]s\.map$/.test(entry.name))
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

await prepareMemoryInstaller(resolve(desktopRoot, 'dsh-runtime', 'memory-runtime'), target, stageExecutable);

// Pruning is in place, so a local cross-build would delete this machine's own native builds and
// break its dev runs. Each runner builds its own target, so nothing ships unpruned.
if (target === hostTarget) pruneRuntime(resolve(desktopRoot, "dsh-runtime"));

signMacBundledRuntime(resolve(desktopRoot, "dsh-runtime"));
