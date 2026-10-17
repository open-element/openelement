/**
 * S-C1.3 follow-up — a real Dev application under a NON-ROOT Vite base.
 *
 * `base: '/sub/'` is the deployment shape the S-C1.3 report left open: the
 * authored-CSS resource endpoint was already base-correct, but the dev
 * integration claimed the base-prefixed paths Vite owns (`/sub/@vite/client`,
 * `/sub/node_modules/...`), so the browser module graph never loaded and no
 * component upgraded — the CSS resource was unreachable in practice.
 *
 * This consumer is the whole path: a page with a Tailwind utility class, a
 * shadow component with authored CSS that references a real asset, and a light
 * component with authored CSS — rendered by the dev SSR entry (DSD + document
 * head links), activated in the browser, hot-updated by a CSS-only edit.
 *
 * Every request the framework produces carries the configured base; the dev
 * host must strip it before the app and Vite see the path, exactly as a base
 * deployment does.
 */

import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import process from 'node:process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, firefox, webkit, type Browser, type BrowserType } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { openElement } from '../src/vite/app-vite.ts';

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/dev-nonroot-base');
const BASE = '/sub/';

/**
 * A real, decodable PNG big enough that Vite serves it as an ASSET (its
 * `assetsInlineLimit` would inline anything smaller as a data URI): the dev
 * resource's rewritten `url()` then becomes a base-prefixed request this test
 * can observe, and the browser can actually paint it.
 */
function texturePng(size = 64): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 3));
  let seed = 0x2f6e2b1;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const at = rowStart + 1 + x * 3;
      raw[at] = seed & 0xff;
      raw[at + 1] = (seed >> 8) & 0xff;
      raw[at + 2] = (seed >> 16) & 0xff;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable: number[] | undefined;
function crc32(buffer: Buffer): number {
  crcTable ??= (() => {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CARD_CSS = `:host { display: block; }
.probe-card {
  --probe-tone: rgb(12, 34, 56);
  color: var(--probe-tone);
  background-image: url('./texture.png');
}
`;

const LIGHT_CSS = `:host { display: block; }
.probe-light {
  --probe-light-tone: rgb(200, 0, 0);
  color: var(--probe-light-tone);
}
`;

const CARD_TSX = `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import cardStyles from './probe-card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('probe-card', { root: 'shadow-open' })
export default class ProbeCard extends OpenElement {
  static override styles = [cardStyles];

  @property({ reflect: false })
  label = '';

  render() {
    return <article class='probe-card p-4'>{this.label}</article>;
  }
}
`;

const LIGHT_TSX = `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import lightStyles from './probe-light.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('probe-light', { root: 'light' })
export default class ProbeLight extends OpenElement {
  static override styles = [lightStyles];

  @property({ reflect: false })
  label = '';

  render() {
    return <section class='probe-light m-2'>{this.label}</section>;
  }
}
`;

const PAGE_TSX = `import { element, OpenElement } from '@openelement/element';

@element('probe-page', { root: 'light' })
export default class ProbePage extends OpenElement {
  render() {
    return (
      <main id='probe-page' class='p-6'>
        <probe-card label='card'></probe-card>
        <probe-light label='light'></probe-light>
      </main>
    );
  }
}
`;

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
import ProbePage from '../components/page-probe.tsx';

export default definePage(ProbePage, { head: { title: 'non-root base probe' } });
`;

function writeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const dir of ['app/routes', 'app/components', 'app/islands', 'node_modules/@openelement']) {
    mkdirSync(join(FIXTURE_DIR, dir), { recursive: true });
  }
  writeFileSync(join(FIXTURE_DIR, 'index.html'), '<html><body></body></html>', 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/texture.png'), texturePng());
  writeFileSync(join(FIXTURE_DIR, 'app/islands/probe-card.css'), CARD_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/probe-light.css'), LIGHT_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/probe-card.tsx'), CARD_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/islands/probe-light.tsx'), LIGHT_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/components/page-probe.tsx'), PAGE_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/index.tsx'), INDEX_ROUTE, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'dev-nonroot-base-fixture', private: true, type: 'module' }),
    'utf8',
  );
  symlinkSync('../../../..', join(FIXTURE_DIR, 'node_modules/@openelement/router'), 'dir');
}

const LIGHT_CSS_PATH = join(FIXTURE_DIR, 'app/islands/probe-light.css');
const CARD_CSS_PATH = join(FIXTURE_DIR, 'app/islands/probe-card.css');

interface DevHandle {
  origin: string;
  server: ViteDevServer;
  close: () => Promise<void>;
}

async function bootDev(): Promise<DevHandle> {
  const { createServer } = await import('vite');
  const ambientNodeEnv = process.env.NODE_ENV;
  // Vite derives `import.meta.env.DEV` from NODE_ENV at config resolution: an
  // ambient production value would serve the PROD branches of the generated
  // entry (no island client script) and nothing would hydrate.
  process.env.NODE_ENV = 'development';
  let server: ViteDevServer;
  const httpServer = createHttpServer((request, response) => {
    server.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    server = await createServer({
      root: FIXTURE_DIR,
      base: BASE,
      logLevel: 'silent',
      configFile: false,
      oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
      server: { middlewareMode: true, hmr: { server: httpServer } },
      plugins: openElement({
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
        layout: false,
        tailwind: {},
      }),
    });
  } finally {
    if (ambientNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ambientNodeEnv;
  }
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') throw new Error('dev server did not bind');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await server.close();
      }
    },
  };
}

interface Probe {
  status: number;
  contentType: string;
  body: string;
}

async function get(handle: DevHandle, path: string): Promise<Probe> {
  const response = await fetch(`${handle.origin}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

/**
 * A stylesheet-context GET: what a browser `<link rel="stylesheet">` sends.
 * Vite decides how to answer a `.css` URL from the request's fetch context
 * (its virtual dev entries are modules when a script asks and CSS text when a
 * stylesheet asks), so a bare `fetch()` cannot ask the question this test is
 * about.
 */
async function getAsStylesheet(handle: DevHandle, path: string): Promise<Probe> {
  const response = await fetch(`${handle.origin}${path}`, {
    headers: { accept: 'text/css,*/*;q=0.1', 'sec-fetch-dest': 'style' },
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

/**
 * Wait until the page stops reloading: the first load of a cold dev server can
 * be followed by Vite's dependency-optimizer full reload (its own cold-start
 * behavior, unrelated to the edit under test). Everything after this point is
 * the edit's own effect.
 */
async function waitForStableLoads(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
}): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const loads = await page.evaluate(
      () => (window as unknown as { __loads?: number }).__loads ?? 0,
    );
    if (loads > 0 && loads === previous) return loads;
    previous = loads;
    await page.waitForTimeout(1000);
  }
  return previous;
}

const ENGINE_FACTORIES: Array<[string, BrowserType]> = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
const browsers = new Map<string, Browser>();

async function browserFor(name: string, engine: BrowserType): Promise<Browser> {
  let browser = browsers.get(name);
  if (browser === undefined) {
    browser = await engine.launch();
    browsers.set(name, browser);
  }
  return browser;
}

const handles: DevHandle[] = [];
let previousCwd = '';

beforeAll(() => {
  writeFixture();
  // The dev island client scans process.cwd() at request time (#951).
  previousCwd = process.cwd();
  process.chdir(FIXTURE_DIR);
});

afterAll(async () => {
  for (const handle of handles) await handle.close();
  for (const browser of browsers.values()) await browser.close();
  process.chdir(previousCwd);
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

test('the dev host serves the app and Vite-owned paths under the configured base', async () => {
  const handle = await bootDev();
  handles.push(handle);

  // The app is reachable at its public root — a base deployment's contract.
  const doc = await get(handle, BASE);
  expect(doc.status, `GET ${BASE}`).toEqual(200);
  expect(doc.contentType).toContain('text/html');
  expect(doc.body, 'the document declares its scripts base-prefixed').toContain(
    `${BASE}client/islands/client.js`,
  );
  expect(doc.body, 'the vite client injection carries the base').toContain(`${BASE}@vite/client`);

  // Vite owns `/@vite/client`: the host must hand the base-prefixed request to
  // Vite instead of routing it into the application.
  const viteClient = await get(handle, `${BASE}@vite/client`);
  expect(viteClient.status, `GET ${BASE}@vite/client`).toEqual(200);
  expect(viteClient.contentType, 'the real Vite client module').toMatch(/javascript/);
  expect(viteClient.body, 'the served module is the Vite client').toContain('createHotContext');

  // The dev entry (the SSR module graph) stays servable behind the base.
  const entry = await get(handle, `${BASE}@id/__x00__virtual:open-entry`);
  expect(entry.status, 'the generated dev entry answers through Vite').toBeLessThan(400);

  // Authored CSS resources and their referenced assets are base-prefixed.
  const links = [...doc.body.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  const authored = links.filter((href) => href.includes('authored-css.'));
  expect(authored.length, `authored resources declared: ${links.join(', ')}`).toBeGreaterThan(0);
  for (const href of authored) {
    expect(href, 'the authored resource carries the base').toMatch(
      /^\/sub\/\.openElement\/authored-css\.[0-9a-f]{16}\.css$/,
    );
    const resource = await get(handle, href);
    expect(resource.status, `GET ${href}`).toEqual(200);
    expect(resource.contentType).toContain('text/css');
  }
});

test('the tailwind channel serves its entry and component sheet under the base', async () => {
  const handle = await bootDev();
  handles.push(handle);
  const doc = await get(handle, BASE);
  const links = [...doc.body.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  const tailwind = links.filter((href) => href.includes('tailwind'));
  expect(tailwind.length, `tailwind links in ${links.join(', ')}`).toBeGreaterThan(0);
  for (const href of tailwind) {
    const resource = await getAsStylesheet(handle, href);
    expect(resource.status, `GET ${href}`).toEqual(200);
    expect(resource.contentType, `GET ${href}`).toContain('text/css');
  }
});

for (const [name, engine] of ENGINE_FACTORIES) {
  test(
    `[${name}] the app activates, styles and hot-updates under the base`,
    { timeout: 180_000 },
    async () => {
      const handle = await bootDev();
      handles.push(handle);
      const browser = await browserFor(name, engine);
      const context = await browser.newContext();
      const page = await context.newPage();
      const responses: Array<{ status: number; url: string }> = [];
      const aborted: string[] = [];
      page.on('response', (response) => {
        responses.push({ status: response.status(), url: response.url() });
      });
      // The dev module graph aborts requests it supersedes (HMR invalidation,
      // duplicate module fetches); an aborted URL that never succeeded would be a
      // real missing resource, and is asserted below.
      page.on('requestfailed', (request) => aborted.push(request.url()));
      await page.addInitScript(() => {
        (window as unknown as { __loads: number }).__loads = 0;
        window.addEventListener('load', () => {
          (window as unknown as { __loads: number }).__loads += 1;
        });
      });
      const original = readFileSync(LIGHT_CSS_PATH, 'utf8');
      try {
        await page.goto(`${handle.origin}${BASE}`, { waitUntil: 'load' });
        // The real module graph must load: both components upgrade.
        await page.waitForFunction(
          () =>
            customElements.get('probe-card') !== undefined &&
            customElements.get('probe-light') !== undefined,
          undefined,
          { timeout: 20_000 },
        );

        // The adapters adopt the authored sheets asynchronously (fetch + CSSOM).
        await page.waitForFunction(
          () => {
            const card = document.querySelector('probe-card');
            return (
              (card?.shadowRoot?.adoptedStyleSheets.length ?? 0) > 0 &&
              (document.adoptedStyleSheets?.length ?? 0) > 0
            );
          },
          undefined,
          { timeout: 20_000 },
        );

        const state = await page.evaluate(() => {
          const card = document.querySelector('probe-card');
          const cardRoot = card?.shadowRoot ?? null;
          const article = cardRoot?.querySelector('.probe-card') ?? null;
          const light = document.querySelector('probe-light');
          const lightSection = light?.querySelector('.probe-light') ?? null;
          const pageMain = document.querySelector('#probe-page');
          const sheets = (target: ShadowRoot | Document | null | undefined) =>
            target?.adoptedStyleSheets?.length ?? -1;
          return {
            cardColor: article ? getComputedStyle(article).color : 'no-card',
            cardPadding: article ? getComputedStyle(article).paddingTop : 'no-card',
            cardBackground: article ? getComputedStyle(article).backgroundImage : 'no-card',
            lightColor: lightSection ? getComputedStyle(lightSection).color : 'no-light',
            lightMargin: lightSection ? getComputedStyle(lightSection).marginTop : 'no-light',
            pagePadding: pageMain ? getComputedStyle(pageMain).paddingTop : 'no-page',
            hostDisplay: light ? getComputedStyle(light).display : 'no-host',
            nodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
            cardSheets: sheets(cardRoot),
            documentSheets: sheets(document),
            loads: (window as unknown as { __loads: number }).__loads,
          };
        });

        expect(state.cardColor, 'the shadow component is styled by its authored sheet').toBe(
          'rgb(12, 34, 56)',
        );
        expect(state.lightColor, 'the light component is styled by its scoped sheet').toBe(
          'rgb(200, 0, 0)',
        );
        expect(state.hostDisplay, 'the scoped :host rule reaches the light host').toBe('block');
        expect(state.cardPadding, 'the tailwind utility applies to the shadow component').toBe(
          '16px',
        );
        expect(state.lightMargin, 'the tailwind utility applies to the light component').toBe(
          '8px',
        );
        expect(state.pagePadding, 'the tailwind utility applies to the page').toBe('24px');
        expect(state.cardBackground, 'the relative asset resolved under the base').toContain(
          `${BASE}app/islands/texture.png`,
        );
        expect(state.nodes, 'no framework stylesheet node exists').toEqual(0);
        expect(state.cardSheets, 'the shadow root adopted its sheet').toBeGreaterThan(0);
        expect(state.documentSheets, 'the document adopted its sheets').toBeGreaterThan(0);
        const served = new Set(
          responses.filter((entry) => entry.status < 400).map((entry) => entry.url),
        );
        const broken = responses.filter((entry) => entry.status >= 400);
        expect(
          broken
            .slice(0, 5)
            .map((entry) => `${entry.status} ${entry.url}`)
            .join(' | '),
          `${broken.length} of ${responses.length} responses were errors`,
        ).toEqual('');
        expect(
          aborted
            .filter((url) => !served.has(url))
            .slice(0, 5)
            .join(' | '),
          `${aborted.length} aborted requests, all must have been served at some point`,
        ).toEqual('');
        expect(responses.length, 'the module graph issued requests').toBeGreaterThan(10);

        // A CSS-only edit reaches the live sheet without a reload.
        const loadsBefore = await waitForStableLoads(page);
        writeFileSync(LIGHT_CSS_PATH, original.replace('rgb(200, 0, 0)', 'rgb(7, 70, 70)'), 'utf8');
        await page.waitForFunction(
          () => {
            const section = document.querySelector('probe-light')?.querySelector('.probe-light');
            return !!section && getComputedStyle(section).color === 'rgb(7, 70, 70)';
          },
          undefined,
          { timeout: 20_000 },
        );
        const afterLight = await page.evaluate(() => ({
          loads: (window as unknown as { __loads: number }).__loads,
          nodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
          sheets: document.adoptedStyleSheets.length,
          color: (() => {
            const section = document.querySelector('probe-light')?.querySelector('.probe-light');
            return section ? getComputedStyle(section).color : 'gone';
          })(),
        }));
        expect(afterLight.loads, 'the hot update never reloaded the page').toEqual(loadsBefore);
        expect(afterLight.nodes, 'the hot update created no node').toEqual(0);
        expect(afterLight.sheets, 'the sheet count is stable across the update').toEqual(
          state.documentSheets,
        );
        expect(afterLight.color, 'the live sheet carries the edit').toEqual('rgb(7, 70, 70)');

        // The shadow half of the same protocol: an edge under a shadow root
        // refills the sheet the root holds, with no node and no reload.
        const cardOriginal = readFileSync(CARD_CSS_PATH, 'utf8');
        try {
          writeFileSync(
            CARD_CSS_PATH,
            cardOriginal.replace('rgb(12, 34, 56)', 'rgb(56, 34, 12)'),
            'utf8',
          );
          await page.waitForFunction(
            () => {
              const article = document
                .querySelector('probe-card')
                ?.shadowRoot?.querySelector('.probe-card');
              return !!article && getComputedStyle(article).color === 'rgb(56, 34, 12)';
            },
            undefined,
            { timeout: 20_000 },
          );
        } finally {
          writeFileSync(CARD_CSS_PATH, cardOriginal, 'utf8');
        }
        const afterCard = await page.evaluate(() => ({
          loads: (window as unknown as { __loads: number }).__loads,
          nodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
        }));
        expect(afterCard.loads, 'the shadow sheet update never reloaded the page').toEqual(
          loadsBefore,
        );
        expect(afterCard.nodes, 'the shadow sheet update created no node').toEqual(0);
      } finally {
        writeFileSync(LIGHT_CSS_PATH, original, 'utf8');
        writeFileSync(CARD_CSS_PATH, CARD_CSS, 'utf8');
        await context.close();
      }
    },
  );
}
