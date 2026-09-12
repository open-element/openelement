/**
 * Mastodon Desktop — persisted app settings.
 */

import type { AppSettings } from './types.ts';
import { readJson, writeJson } from './storage.ts';

const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: AppSettings = {
  instanceUrl: 'mastodon.social',
  theme: 'system',
  timelineDensity: 'comfortable',
};

export function loadSettings(): AppSettings {
  const stored = readJson<Partial<AppSettings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function applyTheme(theme: AppSettings['theme']): void {
  const resolved = theme === 'system'
    ? (globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}
