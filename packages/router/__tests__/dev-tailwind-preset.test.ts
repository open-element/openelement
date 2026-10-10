/**
 * @openelement/router — dev-mode Tailwind preset delivery (#1582).
 *
 * The preset's build half (#1505) linked the compiled theme into the SSG
 * output, and the dev pipeline read `tailwind` nowhere: `pnpm dev` on the
 * alpha.11 starter served pages whose `var(--paper/--brand/…)` all resolved
 * empty, because the authored `@theme` block is an unknown at-rule to the
 * browser and only the Tailwind compile turns its roles into real custom
 * properties. This suite boots a REAL dev server (vite + @hono/vite-dev-server
 * over the generated entry, the `request-time-parity` harness shape) against a
 * fixture that declares `tailwind: { theme }` and asserts the delivered
 * document:
 *
 *   1. the head carries `<link rel="stylesheet">` to the staged entry and the
 *      URL answers the COMPILED theme (a resolved `--color-*` scale value,
 *      no raw `@theme` at-rule);
 *   2. that link precedes the page's `@scope` static styles in the document;
 *   3. editing the declared sheet reaches the browser as a Vite `css-update`
 *      and a `?t=`-stamped re-request answers the edited tokens;
 *   4. with no `tailwind` key the document is byte-identical to the same
 *      pipeline minus this plugin (OFF stays OFF: no staging file, no link,
 *      nothing contributed).
 *   5. dev/build parity: the served entry and the build bundle (through
 *      `buildTailwindPresetBundle`) declare the same custom-property set
 *      with an equal normalized declaration set — including the
 *      Tailwind-internal `--tw-shadow`, whose multi-occurrence shape and
 *      the peer's two inherent variant differences are documented at the
 *      parity test below.
 *
 * The fixture lives under __test_fixtures__ (gitignored) and is written per
 * run — the #1535/#1536 preset tests use the same shape.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Plugin, ViteDevServer } from 'vite';
import { openElement } from '../src/vite/app-vite.ts';
import { buildTailwindPresetBundle } from '../src/vite/preset-tailwind.ts';

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/tailwind-dev-delivery');
const THEME_PATH = join(FIXTURE_DIR, 'app', 'styles', 'theme.css');

/** A token the authored sheet does NOT declare — only the compile emits it. */
const COMPILED_SCALE_MARKER = /--color-violet-700:\s*(?:oklch|#|rgb)/;
/** The compiled theme block: roles inside one `:root, :host` scope. */
const COMPILED_THEME_BLOCK = /:root,?\s*:host\s*\{/;
const STAGED_ENTRY = '.openElement/tailwind-preset/entry.css';

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

@element('index-page', { root: 'light' })
export default class HomePage extends OpenElement {
  static override styles = [pageStyles];

  render() {
    return (
      <main>
        <h1 id='home'>dev preset fixture</h1>
        <section class='panel shadow-1'>panel</section>
      </main>
    );
  }
}
`;

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, { head: { title: 'dev preset fixture' } });
`;

/** Write the fixture app; idempotent so a re-run reuses the same tree. */
function writeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const dirs = ['app/routes', 'app/components', 'app/styles', 'node_modules/@openelement'];
  for (const dir of dirs) mkdirSync(join(FIXTURE_DIR, dir), { recursive: true });
  writeFileSync(join(FIXTURE_DIR, 'app/styles/theme.css'), THEME_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/components/page-home.css'), HOME_CSS, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/components/page-home.tsx'), HOME_TSX, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/index.tsx'), INDEX_ROUTE, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'tailwind-dev-delivery-fixture', private: true, type: 'module' }),
    'utf8',
  );
  // The generated entry imports `@openelement/router/http` and
  // `@openelement/router/server-runtime` by package name; the fixture sits
  // inside the router package, so it needs its own resolution edge to it
  // (every fixture under tests/fixtures/ carries the same symlink).
  symlinkSync('../../../..', join(FIXTURE_DIR, 'node_modules/@openelement/router'), 'dir');
}

interface DevHandle {
  base: string;
  server: ViteDevServer;
  hotPayloads: unknown[];
  close: () => Promise<void>;
}

/** Boot a real dev server over the fixture, loopback-only (the parity harness). */
async function bootDev(plugins: Plugin[]): Promise<DevHandle> {
  const { createServer } = await import('vite');
  const previousCwd = process.cwd();
  process.chdir(FIXTURE_DIR);
  let server: ViteDevServer;
  try {
    server = await createServer({
      root: FIXTURE_DIR,
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
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    hotPayloads,
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

const PRESET_OPTIONS = {
  routesDir: 'app/routes',
  islandsDir: 'app/islands',
  componentsDir: 'app/components',
  appShell: false as const,
};

/** The one option under test: the declared theme source, preset ON. */
const PRESET_ON = {
  ...PRESET_OPTIONS,
  // App-relative (the documented contract, #1633): the preset resolves it
  // against the app root into the staged entry's own base.
  tailwind: { theme: ['app/styles/theme.css'] },
};

async function fetchDoc(handle: DevHandle, path = '/'): Promise<string> {
  const response = await fetch(`${handle.base}${path}`);
  expect(response.status, `GET ${path}`).toEqual(200);
  return await response.text();
}

async function fetchStagedCss(handle: DevHandle, query = ''): Promise<string> {
  const response = await fetch(`${handle.base}/${STAGED_ENTRY}${query}`, {
    headers: { accept: 'text/css,*/*;q=0.1' },
  });
  expect(response.status, 'GET staged entry').toEqual(200);
  expect(response.headers.get('content-type') ?? '', 'staged entry content type').toContain(
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

test('dev document head carries the compiled theme sheet (#1582)', async () => {
  const handle = await bootDev(openElement(PRESET_ON));
  handles.push(handle);

  const doc = await fetchDoc(handle);
  const linkIndex = doc.indexOf(STAGED_ENTRY);
  expect(linkIndex, 'the dev document links the staged preset entry').toBeGreaterThan(-1);
  expect(doc.slice(0, linkIndex).includes('<head>'), 'the link sits in the document head').toEqual(
    true,
  );

  // The page's own static styles are `@scope`-scoped into the body markup: the
  // head link precedes them by construction, which is the delivery order the
  // acceptance criteria name.
  const scopeIndex = doc.indexOf('@scope');
  expect(scopeIndex, 'the fixture page emits scoped static styles').toBeGreaterThan(-1);
  expect(linkIndex, 'the theme link precedes the page @scope styles').toBeLessThan(scopeIndex);

  const css = await fetchStagedCss(handle);
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
  const handle = await bootDev(openElement(PRESET_ON));
  handles.push(handle);
  // Prime the module graph with the staged entry, as a browsing client would.
  await fetchStagedCss(handle);

  const original = await readFile(THEME_PATH, 'utf8');
  try {
    await writeFile(THEME_PATH, original.replace('--color-violet-700', '--color-violet-600'));
    // The edit must surface as a css-update for the staged entry: that is the
    // HMR signal the browser applies, and the peer registers the declared
    // sources as watch files precisely so this fires.
    //
    // The deadline is 30s, not 10s (F-1, alpha.13): this test starts a real Vite
    // dev server and a real Tailwind compile, and on a 2-core CI runner those
    // compete with the rest of the suite for the same cores — the 10s wall
    // clock was observed exceeding once for a compile that then did arrive. The
    // loop still fails on a genuinely missing update, just later; the assertion
    // below is unchanged.
    const deadline = Date.now() + 30_000;
    while (
      !handle.hotPayloads.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          'type' in payload &&
          (payload as { type?: unknown }).type === 'update' &&
          JSON.stringify(payload).includes('css-update') &&
          JSON.stringify(payload).includes('/tailwind-preset/entry.css'),
      )
    ) {
      if (Date.now() > deadline) throw new Error('no css-update for the staged entry');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // The client re-requests the link with a `?t=` stamp; the stamped answer
    // must carry the edited token (the `?t=` form is what the Hono dev
    // server's exclude list lets through to Vite).
    const css = await fetchStagedCss(handle, `?t=${Date.now()}`);
    expect(css, 'the edited scale step reaches the delivered sheet').toMatch(
      /--color-violet-600:\s*(?:oklch|#|rgb)/,
    );
  } finally {
    await writeFile(THEME_PATH, original);
  }
});

test('with no tailwind key the dev document is unchanged (#1582 constraint)', async () => {
  // The ON tests above staged the entry; clear it so "OFF writes nothing" is
  // asserted against this run and not against their leftover.
  rmSync(join(FIXTURE_DIR, '.openElement'), { recursive: true, force: true });
  // The control is the same pipeline with this one plugin removed: a
  // byte-identical document is the honest statement of "zero behavior change",
  // and it also pins that the preset plugin contributes no styling of its own.
  const withPlugin = await bootDev(openElement(PRESET_OPTIONS));
  handles.push(withPlugin);
  const control = await bootDev(
    openElement(PRESET_OPTIONS).filter((plugin) => plugin.name !== 'open:tailwind-preset-dev'),
  );
  handles.push(control);

  const doc = await fetchDoc(withPlugin);
  const controlDoc = await fetchDoc(control);
  expect(doc, 'preset-less dev document carries no preset artifact').not.toContain(
    'tailwind-preset',
  );
  expect(doc).not.toMatch(/<link rel="stylesheet"/);
  expect(doc, 'OFF stays OFF: byte-identical document').toEqual(controlDoc);
  expect(
    existsSync(join(FIXTURE_DIR, '.openElement/tailwind-preset/entry.css')),
    'OFF writes no staging file',
  ).toEqual(false);
});

test('the served entry is request-time: a build emptying .openElement cannot 404 it', async () => {
  rmSync(join(FIXTURE_DIR, '.openElement'), { recursive: true, force: true });
  const handle = await bootDev(openElement(PRESET_ON));
  handles.push(handle);
  const stagedPath = join(FIXTURE_DIR, STAGED_ENTRY);

  // The dev channel owns no file: the URL answers the compiled theme with
  // nothing on disk (the build half's `emptyOutDir` inner build empties that
  // directory — a disk-backed dev channel died with the next `vite build`).
  const served = await fetchStagedCss(handle);
  expect(served).toMatch(COMPILED_THEME_BLOCK);
  expect(() => readFileSync(stagedPath, 'utf8'), 'the dev channel writes no file').toThrow(
    /ENOENT/,
  );

  // A build half's staging write lands on that same path next; the served
  // module must stay the generated entry (the file is never the source), and
  // its later deletion (the inner build's emptyOutDir) must not disturb the
  // already-running server.
  mkdirSync(join(FIXTURE_DIR, '.openElement', 'tailwind-preset'), { recursive: true });
  writeFileSync(stagedPath, '/* stale staging text a build left behind */\n', 'utf8');
  const afterWrite = await fetchStagedCss(handle, `?t=${Date.now()}`);
  expect(afterWrite, 'the file at the mapped path is not the served source').toMatch(
    COMPILED_THEME_BLOCK,
  );
  rmSync(stagedPath);
  // Both client shapes after the wipe: the HMR-stamped re-request and the
  // plain URL a browser refresh asks for (the plain form is the one the
  // recorded incident saw 404 — the unlink had invalidated the module).
  const afterWipe = await fetchStagedCss(handle, `?t=${Date.now()}`);
  expect(afterWipe, 'the wiped entry still answers the compile').toMatch(COMPILED_SCALE_MARKER);
  const afterWipePlain = await fetchStagedCss(handle);
  expect(afterWipePlain, 'the plain URL still answers the compile').toMatch(COMPILED_THEME_BLOCK);
});

// ─── Dev/build parity (--tw-shadow and the minified-literal deltas) ─────────
//
// The preset's two channels ride the two variants of the @tailwindcss/vite
// peer (dev-tailwind.ts proxies the serve plugins; preset-tailwind.ts runs
// the inner build with the build plugins), and the peer compiles them with
// a few known, INHERENT differences — verified against 4.3.3 by direct
// probe and pinned here so they cannot silently grow:
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
//    the shadow utility's resolved value (`.shadow-1 { --tw-shadow: 0 1px
//    2px 0 var(--tw-shadow-color, …), … }`), the `*, ::before, …` compat
//    fallback (`--tw-shadow: 0 0 #0000`), and the `@property` initial value
//    (also `0 0 #0000`) — so a NAME-keyed (first/last-wins) dev/build diff
//    reports different occurrences as "the value" and looks like a
//    divergence. It is not one: both channels ship the same declarations.
//
// The parity bound below therefore compares (a) the custom-property NAME
// sets and (b) the SET of unique normalized declarations — anything beyond
// the inherent differences above fails the test.

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

test('dev and build compile one contract: equal declaration sets (--tw-shadow pinned)', async () => {
  // The fixture carries the consumer-reported shape: custom `--shadow-1`/
  // `--shadow-2` theme tokens AND a page that uses the `shadow-1` utility,
  // so the Tailwind-internal `--tw-shadow` machinery compiles on both
  // channels (with no shadow utility neither channel emits any --tw-shadow
  // at all — the variable exists only as utility/compat output).
  rmSync(join(FIXTURE_DIR, '.openElement'), { recursive: true, force: true });
  const handle = await bootDev(openElement(PRESET_ON));
  handles.push(handle);
  const devCss = await fetchStagedCss(handle);

  // The build channel over the SAME root and options. It stages/empties
  // `.openElement/tailwind-preset/` on disk — the dev channel's served
  // module is disk-independent (the test above), so the order is safe.
  const built = await buildTailwindPresetBundle({
    root: FIXTURE_DIR,
    outDir: join(FIXTURE_DIR, 'dist'),
    options: PRESET_ON.tailwind,
    base: '/',
  });

  // (a) The name SETS are equal: neither channel drops or adds a custom
  // property (a dropped candidate or a dropped theme token fails here).
  const devNames = new Set(cssDeclarations(devCss).map((entry) => entry.name));
  const buildNames = new Set(cssDeclarations(built.bundleCss).map((entry) => entry.name));
  expect(
    [...devNames].filter((name) => !buildNames.has(name)),
    'dev-only names',
  ).toEqual([]);
  expect(
    [...buildNames].filter((name) => !devNames.has(name)),
    'build-only names',
  ).toEqual([]);

  // (b) The SET of unique normalized declarations is equal: the only
  // accepted deltas are the peer's minified literal spellings and its
  // duplicate-declaration dedup, both of which the normalizer abstracts
  // away (counts excluded for exactly the dedup reason above).
  const uniqueDeclarations = (css: string): string[] =>
    [...new Set(cssDeclarations(css).map((entry) => `${entry.name}: ${entry.value}`))].sort();
  expect(uniqueDeclarations(devCss), 'dev declaration set').toEqual(
    uniqueDeclarations(built.bundleCss),
  );

  // --tw-shadow, covered explicitly (the reported pair):
  // both channels carry the compat fallback — byte-identical, `0 0 #0000`
  // is already the minified spelling on both sides…
  for (const [label, css] of [
    ['dev', devCss],
    ['build', built.bundleCss],
  ] as const) {
    expect(
      css.match(/--tw-shadow:\s*0 0 #0000/g)?.length ?? 0,
      `${label}: the compat fallback occurrence count`,
    ).toBeGreaterThan(0);
    // …and both carry the utility's own resolved value with the two-layer
    // geometry the authored `--shadow-1` token declares, the color overlay
    // spelled per variant (rgb() on dev, minified hex on build).
    expect(
      css.match(
        /--tw-shadow:\s*0 1px 2px 0 var\(--tw-shadow-color, (?:rgb\(0 0 0 \/ 0\.05\)|#0000000d)\), 0 1px 3px 0 var\(--tw-shadow-color, (?:rgb\(0 0 0 \/ 0\.1\)|#0000001a)\)/,
      ),
      `${label}: the .shadow-1 utility's resolved --tw-shadow value`,
    ).toBeTruthy();
  }

  // The consumer-reported tokens are present on both channels (their value
  // delta is exactly the minified color class the normalizer abstracts).
  for (const token of ['--shadow-1', '--shadow-2']) {
    expect(devCss.match(new RegExp(`${token}:`)), `dev carries ${token}`).toBeTruthy();
    expect(built.bundleCss.match(new RegExp(`${token}:`)), `build carries ${token}`).toBeTruthy();
  }
});
