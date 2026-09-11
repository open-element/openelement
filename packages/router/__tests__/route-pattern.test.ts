import { assertEquals } from '@std/assert';
import { normalizeRoutePatternForURLPattern } from '../src/internal/router/route-pattern.ts';

Deno.test('shared route normalizer preserves params and converts Hono catch-alls (#1103)', () => {
  assertEquals(normalizeRoutePatternForURLPattern('/item/:id'), '/item/:id');
  assertEquals(
    normalizeRoutePatternForURLPattern('/docs/:path{.+}'),
    '/docs/:path(.+)',
  );
  assertEquals(
    normalizeRoutePatternForURLPattern('/org/:org/repo/:path{.*}'),
    '/org/:org/repo/:path(.*)',
  );
});
