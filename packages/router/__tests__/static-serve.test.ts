/**
 * @openelement/router - static-serve.ts tests (#732)
 *
 * Pins the shared MIME table, static candidate rules, and traversal guard so
 * cli/start.ts and the request-time fixture server cannot drift apart again.
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { join } from '@std/path';
import {
  contentTypeFor,
  dispatchRequest,
  isMalformedUrlError,
  staticFileCandidates,
  tryStatic,
} from '../src/vite/internal/static-serve.ts';

Deno.test('dispatchRequest shares mutating and styled-fallback production semantics (#1100)', async () => {
  const root = await Deno.makeTempDir();
  const seen: string[] = [];
  try {
    await Deno.writeTextFile(join(root, 'index.html'), '<h1>static home</h1>');
    const serverMod = {
      isRequestTimePath: (pathname: string) => pathname === '/live',
      default: ({ req }: { req: Request }) => {
        seen.push(`${req.method} ${new URL(req.url).pathname}`);
        if (new URL(req.url).pathname === '/missing') {
          return Promise.resolve(
            new Response('<h1>styled not found</h1>', {
              status: 404,
              statusText: 'Styled Not Found',
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
          );
        }
        return Promise.resolve(
          new Response('request-time', { status: req.method === 'PUT' ? 405 : 200 }),
        );
      },
    };

    const home = await dispatchRequest(new Request('http://example.test/'), {
      distDir: root,
      serverMod,
    });
    assertEquals(await home.text(), '<h1>static home</h1>');

    const mutation = await dispatchRequest(
      new Request('http://example.test/form', { method: 'PUT', body: 'x=1' }),
      { distDir: root, serverMod },
    );
    assertEquals(mutation.status, 405);

    const missing = await dispatchRequest(new Request('http://example.test/missing'), {
      distDir: root,
      serverMod,
    });
    assertEquals(missing.status, 404);
    assertEquals(missing.statusText, 'Styled Not Found');
    assertStringIncludes(await missing.text(), 'styled not found');
    assertEquals(seen, ['PUT /form', 'GET /missing']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('contentTypeFor covers the merged MIME table (#732)', () => {
  assertEquals(contentTypeFor('/d/index.html'), 'text/html; charset=utf-8');
  assertEquals(contentTypeFor('/d/app.js'), 'text/javascript; charset=utf-8');
  // Added to close the drift: start.ts lacked these three.
  assertEquals(contentTypeFor('/d/app.mjs'), 'text/javascript; charset=utf-8');
  assertEquals(contentTypeFor('/d/favicon.ico'), 'image/x-icon');
  assertEquals(contentTypeFor('/d/sitemap.xml'), 'application/xml; charset=utf-8');
  assertEquals(contentTypeFor('/d/unknown.bin'), 'application/octet-stream');
});

Deno.test('staticFileCandidates: exact, /index.html, then .html', () => {
  assertEquals(staticFileCandidates('/'), ['index.html', 'index.html/index.html']);
  assertEquals(staticFileCandidates('/about'), ['about', 'about/index.html', 'about.html']);
  assertEquals(staticFileCandidates('/about/'), ['about/', 'about/index.html']);
  assertEquals(staticFileCandidates('/a.html'), ['a.html', 'a.html/index.html']);
  assertEquals(staticFileCandidates('/x y'), ['x y', 'x y/index.html', 'x y.html']);
});

Deno.test('tryStatic serves files and refuses path escape', async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, 'index.html'), '<h1>home</h1>');
    await Deno.mkdir(join(root, 'about'));
    await Deno.writeTextFile(join(root, 'about', 'index.html'), '<h1>about</h1>');
    await Deno.writeTextFile(join(root, 'contact.html'), '<h1>contact</h1>');
    await Deno.writeTextFile(join(root, 'feed.xml'), '<rss/>');

    const home = tryStatic(root, '/');
    assert(home);
    assertEquals(await home.text(), '<h1>home</h1>');

    const about = tryStatic(root, '/about');
    assert(about);
    assertEquals(await about.text(), '<h1>about</h1>');

    const contact = tryStatic(root, '/contact');
    assert(contact);
    assertEquals(await contact.text(), '<h1>contact</h1>');

    const feed = tryStatic(root, '/feed.xml');
    assert(feed);
    assertEquals(feed.headers.get('content-type'), 'application/xml; charset=utf-8');

    assertEquals(tryStatic(root, '/missing'), null);
    // Path escape outside the static root must never be served.
    assertEquals(tryStatic(root, '/../secret.txt'), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('tryStatic treats a directory at a candidate path as a miss (#1281, CodeQL file-system-race)', async () => {
  // The candidate check is read-and-fallback instead of existsSync/statSync
  // guard-then-read (check-then-act TOCTOU): a directory named like a file
  // candidate must fall through exactly like a missing file.
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, 'dir.html'));
    await Deno.writeTextFile(join(root, 'real.html'), '<h1>real</h1>');
    assertEquals(tryStatic(root, '/dir.html'), null);
    const real = tryStatic(root, '/real.html');
    assert(real);
    assertEquals(await real.text(), '<h1>real</h1>');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('malformed percent-encoding is a defined 400, never a crash (#823)', async () => {
  // decodeURIComponent throws URIError on input like /%zz; the serving layer
  // converts it to a 400 so `start` and the fixture server stay alive.
  const err = assertThrows(() => staticFileCandidates('/%zz'), URIError);
  assert(isMalformedUrlError(err));
  assert(!isMalformedUrlError(new Error('nope')));

  const root = await Deno.makeTempDir();
  try {
    const response = tryStatic(root, '/%zz');
    assert(response);
    assertEquals(response.status, 400);
    assertEquals(await response.text(), 'Bad Request');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('tryStatic cache-control: content-hashed assets immutable, HTML rechecked on deploy (#1039)', async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, 'assets'));
    await Deno.writeTextFile(join(root, 'assets', 'index-Dq2gH8fM.js'), 'console.log(1)');
    await Deno.writeTextFile(join(root, 'index.html'), '<h1>home</h1>');
    await Deno.writeTextFile(join(root, 'favicon.ico'), 'ico');

    const asset = tryStatic(root, '/assets/index-Dq2gH8fM.js');
    assert(asset);
    assertEquals(
      asset.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    const html = tryStatic(root, '/');
    assert(html);
    assertEquals(html.headers.get('cache-control'), 'no-cache');

    // Unhashed static files stay unpinned.
    const icon = tryStatic(root, '/favicon.ico');
    assert(icon);
    assertEquals(icon.headers.get('cache-control'), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
