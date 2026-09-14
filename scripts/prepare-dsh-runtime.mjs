import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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

const target =
  process.env.CARGO_BUILD_TARGET ||
  execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
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

// this node becomes the runtime, and one without node:sqlite dies at launch with nothing on screen
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) throw new Error(`Node ${process.version} can't run the Bees runtime. Use Node 22.5 or newer.`);
mkdirSync(dirname(destination), { recursive: true });
stageExecutable(process.execPath, destination, "Node");

// b10153 is the first release with the `nanbeige` architecture the seeded model uses.
const llamaRelease = "b10164";
const macTarget = target.endsWith("-apple-darwin");
// Both macOS arches share the same source release, with a per-target build marker.
const llamaRuntimeRevision = macTarget
  ? `${llamaRelease}-macos13-static-1-${target}`
  : `${llamaRelease}-1-${target}`;
const llamaSource = [
  `llama.cpp-${llamaRelease}.tar.gz`,
  "1d38f33c3b9fa8cd9af2ed37b7d3b60c7ba074d245a82e37c0bf3be2f6e94c66"
];
const llamaAssets = {
  "aarch64-unknown-linux-gnu": [
    "llama-b10164-bin-ubuntu-arm64.tar.gz",
    "51ef9c5479e1a35c67bb672d5945faa70291ee9c92357fd3a31c5119e9be9467"
  ],
  "x86_64-unknown-linux-gnu": [
    "llama-b10164-bin-ubuntu-x64.tar.gz",
    "e837eafd90e7c46cc5c4b6326df1bdc54a215c5cf785ccfa7ac226a365597ffa"
  ],
  "aarch64-pc-windows-msvc": [
    "llama-b10164-bin-win-cpu-arm64.zip",
    "34d428a36014c68b060704aaafb32399a45a500646921009b53a72e200fe509c"
  ],
  "x86_64-pc-windows-msvc": [
    "llama-b10164-bin-win-cpu-x64.zip",
    "3ce47be7fe67ea3cae38d0e6932efa38c17cf889c8d438d6befa044dc8141464"
  ]
};
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

function copyRuntimeDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyRuntimeDirectory(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      const resolved = realpathSync(sourcePath);
      if (statSync(resolved).isDirectory()) copyRuntimeDirectory(resolved, destinationPath);
      else copyFileSync(resolved, destinationPath);
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, destinationPath);
    }
  }
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
      { cwd: sourceRoot, stdio: "inherit" }
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
    renameSync(staged, destination);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function buildMacLlamaRuntime(temporaryRoot, runtimeRoot, serverName) {
  const [fileName, expectedSha256] = llamaSource;
  const url = `https://github.com/ggml-org/llama.cpp/archive/refs/tags/${llamaRelease}.tar.gz`;
  console.log(`Building llama-server ${llamaRelease} for ${target} (macOS 13.3+)...`);
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
    throw new Error("Building the macOS local-model runtime requires CMake (`brew install cmake`).");
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
      `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DGGML_CCACHE=OFF",
      `-DGGML_METAL=${architecture === "arm64" ? "ON" : "OFF"}`,
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DLLAMA_BUILD_NUMBER=10164",
      "-DLLAMA_BUILD_COMMIT=b62b350",
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
  if (!server) throw new Error(`The ${llamaRelease} build did not produce ${serverName}.`);

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
function signMacRuntime(runtimeRoot) {
  if (!(target.includes("apple") || target.includes("darwin") || target.includes("macos"))) return;
  // Strip com.apple.provenance/quarantine first: those xattrs make macOS run a first-launch
  // Gatekeeper/XProtect assessment that can wedge the process uninterruptibly at dyld start.
  execFileSync("xattr", ["-cr", runtimeRoot]);
  const identity = (process.env.APPLE_SIGNING_IDENTITY ?? "").trim();
  const adhoc = !identity || identity === "-";
  const signArgs = adhoc
    ? ["--force", "--timestamp=none", "--sign", "-"]
    : ["--force", "--timestamp", "--options", "runtime", "--sign", identity];
  console.log(
    adhoc
      ? "Signing the local-model runtime ad-hoc. Set APPLE_SIGNING_IDENTITY to notarize."
      : `Signing the local-model runtime with ${identity}.`
  );
  for (const entry of readdirSync(runtimeRoot)) {
    if (entry.startsWith(".") || entry === "LICENSE") continue;
    const path = join(runtimeRoot, entry);
    // A linker-generated ad-hoc signature passes `codesign --verify`, but macOS can still
    // assess it on every launch and wedge the process before main. Replace it with a normal
    // ad-hoc signature even when verification succeeds.
    execFileSync("codesign", [...signArgs, path]);
  }
}

async function prepareLlamaRuntime() {
  const asset = llamaAssets[target];
  if (!asset && !macTarget) {
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
    if (macTarget) {
      await buildMacLlamaRuntime(temporaryRoot, runtimeRoot, serverName);
    } else {
      const [fileName, expectedSha256] = asset;
      const url = `https://github.com/ggml-org/llama.cpp/releases/download/${llamaRelease}/${fileName}`;
      console.log(`Preparing llama-server ${llamaRelease} for ${target}...`);
      const archive = await downloadVerified(url, expectedSha256);
      const archivePath = join(temporaryRoot, basename(fileName));
      const extracted = join(temporaryRoot, "extracted");
      mkdirSync(extracted);
      writeFileSync(archivePath, archive);
      execFileSync("tar", ["-xf", archivePath, "-C", extracted]);
      const server = findFile(extracted, serverName);
      if (!server) throw new Error(`${fileName} did not contain ${serverName}.`);
      rmSync(runtimeRoot, { recursive: true, force: true });
      copyRuntimeDirectory(dirname(server), runtimeRoot);
    }
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
