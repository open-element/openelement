import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  renderRequestTimeServerModule,
  renderStandaloneServerModule,
  resolveDynamicRoutePath,
} from '../src/vite/internal/ssg/ssg-helpers.ts';
import { parseRouteFilePath } from '../src/vite/internal/ssg/route-scanner.ts';
import { cacheControlFor, contentTypeFor } from '../src/vite/internal/static-serve.ts';

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

Deno.test('renderStandaloneServerModule fails fast below the URLPattern floor (#969)', () => {
  const code = renderStandaloneServerModule();
  // The generated route table in ./index.js builds WHATWG URLPattern objects
  // at module scope; Node.js only gained the global in v24 (node:url export
  // in v23.8). serve.mjs must check the floor and exit with guidance before
  // importing ./index.js — not die with a raw ReferenceError.
  assertStringIncludes(code, "typeof globalThis.URLPattern === 'undefined'");
  assertStringIncludes(code, "await import('node:url')");
  assertStringIncludes(code, 'Node.js >= 24');
  assertStringIncludes(code, "await import('./index.js')");
  // The dynamic import is load-bearing: a static import would evaluate
  // ./index.js (and its URLPattern constructions) before the floor check.
  assertEquals(code.includes("from './index.js'"), false);
});

Deno.test('renderRequestTimeServerModule carries the URLPattern floor guard (#969)', () => {
  const code = renderRequestTimeServerModule([{ path: '/live' }]);
  // index.js builds its admission patterns at module scope; direct
  // `node dist/server/index.js` on Node < 24 must fail with guidance (or
  // polyfill via node:url on 23.8+), not a raw ReferenceError.
  assertStringIncludes(code, "typeof globalThis.URLPattern === 'undefined'");
  assertStringIncludes(code, "await import('node:url')");
  assertStringIncludes(code, 'requires a runtime with WHATWG URLPattern');
});

Deno.test('renderStandaloneServerModule MIME table matches static-serve.ts (#732-class drift guard)', () => {
  const code = renderStandaloneServerModule();
  // serve.mjs is self-contained and cannot import the shared table, so pin
  // every value instead — a drift here once served CSS without a charset.
  for (
    const ext of [
      '.html',
      '.js',
      '.mjs',
      '.css',
      '.json',
      '.svg',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.ico',
      '.xml',
      '.woff2',
      '.txt',
    ]
  ) {
    assertStringIncludes(code, `'${ext}': '${contentTypeFor(`x${ext}`)}'`);
  }
});

Deno.test('renderStandaloneServerModule Cache-Control rules match static-serve.ts (#1058 drift guard)', () => {
  const code = renderStandaloneServerModule();
  // Same drift class as the MIME table above: serve.mjs inlines the
  // Cache-Control policy instead of importing it. Pin every value the shared
  // cacheControlFor can return, plus the path normalization the hashed-asset
  // regex depends on, so the two implementations cannot diverge.
  assertStringIncludes(code, `'${cacheControlFor('assets/index-Ab1_CD2e.js')}'`);
  assertStringIncludes(code, `'${cacheControlFor('index.html')}'`);
  assertEquals(cacheControlFor('favicon.ico'), null);
  assertStringIncludes(code, "replaceAll(sep, '/')");
});

Deno.test('renderStandaloneServerModule forwards the process env to loaders (#1057)', () => {
  const code = renderStandaloneServerModule();
  // Mirrors cli/start.ts (#981): worker env reaches loaders through `env`;
  // in the standalone server that is the process env, with undefined values
  // filtered out (Record<string, string> contract).
  assertStringIncludes(code, 'openElementServer({ req: request, env: processEnv })');
  assertStringIncludes(code, 'if (value !== undefined) processEnv[key] = value;');
});
