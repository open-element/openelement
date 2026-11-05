/**
 * Dev watcher shutdown (item 14): one idempotent cleanup serves normal and
 * middleware-mode Vite servers. A close must clear the debounce timer, stop a
 * rescan that is already queued/executing before it invalidates modules or
 * sends a reload, and leave the shared watch directories alone.
 *
 * Restart reuse (22-item re-review): Vite reuses one plugin instance across a
 * restart and runs the replacement server's `configureServer` BEFORE the
 * outgoing server's `closeBundle`. Disposal is keyed by server identity, so an
 * outgoing close must not collect the replacement's listeners — and a close
 * landing while the initial package scan still awaits must install nothing on
 * that server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { TestFileWatcher } from './test-watcher.ts';

const rescanMocks = vi.hoisted(() => ({
  rescanRoutes: vi.fn<(state: unknown) => Promise<void>>(async () => {}),
  rescanIslands: vi.fn<(state: unknown) => Promise<void>>(async () => {}),
}));

vi.mock('../src/vite/plugin-scanners.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vite/plugin-scanners.ts')>();
  return {
    ...actual,
    rescanRoutes: rescanMocks.rescanRoutes,
    rescanIslands: rescanMocks.rescanIslands,
  };
});

const { createOpenPlugin } = await import('../src/vite/plugin.ts');

const INDEX_ROUTE = `import { definePage } from '@openelement/router';
export const tagName = 'test-index-page';
export default definePage({
  render() { return null; },
});
`;

type Hooked = {
  buildStart?: () => Promise<void>;
  configureServer?: (server: unknown) => Promise<void>;
  closeBundle?: () => void;
};

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test watcher with chokidar's synchronous `closed` flag. Vite's real
 * `server.close()` flips it before `closeBundle` runs, so the fake servers
 * model that order explicitly. Tests that pass a plain `TestFileWatcher`
 * model Vite's flag-less `NoopWatcher` instead.
 */
class FakeWatcher extends TestFileWatcher {
  closed = false;
  /** Watch paths this hook family added. */
  readonly added: string[] = [];

  override add(path: string): void {
    this.added.push(path);
  }
}

interface FakeServerHandle<W extends TestFileWatcher = FakeWatcher> {
  server: unknown;
  watcher: W;
  sent: unknown[];
  invalidated: string[];
}

/** One fake Vite server; `normal` mirrors the HTTP-server shape, `middleware` the null shape. */
function createFakeServer<W extends TestFileWatcher>(
  dir: string,
  watcher: W,
  sent: unknown[],
  invalidated: string[],
  normal: boolean,
): FakeServerHandle<W> {
  return {
    server: {
      config: { root: dir },
      watcher,
      hot: { send: (payload: unknown) => sent.push(payload) },
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        getModulesByFile: () => new Set(),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      httpServer: normal ? { on: () => {}, off: () => {} } : null,
      pluginContainer: { resolveId: () => Promise.resolve(null) },
    },
    watcher,
    sent,
    invalidated,
  };
}

async function createHarness(dir: string) {
  const routesDir = join(dir, 'routes');
  await mkdir(routesDir, { recursive: true });
  await writeFile(join(routesDir, 'index.tsx'), INDEX_ROUTE);
  const plugins = createOpenPlugin({ routesDir }) as Hooked[];
  const core = plugins.find((plugin) => (plugin as { name?: string }).name === 'open:core')!;
  await core.buildStart!();

  /** Configure one more server on the SAME plugin instance (a Vite restart). */
  const addServer = async (normal = false): Promise<FakeServerHandle> => {
    const watcher = new FakeWatcher();
    const handle = createFakeServer(dir, watcher, [], [], normal);
    await core.configureServer!(handle.server);
    rescanMocks.rescanRoutes.mockClear();
    rescanMocks.rescanIslands.mockClear();
    return handle;
  };

  return { core, routesDir, addServer };
}

async function configuredPlugin(dir: string, normal: boolean) {
  const { core, routesDir, addServer } = await createHarness(dir);
  const handle = await addServer(normal);
  return { core, routesDir, ...handle };
}

test('normal and middleware server shapes share the closeBundle cleanup, idempotently', async () => {
  for (const normal of [true, false]) {
    const dir = await mkdtemp(join(tmpdir(), 'oe-watch-cleanup-'));
    try {
      const { core, routesDir, watcher, sent, invalidated } = await configuredPlugin(dir, normal);

      // A debounce is pending when the server closes: it must never run.
      watcher.emit('change', join(routesDir, 'index.tsx'));
      // The change listener also invalidates the SSR entry synchronously; only
      // what happens AFTER close is the contract under test.
      invalidated.length = 0;
      sent.length = 0;
      // Vite's order: watcher.close() flips `closed` before closeBundle.
      watcher.closed = true;
      core.closeBundle!();
      core.closeBundle!();
      await wait(60);
      expect(
        rescanMocks.rescanRoutes,
        `normal=${normal}: pending debounce stopped`,
      ).not.toHaveBeenCalled();
      expect(sent, `normal=${normal}: no reload after close`).toEqual([]);
      expect(invalidated, `normal=${normal}: no module invalidation after close`).toEqual([]);

      // Listeners were removed, not the shared watch paths.
      watcher.emit('change', join(routesDir, 'index.tsx'));
      await wait(40);
      expect(
        rescanMocks.rescanRoutes,
        `normal=${normal}: closed watcher ignores edits`,
      ).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true }).catch(() => {});
    }
  }
});

test('an executing rescan stops before invalidation and reload once the server closes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-watch-inflight-'));
  try {
    const { core, routesDir, watcher, sent, invalidated } = await configuredPlugin(dir, false);
    const gate = Promise.withResolvers<void>();
    rescanMocks.rescanRoutes.mockImplementationOnce(async () => {
      await gate.promise;
    });

    watcher.emit('change', join(routesDir, 'index.tsx'));
    // The synchronous SSR-entry invalidation is not the rescan under test.
    invalidated.length = 0;
    sent.length = 0;
    await wait(40); // debounce elapsed; the mock rescan is now awaiting its gate
    expect(rescanMocks.rescanRoutes).toHaveBeenCalledTimes(1);

    watcher.closed = true;
    core.closeBundle!();
    gate.resolve();
    await wait(30);

    expect(
      rescanMocks.rescanIslands,
      'the pass ends after the closed check',
    ).not.toHaveBeenCalled();
    expect(invalidated, 'no invalidation from a rescan that finished after close').toEqual([]);
    expect(sent, 'no reload from a rescan that finished after close').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('closeBundle leaves the shared route/island watch paths registered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-watch-shared-'));
  try {
    const { core, watcher } = await configuredPlugin(dir, false);
    const unwatch = vi.fn();
    Object.assign(watcher, { unwatch });
    watcher.closed = true;
    core.closeBundle!();
    expect(
      unwatch,
      'cleanup must not unwatch paths another plugin may share',
    ).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('a restart close disposes only the outgoing server, leaving the replacement listening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-watch-restart-'));
  try {
    const { core, routesDir, addServer } = await createHarness(dir);
    const outgoing = await addServer(false);
    // Vite restart order: the replacement server is created (configureServer)
    // BEFORE the outgoing server closes (closeBundle).
    const replacement = await addServer(false);

    // Vite close order: watcher.close() flips the flag, then closeBundle.
    outgoing.watcher.closed = true;
    core.closeBundle!();

    // The outgoing server is no longer wired to its watcher.
    rescanMocks.rescanRoutes.mockClear();
    outgoing.watcher.emit('change', join(routesDir, 'index.tsx'));
    await wait(40);
    expect(
      rescanMocks.rescanRoutes,
      'the outgoing server no longer responds',
    ).not.toHaveBeenCalled();

    // The replacement kept its listeners: the debounced rescan still runs.
    replacement.sent.length = 0;
    replacement.invalidated.length = 0;
    replacement.watcher.emit('change', join(routesDir, 'index.tsx'));
    await wait(60);
    expect(rescanMocks.rescanRoutes, 'the replacement server still rescans').toHaveBeenCalledTimes(
      1,
    );
    expect(replacement.sent, 'the replacement server still reloads').toEqual([
      { type: 'full-reload' },
    ]);
    expect(replacement.invalidated, 'the replacement server still invalidates').not.toEqual([]);

    // Closing the replacement disposes the rest; a second close is a no-op.
    replacement.watcher.closed = true;
    core.closeBundle!();
    core.closeBundle!();
    replacement.sent.length = 0;
    replacement.invalidated.length = 0;
    rescanMocks.rescanRoutes.mockClear();
    replacement.watcher.emit('change', join(routesDir, 'index.tsx'));
    await wait(40);
    expect(
      rescanMocks.rescanRoutes,
      'the replacement is cleaned on its own close',
    ).not.toHaveBeenCalled();
    expect(replacement.sent, 'no reload after the replacement closes').toEqual([]);
    expect(replacement.invalidated, 'no invalidation after the replacement closes').toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('a close during the initial package scan installs no listeners on that server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-watch-scan-window-'));
  try {
    const { core, routesDir } = await createHarness(dir);
    const watcher = new FakeWatcher();
    const sent: unknown[] = [];
    const invalidated: string[] = [];
    const server = createFakeServer(dir, watcher, sent, invalidated, false);
    rescanMocks.rescanRoutes.mockClear();
    rescanMocks.rescanIslands.mockClear();

    // Do not await: configureServer parks on the package-scan await AFTER
    // registering its placeholder, so this close lands inside that window.
    const configuring = core.configureServer!(server.server);
    watcher.closed = true;
    core.closeBundle!();
    await configuring;

    expect(watcher.added, 'no watch paths are added by a server closed mid-scan').toEqual([]);
    watcher.emit('change', join(routesDir, 'index.tsx'));
    await wait(40);
    expect(
      rescanMocks.rescanRoutes,
      'no listeners are installed for the closed server',
    ).not.toHaveBeenCalled();
    expect(sent, 'no reload from a server closed mid-scan').toEqual([]);
    expect(invalidated, 'no invalidation from a server closed mid-scan').toEqual([]);

    // The cancelled placeholder must not leave a stale registration behind.
    core.closeBundle!();
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('a flag-less watcher (NoopWatcher shape) keeps the conservative full cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-watch-noop-'));
  try {
    const { core, routesDir } = await createHarness(dir);
    const watcher = new TestFileWatcher();
    const sent: unknown[] = [];
    const invalidated: string[] = [];
    const server = createFakeServer(dir, watcher, sent, invalidated, false);
    await core.configureServer!(server.server);
    rescanMocks.rescanRoutes.mockClear();

    // No `closed` field: closeBundle cannot attribute the close to a server,
    // so it must fall back to disposing every registration (legacy behavior).
    core.closeBundle!();

    watcher.emit('change', join(routesDir, 'index.tsx'));
    await wait(40);
    expect(
      rescanMocks.rescanRoutes,
      'flag-less watcher cleanup still removes listeners',
    ).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(invalidated).toEqual([]);
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
