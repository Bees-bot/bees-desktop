import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

test('desktop dev commands wait for runtime staging before Cargo reads resources', () => {
  const root = new URL('../', import.meta.url);
  for (const name of ['tauri.conf.json', 'tauri.dev.conf.json']) {
    const config = JSON.parse(readFileSync(new URL(`src-tauri/${name}`, root), 'utf8'));
    assert.equal(config.build.beforeDevCommand.wait, true, name);
    assert.match(config.build.beforeDevCommand.script, /scripts\/prepare-desktop\.mjs$/);
  }
  const command = execFileSync('make', ['-n', 'bees'], { cwd: root, encoding: 'utf8' });
  const override = JSON.parse(command.match(/--config '([^']+)'/)[1]);
  assert.equal(override.build.beforeDevCommand.wait, true, 'make bees must preserve the startup barrier');
  assert.match(override.build.beforeDevCommand.script, /scripts\/prepare-desktop\.mjs$/);
});

test('Mac packaging retries transient Apple errors and still fails after repeated errors', () => {
  const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  const retry = workflow.match(/^\s+(try\(\) \{[^\n]+\})$/m);
  assert.ok(retry, 'Mac network retry function is present');
  execFileSync('bash', ['-eu', '-c', `
    ${retry[1]}
    sleep() { :; }
    attempts=0
    flaky() { attempts=$((attempts + 1)); test "$attempts" -eq 3; }
    try flaky
    test "$attempts" -eq 3
    attempts=0
    fails() { attempts=$((attempts + 1)); return 1; }
    if try fails; then exit 1; fi
    test "$attempts" -eq 6
  `]);
});

test('release collects the installers and update packages from all four build jobs', t => {
  const script = readFileSync(new URL('./release.sh', import.meta.url), 'utf8');
  const collect = script.match(/  while IFS= read -r -d '' file; do\n[\s\S]*?\n  done < <\(find[^\n]+/);
  assert.ok(collect, 'artifact collection loop is present');
  const out = mkdtempSync(join(tmpdir(), 'bees release '));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const artifacts = [
    ['macos-15/Bees.app.tar.gz', 'aarch64.app.tar.gz'],
    ['macos-15/dmg/Bees Client.dmg', 'aarch64.dmg'],
    ['macos-15-intel/Bees.app.tar.gz', 'x64.app.tar.gz'],
    ['macos-15-intel/dmg/Bees Client.dmg', 'x64.dmg'],
    ['ubuntu-22.04/appimage/Bees Client.AppImage', 'amd64.AppImage'],
    ['ubuntu-22.04/deb/Bees Client.deb', 'amd64.deb'],
    ['windows-2025/nsis/Bees Client-setup.exe', 'x64-setup.exe'],
    ...['darwin_arm64', 'darwin_x64', 'linux_x64', 'win32_x64'].map(platform => [
      `support/Bees_runtime_0.3.1_${platform}.tar.gz`, `runtime_0.3.1_${platform}.tar.gz`
    ]),
  ];
  for (const [source] of artifacts) {
    const path = join(out, 'ci', source);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  execFileSync('bash', ['-eu', '-c', `
    die() { printf '%s\\n' "$*" >&2; exit 1; }
    out=$1
    version=0.3.1
    ${collect[0]}
  `, 'release-test', out]);
  const destination = target => target.startsWith('runtime_') ? `Bees_${target}` : `Bees_0.3.1_${target}`;
  assert.deepEqual(readdirSync(out).sort(), ['ci', ...artifacts.map(([, target]) => destination(target))].sort());
  for (const [source, target] of artifacts) {
    assert.equal(readFileSync(join(out, destination(target)), 'utf8'), source);
  }
});

test('release manifest matches the app update feed and signed version', t => {
  const root = new URL('../', import.meta.url);
  const config = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'));
  assert.deepEqual(config.plugins.updater.endpoints, ['https://github.com/Bees-bot/bees-desktop/releases/latest/download/bees-update.json']);
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  const publicKey = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split('\n');
  assert.match(publicKey[0], /^untrusted comment: minisign public key/);
  assert.equal(Buffer.from(publicKey[1], 'base64').length, 42);
  const script = readFileSync(new URL('./release.sh', import.meta.url), 'utf8');
  const start = script.indexOf('  V=$version BASE=');
  const end = script.indexOf('\n  files=(', start);
  assert.ok(start > 0 && end > start);
  const out = mkdtempSync(join(tmpdir(), 'bees feeds '));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const files = ['aarch64.app.tar.gz', 'x64.app.tar.gz', 'x64-setup.exe', 'amd64.AppImage', 'amd64.deb'];
  for (const file of files) writeFileSync(join(out, `Bees_0.3.1_${file}.sig`), `signature for ${file}\n`);
  execFileSync('bash', ['-eu', '-c', `
    out=$1
    version=0.3.1
    repo=Bees-bot/bees-desktop
    tag=v0.3.1
    ${script.slice(start, end)}
  `, 'feed-test', out], { cwd: new URL('../', import.meta.url) });
  const current = JSON.parse(readFileSync(join(out, 'bees-update.json'), 'utf8'));
  assert.equal(current.version, '0.3.1');
  assert.deepEqual(Object.keys(current.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-x86_64-deb', 'windows-x86_64']);
  for (const entry of Object.values(current.platforms)) {
    assert.match(entry.url, /^https:\/\/github\.com\/Bees-bot\/bees-desktop\/releases\/download\/v0\.3\.1\/Bees_0\.3\.1_/);
    const file = files.find(name => entry.url.endsWith(name));
    assert.equal(entry.signature, `signature for ${file}`);
  }
});

test('release uploads have friendly labels without changing filenames', () => {
  const script = readFileSync(new URL('./release.sh', import.meta.url), 'utf8');
  const upload = script.match(/  for file in "\$\{files\[@\]\}" bees-update\.json SHA256SUMS; do\n[\s\S]*?\n  done/);
  assert.ok(upload, 'release upload loop is present');
  const downloads = [
    ['Bees_0.9.0_aarch64.dmg', 'Mac (Apple silicon) - installer (.dmg)'],
    ['Bees_0.9.0_x64.dmg', 'Mac (Intel) - installer (.dmg)'],
    ['Bees_0.9.0_aarch64.app.tar.gz', 'Automatic update only - Mac (Apple silicon)'],
    ['Bees_0.9.0_x64.app.tar.gz', 'Automatic update only - Mac (Intel)'],
    ['Bees_0.9.0_x64-setup.exe', 'Windows (Intel/AMD 64-bit) - installer (.exe)'],
    ['Bees_0.9.0_amd64.AppImage', 'Linux (Intel/AMD 64-bit) - standalone app (.AppImage)'],
    ['Bees_0.9.0_amd64.deb', 'Linux (Intel/AMD 64-bit) - DEB installer (.deb)'],
    ['Bees_runtime_0.9.0_darwin_arm64.tar.gz', 'Downloaded by Bees - document, voice and memory support'],
    ['bees-update.json', 'Automatic update only - manifest (.json)'],
    ['SHA256SUMS', 'SHA-256 checksums (not an installer)'],
  ];
  const output = execFileSync('bash', ['-eu', '-c', `
    try() { printf '%s\\0' "$@"; }
    tag=v0.9.0
    repo=Bees-bot/bees-desktop
    out='/tmp/release files'
    files=("$@")
    ${upload[0]}
  `, 'release-test', ...downloads.slice(0, -2).map(([file]) => file)], { encoding: 'utf8' });
  assert.deepEqual(output.split('\0').slice(0, -1), downloads.flatMap(([file, label]) => [
    'gh', 'release', 'upload', 'v0.9.0', '--repo', 'Bees-bot/bees-desktop',
    '--clobber', `/tmp/release files/${file}#${label}`,
  ]));
});
