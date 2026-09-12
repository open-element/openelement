/**
 * Mastodon Desktop — safe localStorage wrapper.
 */

export const STORAGE_PREFIX = 'mastodon:';

export function storageKey(name: string): string {
  return `${STORAGE_PREFIX}${name}`;
}

export function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // ignore quota or private-mode errors
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}
