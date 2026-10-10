/**
 * @openelement/router - static-serve.ts tests (#732)
 *
 * Pins the shared MIME table, static candidate rules, and traversal guard so
 * cli/start.ts and the request-time fixture server cannot drift apart again.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import {
  contentTypeFor,
  dispatchRequest,
  isMalformedUrlError,
  staticFileCandidates,
  tryErrorDocument,
  tryStatic,
} from '../src/vite/internal/static-serve.ts';

test('dispatchRequest shares mutating and styled-fallback production semantics (#1100)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  const seen: string[] = [];
  try {
    await writeFile(join(root, 'index.html'), '<h1>static home</h1>');
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
    expect(await home.text()).toEqual('<h1>static home</h1>');

    const mutation = await dispatchRequest(
      new Request('http://example.test/form', { method: 'PUT', body: 'x=1' }),
      { distDir: root, serverMod },
    );
    expect(mutation.status).toEqual(405);

    const missing = await dispatchRequest(new Request('http://example.test/missing'), {
      distDir: root,
      serverMod,
    });
    expect(missing.status).toEqual(404);
    expect(missing.statusText).toEqual('Styled Not Found');
    expect(await missing.text()).toContain('styled not found');
    expect(seen).toEqual(['PUT /form', 'GET /missing']);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('contentTypeFor uses the maintained mime database (#732)', () => {
  expect(contentTypeFor('/d/index.html')).toEqual('text/html; charset=UTF-8');
  expect(contentTypeFor('/d/app.js')).toEqual('text/javascript; charset=UTF-8');
  // Added to close the drift: start.ts lacked these three.
  expect(contentTypeFor('/d/app.mjs')).toEqual('text/javascript; charset=UTF-8');
  expect(contentTypeFor('/d/favicon.ico')).toEqual('image/vnd.microsoft.icon');
  expect(contentTypeFor('/d/sitemap.xml')).toEqual('application/xml');
  expect(contentTypeFor('/d/unknown.bin')).toEqual('application/octet-stream');
});

test('staticFileCandidates: exact, /index.html, then .html', () => {
  expect(staticFileCandidates('/')).toEqual(['index.html', 'index.html/index.html']);
  expect(staticFileCandidates('/about')).toEqual(['about', 'about/index.html', 'about.html']);
  expect(staticFileCandidates('/about/')).toEqual(['about/', 'about/index.html']);
  expect(staticFileCandidates('/a.html')).toEqual(['a.html', 'a.html/index.html']);
  expect(staticFileCandidates('/x y')).toEqual(['x y', 'x y/index.html', 'x y.html']);
});

test('tryStatic serves files and refuses path escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await mkdir(join(root, 'about'));
    await writeFile(join(root, 'about', 'index.html'), '<h1>about</h1>');
    await writeFile(join(root, 'contact.html'), '<h1>contact</h1>');
    await writeFile(join(root, 'feed.xml'), '<rss/>');

    const home = tryStatic(root, '/');
    expect(home).toBeTruthy();
    expect(await home.text()).toEqual('<h1>home</h1>');

    const about = tryStatic(root, '/about');
    expect(about).toBeTruthy();
    expect(await about.text()).toEqual('<h1>about</h1>');

    const contact = tryStatic(root, '/contact');
    expect(contact).toBeTruthy();
    expect(await contact.text()).toEqual('<h1>contact</h1>');

    const feed = tryStatic(root, '/feed.xml');
    expect(feed).toBeTruthy();
    expect(feed.headers.get('content-type')).toEqual('application/xml');

    expect(tryStatic(root, '/missing')).toEqual(null);
    // Path escape outside the static root must never be served.
    expect(tryStatic(root, '/../secret.txt')).toEqual(null);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryStatic serves the error document with the 404 status it denotes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await mkdir(join(root, 'zh'));
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, '404.html'), '<h1>not found</h1>');
    await writeFile(join(root, 'zh', '404.html'), '<h1>未找到</h1>');

    // The document is the not-found answer by definition, whichever URL form
    // reaches it: the exact file, or the clean-URL twin the candidate rules
    // resolve to the same bytes. It must never answer 200, or a cache or
    // crawler records the error document as real content.
    for (const pathname of ['/404.html', '/404', '/zh/404.html', '/zh/404']) {
      const response = tryStatic(root, pathname);
      expect(response, `${pathname} resolves to the error document`).toBeTruthy();
      expect(response!.status, `${pathname} status`).toEqual(404);
      expect(response!.headers.get('content-type')).toEqual('text/html; charset=UTF-8');
    }
    expect(await tryStatic(root, '/404.html')!.text()).toEqual('<h1>not found</h1>');
    expect(await tryStatic(root, '/zh/404')!.text()).toEqual('<h1>未找到</h1>');

    // Ordinary pages keep the 200 contract.
    expect(tryStatic(root, '/')!.status).toEqual(200);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("tryErrorDocument: the request's first-segment document wins, else the root one", async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, '404.html'), '<h1>root error</h1>');
    await mkdir(join(root, 'zh'));
    await writeFile(join(root, 'zh', '404.html'), '<h1>zh error</h1>');
    await mkdir(join(root, 'guide'));
    await writeFile(join(root, 'guide', '404.html'), '<h1>guide error</h1>');
    // A document two levels down exists but is NOT a site error document.
    await mkdir(join(root, 'deep'));
    await mkdir(join(root, 'deep', 'nested'));
    await writeFile(join(root, 'deep', 'nested', '404.html'), '<h1>deeper decoy</h1>');

    const root404 = tryErrorDocument(root, '/no-such-page');
    expect(root404!.status).toEqual(404);
    expect(await root404!.text()).toEqual('<h1>root error</h1>');

    // The locale convention the SSG emits: dist/<locale>/404.html. It covers
    // misses under the locale AND the locale directory itself.
    const zh404 = tryErrorDocument(root, '/zh/no-such-page');
    expect(zh404!.status).toEqual(404);
    expect(await zh404!.text()).toEqual('<h1>zh error</h1>');
    expect(await tryErrorDocument(root, '/zh/')!.text()).toEqual('<h1>zh error</h1>');

    // The first segment's own document.
    expect(await tryErrorDocument(root, '/guide/no-such-page')!.text()).toEqual(
      '<h1>guide error</h1>',
    );
    // A miss deeper under the same first segment still resolves through that
    // first segment, never through a document nested below it.
    expect(await tryErrorDocument(root, '/guide/deep/no-such-page')!.text()).toEqual(
      '<h1>guide error</h1>',
    );
    // `deep/nested/404.html` is two levels deep: not consulted (the answer
    // comes from the root document, since `deep/404.html` does not exist).
    expect(await tryErrorDocument(root, '/deep/nested/no-such-page')!.text()).toEqual(
      '<h1>root error</h1>',
    );
    // A single-segment miss whose segment carries no document falls back.
    expect(await tryErrorDocument(root, '/deep/')!.text()).toEqual('<h1>root error</h1>');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryErrorDocument returns null when the build shipped no error document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    expect(tryErrorDocument(root, '/no-such-page')).toEqual(null);
    // A locale-prefixed miss with only the root document falls back to it.
    await writeFile(join(root, '404.html'), '<h1>root error</h1>');
    expect(await tryErrorDocument(root, '/zh/no-such-page')!.text()).toEqual('<h1>root error</h1>');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryErrorDocument never forwards a non-document response', async () => {
  // tryStatic answers malformed percent-encoding with a 400. That is not an
  // error document: a malformed first segment must be skipped (the root
  // document still answers), and with no document on disk the miss stays null
  // rather than surfacing the inner 400 as the caller's answer.
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  const bare = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, '404.html'), '<h1>root error</h1>');
    const malformed = tryErrorDocument(root, '/%zz/no-such-page');
    expect(malformed).toBeTruthy();
    expect(malformed!.status).toEqual(404);
    expect(await malformed!.text()).toEqual('<h1>root error</h1>');

    expect(tryErrorDocument(bare, '/%zz/no-such-page')).toEqual(null);
  } finally {
    await rm(root, { recursive: true });
    await rm(bare, { recursive: true });
  }
});

test('dispatchRequest: a pure-static miss answers the error document (#KR-7)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, '404.html'), '<h1>styled not found</h1>');

    const missing = await dispatchRequest(new Request('http://example.test/no-such-page'), {
      distDir: root,
      serverMod: null,
    });
    expect(missing.status).toEqual(404);
    expect(await missing.text()).toEqual('<h1>styled not found</h1>');
    expect(missing.headers.get('content-type')).toEqual('text/html; charset=UTF-8');

    // Direct access to the document keeps the same 404 status.
    const direct = await dispatchRequest(new Request('http://example.test/404.html'), {
      distDir: root,
      serverMod: null,
    });
    expect(direct.status).toEqual(404);

    // A build with no error document keeps the bare response.
    const bare = await mkdtemp(join(tmpdir(), 'oe-'));
    try {
      await writeFile(join(bare, 'index.html'), '<h1>home</h1>');
      const bare404 = await dispatchRequest(new Request('http://example.test/no-such-page'), {
        distDir: bare,
        serverMod: null,
      });
      expect(bare404.status).toEqual(404);
      expect(await bare404.text()).toEqual('Not Found');
    } finally {
      await rm(bare, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test('dispatchRequest: a dynamic server owns its own miss, the static document never shadows it', async () => {
  // A build with dist/server answers unmatched GETs from the server (the
  // starter's dynamic 404). The static error document is a pure-static
  // fallback only: it must not pre-empt the server's answer.
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, '404.html'), '<h1>static error</h1>');
    const serverMod = {
      isRequestTimePath: () => false,
      default: () =>
        Promise.resolve(
          new Response('<h1>dynamic not found</h1>', {
            status: 404,
            statusText: 'Dynamic Not Found',
          }),
        ),
    };

    const missing = await dispatchRequest(new Request('http://example.test/no-such-page'), {
      distDir: root,
      serverMod,
    });
    expect(missing.status).toEqual(404);
    expect(missing.statusText).toEqual('Dynamic Not Found');
    expect(await missing.text()).toEqual('<h1>dynamic not found</h1>');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('dispatchRequest: HEAD carries the error document status without a body', async () => {
  // The node:http adapter (node-http.ts sendResponse) writes the status and
  // drops the body for HEAD; this pins the handler side of the same contract
  // so the error document's status is the one HEAD reports.
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, '404.html'), '<h1>styled not found</h1>');

    const head = await dispatchRequest(
      new Request('http://example.test/no-such-page', { method: 'HEAD' }),
      { distDir: root, serverMod: null },
    );
    expect(head.status).toEqual(404);
    expect(await head.text()).toEqual('<h1>styled not found</h1>');

    // Mutating methods keep their defined 405 shape, document or not.
    const post = await dispatchRequest(
      new Request('http://example.test/no-such-page', { method: 'POST', body: 'x=1' }),
      { distDir: root, serverMod: null },
    );
    expect(post.status).toEqual(405);
    expect(await post.text()).toEqual('Method Not Allowed');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryStatic refuses symlink escape but allows in-root symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  const outside = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET');
    await writeFile(join(root, 'real.html'), '<h1>real</h1>');
    await symlink(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    await symlink(join(root, 'real.html'), join(root, 'linked.html'));

    // A symlink resolving outside the static root must never be served.
    expect(tryStatic(root, '/leak.txt')).toEqual(null);
    // A symlink resolving back inside the root is ordinary static content.
    const linked = tryStatic(root, '/linked.html');
    expect(linked).toBeTruthy();
    expect(await linked.text()).toEqual('<h1>real</h1>');
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});

test('tryStatic treats a directory at a candidate path as a miss (#1281, CodeQL file-system-race)', async () => {
  // The candidate check is read-and-fallback instead of existsSync/statSync
  // guard-then-read (check-then-act TOCTOU): a directory named like a file
  // candidate must fall through exactly like a missing file.
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await mkdir(join(root, 'dir.html'));
    await writeFile(join(root, 'real.html'), '<h1>real</h1>');
    expect(tryStatic(root, '/dir.html')).toEqual(null);
    const real = tryStatic(root, '/real.html');
    expect(real).toBeTruthy();
    expect(await real.text()).toEqual('<h1>real</h1>');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('malformed percent-encoding is a defined 400, never a crash (#823)', async () => {
  // decodeURIComponent throws URIError on input like /%zz; the serving layer
  // converts it to a 400 so `start` and the fixture server stay alive.
  const err = assertThrowsIncludes(() => staticFileCandidates('/%zz'), URIError);
  expect(isMalformedUrlError(err)).toBeTruthy();
  expect(!isMalformedUrlError(new Error('nope'))).toBeTruthy();

  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const response = tryStatic(root, '/%zz');
    expect(response).toBeTruthy();
    expect(response.status).toEqual(400);
    expect(await response.text()).toEqual('Bad Request');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryStatic cache-control: content-hashed assets immutable, HTML rechecked on deploy (#1039)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'index-Dq2gH8fM.js'), 'console.log(1)');
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, 'favicon.ico'), 'ico');

    const asset = tryStatic(root, '/assets/index-Dq2gH8fM.js');
    expect(asset).toBeTruthy();
    expect(asset.headers.get('cache-control')).toEqual('public, max-age=31536000, immutable');

    const html = tryStatic(root, '/');
    expect(html).toBeTruthy();
    expect(html.headers.get('cache-control')).toEqual('no-cache');

    // Unhashed static files fall back to no-cache: the same URL can serve
    // different bytes after a redeploy, so caches must revalidate.
    const icon = tryStatic(root, '/favicon.ico');
    expect(icon).toBeTruthy();
    expect(icon.headers.get('cache-control')).toEqual('no-cache');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('tryStatic cache-control: unhashed framework client runtime revalidates', async () => {
  // The framework-owned /client/islands/client.js is not content-hashed;
  // without an explicit header its cache semantics were undefined.
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await mkdir(join(root, 'client', 'islands'), { recursive: true });
    await writeFile(join(root, 'client', 'islands', 'client.js'), 'export {}');

    const client = tryStatic(root, '/client/islands/client.js');
    expect(client).toBeTruthy();
    expect(client.headers.get('cache-control')).toEqual('no-cache');
    expect(client.headers.get('content-type')).toEqual('text/javascript; charset=UTF-8');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('dispatchRequest: pure-static (serverMod=null) answers mutating methods 405', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await mkdir(join(root, 'about'));
    await writeFile(join(root, 'about', 'index.html'), '<h1>about</h1>');

    for (const method of ['POST', 'PUT']) {
      const response = await dispatchRequest(
        new Request('http://example.test/about', { method, body: 'x=1' }),
        { distDir: root, serverMod: null },
      );
      expect(response.status, `${method} /about status`).toEqual(405);
      expect(response.headers.get('allow'), `${method} /about Allow`).toEqual('GET, HEAD');
      expect(await response.text()).toEqual('Method Not Allowed');
    }

    // GET/HEAD keep the pure-static page contract.
    const get = await dispatchRequest(new Request('http://example.test/about'), {
      distDir: root,
      serverMod: null,
    });
    expect(get.status).toEqual(200);
    expect(await get.text()).toEqual('<h1>about</h1>');
    const head = await dispatchRequest(
      new Request('http://example.test/about', { method: 'HEAD' }),
      { distDir: root, serverMod: null },
    );
    expect(head.status).toEqual(200);
  } finally {
    await rm(root, { recursive: true });
  }
});
