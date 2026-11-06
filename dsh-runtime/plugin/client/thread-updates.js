import { h, useEffect, useRef, useState, hosted } from './runtime.js';
import { openExternal } from './common.js';

export function useUpdates() {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  const enabled = !!invoke && !hosted;
  const [version, setVersion] = useState(null), [currentVersion, setCurrentVersion] = useState('');
  const [status, setStatus] = useState(''), [checking, setChecking] = useState(false), [installing, setInstalling] = useState(false);
  const busy = useRef(false);
  const check = async (manual = false) => {
    if (!enabled || busy.current) return;
    busy.current = true;
    setChecking(true);
    if (manual) setStatus('');
    try {
      const next = await invoke('check_for_update');
      setVersion(next);
      if (next || manual) setStatus(next ? '' : 'Bees is up to date.');
    } catch (error) {
      if (manual) setStatus('Could not check for updates: ' + error);
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };
  const install = async () => {
    if (!enabled || busy.current) return;
    busy.current = true;
    setInstalling(true);
    setStatus('');
    let restarting = false;
    try {
      restarting = await invoke('install_update');
    } catch (error) {
      setStatus('Update failed: ' + error);
    } finally {
      if (!restarting) {
        busy.current = false;
        setInstalling(false);
      }
    }
  };
  useEffect(() => {
    if (!enabled) return;
    void invoke('plugin:app|version').then(setCurrentVersion, () => {});
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return { enabled, version, currentVersion, status, checking, installing, check, install };
}

export function UpdateSettings({ updates, onClose }) {
  const { enabled, version, currentVersion, status, checking, installing, check, install } = updates;
  if (!enabled) return null;
  return h('section', { className: 'bc-form' },
    h('h3', null, 'Check for updates'),
    currentVersion ? h('p', null, `You are on version ${currentVersion}.`) : null,
    h('p', { className: 'bc-muted' }, 'Bees checks for updates at startup and every six hours. You choose when to update and restart.'),
    h('p', { role: 'status' }, installing ? 'Downloading update…' : status || (version ? `Bees ${version} is ready to install.` : 'Check for a newer version of Bees.')),
    h('div', { className: 'bc-actions' },
      h('button', { type: 'button', disabled: checking || installing, onClick: () => check(true) }, checking ? 'Checking…' : 'Check for updates'),
      version ? h('button', { type: 'button', onClick: () => void openExternal(`https://github.com/Bees-bot/bees-desktop/releases/tag/v${version}`) }, "What's new") : null,
      version ? h('button', { type: 'button', className: 'bc-primary', disabled: checking || installing, onClick: install }, installing ? 'Downloading…' : 'Update and restart') : null,
      version ? h('button', { type: 'button', disabled: installing, onClick: onClose }, 'Later') : null));
}
