import { assertEquals } from '@std/assert';
import { getCache, removeCache, setCache } from '../cache.ts';
import { storageKey } from '../storage.ts';

// Test-only helper (demoted from cache.ts: it has no production callers).
function clearCache(): void {
  try {
    const prefix = storageKey('cache:');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}

Deno.test('setCache and getCache round-trip', () => {
  const key = 'test-roundtrip';
  removeCache(key);
  setCache(key, { hello: 'world' });
  const value = getCache<{ hello: string }>(key, 60_000);
  assertEquals(value, { hello: 'world' });
});

Deno.test('getCache returns undefined for missing key', () => {
  removeCache('missing');
  const value = getCache('missing', 60_000);
  assertEquals(value, undefined);
});

Deno.test('getCache returns undefined after TTL', () => {
  const key = 'test-ttl';
  setCache(key, 'value');
  const value = getCache<string>(key, -1);
  assertEquals(value, undefined);
});

Deno.test('clearCache removes all cache entries', () => {
  setCache('a', 1);
  setCache('b', 2);
  clearCache();
  assertEquals(getCache('a', 60_000), undefined);
  assertEquals(getCache('b', 60_000), undefined);
});
