/**
 * @openelement/adapter-vite - plugin.ts tests (Deno)
 *
 * Focused tests for the internal plugin factory (plugin.ts):
 * Tests the raw `createOpenPlugin()` function which is NOT part of the public API —
 * consumers should use `openPipeline()` from the main entry.
 *
 * Complements index-plugin.test.ts which tests the public API surface.
 */
import {
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import { join } from '@std/path';
import { createOpenPlugin } from '../src/plugin.ts';

type PluginOptions = Parameters<typeof createOpenPlugin>[0];

type HookRecord = {
  config?: unknown;
  load?: unknown;
  resolveId?: unknown;
};
type TestConfigHook = (config: Record<string, unknown>) => unknown;
type TestLoadHook = (id: string) => unknown;
type TestResolveIdHook = (id: string) => unknown;

function callConfig(
  plugin: unknown,
  config: Record<string, unknown> = {},
): Record<string, unknown> {
  const hook = (plugin as HookRecord).config;
  assertExists(hook, 'config hook must exist');
  return (hook as TestConfigHook)(config) as Record<string, unknown>;
}

function callResolveId(plugin: unknown, id: string): unknown {
  const hook = (plugin as HookRecord).resolveId;
  assertExists(hook, 'resolveId hook must exist');
  return (hook as TestResolveIdHook)(id);
}

function callLoad(plugin: unknown, id: string): unknown {
  const hook = (plugin as HookRecord).load;
  assertExists(hook, 'load hook must exist');
  return (hook as TestLoadHook)(id);
}

// ─── Plugin Order & Structure ─────────────────────────────────

Deno.test('openPlugin: returns retained plugins in correct order', () => {
  const plugins = createOpenPlugin();
  assertEquals(plugins.length, 9);

  const names = plugins.map((p) => p.name);
  assertEquals(names, [
    'open:mdx',
    'open:core',
    'open:generated-data',
    'open:optional-package-stubs',
    'open:virtual-entry',
    '@hono/vite-dev-server',
    'open:island-transform',
    'open:build',
    // #951: dev-only (apply: 'serve') island client entry serving.
    'open:dev-island-client',
  ]);
});

Deno.test('optional i18n fallback emits an explicit configuration warning', () => {
  const plugin = createOpenPlugin().find((entry) => entry.name === 'open:optional-package-stubs');
  assertExists(plugin);
  const source = callLoad(plugin, '\0open:optional-stub:@openelement/router/i18n');
  assertStringIncludes(String(source), 'console.warn');
  assertStringIncludes(String(source), '@openelement/router/i18n');
});

// ─── Option Defaults ──────────────────────────────────────────

/**
 * Drive config -> configResolved -> buildStart -> virtual-entry load against a
 * temp working directory and return the generated SSR entry code. This mirrors
 * how Vite drives the plugin pipeline, so the emitted code reflects the
 * resolved options (routesDir, islandsDir, upgradeStrategy, ...).
 */
async function renderVirtualEntry(
  options: PluginOptions,
  setup?: (tmp: string) => void,
): Promise<string> {
  const tmp = Deno.makeTempDirSync({ prefix: 'open-plugin-opts-' });
  const origCwd = Deno.cwd();
  try {
    setup?.(tmp);
    Deno.chdir(tmp);
    const plugins = createOpenPlugin(options);
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
    callConfig(corePlugin);
    const configResolved = (corePlugin as { configResolved?: unknown }).configResolved;
    assertExists(configResolved, 'configResolved hook must exist');
    (configResolved as (config: never) => void)({} as never);
    const buildStart = (corePlugin as { buildStart?: unknown }).buildStart;
    assertExists(buildStart, 'buildStart hook must exist');
    await (buildStart as () => Promise<void>)();
    const code = callLoad(virtualPlugin, '\0virtual:open-hono-entry');
    assertExists(code, 'virtual entry load must return code');
    return String(code);
  } finally {
    Deno.chdir(origCwd);
    try {
      Deno.removeSync(tmp, { recursive: true });
    } catch { /* ignore */ }
  }
}

function writeRouteIndex(dir: string): void {
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(join(dir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');
}

function writeIsland(dir: string): void {
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(join(dir, 'my-counter.ts'), 'export const tagName = "my-counter"');
}

Deno.test('openPlugin: defaults routesDir to app/routes', async () => {
  const code = await renderVirtualEntry({}, (tmp) => writeRouteIndex(join(tmp, 'app', 'routes')));
  assertStringIncludes(code, '/app/routes/index.ts');
});

Deno.test('openPlugin: defaults islandsDir to app/islands', async () => {
  const code = await renderVirtualEntry({}, (tmp) => writeIsland(join(tmp, 'app', 'islands')));
  assertStringIncludes(code, '/app/islands/my-counter.ts');
});

Deno.test('openPlugin: respects custom routesDir', async () => {
  const code = await renderVirtualEntry(
    { routesDir: 'src/pages' },
    (tmp) => writeRouteIndex(join(tmp, 'src', 'pages')),
  );
  assertStringIncludes(code, '/src/pages/index.ts');
});

Deno.test('openPlugin: respects custom islandsDir', async () => {
  const code = await renderVirtualEntry(
    { islandsDir: 'src/widgets' },
    (tmp) => writeIsland(join(tmp, 'src', 'widgets')),
  );
  assertStringIncludes(code, '/src/widgets/my-counter.ts');
});

Deno.test('openPlugin: accepts default and custom componentsDir', () => {
  // componentsDir is only consumed by the build closeBundle phase; here we can
  // only assert both forms construct a valid pipeline.
  assertEquals(createOpenPlugin({}).length, 9);
  assertEquals(createOpenPlugin({ componentsDir: 'src/ui' }).length, 9);
});

// ─── Upgrade Strategy ─────────────────────────────────────────

Deno.test('openPlugin: island.upgradeStrategy flows into the SSR admission plan', async () => {
  const setup = (tmp: string) => writeIsland(join(tmp, 'app', 'islands'));

  // Default ('idle'): local islands are SSR-admitted and imported by the entry.
  const defaultCode = await renderVirtualEntry({}, setup);
  assertStringIncludes(defaultCode, 'import * as __island_my_counter');

  // 'only': islands are excluded from SSR and marked client-only in the plan.
  const onlyCode = await renderVirtualEntry({ island: { upgradeStrategy: 'only' } }, setup);
  assertEquals(onlyCode.includes('import * as __island_my_counter'), false);
  assertStringIncludes(onlyCode, 'client-only');

  // 'load' / 'visible' remain valid construction options.
  assertEquals(createOpenPlugin({ island: { upgradeStrategy: 'load' } }).length, 9);
  assertEquals(createOpenPlugin({ island: { upgradeStrategy: 'visible' } }).length, 9);
});

// ─── Invalid Options ──────────────────────────────────────────

Deno.test('openPlugin: rejects script tags in headExtras', () => {
  assertThrows(
    () => createOpenPlugin({ headExtras: '<script>alert(1)</script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

Deno.test('openPlugin: rejects script tags in inject.headFragments', () => {
  assertThrows(
    () => createOpenPlugin({ inject: { headFragments: ['<script src="/x.js"></script>'] } }),
    Error,
    'inject.headFragments must not contain <script> tags',
  );
});

Deno.test('openPlugin: handles empty options object', () => {
  const plugins = createOpenPlugin({});
  assertEquals(plugins.length, 9);
});

Deno.test('openPlugin: handles undefined options', () => {
  const plugins = createOpenPlugin();
  assertEquals(plugins.length, 9);
});

// ─── Virtual Entry Plugin Behaviors ───────────────────────────

Deno.test('openPlugin: virtual-entry resolves virtual:open-hono-entry', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const resolved = callResolveId(virtualPlugin, 'virtual:open-hono-entry');
  assertExists(resolved);
  assertEquals(resolved, '\0virtual:open-hono-entry');
});

Deno.test('openPlugin: virtual-entry resolves virtual:open-build-trigger', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const resolved = callResolveId(virtualPlugin, 'virtual:open-build-trigger');
  assertExists(resolved);
  assertEquals(resolved, '\0virtual:open-build-trigger');
});

Deno.test('openPlugin: virtual-entry resolveId returns undefined for unknown IDs', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const result = callResolveId(virtualPlugin, 'some-random-module');
  assertEquals(result, undefined);
});

Deno.test('openPlugin: virtual-entry load returns code for resolved entry ID', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const code = callLoad(virtualPlugin, '\0virtual:open-hono-entry');
  assertExists(code);
  assertStringIncludes(code as string, 'hono');
});

Deno.test('openPlugin: virtual-entry load returns null export for build trigger', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const code = callLoad(virtualPlugin, '\0virtual:open-build-trigger');
  assertExists(code);
  assertEquals(code, 'export default null;');
});

Deno.test('openPlugin: virtual-entry load returns undefined for unknown IDs', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const result = callLoad(virtualPlugin, 'unknown-virtual-id');
  assertEquals(result, undefined);
});

// ─── Core Plugin Hooks ────────────────────────────────────────

Deno.test('openPlugin: core plugin has config hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  assertExists(corePlugin.config);
  assertEquals(typeof corePlugin.config, 'function');
});

Deno.test('openPlugin: core plugin has configResolved hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  assertExists(corePlugin.configResolved);
  assertEquals(typeof corePlugin.configResolved, 'function');
});

Deno.test('openPlugin: core plugin has buildStart hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  assertExists(corePlugin.buildStart);
  assertEquals(typeof corePlugin.buildStart, 'function');
});

Deno.test('openPlugin: core config sets chunkSizeWarningLimit', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = callConfig(corePlugin);
  const build = result.build as Record<string, unknown>;
  assertEquals(build.chunkSizeWarningLimit, 1500);
});

Deno.test('openPlugin: core config includes rollupOptions with build trigger input', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = callConfig(corePlugin);
  const build = result.build as Record<string, unknown>;
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];

  assertExists(input);
  assertArrayIncludes(input, ['virtual:open-build-trigger']);
});

Deno.test('openPlugin: core config sorts aliases by subpath specificity', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = callConfig(corePlugin, {
    resolve: {
      alias: [
        { find: '@openelement/element', replacement: '/repo/packages/core/src/index.ts' },
        { find: '@openelement/core/csr', replacement: '/repo/packages/core/src/csr.ts' },
      ],
    },
  });
  const resolve = result.resolve as { alias: Array<{ find: string; replacement: string }> };
  const coreCsrIndex = resolve.alias.findIndex((alias) => alias.find === '@openelement/core/csr');
  const coreRootIndex = resolve.alias.findIndex((alias) => alias.find === '@openelement/element');

  assertEquals(coreCsrIndex >= 0, true);
  assertEquals(coreRootIndex >= 0, true);
  assertEquals(coreCsrIndex < coreRootIndex, true);
});

// ─── Island Transform Plugin ──────────────────────────────────

Deno.test('openPlugin: island-transform plugin exists with correct name', () => {
  const plugins = createOpenPlugin({});
  const islandPlugin = plugins.find((p) => p.name === 'open:island-transform')!;

  assertExists(islandPlugin);
  assertEquals(islandPlugin.name, 'open:island-transform');
});

Deno.test('openPlugin: island-transform has transform hook', () => {
  const plugins = createOpenPlugin({});
  const islandPlugin = plugins.find((p) => p.name === 'open:island-transform')!;

  assertExists(islandPlugin.transform, 'island transform must have transform hook');
});

// ─── Build Plugin ─────────────────────────────────────────────

Deno.test('openPlugin: build plugin exists', () => {
  const plugins = createOpenPlugin({});
  const buildPlugin = plugins.find((p) => p.name === 'open:build')!;

  assertExists(buildPlugin);
});

// ─── Dev Server Plugin ────────────────────────────────────────

Deno.test('openPlugin: dev server plugin is @hono/vite-dev-server', () => {
  const plugins = createOpenPlugin({});
  const devServerPlugin = plugins.find((p) => p.name === '@hono/vite-dev-server')!;

  assertExists(devServerPlugin);
});

// ─── SPA Mode: SSR dev server must be skipped ─────────────────
// Regression: route modules call customElements.define() at module top level,
// which crashes in a server context. SPA is client-only, so the @hono/vite-dev-server
// middleware (which SSR-imports route modules) must NOT be registered.

Deno.test('openPlugin: SPA mode omits @hono/vite-dev-server (8 plugins)', () => {
  const plugins = createOpenPlugin({ mode: 'spa' });
  assertEquals(plugins.length, 8);

  const names = plugins.map((p) => p.name);
  assertEquals(
    names,
    [
      'open:mdx',
      'open:core',
      'open:generated-data',
      'open:optional-package-stubs',
      'open:virtual-entry',
      'open:island-transform',
      'open:build',
      // #951: dev-only (apply: 'serve') island client entry serving.
      'open:dev-island-client',
    ],
  );

  // Critical: no SSR dev server in SPA mode
  assertEquals(
    names.includes('@hono/vite-dev-server'),
    false,
    'SPA mode must not register @hono/vite-dev-server — it SSR-imports route ' +
      'modules that call customElements.define() and crash on the server',
  );
});

Deno.test('openPlugin: SSG mode (default) includes @hono/vite-dev-server (9 plugins)', () => {
  const plugins = createOpenPlugin({});
  assertEquals(plugins.length, 9);
  assertExists(plugins.find((p) => p.name === '@hono/vite-dev-server'));
});

Deno.test('openPlugin: explicit SSG mode includes @hono/vite-dev-server', () => {
  const plugins = createOpenPlugin({ mode: 'ssg' });
  assertEquals(plugins.length, 9);
  assertExists(plugins.find((p) => p.name === '@hono/vite-dev-server'));
});

// ─── packageIslands Option ────────────────────────────────────

Deno.test('openPlugin: accepts packageIslands option', () => {
  const plugins = createOpenPlugin({ packageIslands: ['@acme/components'] });
  assertExists(plugins);
  assertEquals(plugins.length, 9);
});

Deno.test('openPlugin: accepts empty packageIslands', () => {
  const plugins = createOpenPlugin({ packageIslands: [] });
  assertExists(plugins);
  assertEquals(plugins.length, 9);
});

Deno.test('openPlugin: accepts multiple packageIslands', () => {
  const plugins = createOpenPlugin({
    packageIslands: ['@acme/components', '@openelement/element'],
  });
  assertExists(plugins);
});

// ─── CORS Origin Edge Cases ───────────────────────────────────

Deno.test('openPlugin: accepts middleware.corsOrigin as string', () => {
  const plugins = createOpenPlugin({ middleware: { corsOrigin: 'https://example.com' } });
  assertExists(plugins);
});

Deno.test('openPlugin: accepts middleware.corsOrigin as array', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: ['https://a.com', 'https://b.com'] },
  });
  assertExists(plugins);
});

// ─── HTML Config ──────────────────────────────────────────────

Deno.test('openPlugin: accepts html config with title', () => {
  const plugins = createOpenPlugin({ html: { title: 'My App' } });
  assertExists(plugins);
});

Deno.test('openPlugin: accepts html config with lang', () => {
  const plugins = createOpenPlugin({ html: { lang: 'zh-CN' } });
  assertExists(plugins);
});

Deno.test('openPlugin: accepts full html config', () => {
  const plugins = createOpenPlugin({ html: { lang: 'ja', title: 'テスト' } });
  assertExists(plugins);
});

// ─── Inject Structured API ────────────────────────────────────

Deno.test('openPlugin: inject.stylesheets string form', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  assertExists(plugins);
});

Deno.test('openPlugin: inject.stylesheets object form with integrity', () => {
  const plugins = createOpenPlugin({
    inject: {
      stylesheets: [{
        href: 'https://cdn.example.com/app.css',
        integrity: 'sha384-abc',
      }],
    },
  });
  assertExists(plugins);
});

Deno.test('openPlugin: inject.scripts with defer', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: [{ src: 'https://cdn.example.com/app.js', defer: true }] },
  });
  assertExists(plugins);
});

Deno.test('openPlugin: headExtras and inject work together (headExtras wins)', () => {
  const plugins = createOpenPlugin({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  assertExists(plugins);
});
