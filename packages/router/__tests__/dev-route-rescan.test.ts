/**
 * plugin.ts: dev route rescan (#1028).
 *
 * Route scanning used to happen only in buildStart(); a route file added
 * while `deno task dev` ran was never picked up (404 until restart). The core
 * plugin's dev watcher must re-scan the routes dir, rebuild the cached entry
 * descriptor (virtualEntryPlugin.load() renders from it), invalidate the
 * virtual entry module, and full-reload.
 */
import { assertEquals, assertStringIncludes } from '@std/assert';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { createOpenPlugin } from '../src/vite/plugin.ts';

const RESOLVED_ENTRY_ID = '\0virtual:open-hono-entry';

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
export const tagName = 'test-index-page';
export default definePage({
  render() { return null; },
});
`;

const ABOUT_ROUTE = `import { definePage } from '@openelement/router';
export const tagName = 'test-about-page';
export default definePage({
  render() { return null; },
});
`;

const ENHANCED_INDEX_ROUTE = `import { definePage } from '@openelement/router';
export const tagName = 'test-index-page';
export default definePage({
  renderIntent: { mode: 'dynamic' },
  render() { return <form method='post' data-open-enhance><button>save</button></form>; },
});
`;

type Hooked = {
  buildStart?: () => Promise<void>;
  configureServer?: (server: unknown) => void;
  load?: (id: string) => unknown;
};

/** Wait until predicate() holds; fails the test after ~2s. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

Deno.test('openPlugin: route file added during dev triggers descriptor rescan (#1028)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'oe-route-rescan-' });
  try {
    const routesDir = join(dir, 'routes');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.writeTextFile(join(routesDir, 'index.tsx'), INDEX_ROUTE);

    const plugins = createOpenPlugin({ routesDir }) as Hooked[];
    const core = plugins.find((p) => (p as { name?: string }).name === 'open:core')!;
    const virtualEntry = plugins.find((p) =>
      (p as { name?: string }).name === 'open:virtual-entry'
    )!;

    await core.buildStart!();

    const entryBefore = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    assertStringIncludes(entryBefore, 'index.tsx');
    assertEquals(entryBefore.includes('about.tsx'), false);

    const watcher = new EventEmitter() as EventEmitter & { add(path: string): void };
    watcher.add = () => {};
    const sent: unknown[] = [];
    const invalidated: string[] = [];
    core.configureServer!({
      config: { root: dir },
      watcher,
      hot: { send: (payload: unknown) => sent.push(payload) },
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      httpServer: null,
    });

    // A new route file appears while dev is running.
    await Deno.writeTextFile(join(routesDir, 'about.tsx'), ABOUT_ROUTE);
    watcher.emit('add', join(routesDir, 'about.tsx'));

    await waitFor(() => sent.length === 1, 'full-reload after route rescan');
    assertEquals(sent[0], { type: 'full-reload' });
    assertEquals(invalidated, [RESOLVED_ENTRY_ID]);

    // load() must render from the re-scanned descriptor.
    const entryAfter = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    assertStringIncludes(entryAfter, 'about.tsx');

    // Removing the route re-scans back down.
    await Deno.remove(join(routesDir, 'about.tsx'));
    watcher.emit('unlink', join(routesDir, 'about.tsx'));
    await waitFor(() => sent.length === 2, 'full-reload after route removal');
    const entryFinal = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    assertEquals(entryFinal.includes('about.tsx'), false);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('openPlugin: dev watcher ignores non-route files outside routesDir (#1028)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'oe-route-rescan-guard-' });
  try {
    const routesDir = join(dir, 'routes');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.writeTextFile(join(routesDir, 'index.tsx'), INDEX_ROUTE);

    const plugins = createOpenPlugin({ routesDir }) as Hooked[];
    const core = plugins.find((p) => (p as { name?: string }).name === 'open:core')!;
    await core.buildStart!();

    const watcher = new EventEmitter() as EventEmitter & { add(path: string): void };
    watcher.add = () => {};
    const sent: unknown[] = [];
    core.configureServer!({
      config: { root: dir },
      watcher,
      hot: { send: (payload: unknown) => sent.push(payload) },
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: () => {},
      },
      httpServer: null,
    });

    watcher.emit('add', join(dir, 'elsewhere.tsx')); // outside routesDir
    watcher.emit('add', join(routesDir, 'notes.md')); // not a route extension
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(sent.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('openPlugin: route content changes rebuild descriptor once after a burst (#1102)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'oe-route-change-rescan-' });
  try {
    const routesDir = join(dir, 'routes');
    const routeFile = join(routesDir, 'index.tsx');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.writeTextFile(routeFile, INDEX_ROUTE);

    const plugins = createOpenPlugin({ routesDir }) as Hooked[];
    const core = plugins.find((p) => (p as { name?: string }).name === 'open:core')!;
    const virtualEntry = plugins.find((p) =>
      (p as { name?: string }).name === 'open:virtual-entry'
    )!;
    await core.buildStart!();

    const watcher = new EventEmitter() as EventEmitter & { add(path: string): void };
    watcher.add = () => {};
    const sent: unknown[] = [];
    const invalidated: string[] = [];
    core.configureServer!({
      config: { root: dir },
      watcher,
      hot: { send: (payload: unknown) => sent.push(payload) },
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        getModulesByFile: () => new Set([{ id: routeFile }]),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      httpServer: null,
    });

    await Deno.writeTextFile(routeFile, ENHANCED_INDEX_ROUTE);
    // Chokidar can coalesce or duplicate editor writes. Three rapid events
    // must produce one serialized descriptor commit from the final file.
    watcher.emit('change', routeFile);
    watcher.emit('change', routeFile);
    watcher.emit('change', routeFile);

    await waitFor(() => sent.length === 1, 'debounced descriptor rescan');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assertEquals(sent.length, 1);
    const entryAfter = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    assertStringIncludes(entryAfter, 'import.meta.env.DEV && true');
    assertEquals(invalidated.includes(RESOLVED_ENTRY_ID), true);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
