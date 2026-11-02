import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

test('an unsupported default browser offers installed Chrome while supported defaults keep priority', { skip: process.platform !== 'darwin' }, async t => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromeState = join(homedir(), 'Library/Application Support/Google/Chrome/Local State');
  const braveState = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser/Local State');
  let app, installed;
  t.mock.method(childProcess, 'execFileSync', command => { assert.equal(command, 'osascript'); return JSON.stringify(app); });
  t.mock.method(fs, 'existsSync', path => installed.has(String(path)));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const zen = { id: 'app.zen-browser.zen', path: '/Applications/Zen.app', binary: '/Applications/Zen.app/Contents/MacOS/zen' };
  const brave = { id: 'com.brave.Browser', path: '/Applications/Brave Browser.app', binary: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' };
  let i = 0;
  for (const [defaultApp, paths, expected] of [
    [zen, [chrome, chromeState], 'Google Chrome'],
    [brave, [chrome, chromeState, braveState], 'Brave Browser'],
    [zen, [], null]
  ]) {
    app = defaultApp; installed = new Set(paths);
    const { defaultBrowser } = await import(`./agent-browser.js?browser-choice=${i++}`);
    const browser = defaultBrowser();
    assert.equal(browser?.name ?? null, expected);
    if (expected === 'Google Chrome') { assert.equal(browser.binary, chrome); assert.equal(browser.fallback, true); }
    if (expected === 'Brave Browser') assert.equal(browser.fallback, undefined);
  }
});
