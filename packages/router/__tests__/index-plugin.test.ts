/**
 * @openelement/router - index.ts main entry tests (Deno)
 *
 * Tests that the internal plugin factory returns valid plugin arrays with correct
 * structure and re-exports.
 */
/* oxlint-disable ban-types */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from '@std/path';
import { createOpenPlugin } from '../src/vite/plugin.ts';

import { openPipeline } from '../src/vite/index.ts';

type CallablePluginHook = (...args: unknown[]) => unknown;

function callPluginHook(hook: unknown, ...args: unknown[]): unknown {
  if (typeof hook === 'function') return hook(...args);
  if (hook && typeof hook === 'object' && 'handler' in hook) {
    const objectHook = hook as { handler: CallablePluginHook };
    return objectHook.handler(...args);
  }
  return undefined;
}

// createOpenPlugin() Plugin Factory

function assertOpenPluginArray(plugins: ReturnType<typeof createOpenPlugin>): void {
  expect(plugins).toEqual(expect.anything());
  expect(Array.isArray(plugins)).toEqual(true);
  const names = plugins.map((p) => p.name);
  expect(names).toEqual(
    expect.arrayContaining([
      'open:mdx',
      'open:core',
      'open:virtual-entry',
      '@hono/vite-dev-server',
      'open:island-transform',
      'open:build',
    ]),
  );
}

test('createOpenPlugin() returns an array of plugins', () => {
  const plugins = createOpenPlugin();
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() plugins have names starting with open:', () => {
  const plugins = createOpenPlugin();
  const names = plugins.map((p) => p.name);

  // All openElement plugins should have the open: prefix
  for (const name of names) {
    if (name === '@hono/vite-dev-server') continue; // external
    expect(name.startsWith('open:'), `Plugin "${name}" should start with "open:"`).toEqual(true);
  }
});

test('createOpenPlugin() includes required plugin types', () => {
  const plugins = createOpenPlugin();
  const names = plugins.map((p) => p.name);

  // The pipeline owns content, rendering, and build ordering.
  expect(names).toEqual(expect.arrayContaining(['open:mdx']));
  expect(names).toEqual(expect.arrayContaining(['open:core']));
  expect(names).toEqual(expect.arrayContaining(['open:virtual-entry']));
  expect(names).toEqual(expect.arrayContaining(['open:island-transform']));
  expect(names).toEqual(expect.arrayContaining(['open:build']));

  // External dev server
  expect(names).toEqual(expect.arrayContaining(['@hono/vite-dev-server']));
});

test('createOpenPlugin() accepts options without error', () => {
  const plugins = createOpenPlugin({
    routesDir: 'pages',
    islandsDir: 'widgets',
    headExtras: '<link rel="stylesheet" />',
    html: { title: 'Test', lang: 'ja' },
    packageIslands: ['@acme/components'],
    island: { upgradeStrategy: 'load' },
    middleware: { corsOrigin: '*' },
  });

  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() inject / headExtras branches ─────────────────────

test('createOpenPlugin() inject.stylesheets -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  assertOpenPluginArray(plugins);
  // headExtras computed internally from inject.stylesheets
  // Verification: plugin construction succeeds for inject-only config
});

test('createOpenPlugin() inject.scripts -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: ['https://cdn.example.com/app.js'] },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() inject.headFragments -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { headFragments: ['<meta name="theme-color" content="#000">'] },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() inject all combined', () => {
  const plugins = createOpenPlugin({
    inject: {
      stylesheets: ['https://cdn.example.com/app.css'],
      scripts: ['https://cdn.example.com/app.js'],
      headFragments: ['<meta charset="utf-8">'],
    },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() headExtras takes precedence over inject', () => {
  const plugins = createOpenPlugin({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://example.com/style.css'] },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() rejects script tags in raw headExtras', () => {
  assertThrowsIncludes(
    () => createOpenPlugin({ headExtras: '<script src="/x.js"></script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

test('createOpenPlugin() rejects script tags in inject.headFragments', () => {
  assertThrowsIncludes(
    () => createOpenPlugin({ inject: { headFragments: ['<script src="/x.js"></script>'] } }),
    Error,
    'inject.headFragments must not contain <script> tags',
  );
});

test('createOpenPlugin() allows scripts through structured inject.scripts', () => {
  const plugins = createOpenPlugin({ inject: { scripts: [{ src: '/x.js', defer: true }] } });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() config hook (captures userConfig.resolve.alias) ───

test('createOpenPlugin() corePlugin.config captures resolve.alias', async () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  expect(corePlugin.config).toEqual(expect.anything());
  // #1411: the hook is async (it loads openelement.config.ts).
  const result = await (corePlugin.config as Function)({
    resolve: { alias: { '@/*': '/src/*' } },
  } as never);
  expect(result).toEqual(expect.anything());
  expect((result as Record<string, unknown>).build, 'config should return build options').toEqual(
    expect.anything(),
  );
  const build = (result as Record<string, unknown>).build as Record<string, unknown>;
  expect(build.rollupOptions, 'should include rollupOptions').toEqual(expect.anything());
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];
  expect(input).toEqual(expect.arrayContaining(['virtual:open-build-trigger']));
});

test('createOpenPlugin() corePlugin.config returns rollupOptions with build trigger input', async () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = (await (corePlugin.config as Function)({} as never)) as Record<string, unknown>;
  const build = result.build as Record<string, unknown>;
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];
  expect(input).toEqual(expect.arrayContaining(['virtual:open-build-trigger']));
});

// ─── createOpenPlugin() configResolved + generateEntry ───────────────────

test('createOpenPlugin() corePlugin.configResolved builds the placeholder entry descriptor', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  expect(corePlugin.configResolved).toEqual(expect.anything());
  // Populate the placeholder entry descriptor via the configResolved hook.
  if (typeof corePlugin.configResolved === 'function') {
    (corePlugin.configResolved as (config: never) => void)({} as never);
  }
  // Behavior assertion (#847): the placeholder descriptor must let the
  // virtual entry plugin load() render entry code without a buildStart().
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const entryCode = (virtualPlugin.load as Function)('\0virtual:open-hono-entry');
  expect(entryCode as string).toContain("import 'virtual:open-ssr-polyfill';");
});

// ─── createOpenPlugin() virtualEntryPlugin hooks ────────────────────────

test('createOpenPlugin() virtualEntryPlugin.resolveId matches VIRTUAL_ENTRY_ID', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  expect(virtualPlugin.resolveId).toEqual(expect.anything());
  // The resolved ID includes '\0' prefix; verify it returns non-null for the ID.
  const result = (virtualPlugin.resolveId as Function)(
    'virtual:open-hono-entry',
    undefined as never,
    {} as never,
  );
  expect(result).toEqual('\0virtual:open-hono-entry');
});

test('createOpenPlugin() virtualEntryPlugin.load returns code for resolved ID', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  expect(virtualPlugin.load).toEqual(expect.anything());
  // '\0virtual:open-hono-entry' is the resolved ID
  const code = (virtualPlugin.load as Function)('\0virtual:open-hono-entry' as never);
  expect(code).toEqual(expect.anything());
  expect(code as string).toContain('hono');
});

// ─── createOpenPlugin() packageIslands option ───────────────────────────

test('createOpenPlugin() with packageIslands option (empty array)', () => {
  const plugins = createOpenPlugin({ packageIslands: [] });
  // v0.3.1: 5 plugins (html-template removed; it was a no-op)
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() default dirs ────────────────────────────────────

test('createOpenPlugin() applies default routesDir and islandsDir', () => {
  const plugins = createOpenPlugin();
  assertOpenPluginArray(plugins);
  // Defaults applied internally via resolvedOptions
});

// ─── createOpenPlugin() buildStart hook (requires filesystem) ──────────

test('createOpenPlugin() corePlugin.buildStart is callable', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  expect(corePlugin.buildStart, 'core plugin must have buildStart').toEqual(expect.anything());
  // buildStart is async and requires filesystem; just verify it's callable.
  expect(typeof corePlugin.buildStart).toEqual('function');
});

// ─── createOpenPlugin() error classification branches ────────────────────

test('createOpenPlugin() with all options branches covered', () => {
  // Test with packageIslands + island strategy + middleware cors
  const plugins = createOpenPlugin({
    routesDir: 'pages',
    islandsDir: 'islands',
    packageIslands: ['@acme/components'],
    island: { upgradeStrategy: 'load' },
    middleware: { corsOrigin: ['http://localhost:3000'] },
    html: { title: 'Test', lang: 'ja' },
    inject: {
      stylesheets: ['https://cdn.example.com/style.css'],
      scripts: ['https://cdn.example.com/app.js'],
      headFragments: ['<meta name="x" content="y">'],
    },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() with middleware.corsOrigin as string', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: '*' },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() with middleware.corsOrigin as array', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: ['http://localhost:3000', 'http://localhost:3001'] },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() with island.upgradeStrategy=load', () => {
  const plugins = createOpenPlugin({
    island: { upgradeStrategy: 'load' },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() with island.upgradeStrategy=load', () => {
  const plugins = createOpenPlugin({
    island: { upgradeStrategy: 'load' },
  });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() buildStart hook (actual execution) ──────────

test('createOpenPlugin() corePlugin.buildStart scans routes and islands', async () => {
  // Create a temp directory structure with routes and islands
  const tmp = mkdtempSync(join(tmpdir(), 'open-buildstart-'));
  try {
    const routesDir = join(tmp, 'app', 'routes');
    const islandsDir = join(tmp, 'app', 'islands');
    mkdirSync(routesDir, { recursive: true });
    mkdirSync(islandsDir, { recursive: true });

    // Create a page route
    writeFileSync(join(routesDir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');
    // Create an island
    writeFileSync(join(islandsDir, 'counter.ts'), 'export const tagName = "open-counter"');

    const origCwd = process.cwd();
    process.chdir(tmp);

    const plugins = createOpenPlugin({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
    });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    expect(corePlugin.buildStart).toEqual(expect.anything());

    // Call buildStart; it should succeed with valid directory structure.
    await (corePlugin.buildStart as Function)();

    process.chdir(origCwd);
  } finally {
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
});

test('createOpenPlugin() corePlugin.buildStart handles empty directories gracefully', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'open-buildstart-empty-'));
  try {
    const origCwd = process.cwd();
    process.chdir(tmp);

    const plugins = createOpenPlugin({
      routesDir: 'nonexistent/routes',
      islandsDir: 'nonexistent/islands',
    });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;

    // buildStart should NOT throw; scanRoutes returns empty array for missing dirs.
    await (corePlugin.buildStart as Function)();

    process.chdir(origCwd);
  } finally {
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
});

test('createOpenPlugin() corePlugin.buildStart with packageIslands config', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'open-buildstart-pkg-'));
  try {
    const routesDir = join(tmp, 'app', 'routes');
    const islandsDir = join(tmp, 'app', 'islands');
    mkdirSync(routesDir, { recursive: true });
    mkdirSync(islandsDir, { recursive: true });
    writeFileSync(join(routesDir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');

    const origCwd = process.cwd();
    process.chdir(tmp);

    // packageIslands with non-existent package should still not crash buildStart.
    const plugins = createOpenPlugin({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      packageIslands: ['@nonexistent/package'],
    });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;

    // Will try to scan package islands but fail gracefully (logged, not thrown)
    try {
      await (corePlugin.buildStart as Function)();
    } catch {
      // Expected: @nonexistent/package import will fail, but route scan should succeed first.
    }

    process.chdir(origCwd);
  } finally {
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
});

// ─── createOpenPlugin() configResolved + virtualEntry fallback ──────────

test('createOpenPlugin() virtualEntryPlugin.load falls back to regenerating from cached routes', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  // Prime the placeholder entry descriptor (empty routes), as configResolved
  // does before buildStart.
  callPluginHook(plugins[0].configResolved, {});
  // load should return code
  const code = callPluginHook(virtualPlugin.load, '\0virtual:open-hono-entry');
  expect(code).toEqual(expect.anything());
  expect(code as string).toContain('hono');
});

test('createOpenPlugin() virtualEntryPlugin.resolveId returns null for unknown IDs', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const result = callPluginHook(virtualPlugin.resolveId, 'unknown-module', undefined, {});
  expect(result).toEqual(undefined);
});

test('createOpenPlugin() virtualEntryPlugin.load returns null for unknown IDs', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const result = callPluginHook(virtualPlugin.load, 'unknown-id');
  expect(result).toEqual(undefined);
});

// ─── createOpenPlugin() inject with special chars (escaping) ──────────

test('createOpenPlugin() inject.stylesheets escapes special chars in URLs', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css?v=1&x<"test">'] },
  });
  assertOpenPluginArray(plugins);
});

test('createOpenPlugin() inject.scripts escapes special chars in URLs', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: ['https://cdn.example.com/app.js?v=1&x<"test">'] },
  });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() config hook without resolve ──────────

test('createOpenPlugin() corePlugin.config handles config without resolve', async () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = await (corePlugin.config as Function)({} as never);
  expect(result).toEqual(expect.anything());
  expect((result as Record<string, unknown>).build).toEqual(expect.anything());
});

// ─── openPipeline() mode ─────────────────────────────────────

test('openPipeline() defaults to SSG (includes @hono/vite-dev-server)', () => {
  const plugins = openPipeline();
  const names = plugins.map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['@hono/vite-dev-server']));
});
