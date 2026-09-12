import { h } from 'preact';
import { useState } from 'preact/hooks';
import { definePreactIsland } from '@openelement/app/preact';
import { applyTheme, loadSettings, saveSettings } from '../app/settings.ts';
import type { AppSettings } from '../app/types.ts';

function SettingsIsland() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [saved, setSaved] = useState(false);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    if (key === 'theme') applyTheme(value as AppSettings['theme']);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return h(
    'form',
    {
      className: 'mastodon-settings-form',
      onSubmit: (e: Event) => e.preventDefault(),
    },
    [
      h(
        'style',
        null,
        `
        .mastodon-settings-form { display: grid; gap: 20px; }
        .mastodon-settings-field { display: grid; gap: 6px; }
        .mastodon-settings-field label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        .mastodon-settings-form input, .mastodon-settings-form select {
          background: var(--bg-inset);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font: inherit;
          padding: 10px 12px;
        }
        .mastodon-settings-form input:focus, .mastodon-settings-form select:focus {
          border-color: var(--brand);
          box-shadow: 0 0 0 3px var(--brand-ring);
          outline: none;
        }
        .mastodon-settings-hint { color: var(--text-muted); font-size: 13px; margin: 0; }
        .mastodon-settings-saved { color: var(--brand); font-size: 14px; font-weight: 600; }
      `,
      ),
      h('div', { className: 'mastodon-settings-field' }, [
        h('label', { htmlFor: 'instance' }, 'Instance'),
        h('input', {
          id: 'instance',
          type: 'text',
          value: settings.instanceUrl,
          onInput: (e: Event) => update('instanceUrl', (e.currentTarget as HTMLInputElement).value),
        }),
        h(
          'p',
          { className: 'mastodon-settings-hint' },
          'Public Mastodon instance used in live mode.',
        ),
      ]),
      h('div', { className: 'mastodon-settings-field' }, [
        h('label', { htmlFor: 'theme' }, 'Theme'),
        h('select', {
          id: 'theme',
          value: settings.theme,
          onChange: (e: Event) =>
            update('theme', (e.currentTarget as HTMLSelectElement).value as AppSettings['theme']),
        }, [
          h('option', { value: 'light' }, 'Light'),
          h('option', { value: 'dark' }, 'Dark'),
          h('option', { value: 'system' }, 'System'),
        ]),
      ]),
      h('div', { className: 'mastodon-settings-field' }, [
        h('label', { htmlFor: 'density' }, 'Timeline density'),
        h('select', {
          id: 'density',
          value: settings.timelineDensity,
          onChange: (e: Event) =>
            update(
              'timelineDensity',
              (e.currentTarget as HTMLSelectElement).value as AppSettings['timelineDensity'],
            ),
        }, [
          h('option', { value: 'comfortable' }, 'Comfortable'),
          h('option', { value: 'compact' }, 'Compact'),
        ]),
      ]),
      saved && h('p', { className: 'mastodon-settings-saved' }, 'Saved'),
    ],
  );
}

definePreactIsland('settings-island', SettingsIsland, { ssr: false });
