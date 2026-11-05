import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export function packageOptionalRuntime(runtime, output, version, target, identity) {
  const platform = target.includes('apple-darwin') ? 'darwin' : target.includes('windows') ? 'win32' : 'linux';
  const arch = target.startsWith('aarch64') ? 'arm64' : 'x64';
  const officePackage = `@deepseek-ai/libreoffice-kit-${platform === 'linux' ? 'wasm' : `${platform}-${arch}`}`;
  const speechPackage = `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`;
  const source = join(runtime, 'node_modules', officePackage);
  if (!existsSync(source)) throw new Error(`LibreOffice engine is missing: ${officePackage}`);
  const staging = mkdtempSync(join(tmpdir(), 'bees-support-'));
  try {
    const files = join(staging, 'runtime');
    mkdirSync(dirname(join(files, 'node_modules', officePackage)), { recursive: true });
    cpSync(source, join(files, 'node_modules', officePackage), { recursive: true, dereference: true });
    for (const name of ['sherpa-onnx-node', speechPackage])
      cpSync(join(runtime, 'node_modules', name), join(files, 'node_modules', name), { recursive: true, dereference: true });
    mkdirSync(join(files, 'licenses'));
    for (const name of ['NOTICE', 'LICENSE-APACHE', 'LICENSE-MIT'])
      cpSync(join(dirname(runtime), name), join(files, 'licenses', name));
    cpSync(join(runtime, 'memory-runtime'), join(files, 'memory-runtime'), { recursive: true });
    if (platform === 'darwin' && identity && identity !== '-') {
      const archive = join(staging, 'notarize.zip');
      execFileSync('ditto', ['-c', '-k', '--keepParent', files, archive], { stdio: 'inherit' });
      let submission;
      try {
        const result = execFileSync('xcrun', ['notarytool', 'submit', archive, '--apple-id', process.env.APPLE_ID,
          '--password', process.env.APPLE_PASSWORD, '--team-id', process.env.APPLE_TEAM_ID, '--wait', '--output-format', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
        submission = JSON.parse(result);
      } catch { throw new Error('Bees support package notarization failed'); }
      if (submission.status !== 'Accepted') throw new Error(`Bees support notarization ${submission.id}: ${submission.status}`);
    }
    mkdirSync(output, { recursive: true });
    const filename = `Bees_runtime_${version}_${platform}_${arch}.tar.gz`;
    const archive = join(output, filename);
    execFileSync('tar', ['-czf', archive, '-C', files, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const manifest = { platform, arch, officePackage, speechPackage,
      url: `https://github.com/Bees-bot/bees-desktop/releases/download/v${version}/${filename}`,
      sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), bytes: statSync(archive).size };
    return manifest;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

export function stageDesktopRuntime(runtime, destination, manifest) {
  rmSync(destination, { recursive: true, force: true });
  cpSync(runtime, destination, { recursive: true, dereference: true, filter: path => {
    if (!manifest) return true;
    return path !== join(runtime, 'memory-runtime') &&
      !(dirname(path) === join(runtime, 'node_modules') && /^sherpa-onnx-/.test(basename(path))) &&
      !(dirname(path) === join(runtime, 'node_modules', '@deepseek-ai') && /^libreoffice-kit-(?:darwin-|win32-|linux-|wasm)/.test(basename(path)));
  } });
  if (manifest) writeFileSync(join(destination, 'optional-runtime.json'), JSON.stringify(manifest) + '\n');
}
