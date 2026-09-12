/**
 * Mastodon Desktop — simple localStorage cache with TTL.
 */

import { readJson, storageKey, writeJson } from './storage.ts';

const CACHE_PREFIX = 'cache:';

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

function cacheKey(name: string): string {
  return `${CACHE_PREFIX}${name}`;
}

export function getCache<T>(name: string, ttlMs: number): T | undefined {
  const entry = readJson<CacheEntry<T>>(cacheKey(name));
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > ttlMs) {
    removeCache(name);
    return undefined;
  }
  return entry.value;
}

export function setCache<T>(name: string, value: T): void {
  writeJson(cacheKey(name), { value, storedAt: Date.now() });
}

export function removeCache(name: string): void {
  try {
    localStorage.removeItem(storageKey(cacheKey(name)));
  } catch {
    // ignore
  }
}
