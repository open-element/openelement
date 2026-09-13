import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  renderRequestTimeServerModule,
  resolveDynamicRoutePath,
} from '../src/vite/internal/ssg/ssg-helpers.ts';
import { parseRouteFilePath } from '../src/vite/internal/ssg/route-scanner.ts';

Deno.test('resolveDynamicRoutePath encodes # ? & % and spaces', () => {
  const path = resolveDynamicRoutePath('/blog/:slug', ['slug'], {
    slug: 'a#b?c&d%e f',
  });
  assertEquals(path, '/blog/a%23b%3Fc%26d%25e%20f');
});

Deno.test('resolveDynamicRoutePath preserves @ in values', () => {
  const path = resolveDynamicRoutePath('/pkg/:name', ['name'], {
    name: '@user',
  });
  assertEquals(path, '/pkg/@user');
});

Deno.test('resolveDynamicRoutePath rejects path traversal', () => {
  assertThrows(() => resolveDynamicRoutePath('/x/:p', ['p'], { p: '../etc' }));
});

Deno.test('resolveDynamicRoutePath resolves catch-all values and consumes the regex body (#1022)', () => {
  assertEquals(
    resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a/b' }),
    '/docs/a/b',
  );
  // Unsafe chars are encoded per segment; the slash structure is preserved.
  assertEquals(
    resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a b/c#d' }),
    '/docs/a%20b/c%23d',
  );
});

Deno.test('resolveDynamicRoutePath rejects traversal segments inside catch-all values (#1022)', () => {
  assertThrows(() => resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: 'a/../b' }));
  assertThrows(() => resolveDynamicRoutePath('/docs/:path{.+}', ['path'], { path: '..' }));
});

Deno.test('request-time client injection embeds portable tolerant helper and preserves statusText (#1103)', () => {
  const code = renderRequestTimeServerModule([]);
  assertStringIncludes(code, 'function insertBeforeBodyClose(html, fragment)');
  assertStringIncludes(code, "insertBeforeBodyClose(html, '  ' + tag)");
  assertStringIncludes(code, 'statusText: response.statusText');
  assertEquals(code.includes("from '@openelement/"), false);
});

Deno.test('parseRouteFilePath maps a catch-all segment to a named Hono regex param (#556)', () => {
  assertEquals(parseRouteFilePath('docs/[...path].ts'), '/docs/:path{.+}');
  assertEquals(parseRouteFilePath('item/[id].ts'), '/item/:id');
});

Deno.test('renderRequestTimeServerModule mounts the entry openElementHandler (#858)', () => {
  const code = renderRequestTimeServerModule([{ path: '/live' }]);
  // The generated server entry delegates to the entry's openElementHandler
  // export, which carries the composed middleware.use chain when configured —
  // no direct app.fetch bypass.
  assertStringIncludes(code, "import { openElementHandler } from './entry.js';");
  assertStringIncludes(code, 'return openElementHandler(request, {');
  assertEquals(code.includes('app.fetch'), false);
});
