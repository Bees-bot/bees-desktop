import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

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
  ];
  for (const [source] of artifacts) {
    const path = join(out, 'ci', source);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  execFileSync('bash', ['-eu', '-c', `
    die() { printf '%s\\n' "$*" >&2; exit 1; }
    out=$1
    version=0.30.0
    ${collect[0]}
  `, 'release-test', out]);
  assert.deepEqual(readdirSync(out).sort(), ['ci', ...artifacts.map(([, target]) => `Bees_0.30.0_${target}`)].sort());
  for (const [source, target] of artifacts) {
    assert.equal(readFileSync(join(out, `Bees_0.30.0_${target}`), 'utf8'), source);
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
