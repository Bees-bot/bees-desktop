import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Carry forward the pinned installer used by old Bees, not a machine's Python environment.
export async function prepareMemoryInstaller(directory, target, stageExecutable) {
  const release = '0.10.0', windows = target.includes('windows');
  const binary = join(directory, windows ? 'uv.exe' : 'uv'), marker = join(directory, '.prepared');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (existsSync(marker) && existsSync(binary)) {
    const saved = JSON.parse(readFileSync(marker, 'utf8'));
    if (saved.version === `${release}-${target}` && saved.digest === hash(readFileSync(binary))) return;
  }
  const archive = `uv-${target}.${windows ? 'zip' : 'tar.gz'}`;
  const base = `https://github.com/astral-sh/uv/releases/download/${release}`;
  const get = async url => { const response = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!response.ok) throw Error(`Could not download the memory installer (HTTP ${response.status})`); return response; };
  const expected = (await (await get(`${base}/${archive}.sha256`)).text()).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid memory installer checksum');
  const bytes = Buffer.from(await (await get(`${base}/${archive}`)).arrayBuffer());
  if (hash(bytes) !== expected) throw Error('Memory installer checksum did not match');
  const staging = mkdtempSync(join(tmpdir(), 'bees-memory-installer-'));
  try {
    const path = join(staging, archive); writeFileSync(path, bytes);
    if (windows) execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.replaceAll("'", "''")}' -DestinationPath '${staging.replaceAll("'", "''")}'`]);
    else execFileSync('tar', ['-xzf', path, '-C', staging]);
    const find = root => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === (windows ? 'uv.exe' : 'uv')) return join(root, entry.name);
        if (entry.isDirectory()) { const hit = find(join(root, entry.name)); if (hit) return hit; }
      }
    };
    const executable = find(staging); if (!executable) throw Error('Memory installer executable is missing');
    mkdirSync(directory, { recursive: true }); stageExecutable(executable, binary, 'Memory installer');
    const license = await (await get(`https://raw.githubusercontent.com/astral-sh/uv/${release}/LICENSE-MIT`)).text();
    writeFileSync(join(directory, 'LICENSE-MIT'), license);
    writeFileSync(marker, JSON.stringify({ version: `${release}-${target}`, digest: hash(readFileSync(binary)) }));
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
