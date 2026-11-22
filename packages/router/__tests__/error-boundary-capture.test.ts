/**
 * @openelement/router — the generated lane's `onError` capture over a REAL dev
 * server + REAL browser.
 *
 * BREAKING REMOVAL RECORDED HERE: cross-element containment RETIRED with the
 * class lane's `ErrorBoundary` base class (F16, owner-approved). `ErrorBoundary`
 * captured DESCENDANT failures and climbed from the failing element to the
 * nearest boundary ancestor; that was ITS capability, and the generated lane
 * deliberately does not have it. The replacement is the `onError` intrinsic
 * (ADR-0182, `16b-EB`), whose handler list is owned by ONE element: it captures
 * that element's own failures and nothing else. An island can therefore no
 * longer flip a PARENT island's fallback, and assertions that depended on the
 * climb — a `<boundary-island>` wrapping a throwing child
 * `<boom-island>`, `boundary.catchError`, an authored `detonate()` method —
 * were deleted with the base class rather than kept red or quietly weakened.
 * What remains, and what this suite pins end to end, is same-element capture.
 *
 * The generated lane has exactly TWO capture points, both inside the one
 * element (`shell.ts`, the `16b-EB` amendment):
 *
 *   - `/`: the DOM-LISTENER channel. A click handler throws; the generated
 *     `guardUpdate(handler, __oe_reportError)` sink routes the throw to the
 *     island's own `onError`, which flips its fallback branch.
 *   - /update: the REFRESH-SUBSCRIPTION channel. A click writes a poisoned
 *     payload; the tracked `computed()` read by a slot throws inside its
 *     `bindSignalWrites(..., guardUpdate(...))` refresh, and the same handler
 *     flips the same element's fallback.
 *
 * Both are UPDATE-phase failures, and that is not a shortcut: the other capture
 * point (connect/claim) rolls the element back to its defined post-failure
 * state — no projection, no listeners — so an element that fails its FIRST
 * connect has nowhere to render a fallback. A visible fallback is only
 * meaningful after the element is live, which is what both routes do.
 *
 * Harness shape: the #1582 dev-Tailwind suite (real vite dev server in
 * middleware mode over the generated entry; the cwd stays at the fixture for
 * the server's lifetime — the island client's load() hook scans from
 * process.cwd() at request time, #951) + the stream-browser suite's direct
 * chromium launch.
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium } from '@playwright/test';
import type { Plugin, ViteDevServer } from 'vite';
import { openElement } from '../src/vite/app-vite.ts';

const FIXTURE_DIR = join(import.meta.dirname!, '../__test_fixtures__/boundary-capture-dev');

/**
 * The DOM-LISTENER capture island: its `#boom` handler throws and the island's
 * own `onError` flips the fallback branch.
 *
 * `onError` is the root-entry export deliberately (the side-effect-free
 * `lifecycle` subpath does not re-export it), so this fixture imports it from
 * the package root exactly as an author would.
 */
const BOOM_ISLAND = `import { defineIslandConfig } from '@openelement/router';
import { onError, signal } from '@openelement/element';

export const openElement = defineIslandConfig({
  tag: 'boom-island',
  root: 'shadow',
  hydrate: 'load',
  ssr: true,
  dsd: true,
});

export default function BoomIsland() {
  const hasError = signal(false);
  onError(() => {
    hasError.value = true;
  });
  return (
    <div class='boundary'>
      {hasError.value ? (
        <p class='fallback'>boundary capture fallback</p>
      ) : (
        <section class='body'>
          <p class='safe'>boom-island intended output</p>
          <button
            id='boom'
            type='button'
            onClick={() => {
              throw new Error('boom-island exploded in its click handler');
            }}
          >
            detonate
          </button>
        </section>
      )}
    </div>
  );
}
`;

/**
 * The REFRESH-SUBSCRIPTION capture island.
 *
 * `#poison` writes a payload whose nested object is missing, so the `derived`
 * computed — tracked by the `#derived` slot — throws when its refresh runs. The
 * generated `bindSignalWrites(..., guardUpdate(refresh, __oe_reportError))`
 * routes that throw to the same element's `onError`.
 *
 * The cast is what makes an author-written type lie expressible: a generated
 * component reads its signals as plain values, so "this value is not the shape
 * the type says" is runtime corruption by construction.
 */
const UPDATE_BOOM_ISLAND = `import { defineIslandConfig } from '@openelement/router';
import { computed, onError, signal } from '@openelement/element';

export const openElement = defineIslandConfig({
  tag: 'update-boom-island',
  root: 'shadow',
  hydrate: 'load',
  ssr: true,
  dsd: true,
});

type Payload = { nested: { deep: string } };

export default function UpdateBoomIsland() {
  const hasError = signal(false);
  const payload = signal<Payload>({ nested: { deep: 'initial safe value' } });
  const derived = computed(() => payload.value.nested.deep);
  onError(() => {
    hasError.value = true;
  });
  return (
    <div class='update-boom'>
      {hasError.value ? (
        <p class='fallback'>boundary capture fallback</p>
      ) : (
        <section class='body'>
          <button
            id='poison'
            type='button'
            onClick={() => {
              payload.value = { nested: null } as unknown as Payload;
            }}
          >
            poison
          </button>
          <p id='derived'>{derived.value}</p>
        </section>
      )}
    </div>
  );
}
`;

/** A generated SHADOW page root: the page's own tree is where `pierce` starts. */
const BOUNDARY_PAGE = `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'boundary-capture-page', root: 'shadow' });

export default function BoundaryCapturePage() {
  return (
    <main>
      <boom-island></boom-island>
    </main>
  );
}
`;

const UPDATE_PAGE = `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'update-capture-page', root: 'shadow' });

export default function UpdateCapturePage() {
  return (
    <main>
      <update-boom-island></update-boom-island>
    </main>
  );
}
`;

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
import BoundaryCapturePage from '../components/page-boundary-capture.tsx';

export default definePage(BoundaryCapturePage, {
  head: { title: 'boundary capture' },
});
`;

const UPDATE_ROUTE = `import { definePage } from '@openelement/router';
import UpdateCapturePage from '../components/page-update-capture.tsx';

export default definePage(UpdateCapturePage, {
  head: { title: 'update boundary capture' },
});
`;

/** Write the fixture app; idempotent so a re-run reuses the same tree. */
function writeFixture(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const dirs = ['app/routes', 'app/components', 'app/islands', 'node_modules/@openelement'];
  for (const dir of dirs) mkdirSync(join(FIXTURE_DIR, dir), { recursive: true });
  writeFileSync(join(FIXTURE_DIR, 'app/islands/boom-island.tsx'), BOOM_ISLAND, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'app/islands/update-boom-island.tsx'),
    UPDATE_BOOM_ISLAND,
    'utf8',
  );
  writeFileSync(
    join(FIXTURE_DIR, 'app/components/page-boundary-capture.tsx'),
    BOUNDARY_PAGE,
    'utf8',
  );
  writeFileSync(join(FIXTURE_DIR, 'app/components/page-update-capture.tsx'), UPDATE_PAGE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/index.tsx'), INDEX_ROUTE, 'utf8');
  writeFileSync(join(FIXTURE_DIR, 'app/routes/update.tsx'), UPDATE_ROUTE, 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'boundary-capture-dev-fixture', private: true, type: 'module' }),
    'utf8',
  );
  // The generated entry imports '@openelement/router/http' by package name;
  // the fixture sits inside the router package, so it needs its own
  // resolution edge to it (the #1582 dev harness's symlink shape). Element,
  // vite and hono resolve through the workspace walk-up from the fixture.
  symlinkSync('../../../..', join(FIXTURE_DIR, 'node_modules/@openelement/router'), 'dir');
}

interface DevHandle {
  base: string;
  server: ViteDevServer;
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
      // The generated entry compiles .tsx route/page/island modules, so the
      // dev pipeline must lower JSX the same way the app's vite.config does.
      oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
      server: { middlewareMode: true, ws: false },
      plugins,
    });
  } catch (error) {
    process.chdir(previousCwd);
    throw error;
  }
  // The dev island client's load() hook scans from process.cwd() at request
  // time (#951), so the cwd must stay at the fixture for the server's whole
  // lifetime — restoring it right after createServer serves an island-free
  // client entry and nothing hydrates. close() restores it.
  const httpServer = createHttpServer((request, response) => {
    server.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
  });
  const restore = (): void => process.chdir(previousCwd);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', () => {
      restore();
      reject(new Error('dev server did not bind'));
    });
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') {
    restore();
    throw new Error('dev server did not bind');
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await server.close();
        restore();
      }
    },
  };
}

const OPTIONS = {
  routesDir: 'app/routes',
  islandsDir: 'app/islands',
  layout: false as const,
};

/**
 * Shadow-piercing deep query, serialized into the page: the islands live in
 * the page's shadow tree, where document.querySelector cannot see them (an
 * optional-chained query there resolves vacuously).
 */
const PIERCE_HELPER = `
  const pierce = (selector) => {
    const queue = [document];
    while (queue.length > 0) {
      const node = queue.shift();
      const found = node && node.querySelector ? node.querySelector(selector) : null;
      if (found) return found;
      const shadow = node instanceof Element ? node.shadowRoot : null;
      if (shadow) queue.push(shadow);
      const all = node && node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const child of all) queue.push(child);
    }
    return null;
  };`;

/** The vite HMR client's failed websocket connect is harness noise (ws off). */
const isHarnessNoise = (message: string): boolean =>
  message.includes('WebSocket closed without opened');

let handle: DevHandle | undefined;

beforeAll(() => {
  writeFixture();
});

afterAll(async () => {
  if (handle) await handle.close();
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

test("a throwing DOM listener flips the element's own fallback (update capture point)", async () => {
  if (handle) await handle.close();
  handle = await bootDev(openElement(OPTIONS));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    const response = await page.goto(`${handle.base}/`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toEqual(200);
    // SSR integrity: the element's own body branch is server-rendered, and the
    // fallback is NOT (it only exists after a captured failure).
    const ssr = await (await fetch(`${handle.base}/`)).text();
    expect(ssr).toContain('boom-island intended output');
    expect(ssr).not.toContain('boundary capture fallback');

    // Upgrade-positive probe. The generated lane has no base-class method to
    // look for, and the DSD template is queryable pre-upgrade — so the probe is
    // an authored CLICK HANDLER's effect plus the element's own definition
    // having taken the host (`customElements.get` returning a constructor the
    // element is an instance of is the upgrade fact; the shadow root alone is
    // not).
    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('boom-island');
        const ctor = customElements.get('boom-island');
        return !!island && typeof ctor === 'function' && island instanceof ctor
          && !!island.shadowRoot && island.shadowRoot.querySelector('#boom') !== null;
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );

    // Detonate: the handler throws inside `guardUpdate(handler, sink)`, which
    // routes it to this element's own onError.
    await page.evaluate(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('boom-island');
        const button = island && island.shadowRoot ? island.shadowRoot.querySelector('#boom') : null;
        if (!button) throw new Error('boom button not found');
        button.click();
      `) as () => void,
    );

    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('boom-island');
        return !!island && !!island.shadowRoot && island.shadowRoot.querySelector('.fallback') !== null;
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );
    expect(
      (
        (await page.evaluate(
          new Function(`
            ${PIERCE_HELPER}
            const island = pierce('boom-island');
            const fallback = island && island.shadowRoot ? island.shadowRoot.querySelector('.fallback') : null;
            return fallback ? fallback.textContent : '';
          `) as () => string,
        )) ?? ''
      ).trim(),
      "the captured throw swapped the element's own fallback in",
    ).toEqual('boundary capture fallback');
    expect(
      pageErrors.filter((message) => !isHarnessNoise(message)),
      'the listener throw is captured by the element, never uncaught',
    ).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);

test("a throwing refresh subscription flips the element's own fallback after a real click", async () => {
  if (handle) await handle.close();
  handle = await bootDev(openElement(OPTIONS));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

    const response = await page.goto(`${handle.base}/update`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toEqual(200);

    // Upgrade-positive + claimed-content probe: the safe initial value must be
    // the CLAIMED server DOM (so the refresh subscription exists to throw
    // from), and the button must be live.
    const hydrated = await page
      .waitForFunction(
        new Function(`
          ${PIERCE_HELPER}
          const island = pierce('update-boom-island');
          const ctor = customElements.get('update-boom-island');
          return !!island && typeof ctor === 'function' && island instanceof ctor
            && !!island.shadowRoot
            && (island.shadowRoot.textContent || '').includes('initial safe value')
            && island.shadowRoot.querySelector('#poison') !== null;
        `) as () => boolean,
        undefined,
        { timeout: 20_000, polling: 100 },
      )
      .catch(() => null);
    expect(
      hydrated !== null || pageErrors.some((message) => !isHarnessNoise(message)),
      `the island must hydrate with its safe value; page errors: ${pageErrors.join(' | ')}`,
    ).toEqual(true);

    await page.evaluate(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('update-boom-island');
        const button = island && island.shadowRoot ? island.shadowRoot.querySelector('#poison') : null;
        if (!button) throw new Error('poison button not found');
        button.click();
      `) as () => void,
    );

    // The poisoned write makes the derived computed throw inside the tracked
    // slot's refresh, whose `guardUpdate(refresh, sink)` routes it to onError.
    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('update-boom-island');
        return !!island && !!island.shadowRoot && island.shadowRoot.querySelector('.fallback') !== null;
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );
    expect(
      pageErrors.filter((message) => !isHarnessNoise(message)),
      'the refresh throw is captured by the element, never uncaught',
    ).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
