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
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
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

const hostTarget = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const target = process.env.CARGO_BUILD_TARGET || hostTarget;
const extension = target.includes("windows") ? ".exe" : "";
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

// Upstream does not support K2 Horizon yet. Pin the model author's fork, which also
// supports the seeded Nanbeige model, and build the same runtime on every platform.
const llamaCommit = "42adf019f76013dac873b5b43950d54d5ab27216";
const macTarget = target.endsWith("-apple-darwin");
const llamaRuntimeRevision = macTarget
  ? `${llamaCommit}-macos13-static-1-${target}`
  : `${llamaCommit}-static-1-${target}`;
const llamaSource = [
  `llama.cpp-${llamaCommit}.tar.gz`,
  "c58cab48ce95510c65ed7f7abe20a3c70c5a0874908dd48268daa552d348aabb"
];
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
const freeLlmVersion = "0.8.4";
const freeLlmCommit = "6c4233b6847623328cdb8652d68e4d70d81f16e6";
const freeLlmArchiveSha256 = "05cbaf60792f5183f74a238ca7938de93b0246e98a90ff571d243ea646e14469";

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

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    }
  }
  return undefined;
}

async function downloadVerified(url, expectedSha256) {
  const response = await fetch(url, { headers: { "User-Agent": "Bees build" } });
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
    // resource instead, the way llama.cpp and FreeLLMAPI carry theirs.
    const licence = findFile(extracted, "LICENSE");
    if (!licence) throw new Error(`${fileName} did not contain the Temporal licence.`);
    copyFileSync(licence, resolve(desktopRoot, "dsh-runtime", "LICENSE-temporal"));
    markPrepared(marker, temporalDestination, temporalRelease);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function prepareFreeLlmRuntime() {
  const revision = `${freeLlmVersion}-${freeLlmCommit}`;
  const runtimeRoot = resolve(desktopRoot, "dsh-runtime", "freellmapi");
  const server = join(runtimeRoot, "server.mjs");
  const marker = join(runtimeRoot, ".freellmapi-version");
  if (preparedAlready(marker, server, revision)) return;

  const temporaryRoot = mkdtempSync(join(tmpdir(), "bees-freellmapi-"));
  try {
    console.log(`Preparing embedded FreeLLMAPI v${freeLlmVersion}...`);
    const archive = await downloadVerified(
      `https://github.com/tashfeenahmed/freellmapi/archive/refs/tags/v${freeLlmVersion}.tar.gz`,
      freeLlmArchiveSha256
    );
    const archivePath = join(temporaryRoot, `freellmapi-v${freeLlmVersion}.tar.gz`);
    const sourceParent = join(temporaryRoot, "source");
    const sourceRoot = join(sourceParent, `freellmapi-${freeLlmVersion}`);
    writeFileSync(archivePath, archive);
    mkdirSync(sourceParent);
    execFileSync("tar", ["-xf", archivePath, "-C", sourceParent]);
    if (!existsSync(join(sourceRoot, "desktop", "src", "server-host.ts"))) {
      throw new Error("The FreeLLMAPI archive did not contain its embedded server.");
    }
    execFileSync(
      "npm",
      ["ci", "--omit=dev", "--omit=optional", "--workspace", "server", "--workspace", "shared", "--ignore-scripts"],
      // npm is npm.cmd on windows, which node only starts through a shell
      { cwd: sourceRoot, stdio: "inherit", shell: process.platform === "win32" }
    );

    rmSync(runtimeRoot, { recursive: true, force: true });
    mkdirSync(runtimeRoot, { recursive: true });
    await build({
      entryPoints: [join(sourceRoot, "desktop", "src", "server-host.ts")],
      absWorkingDir: sourceRoot,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      outfile: server,
      external: ["better-sqlite3"],
      define: {
        "process.env.FREELLMAPI_COMMIT_SHA": JSON.stringify(freeLlmCommit),
        "process.env.FREELLMAPI_INSTALL_METHOD": JSON.stringify("desktop")
      },
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
      },
      logLevel: "info"
    });
    copyFileSync(join(sourceRoot, "LICENSE"), join(runtimeRoot, "LICENSE"));
    markPrepared(marker, server, revision);
    writeFileSync(join(runtimeRoot, ".gitkeep"), "");
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
  if (!(target.includes("apple") || target.includes("darwin") || target.includes("macos"))) return;
  execFileSync("xattr", ["-c", path]);
  const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
  const adhoc = !identity || identity === "-";
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

async function buildLlamaRuntime(temporaryRoot, runtimeRoot, serverName) {
  const [fileName, expectedSha256] = llamaSource;
  const url = `https://github.com/ifm-ai/llama.cpp/archive/${llamaCommit}.tar.gz`;
  console.log(`Building llama-server ${llamaCommit.slice(0, 8)} for ${target}...`);
  const archive = await downloadVerified(url, expectedSha256);
  const archivePath = join(temporaryRoot, fileName);
  const sourceParent = join(temporaryRoot, "source");
  const build = join(temporaryRoot, "build");
  writeFileSync(archivePath, archive);
  mkdirSync(sourceParent);
  execFileSync("tar", ["-xf", archivePath, "-C", sourceParent]);
  const cmakeFile = findFile(sourceParent, "CMakeLists.txt");
  if (!cmakeFile) throw new Error(`${fileName} did not contain CMakeLists.txt.`);

  try {
    execFileSync("cmake", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("Building the local-model runtime requires CMake and a C++ compiler.");
  }

  const architecture = target.startsWith("aarch64-") ? "arm64" : "x86_64";
  execFileSync(
    "cmake",
    [
      "-S",
      dirname(cmakeFile),
      "-B",
      build,
      "-DCMAKE_BUILD_TYPE=Release",
      ...(macTarget ? [
        `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
        "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3"
      ] : []),
      ...(target.includes("windows") ? ["-A", target.startsWith("aarch64-") ? "ARM64" : "x64"] : []),
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DGGML_CCACHE=OFF",
      `-DGGML_METAL=${macTarget && architecture === "arm64" ? "ON" : "OFF"}`,
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DLLAMA_BUILD_NUMBER=0",
      `-DLLAMA_BUILD_COMMIT=${llamaCommit.slice(0, 8)}`,
      "-DLLAMA_BUILD_EXAMPLES=OFF",
      "-DLLAMA_BUILD_TESTS=OFF",
      "-DLLAMA_BUILD_TOOLS=ON",
      "-DLLAMA_BUILD_SERVER=ON",
      "-DLLAMA_BUILD_UI=OFF",
      "-DLLAMA_USE_PREBUILT_UI=OFF",
      "-DLLAMA_OPENSSL=OFF",
      "-DGGML_RPC=OFF"
    ],
    { stdio: "inherit" }
  );
  execFileSync(
    "cmake",
    [
      "--build",
      build,
      "--config",
      "Release",
      "--target",
      "llama-server",
      "-j",
      String(availableParallelism())
    ],
    { stdio: "inherit" }
  );
  const server = findFile(build, serverName);
  if (!server) throw new Error(`The ${llamaCommit} build did not produce ${serverName}.`);

  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot);
  copyFileSync(server, join(runtimeRoot, serverName));
  copyFileSync(join(dirname(cmakeFile), "LICENSE"), join(runtimeRoot, "LICENSE"));
}

// Re-sign on macOS: downloaded and locally linked binaries can carry linker
// signatures (flags 0x20002) that macOS rejects after they are copied.
//
// An ad-hoc signature is fine locally but notarization rejects it, and rejects the whole
// bundle rather than just this file. A release build needs the real Developer ID, a
// secure timestamp and the hardened runtime; the last two are notarization requirements
// on their own, so Apple refuses the binary without them even with the right identity.
//
// This runs on every build, not only when the runtime is first fetched. The runtime is
// cached between builds, so signing it at fetch time left a cached ad-hoc copy in every
// later release build, and Apple rejected the bundle for it.
//
// APPLE_SIGNING_IDENTITY is the variable the Tauri build already reads, so the runtime
// and the app around it are signed by the same identity. `-` is Tauri's spelling of
// ad-hoc, so it counts as no real identity here too.
function signMac(paths, label) {
  const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
  const adhoc = !identity || identity === "-";
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

function signMacRuntime(runtimeRoot) {
  if (!macTarget) return;
  // Strip com.apple.provenance/quarantine first: those xattrs make macOS run a first-launch
  // Gatekeeper/XProtect assessment that can wedge the process uninterruptibly at dyld start.
  execFileSync("xattr", ["-cr", runtimeRoot]);
  signMac(
    readdirSync(runtimeRoot)
      .filter((entry) => !entry.startsWith(".") && entry !== "LICENSE")
      .map((entry) => join(runtimeRoot, entry)),
    "local-model runtime"
  );
}

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

// The bundled runtime ships under the app's Resources with its own native addons and CLIs.
// The bundler signs MacOS, Frameworks, Plugins and the sidecar binaries, not Resources, so
// without this pass the bundle carries ad-hoc signed code and Apple refuses the lot.
// Every installer carried every system's native builds. Keep only what this target can load:
// about 165 MB of the Mac download is Windows, Linux and Intel binaries nothing here runs.
function pruneForeignBinaries(runtimeRoot) {
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
  const bridge = ["@temporalio", "core-bridge", "releases"];
  keepOnly(join(nodeModules, ...bridge), target);
  keepOnly(join(nodeModules, "node-pty", "prebuilds"), nodePlatform);
  if (!nodePlatform.startsWith("win32")) rmSync(join(nodeModules, "node-pty", "third_party", "conpty"), { recursive: true, force: true });
  for (const entry of readdirSync(nodeModules))
    if (entry.startsWith("tree-sitter")) keepOnly(join(nodeModules, entry, "prebuilds"), nodePlatform);
  // musl builds never load on the glibc linux we target, and linuxdeploy stops looking for their libc
  for (const scope of ["", ...readdirSync(nodeModules).filter((entry) => entry.startsWith("@"))])
    for (const entry of readdirSync(join(nodeModules, scope)))
      if (entry.includes("musl")) rmSync(join(nodeModules, scope, entry), { recursive: true, force: true });
}

function signMacBundledRuntime(runtimeRoot) {
  // Reads 46k files, so only when there is a real identity to put on them: an ad-hoc pass
  // here buys nothing a local build needs, and notarization refuses ad-hoc code anyway.
  const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
  if (!macTarget || !identity || identity === "-") return;
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

async function prepareLlamaRuntime() {
  if (!["aarch64-apple-darwin", "x86_64-apple-darwin", "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu", "aarch64-pc-windows-msvc", "x86_64-pc-windows-msvc"].includes(target)) {
    throw new Error(`No bundled llama-server runtime is configured for ${target}.`);
  }

  const runtimeRoot = resolve(desktopRoot, "llama-runtime");
  const serverName = `llama-server${extension}`;
  const marker = join(runtimeRoot, ".llama-version");
  if (preparedAlready(marker, join(runtimeRoot, serverName), llamaRuntimeRevision)) {
    signMacRuntime(runtimeRoot);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "bees-llama-"));
  try {
    await buildLlamaRuntime(temporaryRoot, runtimeRoot, serverName);
    if (!target.includes("windows")) chmodSync(join(runtimeRoot, serverName), 0o755);
    signMacRuntime(runtimeRoot);
    markPrepared(marker, join(runtimeRoot, serverName), llamaRuntimeRevision);
    writeFileSync(join(runtimeRoot, ".gitkeep"), "");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

await prepareFreeLlmRuntime();
await prepareTemporalRuntime();
await prepareLlamaRuntime();

// Ship the small installer, not a developer-machine Python environment. uv provisions
// pinned Hindsight and managed Python into the writable app-data directory on first run.
async function prepareMemoryInstaller() {
  const release = "0.10.0";
  const windows = target.includes("windows");
  const archiveName = `uv-${target}.${windows ? "zip" : "tar.gz"}`;
  const base = `https://github.com/astral-sh/uv/releases/download/${release}`;
  const directory = resolve(desktopRoot, "dsh-runtime", "memory-runtime");
  const binary = join(directory, `uv${extension}`);
  const marker = join(directory, ".prepared");
  if (preparedAlready(marker, binary, `${release}-${target}`)) return;
  const checksum = await fetch(`${base}/${archiveName}.sha256`);
  if (!checksum.ok) throw new Error(`uv does not provide the memory installer for ${target}`);
  const hash = (await checksum.text()).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid uv release checksum");
  const archive = await downloadVerified(`${base}/${archiveName}`, hash);
  const staging = mkdtempSync(join(tmpdir(), "bees-memory-installer-"));
  try {
    const path = join(staging, archiveName);
    writeFileSync(path, archive);
    if (windows) execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${path.replaceAll("'", "''")}' -DestinationPath '${staging.replaceAll("'", "''")}'`]);
    else execFileSync("tar", ["-xzf", path, "-C", staging]);
    const executable = findFile(staging, `uv${extension}`);
    if (!executable) throw new Error("uv release is missing its executable");
    mkdirSync(directory, { recursive: true });
    copyFileSync(executable, binary);
    chmodSync(binary, 0o755);
    const license = await fetch(`https://raw.githubusercontent.com/astral-sh/uv/${release}/LICENSE-MIT`);
    if (!license.ok) throw new Error("uv license download failed");
    writeFileSync(join(directory, "LICENSE-MIT"), await license.text());
    if (macTarget) signMacRuntime(directory);
    markPrepared(marker, binary, `${release}-${target}`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

await prepareMemoryInstaller();

// Builds up to 28 Sept copied the installer beside the plugin as well. Drop that stale copy.
rmSync(resolve(desktopRoot, "dsh-runtime", "node_modules", "@bees", "memory-runtime"), { recursive: true, force: true });

// Pruning is in place, so a local cross-build would delete this machine's own native builds and
// break its dev runs. Each runner builds its own target, so nothing ships unpruned.
if (target === hostTarget) pruneForeignBinaries(resolve(desktopRoot, "dsh-runtime"));

signMacBundledRuntime(resolve(desktopRoot, "dsh-runtime"));
