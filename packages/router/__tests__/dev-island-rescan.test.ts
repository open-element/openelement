/**
 * plugin.ts: dev island rescan (#1062).
 *
 * Island scanning used to happen only in buildStart(); an island file added
 * or removed while the dev server ran never reached the cached descriptor
 * (SSR admission plan) or the dev island client map — the page rendered DSD
 * but the island never hydrated, with no hint why. The core plugin's dev
 * watcher must re-scan the islands dir, rebuild the cached entry descriptor,
 * invalidate BOTH the virtual SSR entry and the virtual island client entry,
 * and full-reload (same chain as the route rescan, #1028).
 *
 * The plugin resolves islandsDir against the process cwd (buildStart) — the
 * dev command runs from the app root — so the tests chdir into the
 * fixture dir and pass relative dir names.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import { createOpenPlugin } from '../src/vite/plugin.ts';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';
import { TestFileWatcher } from './test-watcher.ts';

const RESOLVED_ENTRY_ID = '\0virtual:open-hono-entry';
const RESOLVED_CLIENT_ENTRY_ID = '\0virtual:open-client-entry';

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
export const tagName = 'test-index-page';
export default definePage({
  render() { return null; },
});
`;

const FIRST_ISLAND = `export default class FirstIsland extends HTMLElement {}
`;

const COUNTER_ISLAND = `export default class MyCounter extends HTMLElement {}
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

test('openPlugin: island file added during dev triggers descriptor + client map rescan (#1062)', async () => {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'oe-island-rescan-')));
  const previousCwd = process.cwd();
  try {
    const routesDir = join(dir, 'routes');
    const islandsDir = join(dir, 'islands');
    await mkdir(routesDir, { recursive: true });
    await mkdir(islandsDir, { recursive: true });
    await writeFile(join(routesDir, 'index.tsx'), INDEX_ROUTE);
    await writeFile(join(islandsDir, 'first-island.ts'), FIRST_ISLAND);
    process.chdir(dir);

    const ctx = new OpenElementBuildContext({ routesDir: 'routes', islandsDir: 'islands' });
    const plugins = createOpenPlugin(
      { routesDir: 'routes', islandsDir: 'islands' },
      ctx,
    ) as Hooked[];
    const byName = (name: string) => plugins.find((p) => (p as { name?: string }).name === name)!;
    const core = byName('open:core');
    const virtualEntry = byName('open:virtual-entry');
    const devIslandClient = byName('open:dev-island-client');

    await core.buildStart!();

    expect(ctx.phase1.islandTagNames).toEqual(['first-island']);
    const entryBefore = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    expect(entryBefore).toContain('first-island');
    expect(entryBefore.includes('my-counter')).toEqual(false);

    const watcher = new TestFileWatcher();
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

    // A new island file appears while dev is running.
    await writeFile(join(islandsDir, 'my-counter.ts'), COUNTER_ISLAND);
    watcher.emit('add', join(islandsDir, 'my-counter.ts'));

    await waitFor(() => sent.length === 1, 'full-reload after island rescan');
    expect(sent[0]).toEqual({ type: 'full-reload' });
    // Both virtual entries must be invalidated: the SSR entry carries the
    // island map/admission plan, the client entry the hydration map.
    expect(invalidated).toEqual([RESOLVED_ENTRY_ID, RESOLVED_CLIENT_ENTRY_ID]);

    // The rescan reached the descriptor inputs (SSR admission plan source)
    // and both rendered entries.
    expect(ctx.phase1.islandTagNames).toEqual(['first-island', 'my-counter']);
    expect(ctx.phase1.ssrAdmissionPlan, 'SSR admission plan must be rebuilt').toBeTruthy();
    expect(ctx.phase1.ssrAdmissionPlan.renderableTags.join(',')).toContain('my-counter');
    const entryAfter = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    expect(entryAfter).toContain('my-counter');
    const clientAfter = String(devIslandClient.load!(RESOLVED_CLIENT_ENTRY_ID));
    expect(clientAfter).toContain('my-counter');

    // Removing the island re-scans back down.
    await rm(join(islandsDir, 'my-counter.ts'));
    watcher.emit('unlink', join(islandsDir, 'my-counter.ts'));
    await waitFor(() => sent.length === 2, 'full-reload after island removal');
    expect(ctx.phase1.islandTagNames).toEqual(['first-island']);
    const entryFinal = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
    expect(entryFinal.includes('my-counter')).toEqual(false);
    const clientFinal = String(devIslandClient.load!(RESOLVED_CLIENT_ENTRY_ID));
    expect(clientFinal.includes('my-counter')).toEqual(false);
  } finally {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('openPlugin: dev watcher ignores non-island files outside islandsDir (#1062)', async () => {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'oe-island-rescan-guard-')));
  const previousCwd = process.cwd();
  try {
    const routesDir = join(dir, 'routes');
    const islandsDir = join(dir, 'islands');
    await mkdir(routesDir, { recursive: true });
    await mkdir(islandsDir, { recursive: true });
    await writeFile(join(routesDir, 'index.tsx'), INDEX_ROUTE);
    await writeFile(join(islandsDir, 'first-island.ts'), FIRST_ISLAND);
    process.chdir(dir);

    const plugins = createOpenPlugin({ routesDir: 'routes', islandsDir: 'islands' }) as Hooked[];
    const core = plugins.find((p) => (p as { name?: string }).name === 'open:core')!;
    await core.buildStart!();

    const watcher = new TestFileWatcher();
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

    watcher.emit('add', join(dir, 'elsewhere.ts')); // outside routesDir and islandsDir
    watcher.emit('add', join(islandsDir, 'notes.md')); // not an island extension
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toEqual(0);
  } finally {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
