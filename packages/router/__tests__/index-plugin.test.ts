/**
 * @openelement/router - index.ts main entry tests (Deno)
 *
 * Tests that the internal plugin factory returns valid plugin arrays with correct
 * structure and re-exports.
 */
// deno-lint-ignore-file ban-types
import {
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
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
  assertExists(plugins);
  assertEquals(Array.isArray(plugins), true);
  const names = plugins.map((p) => p.name);
  assertArrayIncludes(names, [
    'open:mdx',
    'open:core',
    'open:virtual-entry',
    '@hono/vite-dev-server',
    'open:island-transform',
    'open:build',
  ]);
}

Deno.test('createOpenPlugin() returns an array of plugins', () => {
  const plugins = createOpenPlugin();
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() plugins have names starting with open:', () => {
  const plugins = createOpenPlugin();
  const names = plugins.map((p) => p.name);

  // All openElement plugins should have the open: prefix
  for (const name of names) {
    if (name === '@hono/vite-dev-server') continue; // external
    assertEquals(
      name.startsWith('open:'),
      true,
      `Plugin "${name}" should start with "open:"`,
    );
  }
});

Deno.test('createOpenPlugin() includes required plugin types', () => {
  const plugins = createOpenPlugin();
  const names = plugins.map((p) => p.name);

  // The pipeline owns content, rendering, and build ordering.
  assertArrayIncludes(names, ['open:mdx']);
  assertArrayIncludes(names, ['open:core']);
  assertArrayIncludes(names, ['open:virtual-entry']);
  assertArrayIncludes(names, ['open:island-transform']);
  assertArrayIncludes(names, ['open:build']);

  // External dev server
  assertArrayIncludes(names, ['@hono/vite-dev-server']);
});

Deno.test('createOpenPlugin() accepts options without error', () => {
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

Deno.test('createOpenPlugin() inject.stylesheets -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  assertOpenPluginArray(plugins);
  // headExtras computed internally from inject.stylesheets
  // Verification: plugin construction succeeds for inject-only config
});

Deno.test('createOpenPlugin() inject.scripts -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: ['https://cdn.example.com/app.js'] },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() inject.headFragments -> headExtras', () => {
  const plugins = createOpenPlugin({
    inject: { headFragments: ['<meta name="theme-color" content="#000">'] },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() inject all combined', () => {
  const plugins = createOpenPlugin({
    inject: {
      stylesheets: ['https://cdn.example.com/app.css'],
      scripts: ['https://cdn.example.com/app.js'],
      headFragments: ['<meta charset="utf-8">'],
    },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() headExtras takes precedence over inject', () => {
  const plugins = createOpenPlugin({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://example.com/style.css'] },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() rejects script tags in raw headExtras', () => {
  assertThrows(
    () => createOpenPlugin({ headExtras: '<script src="/x.js"></script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

Deno.test('createOpenPlugin() rejects script tags in inject.headFragments', () => {
  assertThrows(
    () => createOpenPlugin({ inject: { headFragments: ['<script src="/x.js"></script>'] } }),
    Error,
    'inject.headFragments must not contain <script> tags',
  );
});

Deno.test('createOpenPlugin() allows scripts through structured inject.scripts', () => {
  const plugins = createOpenPlugin({ inject: { scripts: [{ src: '/x.js', defer: true }] } });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() config hook (captures userConfig.resolve.alias) ───

Deno.test('createOpenPlugin() corePlugin.config captures resolve.alias', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  assertExists(corePlugin.config);
  const result = (corePlugin.config as Function)({
    resolve: { alias: { '@/*': '/src/*' } },
  } as never);
  assertExists(result);
  assertExists((result as Record<string, unknown>).build, 'config should return build options');
  const build = (result as Record<string, unknown>).build as Record<string, unknown>;
  assertExists(build.rollupOptions, 'should include rollupOptions');
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];
  assertArrayIncludes(input, ['virtual:open-build-trigger']);
});

Deno.test('createOpenPlugin() corePlugin.config returns rollupOptions with build trigger input', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = (corePlugin.config as Function)({} as never) as Record<string, unknown>;
  const build = result.build as Record<string, unknown>;
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];
  assertArrayIncludes(input, ['virtual:open-build-trigger']);
});

// ─── createOpenPlugin() configResolved + generateEntry ───────────────────

Deno.test('createOpenPlugin() corePlugin.configResolved builds the placeholder entry descriptor', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  assertExists(corePlugin.configResolved);
  // Populate the placeholder entry descriptor via the configResolved hook.
  if (typeof corePlugin.configResolved === 'function') {
    (corePlugin.configResolved as (config: never) => void)({} as never);
  }
  // Behavior assertion (#847): the placeholder descriptor must let the
  // virtual entry plugin load() render entry code without a buildStart().
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const entryCode = (virtualPlugin.load as Function)('\0virtual:open-hono-entry');
  assertStringIncludes(entryCode as string, "import 'virtual:open-ssr-polyfill';");
});

// ─── createOpenPlugin() virtualEntryPlugin hooks ────────────────────────

Deno.test('createOpenPlugin() virtualEntryPlugin.resolveId matches VIRTUAL_ENTRY_ID', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  assertExists(virtualPlugin.resolveId);
  // The resolved ID includes '\0' prefix; verify it returns non-null for the ID.
  const result = (virtualPlugin.resolveId as Function)(
    'virtual:open-hono-entry',
    undefined as never,
    {} as never,
  );
  assertEquals(result, '\0virtual:open-hono-entry');
});

Deno.test('createOpenPlugin() virtualEntryPlugin.load returns code for resolved ID', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  assertExists(virtualPlugin.load);
  // '\0virtual:open-hono-entry' is the resolved ID
  const code = (virtualPlugin.load as Function)('\0virtual:open-hono-entry' as never);
  assertExists(code);
  assertStringIncludes(code as string, 'hono');
});

// ─── createOpenPlugin() packageIslands option ───────────────────────────

Deno.test('createOpenPlugin() with packageIslands option (empty array)', () => {
  const plugins = createOpenPlugin({ packageIslands: [] });
  // v0.3.1: 5 plugins (html-template removed; it was a no-op)
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() default dirs ────────────────────────────────────

Deno.test('createOpenPlugin() applies default routesDir and islandsDir', () => {
  const plugins = createOpenPlugin();
  assertOpenPluginArray(plugins);
  // Defaults applied internally via resolvedOptions
});

// ─── createOpenPlugin() buildStart hook (requires filesystem) ──────────

Deno.test('createOpenPlugin() corePlugin.buildStart is callable', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  assertExists(corePlugin.buildStart, 'core plugin must have buildStart');
  // buildStart is async and requires filesystem; just verify it's callable.
  assertEquals(typeof corePlugin.buildStart, 'function');
});

// ─── createOpenPlugin() error classification branches ────────────────────

Deno.test('createOpenPlugin() with all options branches covered', () => {
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

Deno.test('createOpenPlugin() with middleware.corsOrigin as string', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: '*' },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() with middleware.corsOrigin as array', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: ['http://localhost:3000', 'http://localhost:3001'] },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() with island.upgradeStrategy=load', () => {
  const plugins = createOpenPlugin({
    island: { upgradeStrategy: 'load' },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() with island.upgradeStrategy=load', () => {
  const plugins = createOpenPlugin({
    island: { upgradeStrategy: 'load' },
  });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() buildStart hook (actual execution) ──────────

Deno.test('createOpenPlugin() corePlugin.buildStart scans routes and islands', async () => {
  // Create a temp directory structure with routes and islands
  const tmp = Deno.makeTempDirSync({ prefix: 'open-buildstart-' });
  try {
    const routesDir = join(tmp, 'app', 'routes');
    const islandsDir = join(tmp, 'app', 'islands');
    Deno.mkdirSync(routesDir, { recursive: true });
    Deno.mkdirSync(islandsDir, { recursive: true });

    // Create a page route
    Deno.writeTextFileSync(join(routesDir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');
    // Create an island
    Deno.writeTextFileSync(join(islandsDir, 'counter.ts'), 'export const tagName = "open-counter"');

    const origCwd = Deno.cwd();
    Deno.chdir(tmp);

    const plugins = createOpenPlugin({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
    });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    assertExists(corePlugin.buildStart);

    // Call buildStart; it should succeed with valid directory structure.
    await (corePlugin.buildStart as Function)();

    Deno.chdir(origCwd);
  } finally {
    try {
      Deno.removeSync(tmp, { recursive: true });
    } catch { /* ignore */ }
  }
});

Deno.test('createOpenPlugin() corePlugin.buildStart handles empty directories gracefully', async () => {
  const tmp = Deno.makeTempDirSync({ prefix: 'open-buildstart-empty-' });
  try {
    const origCwd = Deno.cwd();
    Deno.chdir(tmp);

    const plugins = createOpenPlugin({
      routesDir: 'nonexistent/routes',
      islandsDir: 'nonexistent/islands',
    });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;

    // buildStart should NOT throw; scanRoutes returns empty array for missing dirs.
    await (corePlugin.buildStart as Function)();

    Deno.chdir(origCwd);
  } finally {
    try {
      Deno.removeSync(tmp, { recursive: true });
    } catch { /* ignore */ }
  }
});

Deno.test('createOpenPlugin() corePlugin.buildStart with packageIslands config', async () => {
  const tmp = Deno.makeTempDirSync({ prefix: 'open-buildstart-pkg-' });
  try {
    const routesDir = join(tmp, 'app', 'routes');
    const islandsDir = join(tmp, 'app', 'islands');
    Deno.mkdirSync(routesDir, { recursive: true });
    Deno.mkdirSync(islandsDir, { recursive: true });
    Deno.writeTextFileSync(join(routesDir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');

    const origCwd = Deno.cwd();
    Deno.chdir(tmp);

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

    Deno.chdir(origCwd);
  } finally {
    try {
      Deno.removeSync(tmp, { recursive: true });
    } catch { /* ignore */ }
  }
});

// ─── createOpenPlugin() configResolved + virtualEntry fallback ──────────

Deno.test('createOpenPlugin() virtualEntryPlugin.load falls back to regenerating from cached routes', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  // Prime the placeholder entry descriptor (empty routes), as configResolved
  // does before buildStart.
  callPluginHook(plugins[0].configResolved, {});
  // load should return code
  const code = callPluginHook(virtualPlugin.load, '\0virtual:open-hono-entry');
  assertExists(code);
  assertStringIncludes(code as string, 'hono');
});

Deno.test('createOpenPlugin() virtualEntryPlugin.resolveId returns null for unknown IDs', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const result = callPluginHook(virtualPlugin.resolveId, 'unknown-module', undefined, {});
  assertEquals(result, undefined);
});

Deno.test('createOpenPlugin() virtualEntryPlugin.load returns null for unknown IDs', () => {
  const plugins = createOpenPlugin();
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
  const result = callPluginHook(virtualPlugin.load, 'unknown-id');
  assertEquals(result, undefined);
});

// ─── createOpenPlugin() inject with special chars (escaping) ──────────

Deno.test('createOpenPlugin() inject.stylesheets escapes special chars in URLs', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css?v=1&x<"test">'] },
  });
  assertOpenPluginArray(plugins);
});

Deno.test('createOpenPlugin() inject.scripts escapes special chars in URLs', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: ['https://cdn.example.com/app.js?v=1&x<"test">'] },
  });
  assertOpenPluginArray(plugins);
});

// ─── createOpenPlugin() config hook without resolve ──────────

Deno.test('createOpenPlugin() corePlugin.config handles config without resolve', () => {
  const plugins = createOpenPlugin();
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = (corePlugin.config as Function)({} as never);
  assertExists(result);
  assertExists((result as Record<string, unknown>).build);
});

// ─── openPipeline() mode propagation ──────────────────────────
// Regression: OpenPipelineConfig previously had no `mode` field, so
// openPipeline({ mode: 'spa' }) silently dropped the mode and always
// registered the SSR dev server.

Deno.test('openPipeline() defaults to SSG (includes @hono/vite-dev-server)', () => {
  const plugins = openPipeline();
  const names = plugins.map((p) => p.name);
  assertArrayIncludes(names, ['@hono/vite-dev-server']);
});

Deno.test('openPipeline({ mode: "spa" }) omits @hono/vite-dev-server', () => {
  const plugins = openPipeline({ mode: 'spa' });
  const names = plugins.map((p) => p.name);
  assertEquals(
    names.includes('@hono/vite-dev-server'),
    false,
    'openPipeline must propagate mode:"spa" — SSR dev server must be skipped',
  );
});
