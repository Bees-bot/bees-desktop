import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { withFileLock } from '@deepseek-ai/dsh-atomic-write';

const run = promisify(execFile);
let pending;

export function runtimeRoot() {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (basename(directory) !== 'dsh-runtime') {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Bees runtime directory is missing');
    directory = parent;
  }
  return directory;
}

export function optionalRuntimeManifest() {
  const path = join(runtimeRoot(), 'optional-runtime.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// The manifest travels inside the signed app; never trust a checksum supplied by the download server.
export async function installOptionalRuntime(manifest, stateDirectory, signal) {
  signal?.throwIfAborted();
  if (manifest.platform !== process.platform || manifest.arch !== process.arch ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 ||
      !/^https:\/\/github\.com\/Bees-bot\/bees-desktop\/releases\/download\/v\d+\.\d+\.\d+\/Bees_runtime_[\w.-]+\.tar\.gz$/.test(manifest.url) ||
      !/^@deepseek-ai\/libreoffice-kit-(darwin-(arm64|x64)|win32-(arm64|x64)|wasm)$/.test(manifest.officePackage) ||
      manifest.speechPackage !== `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}` ||
      !isAbsolute(stateDirectory)) throw new Error('Invalid Bees support package manifest');
  const parent = join(stateDirectory, 'runtimes');
  const directory = join(parent, manifest.sha256);
  const uv = join('memory-runtime', process.platform === 'win32' ? 'uv.exe' : 'uv');
  const required = [uv, join('node_modules', manifest.officePackage, 'package.json'),
    join('node_modules', manifest.officePackage, 'prebuilds.json'),
    join('node_modules', 'sherpa-onnx-node', 'package.json'),
    join('node_modules', manifest.speechPackage, 'sherpa-onnx.node')];
  const complete = async () => {
    try {
      return await readFile(join(directory, '.ready'), 'utf8') === manifest.sha256 &&
        required.every(path => existsSync(join(directory, path)));
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  if (await complete()) return directory;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return withFileLock(directory, async () => {
    if (await complete()) return directory;
    const staging = await mkdtemp(join(parent, '.download-'));
    const timeout = AbortSignal.timeout(600_000);
    const stopped = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(manifest.url, { signal: stopped });
      if (!response.ok || !response.body) throw new Error(`Bees support download failed (${response.status}); check your connection. Bees will retry.`);
      const archive = join(staging, 'runtime.tar.gz'), files = join(staging, 'files');
      const hash = createHash('sha256');
      let bytes = 0;
      await pipeline(Readable.fromWeb(response.body), new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > manifest.bytes) return callback(new Error('Bees support download exceeds its expected size'));
          hash.update(chunk); callback(null, chunk);
        }
      }), createWriteStream(archive, { mode: 0o600 }), { signal: stopped });
      if (bytes !== manifest.bytes || hash.digest('hex') !== manifest.sha256)
        throw new Error('Bees support download failed verification; Bees will retry.');
      await mkdir(files);
      // Only the exact archive pinned by the app reaches the system extractor.
      await run('tar', ['-xzf', archive, '-C', files], { signal: stopped, windowsHide: true });
      for (const path of required)
        if (!existsSync(join(files, path))) throw new Error('Bees support package is incomplete');
      stopped.throwIfAborted();
      await writeFile(join(files, '.ready'), manifest.sha256);
      await rm(directory, { recursive: true, force: true });
      await rename(files, directory);
      return directory;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }, { signal, waitMs: 660_000 });
}

export function prepareOptionalRuntime(signal) {
  const manifest = optionalRuntimeManifest();
  if (!manifest) return Promise.resolve(null);
  if (!pending) pending = installOptionalRuntime(manifest, process.env.BEES_STATE_DIR ?? '', signal)
    .finally(() => { pending = undefined; });
  return pending;
}
