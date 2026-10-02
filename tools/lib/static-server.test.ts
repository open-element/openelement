import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { contentType, serveStatic } from './static-server.ts';

test('contentType maps known extensions and falls back to octet-stream', () => {
  expect(contentType('/a/b.html')).toEqual('text/html; charset=UTF-8');
  expect(contentType('/a/b.JS')).toEqual('text/javascript; charset=UTF-8');
  expect(contentType('/a/b.css')).toEqual('text/css; charset=UTF-8');
  expect(contentType('/a/b.svg')).toEqual('image/svg+xml');
  expect(contentType('/a/font.woff2')).toEqual('font/woff2');
  expect(contentType('no-extension')).toEqual('application/octet-stream');
});

test('serveStatic serves files and uses production candidate/cache semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  await writeFile(`${root}/index.html`, '<h1>root</h1>');
  await writeFile(`${root}/app.js`, 'console.log(1)');
  await writeFile(`${root}/font.woff2`, new Uint8Array([119, 79, 70, 50]));
  await mkdir(`${root}/guide`);
  await writeFile(`${root}/guide/index.html`, '<h1>guide</h1>');
  await writeFile(`${root}/about.html`, '<h1>about</h1>');

  const server = await serveStatic(root);
  try {
    const page = await (await fetch(`${server.origin}/about`)).text();
    expect(page).toContain('about');

    const dir = await (await fetch(`${server.origin}/guide/`)).text();
    expect(dir).toContain('guide');

    const js = await fetch(`${server.origin}/app.js`);
    expect(js.headers.get('content-type')).toEqual('text/javascript; charset=UTF-8');

    const font = await fetch(`${server.origin}/font.woff2`);
    expect(font.headers.get('content-type')).toEqual('font/woff2');
    await font.body?.cancel();

    const home = await fetch(`${server.origin}/`);
    expect(home.headers.get('cache-control')).toEqual('no-cache');
    await home.body?.cancel();

    const missing = await fetch(`${server.origin}/no/such/route`);
    expect(missing.status).toEqual(404);
    await missing.body?.cancel();
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});

test('serveStatic rejects NUL with 403, returns 404 when nothing matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  const server = await serveStatic(root);
  try {
    // `..` cannot be exercised through fetch (WHATWG URL parsing resolves dot
    // segments, including %2e, before the request leaves the client), but the
    // NUL byte survives percent-decoding into the guard.
    const nul = await fetch(`${server.origin}/%00`);
    expect(nul.status).toEqual(403);
    await nul.body?.cancel();

    // No root index.html present: nothing matches.
    const missing = await fetch(`${server.origin}/anything`);
    expect(missing.status).toEqual(404);
    await missing.body?.cancel();
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});

test('serveStatic answers single-range requests with 206 and advertises accept-ranges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  await writeFile(`${root}/clip.mp4`, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const server = await serveStatic(root);
  try {
    const plain = await fetch(`${server.origin}/clip.mp4`);
    expect(plain.status).toEqual(200);
    expect(plain.headers.get('content-type')).toEqual('video/mp4');
    expect(plain.headers.get('accept-ranges')).toEqual('bytes');
    await plain.body?.cancel();

    const partial = await fetch(`${server.origin}/clip.mp4`, {
      headers: { range: 'bytes=2-5' },
    });
    expect(partial.status).toEqual(206);
    expect(partial.headers.get('content-range')).toEqual('bytes 2-5/10');
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));

    const open = await fetch(`${server.origin}/clip.mp4`, { headers: { range: 'bytes=8-' } });
    expect(open.status).toEqual(206);
    expect(open.headers.get('content-range')).toEqual('bytes 8-9/10');
    await open.body?.cancel();

    const unsatisfiable = await fetch(`${server.origin}/clip.mp4`, {
      headers: { range: 'bytes=42-' },
    });
    expect(unsatisfiable.status).toEqual(416);
    await unsatisfiable.body?.cancel();
  } finally {
    await server.close();
    await rm(root, { recursive: true });
  }
});
