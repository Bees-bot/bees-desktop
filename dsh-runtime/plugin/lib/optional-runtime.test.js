import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOptionalRuntime } from './optional-runtime.js';
import { packageOptionalRuntime, stageDesktopRuntime } from '../../../scripts/package-optional-runtime.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bees support '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, 'dsh-runtime');
  const platform = process.platform, arch = process.arch;
  const officePackage = `@deepseek-ai/libreoffice-kit-${platform === 'linux' ? 'wasm' : `${platform}-${arch}`}`;
  const speechPackage = `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`;
  const uv = join('memory-runtime', platform === 'win32' ? 'uv.exe' : 'uv');
  for (const [path, text] of [
    [join('node_modules', officePackage, 'package.json'), JSON.stringify({ name: officePackage })],
    [join('node_modules', officePackage, 'prebuilds.json'), '{}'],
    [join('node_modules', officePackage, 'licenses', 'LICENSE'), 'Office license'],
    [join('node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js'), 'API adapter stays bundled'],
    [join('node_modules', 'sherpa-onnx-node', 'package.json'), '{"main":"sherpa-onnx.js"}'],
    [join('node_modules', 'sherpa-onnx-node', 'sherpa-onnx.js'), `module.exports = require('../${speechPackage}');`],
    [join('node_modules', speechPackage, 'package.json'), '{"main":"index.js"}'],
    [join('node_modules', speechPackage, 'index.js'), 'module.exports = { onnxruntimeVersion: "cached-onnx" };'],
    [join('node_modules', speechPackage, 'sherpa-onnx.node'), 'native-speech-addon'],
    [uv, 'uv-test-binary'], ['start.mjs', 'core backend stays bundled'],
  ]) {
    const file = join(runtime, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text, { mode: 0o755 });
  }
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'darwin' ? 'apple-darwin' : platform === 'win32' ? 'pc-windows-msvc' : 'unknown-linux-gnu'}`;
  const output = join(root, 'downloads');
  for (const name of ['NOTICE', 'LICENSE-APACHE', 'LICENSE-MIT']) writeFileSync(join(root, name), name);
  const manifest = packageOptionalRuntime(runtime, output, '0.9.0', target, '');
  const archive = readFileSync(join(output, new URL(manifest.url).pathname.split('/').at(-1)));
  return { root, runtime, manifest, archive, uv, officePackage, speechPackage, state: join(root, 'state') };
}

test('installer excludes heavy engines while preserving adapters, licenses and development tools', t => {
  const f = fixture(t), destination = join(f.root, 'installer', 'dsh-runtime');
  stageDesktopRuntime(f.runtime, destination, f.manifest);
  assert(!existsSync(join(destination, 'node_modules', f.officePackage)));
  assert(!existsSync(join(destination, f.uv)));
  assert(!existsSync(join(destination, 'node_modules', f.speechPackage)));
  assert(!existsSync(join(destination, 'node_modules', 'sherpa-onnx-node')));
  assert(existsSync(join(destination, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')));
  assert(existsSync(join(destination, 'start.mjs')));
  assert.deepEqual(JSON.parse(readFileSync(join(destination, 'optional-runtime.json'))), f.manifest);
  assert(existsSync(join(f.runtime, f.uv)), 'developer runtime remains intact');
  assert.equal(createHash('sha256').update(f.archive).digest('hex'), f.manifest.sha256);
  const contents = execFileSync('tar', ['-tzf', join(f.root, 'downloads', new URL(f.manifest.url).pathname.split('/').at(-1))], { encoding: 'utf8' });
  assert(contents.includes('licenses/LICENSE')); assert(contents.includes('licenses/NOTICE'));
  stageDesktopRuntime(f.runtime, destination, null);
  assert(existsSync(join(destination, 'node_modules', f.speechPackage)), 'development builds keep native speech');
  assert(!existsSync(join(destination, 'optional-runtime.json')));
});

test('verified support installs once across concurrent callers and works from cache offline', async t => {
  const f = fixture(t); let requests = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    requests++; assert.equal(url, f.manifest.url); return new Response(f.archive);
  });
  const [first, second] = await Promise.all([
    installOptionalRuntime(f.manifest, f.state), installOptionalRuntime(f.manifest, f.state)
  ]);
  assert.equal(first, second); assert.equal(requests, 1);
  assert.equal(readFileSync(join(first, f.uv), 'utf8'), 'uv-test-binary');
  rmSync(join(first, 'node_modules', f.speechPackage, 'sherpa-onnx.node'));
  assert.equal(await installOptionalRuntime(f.manifest, f.state), first);
  assert.equal(requests, 2, 'a missing native speech addon is repaired');
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Offline'); });
  assert.equal(await installOptionalRuntime(f.manifest, f.state), first);
  assert.equal(createRequire(join(first, 'package.json'))('sherpa-onnx-node').onnxruntimeVersion, 'cached-onnx');
});

test('corrupt or interrupted downloads never become installed support, and retry succeeds', async t => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.alloc(f.archive.length)));
  await assert.rejects(installOptionalRuntime(f.manifest, f.state), /verification/);
  assert(!existsSync(join(f.state, 'runtimes', f.manifest.sha256)));
  const stop = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    stop.abort(new Error('App closed')); signal.throwIfAborted();
  });
  await assert.rejects(installOptionalRuntime(f.manifest, f.state, stop.signal), /App closed/);
  t.mock.method(globalThis, 'fetch', async () => new Response(f.archive));
  assert(existsSync(join(await installOptionalRuntime(f.manifest, f.state), f.uv)));
});

test('support download refuses another platform, untrusted origins, and incomplete archives', async t => {
  const f = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Must not download'); });
  for (const patch of [{ platform: 'wrong' }, { speechPackage: 'sherpa-onnx-wrong' }, { url: 'https://example.com/runtime.tar.gz' }, { sha256: 'invalid' }])
    await assert.rejects(installOptionalRuntime({ ...f.manifest, ...patch }, f.state), /Invalid/);
  const archivePath = join(f.root, 'empty.tar.gz'), empty = join(f.root, 'empty');
  mkdirSync(empty); execFileSync('tar', ['-czf', archivePath, '-C', empty, '.']);
  const bytes = readFileSync(archivePath);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  await assert.rejects(installOptionalRuntime({ ...f.manifest, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') }, f.state), /incomplete/);
});

test('first launch installs Python and Hindsight in the background before waiting for a local model', async t => {
  const f = fixture(t), lib = join(f.runtime, 'plugin', 'lib');
  mkdirSync(lib, { recursive: true });
  for (const name of ['local-memory.js', 'optional-runtime.js', 'startup.js'])
    copyFileSync(new URL(name, import.meta.url), join(lib, name));
  writeFileSync(join(f.runtime, 'package.json'), '{"type":"module"}');
  writeFileSync(join(f.runtime, 'optional-runtime.json'), JSON.stringify(f.manifest));
  const atomic = dirname(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-atomic-write'))));
  symlinkSync(atomic, join(f.runtime, 'node_modules', '@deepseek-ai', 'dsh-atomic-write'), process.platform === 'win32' ? 'junction' : 'dir');
  const previous = process.env.BEES_STATE_DIR;
  process.env.BEES_STATE_DIR = f.state;
  t.after(() => { if (previous === undefined) delete process.env.BEES_STATE_DIR; else process.env.BEES_STATE_DIR = previous; });
  const { LocalMemory } = await import(pathToFileURL(join(lib, 'local-memory.js')));
  const memory = new LocalMemory({}, { get: () => ({}) }, join(f.state, 'memory'));
  t.after(() => memory.close());
  let finishDownload, downloading;
  const started = new Promise(resolve => { downloading = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    downloading(); await new Promise(resolve => { finishDownload = resolve; }); return new Response(f.archive);
  });
  let installed = false;
  t.mock.method(memory, 'spawn', (command, args, env) => {
    assert(command.startsWith(join(f.state, 'runtimes')));
    assert.deepEqual(args, ['tool', 'install', '--python', '3.12', '--with', 'flashrank', 'hindsight-api-slim[local-onnx,embedded-db]==0.10.0']);
    assert.equal(env.UV_PYTHON_PREFERENCE, 'only-managed');
    installed = true; memory.exit = Promise.resolve({ code: 0 });
  });
  t.mock.method(memory, 'target', async () => {
    assert(installed, 'dependency installation must not wait for a local AI model');
    throw Error('Waiting for a local model');
  });
  assert.equal(memory.ensure(), undefined, 'startup does not await dependency setup');
  await started;
  assert(!installed); assert.match(memory.status, /Downloading/);
  finishDownload(); await memory.pending;
  assert(installed); assert.equal(memory.status, 'Waiting for a local model');
});
