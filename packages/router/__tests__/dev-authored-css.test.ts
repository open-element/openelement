/**
 * S-C1.3 — dev authored CSS as an external resource.
 *
 * Production serves an authored component sheet from an emitted, content-
 * addressed asset. Development must serve the SAME facts from a real
 * `text/css` resource: the generated dev adapter carries a URL (never the
 * authored rules), the SSR markup declares that URL as a parser-visible
 * `<link data-oe-static-styles>`, the client fills a shared `CSSStyleSheet`
 * through `fetch()` + `replace()`, and a CSS-only edit updates that sheet in
 * place so connected roots re-render without a reload and without a node.
 *
 * The consumer below is the real pipeline (compiler transform → edge registry
 * → dev style plugin → generated dev entry → browser): a shadow component and
 * a light component with authored CSS, two instances of the shadow one, an
 * unrelated element reusing a scoped class, an `@import`ed dependency, a
 * `url()` asset, a custom property, a media query and nested CSS.
 *
 * Assertions are about HOW the CSS was delivered (resource URL, content type,
 * network requests, sheet identity), not merely that something is styled.
 */

import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type { BrowserEngine } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { styleRequestModuleId } from '@openelement/compiler';
import { styleAssetGraphId } from '../src/vite/internal/style-assets.ts';
import { openElement } from '../src/vite/app-vite.ts';

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/dev-authored-css');

/** The 1×1 PNG the authored sheet references through `url('./card.png')`. */
const CARD_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// ─── Fixture sources ────────────────────────────────────────────────────────

const CARD_EXTRA_CSS = `/* The imported dependency: Vite's CSS pipeline inlines it
   into the served resource, so this rule must be observable in the browser. */
.card-extra {
  letter-spacing: 3px;
}
`;

const CARD_CSS = `@import './card-extra.css';

.card {
  --card-tone: rgb(11, 22, 33);
  color: var(--card-tone);
  /* A public asset: one URL form that works in dev and after a build. */
  background-image: url('/card.png');
  background-repeat: repeat;
}

.card-relative {
  /* The relative-resolution probe: Vite's CSS pipeline rewrites this to a
     base-absolute dev URL, so a <link> delivery and an adopted sheet resolve
     it identically — the semantic external delivery must preserve. */
  background-image: url('./card-sibling.png');
}

@media (min-width: 1px) {
  .card {
    padding-block-start: 4px;
  }
}

.card {
  & > .card-inner {
    text-transform: uppercase;
  }
}
`;

/** The S-C1.3 RED marker: a token only the authored sheet declares. */
const AUTHORED_CSS_TOKEN = '--card-tone';

const LIGHT_CARD_CSS = `:host {
  display: block;
}

.light-card {
  --light-tone: rgb(0, 0, 200);
  color: var(--light-tone);
}

.light-card-shared {
  color: rgb(200, 0, 0);
}
`;

const CARD_TSX = `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import cardStyles from './card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('dev-css-card', { root: 'shadow-open' })
export default class DevCssCard extends OpenElement {
  static override styles = [cardStyles];

  @property({ reflect: false })
  label = '';

  render() {
    return (
      <article class='card card-extra'>
        <span class='card-inner'>{this.label}</span>
        <span class='card-relative'></span>
      </article>
    );
  }
}
`;

const LIGHT_CARD_TSX = `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import lightStyles from './light-card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('dev-css-light-card', { root: 'light' })
export default class DevCssLightCard extends OpenElement {
  static override styles = [lightStyles];

  @property({ reflect: false })
  label = '';

  render() {
    return <section class='light-card'>{this.label}</section>;
  }
}
`;

const PAGE_TSX = `import { element, OpenElement } from '@openelement/element';

@element('dev-css-page', { root: 'light' })
export default class DevCssPage extends OpenElement {
  render() {
    return (
      <main id='dev-css-page'>
        <p class='light-card-shared' id='unrelated'>unrelated document text</p>
        <dev-css-card label='one'></dev-css-card>
        <dev-css-card label='two'></dev-css-card>
        <dev-css-light-card label='light'></dev-css-light-card>
      </main>
    );
  }
}
`;

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
import DevCssPage from '../components/page-dev-css.tsx';

export default definePage(DevCssPage, { head: { title: 'dev authored css fixture' } });
`;

function writeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const dir of [
    'app/routes',
    'app/components',
    'app/islands',
    'public',
    'node_modules/@openelement',
  ]) {
    mkdirSync(join(FIXTURE_DIR, dir), { recursive: true });
  }
  writeFileSync(join(FIXTURE_DIR, 'index.html'), '<html><body></body></html>', 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/card-extra.css'), CARD_EXTRA_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/card.css'), CARD_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/light-card.css'), LIGHT_CARD_CSS, 'utf8');
  // The public asset the authored sheet points at with a base-absolute URL,
  // and the sibling the relative reference names (never requested in dev: the
  // dev-server integration claims source-relative paths — the probe is the
  // REWRITE, which is what makes both deliveries resolve the same resource).
  writeFileSync(join(FIXTURE_DIR, 'public/card.png'), Buffer.from(CARD_PNG_BASE64, 'base64'));
  writeFileSync(
    join(FIXTURE_DIR, 'app/islands/card-sibling.png'),
    Buffer.from(CARD_PNG_BASE64, 'base64'),
  );
  writeFileSync(join(FIXTURE_DIR, 'app/islands/dev-css-card.tsx'), CARD_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/dev-css-light-card.tsx'), LIGHT_CARD_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/components/page-dev-css.tsx'), PAGE_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/index.tsx'), INDEX_ROUTE, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'dev-authored-css-fixture', private: true, type: 'module' }),
    'utf8',
  );
  // The generated entry imports `@openelement/router` by package name; the
  // fixture sits inside the router package, so it needs its own resolution
  // edge (every fixture under tests/fixtures/ carries the same symlink).
  symlinkSync('../../../..', join(FIXTURE_DIR, 'node_modules/@openelement/router'), 'dir');
}

const CARD_CSS_PATH = join(FIXTURE_DIR, 'app/islands/card.css');

// ─── Dev server harness ─────────────────────────────────────────────────────

interface DevHandle {
  /** Origin + the configured base (`/sub` under a non-root base). */
  base: string;
  /** The bare origin the dev document answers on (see the base test). */
  origin: string;
  server: ViteDevServer;
  /** Every payload the dev server pushed to clients. */
  hotPayloads: Array<{ type?: string; updates?: Array<{ type?: string; path?: string }> }>;
  close: () => Promise<void>;
}

async function bootDev(options: Record<string, unknown> = {}, base = '/'): Promise<DevHandle> {
  const { createServer } = await import('vite');
  let server: ViteDevServer;
  let httpServer: ReturnType<typeof createHttpServer> | undefined;
  // Vite derives `import.meta.env.DEV`/`PROD` from NODE_ENV when it resolves
  // the config. An ambient `NODE_ENV=production` (CI shells, release tooling)
  // would silently serve the PROD branches of the generated entry — no island
  // client script, no dev modules — and every browser assertion below would
  // fail for a reason that has nothing to do with the CSS seam. A real
  // `vite dev` runs with DEV set, so the harness pins it explicitly.
  const ambientNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    httpServer = createHttpServer((request, response) => {
      server.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end('not found');
      });
    });
    await new Promise<void>((resolve, reject) => {
      httpServer!.once('error', reject);
      httpServer!.listen(0, '127.0.0.1', resolve);
    });
    server = await createServer({
      root: FIXTURE_DIR,
      base,
      logLevel: 'silent',
      configFile: false,
      oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
      // The browser tests need the real HMR channel, so the dev server owns
      // the WebSocket on the harness's own HTTP server.
      server: { middlewareMode: true, hmr: { server: httpServer! } },
      plugins: openElement({
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
        layout: false,
        ...options,
      }),
    });
  } finally {
    if (ambientNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ambientNodeEnv;
    // The fixture stays the process cwd for the whole file (see beforeAll):
    // the dev island client's load() hook scans from process.cwd() at REQUEST
    // time, so a cwd restored after createServer serves an island-free client
    // entry and nothing hydrates (#951).
  }
  const hotPayloads: DevHandle['hotPayloads'] = [];
  const hot = server.environments.client.hot;
  const originalSend = hot.send.bind(hot);
  hot.send = (payload: unknown) => {
    hotPayloads.push(payload as DevHandle['hotPayloads'][number]);
    return originalSend(payload as never);
  };
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') throw new Error('dev server did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    base: `${origin}${base === '/' ? '' : base.replace(/\/$/, '')}`,
    origin,
    server,
    hotPayloads,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer!.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await server.close();
      }
    },
  };
}

async function fetchDocument(handle: DevHandle): Promise<string> {
  const response = await fetch(`${handle.base}/`);
  expect(response.status, 'GET /').toEqual(200);
  return await response.text();
}

interface FetchedResource {
  status: number;
  contentType: string;
  body: string;
}

async function fetchResource(handle: DevHandle, path: string): Promise<FetchedResource> {
  const response = await fetch(`${handle.base}${path}`, {
    headers: { accept: 'text/css,*/*;q=0.1' },
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

/** The authored stylesheet resource URLs a served document declares. */
function declaredStyleLinks(doc: string): string[] {
  return [...doc.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g)].map(
    (match) => match[1]!,
  );
}

/** The edge's registry key, as the compiled transform registered it. */
function cardEdgeKey(importer: string, specifier: string): string {
  return styleRequestModuleId(join(FIXTURE_DIR, 'app/islands', importer), specifier);
}

/** The authored resource URL whose bytes are the CARD (shadow) sheet. */
async function cardResourceUrl(handle: DevHandle, doc: string): Promise<string> {
  for (const href of new Set(declaredStyleLinks(doc))) {
    const resource = await fetchResource(handle, href);
    if (resource.body.includes(AUTHORED_CSS_TOKEN)) return href;
  }
  throw new Error(
    `the fixture did not declare the card sheet resource (declared ${declaredStyleLinks(doc).length} links)`,
  );
}

const handles: DevHandle[] = [];
let previousCwd = '';

beforeAll(() => {
  writeFixture();
  // The dev island client's load() hook scans from process.cwd() at request
  // time (#951), so the fixture is the process cwd for this file's whole run.
  previousCwd = process.cwd();
  process.chdir(FIXTURE_DIR);
});

afterAll(async () => {
  for (const handle of handles) await handle.close();
  process.chdir(previousCwd);
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ─── 1. The generated dev adapter carries a URL, not CSS text ───────────────

test('the dev adapter for an authored edge embeds no CSS text', async () => {
  const handle = await bootDev();
  handles.push(handle);
  await fetchDocument(handle);

  const key = cardEdgeKey('dev-css-card.tsx', './card.css');
  const adapter = await handle.server.environments.client.transformRequest(styleAssetGraphId(key));
  expect(adapter, 'the dev server serves the edge adapter module').not.toBeNull();
  const code = adapter!.code;
  expect(code, 'the adapter fetches the resource').toContain('fetch(');
  expect(code, 'the adapter carries the resource URL').toContain('.openElement/authored-css.');
  // The retired inline adapter: authored rules verbatim in the module.
  expect(code, 'no authored rule text in the adapter').not.toContain(AUTHORED_CSS_TOKEN);
  expect(code, 'no authored selector text in the adapter').not.toContain('.card-extra');
  expect(code, 'no replaceSync of embedded CSS').not.toContain('replaceSync');
  expect(code, 'no import of the stylesheet constructor for text filling').not.toContain(
    "import { StyleSheet } from '@openelement/element'",
  );
});

// ─── 2. The dev resource endpoint ───────────────────────────────────────────

test('the dev resource endpoint serves the authored sheet as text/css', async () => {
  const handle = await bootDev();
  handles.push(handle);
  const doc = await fetchDocument(handle);

  const cardUrl = await cardResourceUrl(handle, doc);
  const resource = await fetchResource(handle, cardUrl);
  expect(resource.status).toEqual(200);
  expect(resource.contentType, 'a real external stylesheet response').toContain('text/css');
  expect(resource.body, 'the authored declaration value').toContain(AUTHORED_CSS_TOKEN);
  // Vite's CSS pipeline resolved the `@import` dependency…
  expect(resource.body, 'the imported dependency is inlined').toContain('.card-extra');
  // …kept the base-absolute public asset URL (one form that works in dev and
  // after a build), and rewrote the RELATIVE reference, so a link delivery and
  // an adopted sheet resolve it identically.
  expect(resource.body, 'the public asset URL is preserved').toContain("url('/card.png')");
  expect(resource.body, 'the relative url() is rewritten to a dev URL').toMatch(
    /url\((['"]?)\/app\/islands\/card-sibling\.png\1\)/,
  );
  expect(resource.body, 'the media query survives').toContain('@media');
  expect(resource.body, 'nested CSS survives').toContain('& > .card-inner');
  // The served bytes are the sheet and nothing else: no module scaffolding.
  expect(resource.body, 'no module scaffolding in the sheet').not.toContain('export const');
});

test('the light edge resource is served scoped, the shadow one is not', async () => {
  const handle = await bootDev();
  handles.push(handle);
  const doc = await fetchDocument(handle);

  const resources = await Promise.all(
    declaredStyleLinks(doc).map(async (href) => ({
      href,
      ...(await fetchResource(handle, href)),
    })),
  );
  const scoped = resources.find((entry) => entry.body.includes('@scope (dev-css-light-card)'));
  expect(scoped, 'the light edge resource carries its scope').toBeTruthy();
  expect(scoped!.body, 'the light scope projects :host onto :scope').toContain(':scope');
  const shadow = resources.find((entry) => entry.href !== scoped!.href);
  expect(shadow, 'the shadow edge resource is declared too').toBeTruthy();
  expect(shadow!.body, 'the shadow sheet ships unscoped').not.toContain('@scope (dev-css-card)');
  expect(shadow!.body, 'the shadow sheet ships the authored rules').toContain('.card');
});

// ─── 3. Dev SSR / DSD ───────────────────────────────────────────────────────

test('dev SSR declares authored sheets as external links and inlines no CSS', async () => {
  const handle = await bootDev();
  handles.push(handle);
  const doc = await fetchDocument(handle);

  const urls = [...new Set(declaredStyleLinks(doc))];
  expect(urls.length, 'one resource per authored edge').toEqual(2);
  for (const href of urls) {
    expect(href, 'the resource URL is a framework-controlled dev path').toMatch(
      /^\/\.openElement\/authored-css\.[0-9a-f]{16}\.css$/,
    );
  }
  // The shadow edge's two instances each declare the resource in their own DSD
  // template — the existing per-instance link protocol, one resource.
  expect(declaredStyleLinks(doc).length, 'each shadow instance declares its sheet').toEqual(3);

  // Placement is asserted by resource identity, not by document order: the
  // light sheet is a document-head resource, the shadow sheet rides its DSD
  // template (never a component subtree for the light one).
  const scopedHref = (
    await Promise.all(
      urls.map(async (href) => ({
        href,
        body: (await fetchResource(handle, href)).body,
      })),
    )
  ).find((entry) => entry.body.includes('@scope (dev-css-light-card)'))!.href;
  const head = doc.slice(0, doc.indexOf('</head>'));
  const template = doc.slice(doc.indexOf('<template shadowrootmode="open"'));
  expect(head, 'the light component declares its sheet in the document head').toContain(
    `href="${scopedHref}" data-oe-static-styles`,
  );
  const shadowHref = urls.find((href) => href !== scopedHref)!;
  expect(template, 'the shadow component declares its sheet in its DSD template').toContain(
    `href="${shadowHref}" data-oe-static-styles`,
  );
  // No generated inline CSS, and no authored rule text in the document.
  expect(doc, 'no authored rule text in the served document').not.toContain(AUTHORED_CSS_TOKEN);
  expect(doc, 'no light rule text in the served document').not.toContain('--light-tone');
});

// ─── 4. HMR over the resource ───────────────────────────────────────────────

test('a CSS-only edit updates the resource and sends a module update, not a reload', async () => {
  const handle = await bootDev();
  handles.push(handle);
  // Prime the module graphs as a browsing client would: the SSR document was
  // rendered, and the client holds the island module and its edge adapter.
  await fetchDocument(handle);
  const cardImporter = join(FIXTURE_DIR, 'app/islands/dev-css-card.tsx');
  await handle.server.environments.client.transformRequest(cardImporter);
  await handle.server.environments.client.transformRequest(
    styleAssetGraphId(cardEdgeKey('dev-css-card.tsx', './card.css')),
  );
  const original = readFileSync(CARD_CSS_PATH, 'utf8');
  // Only the payloads the EDIT produces are in scope: priming a client graph
  // by hand can trip Vite's dependency optimizer, which reloads on its own.
  handle.hotPayloads.length = 0;

  try {
    writeFileSync(CARD_CSS_PATH, original.replace('rgb(11, 22, 33)', 'rgb(44, 55, 66)'), 'utf8');
    // The dev server's file watcher is asynchronous: give it a bounded window
    // to move the served bytes.
    const deadline = Date.now() + 10_000;
    let updated = false;
    while (Date.now() < deadline) {
      const doc = await fetchDocument(handle);
      const url = await cardResourceUrl(handle, doc);
      const fetched = await fetchResource(handle, url);
      if (fetched.body.includes('rgb(44, 55, 66)')) {
        updated = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(updated, 'the served resource carries the edit').toBe(true);
    // The update payload is pushed by the file-change cycle, which can settle
    // just after the resource's bytes move: give it a bounded window.
    const payloadDeadline = Date.now() + 5_000;
    while (
      Date.now() < payloadDeadline &&
      !handle.hotPayloads.some((payload) => payload.type === 'update')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(
      handle.hotPayloads.filter((payload) => payload.type === 'full-reload'),
      'a CSS-only edit never full-reloads the page',
    ).toEqual([]);
    expect(
      handle.hotPayloads.flatMap((payload) => payload.updates ?? []).map((entry) => entry.type),
      'the edited edge receives a module update',
    ).toContain('js-update');
  } finally {
    writeFileSync(CARD_CSS_PATH, original, 'utf8');
  }
});

// ─── 5. Real browsers ───────────────────────────────────────────────────────

const ENGINE_FACTORIES: Array<[string, BrowserEngine]> = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
const browsers = new Map<string, Browser>();

async function browserFor(name: string, engine: BrowserEngine): Promise<Browser> {
  let browser = browsers.get(name);
  if (browser === undefined) {
    browser = await engine.launch();
    browsers.set(name, browser);
  }
  return browser;
}

interface PageState {
  shadowColor: string;
  lightColor: string;
  unrelatedColor: string;
  letterSpacing: string;
  background: string;
  relativeBackground: string;
  nested: string;
  mediaPadding: string;
  hostDisplay: string;
  runtimeNodes: number;
  documentSheets: number;
  shadowSheets: number;
  sharedShadowSheet: boolean;
  loadCount: number;
}

function readPageState(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const card = document.querySelector('dev-css-card');
    const root = card?.shadowRoot ?? null;
    const article = root?.querySelector('.card') ?? null;
    const relative = root?.querySelector('.card-relative') ?? null;
    const inner = root?.querySelector('.card-inner') ?? null;
    const light = document.querySelector('dev-css-light-card');
    const lightSection = light?.querySelector('.light-card') ?? null;
    const unrelated = document.querySelector('#unrelated');
    const cards = [...document.querySelectorAll('dev-css-card')].map((host) => host.shadowRoot);
    return {
      shadowColor: article ? getComputedStyle(article).color : 'no-article',
      lightColor: lightSection ? getComputedStyle(lightSection).color : 'no-light',
      unrelatedColor: unrelated ? getComputedStyle(unrelated).color : 'no-unrelated',
      letterSpacing: article ? getComputedStyle(article).letterSpacing : 'no-article',
      background: article ? getComputedStyle(article).backgroundImage : 'no-article',
      relativeBackground: relative ? getComputedStyle(relative).backgroundImage : 'no-relative',
      nested: inner ? getComputedStyle(inner).textTransform : 'no-inner',
      mediaPadding: article ? getComputedStyle(article).paddingBlockStart : 'no-article',
      hostDisplay: light ? getComputedStyle(light).display : 'no-light-host',
      runtimeNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      documentSheets: document.adoptedStyleSheets.length,
      shadowSheets: root?.adoptedStyleSheets?.length ?? -1,
      sharedShadowSheet:
        cards.length === 2 &&
        cards[0]?.adoptedStyleSheets?.[0] !== undefined &&
        cards[0]?.adoptedStyleSheets?.[0] === cards[1]?.adoptedStyleSheets?.[0],
      loadCount: (window as unknown as { __devCssLoads?: number }).__devCssLoads ?? -1,
    };
  });
}

async function openPages(
  browser: Browser,
  base: string,
): Promise<{ context: BrowserContext; page: Page; requested: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requested: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('.css') || url.includes('card.png'))
      requested.push(`${response.status()} ${url}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { __devCssLoads: number }).__devCssLoads = 0;
    window.addEventListener('load', () => {
      (window as unknown as { __devCssLoads: number }).__devCssLoads += 1;
    });
  });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      customElements.get('dev-css-card') !== undefined &&
      customElements.get('dev-css-light-card') !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  return { context, page, requested };
}

for (const [name, engine] of ENGINE_FACTORIES) {
  test(`[${name}] authored CSS is delivered from the external dev resources`, async () => {
    const handle = await bootDev();
    handles.push(handle);
    const browser = await browserFor(name, engine);
    const { context, page, requested } = await openPages(browser, handle.base);
    try {
      const state = await readPageState(page);
      expect(state.shadowColor, 'the shadow component is styled from its sheet').toBe(
        'rgb(11, 22, 33)',
      );
      expect(state.letterSpacing, 'the imported dependency reached the browser').toBe('3px');
      expect(state.nested, 'nested CSS applies').toBe('uppercase');
      expect(state.mediaPadding, 'the media query applies').toBe('4px');
      expect(state.lightColor, 'the light component is styled from its scoped sheet').toBe(
        'rgb(0, 0, 200)',
      );
      expect(state.hostDisplay, 'the scoped :host rule reaches the light host').toBe('block');
      // Scope isolation: the unrelated document element keeps its own color.
      expect(state.unrelatedColor, 'no leakage into the document element').not.toBe(
        'rgb(200, 0, 0)',
      );
      // The url() assets: the public one is loaded (200) and applied; the
      // relative one proves the rewrite semantics (both deliveries resolve it
      // against the same base-absolute URL).
      expect(state.background, 'the url() asset resolved').toContain('/card.png');
      expect(state.relativeBackground, 'the rewritten relative url() reached the sheet').toContain(
        '/app/islands/card-sibling.png',
      );
      expect(
        requested.some((entry) => entry.includes('200') && entry.endsWith('/card.png')),
        `the browser fetched the referenced asset (${requested.join(', ')})`,
      ).toBe(true);
      expect(
        requested.some(
          (entry) => entry.includes('200') && entry.includes('.openElement/authored-css.'),
        ),
        `the browser fetched the external stylesheet resource (${requested.join(', ')})`,
      ).toBe(true);
      // Delivery form: no node, and the shared live sheet is adopted.
      expect(state.runtimeNodes, 'no framework stylesheet node exists').toEqual(0);
      expect(state.shadowSheets, 'the shadow root adopted the live dev sheet').toEqual(1);
      expect(state.documentSheets, 'the document adopted the light dev sheet').toEqual(1);
      expect(state.sharedShadowSheet, 'both instances share one sheet object').toBe(true);
      expect(state.loadCount, 'the document loaded once').toEqual(1);
    } finally {
      await context.close();
    }
  });

  test(`[${name}] a CSS-only edit updates computed styles without a reload`, async () => {
    const handle = await bootDev();
    handles.push(handle);
    const browser = await browserFor(name, engine);
    const { context, page } = await openPages(browser, handle.base);
    const original = readFileSync(CARD_CSS_PATH, 'utf8');
    try {
      const before = await readPageState(page);
      expect(before.shadowColor).toBe('rgb(11, 22, 33)');
      // The sheet reference must be compared IN the page: a value returned
      // from evaluate() is serialized, so identity cannot survive the trip.
      await page.evaluate(() => {
        (window as unknown as { __devCssSheet?: unknown }).__devCssSheet =
          document.querySelector('dev-css-card')?.shadowRoot?.adoptedStyleSheets?.[0] ?? null;
      });
      writeFileSync(CARD_CSS_PATH, original.replace('rgb(11, 22, 33)', 'rgb(77, 88, 99)'), 'utf8');
      await page.waitForFunction(
        () => {
          const article = document
            .querySelector('dev-css-card')
            ?.shadowRoot?.querySelector('.card');
          return !!article && getComputedStyle(article).color === 'rgb(77, 88, 99)';
        },
        undefined,
        { timeout: 30_000 },
      );
      const after = await readPageState(page);
      const sheetSame = await page.evaluate(
        () =>
          (window as unknown as { __devCssSheet?: unknown }).__devCssSheet ===
          (document.querySelector('dev-css-card')?.shadowRoot?.adoptedStyleSheets?.[0] ?? null),
      );
      // Dev dual delivery, measured: the SSR link keeps the copy it parsed
      // (the browser never re-fetches a `<link>` whose href did not change),
      // while the live adopted sheet is the edit. The two copies diverge for
      // exactly this window, and the live one is what the page shows — the
      // adopted sheet is ordered after the document's own sheets, so a tie
      // resolves to the newer content, never to the stale one.
      const divergence = await page.evaluate(() => {
        const root = document.querySelector('dev-css-card')?.shadowRoot;
        const link = root?.querySelector('link[data-oe-static-styles]');
        const linked = link?.sheet;
        const linkedText =
          linked === null || linked === undefined
            ? 'no-link'
            : [...linked.cssRules].map((rule) => rule.cssText).join('\n');
        const live = root?.adoptedStyleSheets?.[0];
        return {
          linkedText,
          liveText:
            live === undefined ? '' : [...live.cssRules].map((rule) => rule.cssText).join('\n'),
        };
      });
      expect(divergence.linkedText, 'the linked copy is a real parsed stylesheet').toContain(
        'rgb(11, 22, 33)',
      );
      expect(
        divergence.linkedText,
        'the linked copy is stale until the document renders again',
      ).not.toContain('rgb(77, 88, 99)');
      expect(divergence.liveText, 'the live copy carries the edit').toContain('rgb(77, 88, 99)');
      expect(
        after.loadCount,
        `no page reload happened (payloads: ${JSON.stringify(
          handle.hotPayloads.map((payload) => payload.type),
        )})`,
      ).toEqual(1);
      expect(after.runtimeNodes, 'the update created no node').toEqual(0);
      expect(sheetSame, 'the update re-filled the SAME sheet object').toBe(true);
      expect(after.letterSpacing, 'the rest of the sheet is intact').toBe('3px');
    } finally {
      writeFileSync(CARD_CSS_PATH, original, 'utf8');
      await context.close();
    }
  });

  test(`[${name}] the dev realm cache keeps one sheet per edge and rejects a stale refill`, async () => {
    const handle = await bootDev();
    handles.push(handle);
    const browser = await browserFor(name, engine);
    const { context, page } = await openPages(browser, handle.base);
    try {
      // The adapter module the browser loaded for the shadow edge (its URL is
      // what the module graph registered).
      const adapterUrl = await page.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((name) => name.includes('oe-style-asset') && name.endsWith('.js')) ?? '',
      );
      expect(adapterUrl, 'the edge adapter module was loaded').not.toBe('');

      const result = await page.evaluate(async (url) => {
        const text = await fetch(url, { cache: 'no-store' }).then((response) => response.text());
        const holder = (
          globalThis as unknown as {
            __openElementDevStyleSheets?: Map<string, { sheet: CSSStyleSheet }>;
          }
        ).__openElementDevStyleSheets;
        if (holder === undefined) throw new Error('the realm sheet cache is missing');
        const before = holder.size;
        const realFetch = window.fetch.bind(window);
        let call = 0;
        // Two evaluations of the SAME adapter: the first response is delayed
        // and stale, the second is immediate and fresh. Only the fresh one may
        // reach the sheet.
        window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const target = String(input);
          if (!target.includes('.openElement/authored-css.')) return realFetch(input, init);
          call += 1;
          const stale = call === 1;
          const css = stale
            ? '.stale-refill-probe{color:rgb(1,2,3)}'
            : '.fresh-refill-probe{color:rgb(4,5,6)}';
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(css, {
                    status: 200,
                    headers: { 'content-type': 'text/css; charset=utf-8' },
                  }),
                ),
              stale ? 600 : 0,
            ),
          );
        };
        // Built at runtime: a literal `import()` inside an evaluate() body is
        // rewritten by the test runner's own transform.
        const loadModule = new Function('url', 'return import(url)') as (
          url: string,
        ) => Promise<{ default: CSSStyleSheet }>;
        const evaluate = async (suffix: string) => {
          // The blob module has no hierarchical base, so Vite's client import
          // (the HMR socket, irrelevant to the cache seam under test) is
          // dropped instead of resolved.
          const body = text.replace(/^import[^\n]*@vite\/client[^\n]*\n/m, '');
          const moduleUrl = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
          try {
            return await loadModule(`${moduleUrl}${suffix}`);
          } finally {
            URL.revokeObjectURL(moduleUrl);
          }
        };
        const first = await evaluate('#stale');
        const second = await evaluate('#fresh');
        await new Promise((resolve) => setTimeout(resolve, 900));
        window.fetch = realFetch;
        const rules = second.default.cssRules;
        return {
          before,
          after: holder.size,
          sameSheet: first.default === second.default,
          rules: [...rules].map((rule) => rule.cssText).join('\n'),
        };
      }, adapterUrl);

      expect(result.before, 'one entry per registered edge').toBeGreaterThan(0);
      expect(result.after, 'evaluating an edge again adds no entry').toEqual(result.before);
      expect(result.sameSheet, 'the realm holds ONE sheet object per edge').toBe(true);
      expect(result.rules, 'the fresh response is applied').toContain('rgb(4, 5, 6)');
      expect(result.rules, 'the delayed stale response never overwrites it').not.toContain(
        'rgb(1, 2, 3)',
      );
    } finally {
      await context.close();
    }
  });

  test(`[${name}] an unfetchable authored resource is reported, never inlined`, async () => {
    const handle = await bootDev();
    handles.push(handle);
    const browser = await browserFor(name, engine);
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/.openElement/authored-css.*.css', (route) => route.abort());
    try {
      await page.goto(`${handle.base}/`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => customElements.get('dev-css-card') !== undefined,
        undefined,
        {
          timeout: 30_000,
        },
      );
      await expect
        .poll(() => errors.join('\n'), { timeout: 30_000 })
        .toContain('a component style sheet could not be loaded');
      expect(
        await page.evaluate(
          () => document.querySelectorAll('style[data-open-element-compiled-style]').length,
        ),
        'the failure is reported, not papered over with an inline node',
      ).toEqual(0);
      expect(await page.evaluate(() => document.querySelector('dev-css-card') !== null)).toBe(true);
    } finally {
      await context.close();
    }
  });

  test(`[${name}] a JavaScript-disabled document is styled by the SSR links`, async () => {
    const handle = await bootDev();
    handles.push(handle);
    const browser = await browserFor(name, engine);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto(`${handle.base}/`, { waitUntil: 'load' });
      const state = await page.evaluate(() => {
        const root = document.querySelector('dev-css-card')?.shadowRoot ?? null;
        const article = root?.querySelector('.card') ?? null;
        const light = document.querySelector('dev-css-light-card');
        return {
          shadowColor: article ? getComputedStyle(article).color : 'no-article',
          hostDisplay: light ? getComputedStyle(light).display : 'no-host',
        };
      });
      expect(state.shadowColor, 'the DSD link styles the shadow component without JS').toBe(
        'rgb(11, 22, 33)',
      );
      expect(state.hostDisplay, 'the head link styles the light component without JS').toBe(
        'block',
      );
    } finally {
      await context.close();
    }
  });
}

test('a non-root Vite base keeps resource identity and asset resolution', async () => {
  const handle = await bootDev({}, '/sub/');
  handles.push(handle);
  // The dev integration answers the DOCUMENT on the bare origin (its own
  // pre-existing base handling), while every URL the framework produces
  // carries the configured base — which is what this test pins.
  const doc = await (await fetch(`${handle.origin}/`)).text();
  const urls = [...new Set(declaredStyleLinks(doc))];
  expect(urls.length).toEqual(2);
  for (const href of urls) {
    expect(href, 'the dev resource URL carries the configured base').toMatch(
      /^\/sub\/\.openElement\/authored-css\.[0-9a-f]{16}\.css$/,
    );
  }
  const cardUrl = await cardResourceUrl(handle, doc);
  const resource = await fetchResource(handle, cardUrl);
  expect(resource.status, 'the resource answers at its base-prefixed URL').toEqual(200);
  expect(resource.contentType).toContain('text/css');
  expect(resource.body, 'asset references carry the base too').toMatch(
    /url\((['"]?)\/sub\/app\/islands\/card-sibling\.png\1\)/,
  );
  // No browser half here: the dev integration's middleware claims
  // `<base>/@vite/client` (its exclude patterns are base-less), so no module
  // graph loads under a non-root base at all — a pre-existing dev-integration
  // limitation outside this CSS seam, not a property of the resource URL
  // asserted above.
});

afterAll(async () => {
  for (const browser of browsers.values()) await browser.close();
});
