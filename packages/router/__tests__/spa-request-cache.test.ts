import { assertEquals, assertNotEquals } from '@std/assert';
import { SpaRequestCache } from '../src/internal/spa-request-cache.ts';

Deno.test('SPA request cache reuses the GET request for an identical URL and rebuilds on URL change', () => {
  const cache = new SpaRequestCache();
  const first = cache.get('https://example.test/a');

  assertEquals(cache.get('https://example.test/a'), first);
  assertNotEquals(cache.get('https://example.test/b'), first);
});

Deno.test('SPA request cache rebuilds after clear', () => {
  const cache = new SpaRequestCache();
  const first = cache.get('https://example.test/a');
  cache.clear();

  assertNotEquals(cache.get('https://example.test/a'), first);
});
