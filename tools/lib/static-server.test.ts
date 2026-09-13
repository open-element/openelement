import { assertEquals, assertStringIncludes } from '@std/assert';
import { contentType, serveStatic } from './static-server.ts';

Deno.test('contentType maps known extensions and falls back to octet-stream', () => {
  assertEquals(contentType('/a/b.html'), 'text/html; charset=UTF-8');
  assertEquals(contentType('/a/b.JS'), 'text/javascript; charset=UTF-8');
  assertEquals(contentType('/a/b.css'), 'text/css; charset=UTF-8');
  assertEquals(contentType('/a/b.svg'), 'image/svg+xml');
  assertEquals(contentType('/a/font.woff2'), 'font/woff2');
  assertEquals(contentType('no-extension'), 'application/octet-stream');
});

Deno.test('serveStatic serves files and uses production candidate/cache semantics', async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(`${root}/index.html`, '<h1>root</h1>');
  await Deno.writeTextFile(`${root}/app.js`, 'console.log(1)');
  await Deno.writeFile(`${root}/font.woff2`, new Uint8Array([119, 79, 70, 50]));
  await Deno.mkdir(`${root}/guide`);
  await Deno.writeTextFile(`${root}/guide/index.html`, '<h1>guide</h1>');
  await Deno.writeTextFile(`${root}/about.html`, '<h1>about</h1>');

  const server = serveStatic(root);
  try {
    const page = await (await fetch(`${server.origin}/about`)).text();
    assertStringIncludes(page, 'about');

    const dir = await (await fetch(`${server.origin}/guide/`)).text();
    assertStringIncludes(dir, 'guide');

    const js = await fetch(`${server.origin}/app.js`);
    assertEquals(js.headers.get('content-type'), 'text/javascript; charset=UTF-8');

    const font = await fetch(`${server.origin}/font.woff2`);
    assertEquals(font.headers.get('content-type'), 'font/woff2');
    await font.body?.cancel();

    const home = await fetch(`${server.origin}/`);
    assertEquals(home.headers.get('cache-control'), 'no-cache');
    await home.body?.cancel();

    const missing = await fetch(`${server.origin}/no/such/route`);
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  } finally {
    await server.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('serveStatic rejects NUL with 403, returns 404 when nothing matches', async () => {
  const root = await Deno.makeTempDir();
  const server = serveStatic(root);
  try {
    // `..` cannot be exercised through fetch (WHATWG URL parsing resolves dot
    // segments, including %2e, before the request leaves the client), but the
    // NUL byte survives percent-decoding into the guard.
    const nul = await fetch(`${server.origin}/%00`);
    assertEquals(nul.status, 403);
    await nul.body?.cancel();

    // No root index.html present: nothing matches.
    const missing = await fetch(`${server.origin}/anything`);
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  } finally {
    await server.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('serveStatic answers single-range requests with 206 and advertises accept-ranges', async () => {
  const root = await Deno.makeTempDir();
  await Deno.writeFile(`${root}/clip.mp4`, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const server = serveStatic(root);
  try {
    const plain = await fetch(`${server.origin}/clip.mp4`);
    assertEquals(plain.status, 200);
    assertEquals(plain.headers.get('content-type'), 'video/mp4');
    assertEquals(plain.headers.get('accept-ranges'), 'bytes');
    await plain.body?.cancel();

    const partial = await fetch(`${server.origin}/clip.mp4`, {
      headers: { range: 'bytes=2-5' },
    });
    assertEquals(partial.status, 206);
    assertEquals(partial.headers.get('content-range'), 'bytes 2-5/10');
    assertEquals(new Uint8Array(await partial.arrayBuffer()), new Uint8Array([2, 3, 4, 5]));

    const open = await fetch(`${server.origin}/clip.mp4`, { headers: { range: 'bytes=8-' } });
    assertEquals(open.status, 206);
    assertEquals(open.headers.get('content-range'), 'bytes 8-9/10');
    await open.body?.cancel();

    const unsatisfiable = await fetch(`${server.origin}/clip.mp4`, {
      headers: { range: 'bytes=42-' },
    });
    assertEquals(unsatisfiable.status, 416);
    await unsatisfiable.body?.cancel();
  } finally {
    await server.close();
    await Deno.remove(root, { recursive: true });
  }
});
