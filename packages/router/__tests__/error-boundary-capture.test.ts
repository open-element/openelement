/**
 * @openelement/router — client-path ErrorBoundary automatic capture over a
 * REAL dev server + REAL browser (alpha.13 artifact honesty).
 *
 * The element-package suites pin the routing primitives (`_captureError`,
 * the emitted lifecycle wrapper, the setter and kernel sinks) against the
 * facade DOM; this suite boots the real dev pipeline over a fixture of the
 * audit's island shapes and drives them in Chromium:
 *
 *   - /: a boundary island wrapping a child island whose authored
 *     `attributeChangedCallback()` throws — after hydration the test flips
 *     the child's reflected attribute, the compiled lifecycle wrapper routes
 *     the throw to the boundary, and the fallback branch replaces the slot;
 *   - /update: the update-boom shape — a click handler writes a poisoned
 *     payload, the derived computed throws at the write, and the boundary
 *     flips through the signal-graph/update capture paths.
 *
 * Both failure modes are driven POST-hydration, deliberately: the island
 * scheduler defines each island in its own dynamic-import `.then()`, so a
 * child island's connect-time throw can race its boundary island's
 * definition (an un-upgraded boundary host is not yet a boundary for the
 * climb). That upgrade-order window is an island-scheduler characteristic,
 * not a capture-semantics one — the wrapper's routing is pinned here with
 * the boundary guaranteed present, and the element-package suites cover the
 * connect-time throw directly against the facade DOM.
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

const BOUNDARY_ISLAND = `import { defineIslandConfig } from '@openelement/router';
import { element, ErrorBoundary, property } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('boundary-island', { root: 'shadow-open' })
export default class BoundaryIsland extends ErrorBoundary {
  @property({ reflect: false, attribute: false })
  hasError = false;

  render() {
    return <div>{this.hasError ? <p class='fallback'>boundary capture fallback</p> : <slot></slot>}</div>;
  }
}
`;

/**
 * The audit's boom child, retimed to a post-hydration lifecycle throw: the
 * authored attributeChangedCallback throws whenever the label attribute is
 * set to the detonation word. SSR and the first hydration pass keep the safe
 * initial attribute; the TEST flips the attribute after everything upgraded,
 * so the capture runs against a boundary that is guaranteed present.
 */
const BOOM_ISLAND = `import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('boom-island', { root: 'shadow-open' })
export default class BoomIsland extends OpenElement {
  @property({ reflect: false })
  label = 'boom-island intended output';

  override attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === 'label' && newValue === 'detonate') {
      throw new Error('boom-island exploded in attributeChangedCallback');
    }
  }

  render() {
    return <p>{this.label}</p>;
  }
}
`;

const UPDATE_BOOM_ISLAND = `import { defineIslandConfig } from '@openelement/router';
import { computed, element, OpenElement, property, type ReadonlySignal } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('update-boom-island', { root: 'shadow-open' })
export default class UpdateBoomIsland extends OpenElement {
  @property({ reflect: false, attribute: false })
  payload: { nested: { deep: string } } = { nested: { deep: 'initial safe value' } };

  @property({ reflect: false, attribute: false })
  label = 'detonate';

  @property({ reflect: false, attribute: false, type: String })
  derived: ReadonlySignal<string> = computed(() => this.payload.nested.deep);

  detonate(): void {
    this.payload = { nested: null } as unknown as { nested: { deep: string } };
  }

  render() {
    return (
      <div class='update-boom'>
        <button type='button' onClick={this.detonate}>{this.label}</button>
        <p id='update-boom-derived'>{this.derived}</p>
      </div>
    );
  }
}
`;

const BOUNDARY_PAGE = `import { element, OpenElement } from '@openelement/element';

@element('boundary-capture-page', { root: 'shadow-open' })
export default class BoundaryCapturePage extends OpenElement {
  render() {
    return (
      <main>
        <boundary-island><boom-island></boom-island></boundary-island>
      </main>
    );
  }
}
`;

const UPDATE_PAGE = `import { element, OpenElement } from '@openelement/element';

@element('update-capture-page', { root: 'shadow-open' })
export default class UpdateCapturePage extends OpenElement {
  render() {
    return (
      <main>
        <boundary-island><update-boom-island></update-boom-island></boundary-island>
      </main>
    );
  }
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
  writeFileSync(join(FIXTURE_DIR, 'app/islands/boundary-island.tsx'), BOUNDARY_ISLAND, 'utf8');
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
  componentsDir: 'app/components',
  appShell: false as const,
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

test('an authored lifecycle throw in a child island flips the boundary fallback (client path)', async () => {
  if (handle) await handle.close();
  handle = await bootDev(openElement(OPTIONS));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    const response = await page.goto(`${handle.base}/`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toEqual(200);
    // SSR integrity: the boundary's DSD carries the slot branch and the
    // child island's slotted content is present pre-hydration.
    const ssr = await (await fetch(`${handle.base}/`)).text();
    expect(ssr).toContain('boom-island intended output');

    // Wait for hydration with an UPGRADE-POSITIVE probe: the declarative
    // shadow root is queryable on an un-upgraded host too (the DSD template
    // exists pre-upgrade), so shadowRoot checks alone are vacuous. A base
    // class method only exists once the boundary's custom-element definition
    // took the host.
    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const boundary = pierce('boundary-island');
        return !!boundary && typeof boundary.catchError === 'function';
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );

    // Detonate the authored attributeChangedCallback throw (post-hydration,
    // boundary guaranteed present). The compiled lifecycle wrapper routes it.
    await page.evaluate(
      new Function(`
        ${PIERCE_HELPER}
        const boom = pierce('boom-island');
        if (!boom) throw new Error('boom-island not found');
        boom.setAttribute('label', 'detonate');
      `) as () => void,
    );

    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const boundary = pierce('boundary-island');
        return !!boundary && !!boundary.shadowRoot && boundary.shadowRoot.querySelector('.fallback') !== null;
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );
    expect(
      (
        (await page.evaluate(
          new Function(`
            ${PIERCE_HELPER}
            const boundary = pierce('boundary-island');
            const fallback = boundary && boundary.shadowRoot ? boundary.shadowRoot.querySelector('.fallback') : null;
            return fallback ? fallback.textContent : '';
          `) as () => string,
        )) ?? ''
      ).trim(),
      'the compiled hasError branch swapped the fallback in',
    ).toEqual('boundary capture fallback');
    expect(
      pageErrors.filter((message) => !isHarnessNoise(message)),
      'the lifecycle throw is captured, never uncaught',
    ).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);

test('a detonated derived evaluation flips the boundary after a real click (update path)', async () => {
  if (handle) await handle.close();
  handle = await bootDev(openElement(OPTIONS));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));

    const response = await page.goto(`${handle.base}/update`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toEqual(200);
    // The safe initial value rendered (SSR and first hydration evaluation),
    // and BOTH islands are upgraded — the boundary included: the scheduler
    // defines each island in its own dynamic-import .then(), so the child can
    // hydrate first; detonating before the boundary upgraded would test the
    // scheduler's race, not the capture.
    const hydrated = await page
      .waitForFunction(
        new Function(`
          ${PIERCE_HELPER}
          const island = pierce('update-boom-island');
          const boundary = pierce('boundary-island');
          // Upgrade-positive probes (methods exist only post-definition),
          // then the claimed content.
          return !!island && typeof island.detonate === 'function'
            && !!island.shadowRoot && (island.shadowRoot.textContent || '').includes('initial safe value')
            && !!boundary && typeof boundary.catchError === 'function';
        `) as () => boolean,
        undefined,
        { timeout: 20_000, polling: 100 },
      )
      .catch(() => null);
    expect(
      hydrated !== null || pageErrors.some((message) => !isHarnessNoise(message)),
      `the update island must hydrate with its safe value; page errors: ${pageErrors.join(' | ')}`,
    ).toEqual(true);

    await page.evaluate(
      new Function(`
        ${PIERCE_HELPER}
        const island = pierce('update-boom-island');
        const button = island && island.shadowRoot ? island.shadowRoot.querySelector('button') : null;
        if (!button) throw new Error('detonate button not found');
        button.click();
      `) as () => void,
    );

    // The poisoned write makes the derived computed throw; the capture paths
    // (setter + kernel update sink) route it to the enclosing boundary.
    await page.waitForFunction(
      new Function(`
        ${PIERCE_HELPER}
        const boundary = pierce('boundary-island');
        return !!boundary && !!boundary.shadowRoot && boundary.shadowRoot.querySelector('.fallback') !== null;
      `) as () => boolean,
      undefined,
      { timeout: 20_000, polling: 100 },
    );
    expect(
      pageErrors.filter((message) => !isHarnessNoise(message)),
      'the detonation error is captured, never uncaught',
    ).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
