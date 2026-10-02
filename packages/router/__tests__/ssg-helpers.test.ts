import { expect, test } from 'vitest';
import {
  renderRequestTimeServerModule,
  resolveDynamicRoutePath,
} from '../src/vite/internal/ssg/ssg-helpers.ts';
import { parseRouteFilePath } from '../src/vite/internal/ssg/route-scanner.ts';

test('resolveDynamicRoutePath encodes # ? & % and spaces', () => {
  const path = resolveDynamicRoutePath('/blog/:slug', ['slug'], {
    slug: 'a#b?c&d%e f',
  });
  expect(path).toEqual('/blog/a%23b%3Fc%26d%25e%20f');
});

test('resolveDynamicRoutePath preserves @ in values', () => {
  const path = resolveDynamicRoutePath('/pkg/:name', ['name'], {
    name: '@user',
  });
  expect(path).toEqual('/pkg/@user');
});

test('resolveDynamicRoutePath rejects path traversal', () => {
  expect(() => resolveDynamicRoutePath('/x/:p', ['p'], { p: '../etc' })).toThrow();
});

test('resolveDynamicRoutePath resolves catch-all values and consumes the regex body (#1022)', () => {
  expect(resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a/b' })).toEqual(
    '/docs/a/b',
  );
  // Unsafe chars are encoded per segment; the slash structure is preserved.
  expect(resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a b/c#d' })).toEqual(
    '/docs/a%20b/c%23d',
  );
});

test('resolveDynamicRoutePath rejects traversal segments inside catch-all values (#1022)', () => {
  expect(() => resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a/../b' })).toThrow();
  expect(() => resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: '..' })).toThrow();
});

test('request-time client script rides the entry setter — no response splicing (#1103)', () => {
  const code = renderRequestTimeServerModule([]);
  // The generated server module reads the structured client asset manifest
  // (#1471) and hands the entry URL to the SSR entry at startup; the entry
  // embeds the tag at render time through wrapInDocument (CSP-nonce-safe).
  // No post-hoc HTML splicing remains.
  expect(code).toContain(
    "import { openElementHandler, __setRequestTimeClientScript } from './entry.js';",
  );
  expect(code).toContain("import { clientAssets } from './client-assets.js';");
  expect(code).toContain('__setRequestTimeClientScript(clientAssets.entry);');
  expect(code.includes('clientScriptSrc')).toEqual(false);
  expect(code.includes('insertBeforeBodyClose')).toEqual(false);
  expect(code.includes('withClientScript')).toEqual(false);
  expect(code.includes("from '@openelement/")).toEqual(false);
});

test('parseRouteFilePath maps a catch-all segment to a named Hono regex param (#556)', () => {
  expect(parseRouteFilePath('docs/[...path].ts')).toEqual('/docs/:path{.+}');
  expect(parseRouteFilePath('item/[id].ts')).toEqual('/item/:id');
});

test('renderRequestTimeServerModule mounts the entry openElementHandler (#858)', () => {
  const code = renderRequestTimeServerModule([{ path: '/live' }]);
  // The generated server entry delegates to the entry's openElementHandler
  // export, which carries the composed middleware.use chain when configured —
  // no direct app.fetch bypass.
  expect(code).toContain("from './entry.js';");
  expect(code).toContain('return openElementHandler(request, {');
  expect(code.includes('app.fetch')).toEqual(false);
});
