/**
 * @openelement/router — the dev channel of the Tailwind entry (alpha15 S lane).
 *
 * The build links the compiled source bundle into the SSG output and the dev
 * pipeline must deliver the SAME compiled fact: the authored `@theme` block is
 * an unknown at-rule to the browser, and the role aliases seated on it stay
 * empty until the entry passes through the official Tailwind compile (#1582).
 * This suite boots a REAL dev server (vite + @hono/vite-dev-server over the
 * generated entry, the `request-time-parity` harness shape) against a fixture
 * that declares `tailwind: { theme }` and asserts the delivered document:
 *
 *   1. the head carries `<link rel="stylesheet">` to the served entry and the
 *      URL answers the COMPILED theme (a resolved `--color-*` scale value, no
 *      raw `@theme` at-rule);
 *   2. that link precedes the page's own static styles in the document;
 *   3. editing the declared sheet reaches the browser as a Vite `css-update`
 *      and a `?t=`-stamped re-request answers the edited tokens;
 *   4. with no `tailwind` key the document is byte-identical to the same
 *      pipeline minus this plugin (OFF stays OFF: no file, no link, nothing
 *      contributed), and the dev channel owns no file on disk at all;
 *   5. dev/build parity: the served entry and a build of the SAME entry
 *      through the same plugin + peer declare the same custom-property set
 *      with an equal normalized declaration set — including the
 *      Tailwind-internal `--tw-shadow`, whose multi-occurrence shape and the
 *      peer's two inherent variant differences are documented at the parity
 *      test below.
 *
 * The fixture lives under __test_fixtures__ (gitignored) and is written per
 * run.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Plugin, ViteDevServer } from 'vite';
import { openElement } from '../src/vite/app-vite.ts';
import {
  tailwindEntryPath,
  tailwindEntryPlugin,
  tailwindEntryUrl,
  tailwindPlugins,
} from '../src/vite/tailwind.ts';

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/tailwind-dev-delivery');
const THEME_PATH = join(FIXTURE_DIR, 'app', 'styles', 'theme.css');

/** A token the authored sheet does NOT declare — only the compile emits it. */
const COMPILED_SCALE_MARKER = /--color-violet-700:\s*(?:oklch|#|rgb)/;
/** The compiled theme block: roles inside one `:root, :host` scope. */
const COMPILED_THEME_BLOCK = /:root,?\s*:host\s*\{/;
/** The served entry's URL, joined through the dev server's base. */
const ENTRY_URL = tailwindEntryUrl('/');

const THEME_CSS = `@theme {
  --color-background: var(--color-white);
  --color-primary: var(--color-violet-700);
  --shadow-1: 0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.1);
  --shadow-2: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
}

/* Starter palette aliases: the names component sheets consume. */
:root {
  --paper: var(--color-background);
  --brand: var(--color-primary);
}

body { margin: 0; }
`;

const HOME_CSS = `:host { display: block; }
.panel { border: 1px solid var(--line); border-radius: 10px; }
`;

const HOME_TSX = `import { element, OpenElement } from '@openelement/element';
import pageStyles from './page-home.css';
import './dev-card.tsx';

@element('index-page', { root: 'light' })
export default class HomePage extends OpenElement {
  static override styles = [pageStyles];

  render() {
    return (
      <main>
        <h1 id='home'>dev tailwind fixture</h1>
        <section class='panel shadow-1'>panel</section>
        <oe-dev-card label='dev probe'></oe-dev-card>
        <dev-counter></dev-counter>
      </main>
    );
  }
}
`;

const DEV_COUNTER_TSX = `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('dev-counter')
export default class DevCounter extends OpenElement {
  @property({ reflect: false }) label = 'counter';

  render() {
    return <button id='dev-counter-button'>{this.label}</button>;
  }
}
`;

/** A shadow component whose ONLY styling is Tailwind utilities in TSX (S5-A). */
const DEV_CARD_TSX = `import { element, OpenElement, property } from '@openelement/element';

@element('oe-dev-card', { root: 'shadow-open' })
export default class OeDevCard extends OpenElement {
  @property({ reflect: false }) label = '';

  render() {
    return (
      <article class='dev-card rounded-xl bg-primary p-8 text-white'>
        <h2 class='text-2xl font-semibold'>{this.label}</h2>
      </article>
    );
  }
}
`;

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, { head: { title: 'dev tailwind fixture' } });
`;

/** Write the fixture app; idempotent so a re-run reuses the same tree. */
function writeFixture(): void {
  writeFixtureAt(FIXTURE_DIR, 'p-8');
}

/**
 * Write one fixture tree at `dir`, with the shadow card's utility as the
 * discriminating fact (the second-project isolation proof).
 */
function writeFixtureAt(dir: string, cardUtility: string): void {
  rmSync(dir, { recursive: true, force: true });
  const dirs = [
    'app/routes',
    'app/components',
    'app/styles',
    'app/islands',
    'node_modules/@openelement',
  ];
  for (const nested of dirs) mkdirSync(join(dir, nested), { recursive: true });
  writeFileSync(join(dir, 'app/styles/theme.css'), THEME_CSS, 'utf8');
  writeFileSync(join(dir, 'app/components/page-home.css'), HOME_CSS, 'utf8');
  writeFileSync(join(dir, 'app/components/page-home.tsx'), HOME_TSX, 'utf8');
  writeFileSync(
    join(dir, 'app/components/dev-card.tsx'),
    DEV_CARD_TSX.replaceAll('p-8', cardUtility),
    'utf8',
  );
  writeFileSync(join(dir, 'app/islands/dev-counter.tsx'), DEV_COUNTER_TSX, 'utf8');
  writeFileSync(join(dir, 'app/routes/index.tsx'), INDEX_ROUTE, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'tailwind-dev-delivery-fixture', private: true, type: 'module' }),
    'utf8',
  );
  // The generated entry imports `@openelement/router/http` and
  // `@openelement/router/server-runtime` by package name; the fixture sits
  // inside the router package, so it needs its own resolution edge to it
  // (every fixture under tests/fixtures/ carries the same symlink).
  symlinkSync('../../../..', join(dir, 'node_modules/@openelement/router'), 'dir');
}

interface DevHandle {
  base: string;
  server: ViteDevServer;
  hotPayloads: unknown[];
  close: () => Promise<void>;
}

/** Boot a real dev server over the fixture, loopback-only (the parity harness). */
async function bootDev(plugins: Plugin[], root = FIXTURE_DIR): Promise<DevHandle> {
  const { createServer } = await import('vite');
  const previousCwd = process.cwd();
  process.chdir(root);
  let server: ViteDevServer;
  try {
    server = await createServer({
      root,
      logLevel: 'silent',
      configFile: false,
      // The generated entry compiles .tsx route/page modules, so the dev
      // pipeline must lower JSX the same way the app's vite.config does.
      oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
      server: { middlewareMode: true, ws: false },
      plugins,
    });
  } finally {
    process.chdir(previousCwd);
  }
  const hotPayloads: unknown[] = [];
  const hot = server.environments.client.hot;
  const originalSend = hot.send.bind(hot);
  hot.send = (payload: unknown) => {
    hotPayloads.push(payload);
    return originalSend(payload as never);
  };
  const httpServer = createHttpServer((request, response) => {
    server.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') throw new Error('dev server did not bind');
  let closed = false;
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    hotPayloads,
    // Idempotent: a test may close its own handle (a sequential two-server
    // proof) and the shared afterAll closes every handle again.
    close: async () => {
      if (closed) return;
      closed = true;
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

const BASE_OPTIONS = {
  routesDir: 'app/routes',
  islandsDir: 'app/islands',
  layout: false as const,
};

/** The one option under test: the declared theme source, Tailwind ON. */
const TAILWIND_ON = {
  ...BASE_OPTIONS,
  // App-relative (the documented contract): the entry resolves it against the
  // app root into its own base.
  tailwind: { theme: ['app/styles/theme.css'] },
};

async function fetchDoc(handle: DevHandle, path = '/'): Promise<string> {
  const response = await fetch(`${handle.base}${path}`);
  expect(response.status, `GET ${path}`).toEqual(200);
  return await response.text();
}

/** The component-sheet href a served dev document declares (S5-A). */
async function declaredComponentSheetHref(handle: DevHandle): Promise<string> {
  const doc = await fetchDoc(handle);
  const match = doc.match(
    /<link rel="stylesheet" href="([^"]*tailwind-components[^"]*\.css)" data-oe-static-styles \/>/,
  );
  expect(match, 'the dev document declares the component stylesheet').not.toBeNull();
  return match![1]!;
}

async function fetchEntryCss(handle: DevHandle, query = '', url = ENTRY_URL): Promise<string> {
  const response = await fetch(`${handle.base}${url}${query}`, {
    headers: { accept: 'text/css,*/*;q=0.1' },
  });
  expect(response.status, 'GET served entry').toEqual(200);
  expect(response.headers.get('content-type') ?? '', 'served entry content type').toContain(
    'text/css',
  );
  return await response.text();
}

const handles: DevHandle[] = [];

beforeAll(() => {
  writeFixture();
});

afterAll(async () => {
  for (const handle of handles) await handle.close();
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

test('dev document head carries the compiled entry sheet (#1582)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);

  const doc = await fetchDoc(handle);
  const linkIndex = doc.indexOf(ENTRY_URL);
  expect(linkIndex, 'the dev document links the served entry').toBeGreaterThan(-1);
  expect(doc.slice(0, linkIndex).includes('<head>'), 'the link sits in the document head').toEqual(
    true,
  );

  // The page's own static styles are emitted into the body markup: the head
  // link precedes them by construction, which is the delivery order the
  // acceptance criteria name.
  const staticStyleIndex = doc.indexOf('data-oe-static-styles');
  expect(staticStyleIndex, 'the fixture page emits static styles').toBeGreaterThan(-1);
  expect(linkIndex, 'the theme link precedes the page static styles').toBeLessThan(
    staticStyleIndex,
  );

  const css = await fetchEntryCss(handle);
  // The COMPILED theme: the scale value the authored sheet never declares, in
  // the compiled `:root, :host` theme block, with no raw `@theme` at-rule left
  // (an `@theme` block is an unknown at-rule in a browser — delivering it
  // verbatim is exactly the #1582 failure).
  expect(css, 'compiled --color-* scale declarations').toMatch(COMPILED_SCALE_MARKER);
  expect(css, 'compiled theme block').toMatch(COMPILED_THEME_BLOCK);
  expect(css, 'the authored @theme at-rule is consumed by the compile').not.toMatch(/@theme\b/);
  // A dev serve, not a build: the peer's build variant minifies and would take
  // the served sheet over if the wrapper let it past Vite's `apply` filter.
  expect(css.split('\n').length, 'the dev sheet keeps its formatting').toBeGreaterThan(50);
  // The aliases the component sheets consume ride the same compiled sheet.
  expect(css).toMatch(/--brand:\s*var\(--color-primary\)/);
  expect(css).toMatch(/--paper:\s*var\(--color-background\)/);
  expect(css).toMatch(/body\s*\{[^}]*margin:\s*0/);
});

test('a theme.css edit hot-updates the delivered sheet (#1582)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  // Prime the module graph with the served entry, as a browsing client would.
  await fetchEntryCss(handle);

  const original = await readFile(THEME_PATH, 'utf8');
  try {
    await writeFile(THEME_PATH, original.replace('--color-violet-700', '--color-violet-600'));
    // The edit must surface as a css-update for the served entry: that is the
    // HMR signal the browser applies, and the peer registers the declared
    // sources as watch files precisely so this fires.
    //
    // The deadline is 30s, not 10s (F-1, alpha.13): this test starts a real
    // Vite dev server and a real Tailwind compile, and on a 2-core CI runner
    // those compete with the rest of the suite for the same cores — the 10s
    // wall clock was observed exceeding once for a compile that then did
    // arrive. The loop still fails on a genuinely missing update, just later.
    const deadline = Date.now() + 30_000;
    while (
      !handle.hotPayloads.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          'type' in payload &&
          (payload as { type?: unknown }).type === 'update' &&
          JSON.stringify(payload).includes('css-update') &&
          JSON.stringify(payload).includes('tailwind.css'),
      )
    ) {
      if (Date.now() > deadline) throw new Error('no css-update for the served entry');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // The client re-requests the link with a `?t=` stamp; the stamped answer
    // must carry the edited token (the `?t=` form is what the Hono dev
    // server's exclude list lets through to Vite).
    const css = await fetchEntryCss(handle, `?t=${Date.now()}`);
    expect(css, 'the edited scale step reaches the delivered sheet').toMatch(
      /--color-violet-600:\s*(?:oklch|#|rgb)/,
    );
  } finally {
    await writeFile(THEME_PATH, original);
  }
});

test('with no tailwind key the dev document is unchanged (#1582 constraint)', async () => {
  // The control is the same pipeline with this one plugin removed: a
  // byte-identical document is the honest statement of "zero behavior change",
  // and it also pins that the plugin contributes no styling of its own.
  const withPlugin = await bootDev(openElement(BASE_OPTIONS));
  handles.push(withPlugin);
  const control = await bootDev(
    openElement(BASE_OPTIONS).filter((plugin) => plugin.name !== 'open:style-dev'),
  );
  handles.push(control);

  const doc = await fetchDoc(withPlugin);
  const controlDoc = await fetchDoc(control);
  expect(doc, 'tailwind-less dev document carries no entry artifact').not.toContain('tailwind.css');
  // The document's stylesheet links belong to the AUTHORED components' dev
  // resources (S-C1.3); this plugin contributes none of them, and the
  // byte-identical comparison below is the statement that it contributes
  // nothing at all.
  expect(doc.match(/<link rel="stylesheet"[^>]*>/g) ?? [], 'no entry link').toEqual(
    controlDoc.match(/<link rel="stylesheet"[^>]*>/g) ?? [],
  );
  expect(doc, 'OFF stays OFF: byte-identical document').toEqual(controlDoc);
});

test('the dev channel owns no file on disk (the entry is virtual)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  const entryDiskPath = tailwindEntryPath(FIXTURE_DIR);

  // The URL answers the compiled theme with nothing on disk.
  const served = await fetchEntryCss(handle);
  expect(served).toMatch(COMPILED_THEME_BLOCK);
  expect(() => readFileSync(entryDiskPath, 'utf8'), 'the dev channel writes no file').toThrow(
    /ENOENT/,
  );

  // A stale file at the entry's identity path is never the served source.
  mkdirSync(join(FIXTURE_DIR, '.openElement'), { recursive: true });
  writeFileSync(entryDiskPath, '/* stale text that must never be served */\n', 'utf8');
  try {
    const afterWrite = await fetchEntryCss(handle, `?t=${Date.now()}`);
    expect(afterWrite, 'the file at the mapped path is not the served source').toMatch(
      COMPILED_THEME_BLOCK,
    );
    expect(afterWrite, 'stale bytes never ride the served sheet').not.toContain('stale text');
  } finally {
    rmSync(entryDiskPath, { force: true });
  }
});

test('dev serves the component stylesheet and declares it in the DSD (S5-A)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);

  const doc = await fetchDoc(handle);
  // The shadow component's DSD declares the resource: a parser-visible link,
  // never inline CSS, never a runtime node.
  const card = doc.slice(doc.indexOf('<oe-dev-card'), doc.indexOf('</oe-dev-card>'));
  expect(card, 'the shadow component is DSD-rendered').toContain(
    '<template shadowrootmode="open">',
  );
  expect(card, 'no inline <style> in the dev DSD').not.toContain('<style');
  expect(card, 'the dev DSD declares the component stylesheet').toMatch(
    /<link rel="stylesheet" href="\/\.openElement\/tailwind-components\.[^"]+\.css" data-oe-static-styles \/>/,
  );

  // The declared URL answers the COMPILED utility sheet from the official
  // pipeline (dev serves the one stable resource; production content-addresses
  // it).
  const sheet = await fetchEntryCss(handle, '', await declaredComponentSheetHref(handle));
  expect(sheet, 'the admitted utilities compiled').toMatch(/\.p-8\s*\{/);
  expect(sheet, '\.rounded-xl compiled').toMatch(/\.rounded-xl\s*\{/);
  expect(sheet, '\.bg-primary compiled through the app theme').toMatch(/\.bg-primary\s*\{/);
  expect(sheet, 'a reduced entry: no preflight reset in the component sheet').not.toContain(
    'button, input, select',
  );
  // The client adapter addresses the SAME resource the DSD declared: identity
  // is a fact both halves state independently, and a version derived from the
  // candidate set could not be (the two halves sample it at different points,
  // before and after the app's own shadow modules are transformed). One stable
  // URL is the only identity both can state.
  const declared = await declaredComponentSheetHref(handle);
  expect(declared, 'the DSD declares the stable component sheet resource').toMatch(
    /\/\.openElement\/tailwind-components\.current\.css$/,
  );
  expect(
    await declaredComponentSheetHref(handle),
    'the declared resource does not drift between renders',
  ).toEqual(declared);

  // The client's shared sheet rides the same adapter protocol the built entry
  // uses: one CSSStyleSheet, fetch + replace(), the readiness and identity
  // keys — and NO DOM node creation anywhere in the adapter.
  const adapter = await fetch(`${handle.base}/@id/__x00__oe-style-components-dev.js`).then(
    (response) => response.text(),
  );
  expect(adapter, 'one shared sheet per realm').toContain('__openElementComponentSheet');
  expect(adapter, 'filled by replace(), never a DOM node').toContain('sheet.replace(');
  expect(adapter, 'carries the readiness key').toContain('__openElementStyleReady');
  expect(adapter, 'carries the resource identity key').toContain('__openElementStyleSheetUrl');
  expect(adapter, 'no style/link node is ever created').not.toContain('createElement');
});

test('a TSX class edit recompiles the served component sheet (S5-A)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  const cardPath = join(FIXTURE_DIR, 'app/components/dev-card.tsx');

  // Prime: render the page (compiles the card module, registering candidates)
  // and read the sheet the document declares.
  const beforeHref = await declaredComponentSheetHref(handle);
  const before = await fetchEntryCss(handle, '', beforeHref);
  expect(before, 'the initial sheet carries p-8').toMatch(/\.p-8\s*\{/);

  const original = await readFile(cardPath, 'utf8');
  try {
    await writeFile(cardPath, original.replace('p-8', 'p-4'));
    // The watcher re-registers the edited candidates; the sheet response is
    // compiled per request, so the SAME resource answers the recompiled CSS.
    // Identity stays stable on purpose: the DSD link and the client adapter
    // must name one resource, and a version sampled from the candidate set
    // cannot (they sample it before and after the app's shadow modules are
    // transformed). The browser-level proof — the computed style actually
    // changing without a reload — runs in the dogfood fixture's dev spec.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterHref = await declaredComponentSheetHref(handle);
    expect(afterHref, 'the served resource identity is stable across edits').toEqual(beforeHref);
    const after = await fetchEntryCss(handle, '', afterHref);
    expect(after, 'the edited class compiled').toMatch(/\.p-4\s*\{/);
    expect(after, 'the removed class is gone').not.toMatch(/\.p-8\s*\{/);
  } finally {
    await writeFile(cardPath, original);
  }
});

test('a TSX edit that removes every class drops the stale candidate (defect C)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  const cardPath = join(FIXTURE_DIR, 'app/components/dev-card.tsx');

  const href = await declaredComponentSheetHref(handle);
  expect(await fetchEntryCss(handle, '', href), 'the initial sheet carries p-8').toMatch(
    /\.p-8\s*\{/,
  );

  const original = await readFile(cardPath, 'utf8');
  try {
    // Every utility leaves the module: the registration is authoritative, so
    // the served sheet must stop shipping the emptied module's rules. A stale
    // fact here is exactly the defect (the registry used to ignore an empty
    // registration and keep the previous tokens).
    await writeFile(cardPath, original.replace(/class='[^']*'/g, ''));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const served = await fetchEntryCss(handle, '', href);
    expect(served, 'the emptied module keeps no candidate').not.toMatch(/\.p-8\s*\{/);
    expect(served, 'the other class left with it').not.toMatch(/\.rounded-xl\s*\{/);
  } finally {
    await writeFile(cardPath, original);
  }
});

test('a deleted component module stops contributing its candidates (defect C)', async () => {
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  const cardPath = join(FIXTURE_DIR, 'app/components/dev-card.tsx');

  // Prime through a real render (the versioned URL is a cache-buster; the
  // middleware recompiles for the CURRENT candidate set on every request).
  const href = await declaredComponentSheetHref(handle);
  expect(await fetchEntryCss(handle, '', href), 'the initial sheet carries p-8').toMatch(
    /\.p-8\s*\{/,
  );

  const original = await readFile(cardPath, 'utf8');
  try {
    rmSync(cardPath);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const served = await fetchEntryCss(handle, '', href);
    expect(served, 'the deleted module contributes nothing').not.toMatch(/\.p-8\s*\{/);
    expect(served, 'nor any of its other rules').not.toMatch(/\.rounded-xl\s*\{/);
  } finally {
    await writeFile(cardPath, original);
  }
});

test('two dev projects in one process keep their own candidates (defect C)', async () => {
  // Sequential on purpose: each server owns its registry, so the SECOND
  // project's sheet must contain its own class and none of the first's. Under
  // the retired process-global registry the first project's facts were still
  // registered when the second server compiled its sheet — the leak this pins.
  const secondFixture = join(
    import.meta.dirname!,
    '../__test_fixtures__/tailwind-dev-delivery-second',
  );
  const first = await bootDev(openElement(TAILWIND_ON));
  handles.push(first);
  const firstSheet = await fetchEntryCss(first, '', await declaredComponentSheetHref(first));
  expect(firstSheet, 'the first project compiles its own class').toMatch(/\.p-8\s*\{/);
  await first.close();

  writeFixtureAt(secondFixture, 'mt-9');
  try {
    const second = await bootDev(openElement(TAILWIND_ON), secondFixture);
    handles.push(second);
    const secondSheet = await fetchEntryCss(second, '', await declaredComponentSheetHref(second));
    expect(secondSheet, 'the second project compiles its own class').toMatch(/\.mt-9\s*\{/);
    expect(secondSheet, 'the first project’s facts never leak in').not.toMatch(/\.p-8\s*\{/);
  } finally {
    rmSync(secondFixture, { recursive: true, force: true });
  }
});

// ─── Dev/build parity (--tw-shadow and the minified-literal deltas) ─────────
//
// The two channels ride the two variants of the @tailwindcss/vite peer (the
// dev wrapper proxies the serve plugins; the build runs the build plugins as
// every other CSS module in a vite build), and the peer compiles them with a
// few known, INHERENT differences — verified against 4.3.3 by direct probe
// and pinned here so they cannot silently grow:
//
// 1. MINIFICATION: the build variant emits minified literals —
//    `rgb(0 0 0 / 0.05)` → `#0000000d`, `0.27` → `.27`, `150ms` → `.15s`,
//    `::before` → `:before`, whitespace inside function calls — while the
//    serve variant emits the authored spellings. Every such difference is a
//    literal spelling, never a different declaration.
// 2. MINIFIER DEDUP: the build variant drops duplicate identical
//    declarations the serve variant keeps (observed: one extra
//    `--tw-gradient-position: in oklab` on dev), so declaration COUNTS are
//    not comparable between the channels — only presence is.
// 3. BLOCK ORDER: the build variant emits `@layer properties` (the --tw-*
//    compat fallbacks) BEFORE `@layer utilities`, the serve variant after.
//    `--tw-shadow` is one NAME for several distinct declarations by design —
//    the shadow utility's resolved value, the `*, ::before, …` compat
//    fallback (`--tw-shadow: 0 0 #0000`), and the `@property` initial value —
//    so a NAME-keyed (first/last-wins) dev/build diff reports different
//    occurrences as "the value" and looks like a divergence. It is not one:
//    both channels ship the same declarations.
//
// The parity bound below therefore compares (a) the custom-property NAME sets
// and (b) the SET of unique normalized declarations — anything beyond the
// inherent differences above fails the test.

/** Abstract color/time literals and minified decimal/whitespace spellings. */
function normalizeDeclarationValue(value: string): string {
  return value
    .replace(/#[0-9a-fA-F]{3,8}\b/g, 'COLOR')
    .replace(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^()]*\)/g, 'COLOR')
    .replace(/(?<![\w.])0\.(?=\d)/g, '.')
    .replace(/(?<![\w.])(?:\d*\.)?\d+(?:ms|s)\b/g, 'TIME')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ');
}

/** Every `--name: value` declaration in sheet order (multi-occurrence kept). */
function cssDeclarations(css: string): Array<{ name: string; value: string }> {
  return [...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g)].map((match) => ({
    name: match[1]!,
    value: normalizeDeclarationValue(match[2]!.trim()),
  }));
}

/** The build channel over the same root and options: one real vite build. */
async function buildEntry(root: string): Promise<string> {
  const { build } = await import('vite');
  const probe = join(root, 'build-probe-entry.js');
  writeFileSync(probe, `import ${JSON.stringify(tailwindEntryPath(root))};\n`, 'utf8');
  try {
    const result = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      publicDir: false,
      plugins: [
        tailwindEntryPlugin(root, { theme: ['app/styles/theme.css'], documentReset: true }),
        ...(await tailwindPlugins()),
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: { entry: probe } },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    return output
      .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
      .map((item) => String(item.source))
      .join('\n');
  } finally {
    rmSync(probe, { force: true });
  }
}

test('dev and build compile one contract: equal declaration sets (--tw-shadow pinned)', async () => {
  // The fixture carries the consumer-reported shape: custom `--shadow-1`/
  // `--shadow-2` theme tokens AND a page that uses the `shadow-1` utility,
  // so the Tailwind-internal `--tw-shadow` machinery compiles on both
  // channels (with no shadow utility neither channel emits any --tw-shadow
  // at all — the variable exists only as utility/compat output).
  const handle = await bootDev(openElement(TAILWIND_ON));
  handles.push(handle);
  const devCss = await fetchEntryCss(handle);
  const buildCss = await buildEntry(FIXTURE_DIR);
  expect(buildCss.length, 'the build channel emitted a stylesheet').toBeGreaterThan(0);

  // (a) The name SETS are equal: neither channel drops or adds a custom
  // property (a dropped candidate or a dropped theme token fails here).
  const devNames = new Set(cssDeclarations(devCss).map((entry) => entry.name));
  const buildNames = new Set(cssDeclarations(buildCss).map((entry) => entry.name));
  expect(
    [...devNames].filter((name) => !buildNames.has(name)),
    'dev-only names',
  ).toEqual([]);
  expect(
    [...buildNames].filter((name) => !devNames.has(name)),
    'build-only names',
  ).toEqual([]);

  // (b) The SET of unique normalized declarations is equal: the only accepted
  // deltas are the peer's minified literal spellings and its
  // duplicate-declaration dedup, both of which the normalizer abstracts away.
  const uniqueDeclarations = (css: string): string[] =>
    [...new Set(cssDeclarations(css).map((entry) => `${entry.name}: ${entry.value}`))].sort();
  expect(uniqueDeclarations(devCss), 'dev declaration set').toEqual(uniqueDeclarations(buildCss));

  // --tw-shadow, covered explicitly: both channels carry the compat fallback
  // and the utility's own resolved value with the two-layer geometry the
  // authored `--shadow-1` token declares.
  for (const [label, css] of [
    ['dev', devCss],
    ['build', buildCss],
  ] as const) {
    expect(
      css.match(/--tw-shadow:\s*0 0 #0000/g)?.length ?? 0,
      `${label}: the compat fallback occurrence count`,
    ).toBeGreaterThan(0);
    expect(
      css.match(
        /--tw-shadow:\s*0 1px 2px 0 var\(--tw-shadow-color, (?:rgb\(0 0 0 \/ 0\.05\)|#0000000d)\), 0 1px 3px 0 var\(--tw-shadow-color, (?:rgb\(0 0 0 \/ 0\.1\)|#0000001a)\)/,
      ),
      `${label}: the .shadow-1 utility's resolved --tw-shadow value`,
    ).toBeTruthy();
  }

  // The consumer-reported tokens are present on both channels.
  for (const token of ['--shadow-1', '--shadow-2']) {
    expect(devCss.match(new RegExp(`${token}:`)), `dev carries ${token}`).toBeTruthy();
    expect(buildCss.match(new RegExp(`${token}:`)), `build carries ${token}`).toBeTruthy();
  }
});

test('the fixture tree stays free of retired-entry leftovers', () => {
  // Guard: the retired `.openElement/tailwind-preset/` staging path must not
  // come back from any code path this suite exercises.
  expect(existsSync(join(FIXTURE_DIR, '.openElement/tailwind-preset'))).toEqual(false);
});
