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
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(process.execPath, destination);
chmodSync(destination, 0o755);

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

function hasValidMacSignature(path) {
  try {
    execFileSync("codesign", ["--verify", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
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
    if (!adhoc || !hasValidMacSignature(path)) execFileSync("codesign", [...signArgs, path]);
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
  if (
    existsSync(join(runtimeRoot, serverName)) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === llamaRuntimeRevision
  ) {
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
    writeFileSync(marker, `${llamaRuntimeRevision}\n`);
    writeFileSync(join(runtimeRoot, ".gitkeep"), "");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

await prepareLlamaRuntime();
