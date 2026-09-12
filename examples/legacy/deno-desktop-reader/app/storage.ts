import type { ReaderSettings } from './types.ts';

const SETTINGS_KEY = 'reader:settings';

const DEFAULTS: ReaderSettings = {
  theme: 'light',
  fontSize: 16,
  lineHeight: 1.6,
  measure: 65,
};

// ---------- Settings ----------

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    console.warn('[storage] corrupt settings data, resetting');
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Partial<ReaderSettings>): void {
  const current = loadSettings();
  const merged = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
}
