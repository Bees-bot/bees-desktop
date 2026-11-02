import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
