import { expect, test } from 'vitest';
import { normalizeRoutePatternForURLPattern } from '../src/internal/router/route-pattern.ts';

test('shared route normalizer preserves params and converts Hono catch-alls (#1103)', () => {
  expect(normalizeRoutePatternForURLPattern('/item/:id')).toEqual('/item/:id');
  expect(normalizeRoutePatternForURLPattern('/docs/:path{.+}')).toEqual('/docs/:path(.+)');
  expect(normalizeRoutePatternForURLPattern('/org/:org/repo/:path{.*}')).toEqual(
    '/org/:org/repo/:path(.*)',
  );
});
