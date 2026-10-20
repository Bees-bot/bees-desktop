import { h, useEffect, useState } from './runtime.js';
import { THEME_PRESETS } from '../lib/themes.js';

export function useAppearance(preferences, fallback) {
  const [snapshot, setSnapshot] = useState(() => preferences?.getSnapshot());
  useEffect(() => {
    if (!preferences) return;
    const update = () => setSnapshot(preferences.getSnapshot());
    const unsubscribe = preferences.subscribe(update);
    update();
    return unsubscribe;
  }, [preferences]);
  return preferences ? snapshot?.value ?? {} : fallback ?? {};
}

export function themeStyle(theme) {
  return {
    colorScheme: theme.dark ? 'dark' : 'light',
    '--ink': theme.foreground, '--muted': `color-mix(in srgb, ${theme.foreground} 72%, ${theme.surface})`,
    '--surface': theme.surface, '--surface-alt': theme.surfaceAlt, '--raised': theme.surfaceRaised,
    '--line': `color-mix(in srgb, ${theme.foreground} 16%, ${theme.surface})`,
    '--accent': theme.colors[0], '--accent-contrast': theme.primaryContent,
    '--soft': `color-mix(in srgb, ${theme.colors[0]} 10%, ${theme.surface})`,
    '--bees-accent': theme.colors[0], '--bees-accent-contrast': theme.primaryContent,
    '--dsw-alias-bg-base': theme.surface, '--dsw-alias-label-primary': theme.foreground,
    '--dsw-alias-label-secondary': `color-mix(in srgb, ${theme.foreground} 72%, ${theme.surface})`,
    '--dsw-alias-border-l1': `color-mix(in srgb, ${theme.foreground} 16%, ${theme.surface})`,
    '--dsw-alias-interactive-bg-hover': theme.surfaceAlt,
    '--dsw-alias-button-elevated-fill': theme.surface,
  };
}

export function AppearanceSettings({ preference, onSave, disabled }) {
  const choose = theme => onSave({ themePreset: theme.id, colorMode: theme.dark ? 'dark' : 'light' });
  return h('section', { className: 'bc-form' },
    h('h3', null, 'Appearance'),
    h('p', { className: 'bc-muted' }, 'Your theme applies across all threads and organizations on this computer.'),
    h('h3', null, 'Theme defaults'),
    ...['dark', 'light'].map(mode => h('label', { className: 'bc-field', key: mode },
      h('span', null, `Default ${mode} theme`),
      h('select', { disabled, value: preference[`${mode}ThemePreset`] ?? (mode === 'dark' ? 'halloween' : 'corporate'),
        onChange: event => onSave({ [`${mode}ThemePreset`]: event.target.value }) },
      THEME_PRESETS.filter(theme => theme.dark === (mode === 'dark')).map(theme => h('option', { key: theme.id, value: theme.id }, theme.label))))),
    h('h3', null, 'Themes'),
    h('div', { className: 'bc-theme-grid' }, THEME_PRESETS.map(theme => h('button', {
      key: theme.id, type: 'button', disabled, 'aria-pressed': (preference.themePreset ?? 'corporate') === theme.id,
      onClick: () => choose(theme), className: 'bc-theme-card',
    }, h('span', { className: 'bc-theme-swatches', 'aria-hidden': true }, theme.colors.map((color, i) =>
      h('span', { key: i, style: { background: color } }))), theme.label))));
}
