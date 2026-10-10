/**
 * @openelement/router - plugin.ts tests
 *
 * Focused tests for the internal plugin factory (plugin.ts):
 * Tests the raw `createOpenPlugin()` function which is NOT part of the public API —
 * consumers should use `openPipeline()` from the main entry.
 *
 * Complements index-plugin.test.ts which tests the public API surface.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import { createOpenPlugin } from '../src/vite/plugin.ts';

type PluginOptions = Parameters<typeof createOpenPlugin>[0];

type HookRecord = {
  config?: unknown;
  load?: unknown;
  resolveId?: unknown;
};
type TestConfigHook = (
  config: Record<string, unknown>,
  env?: { command: 'build' | 'serve'; mode: string },
) => unknown;
type TestLoadHook = (id: string) => unknown;
type TestResolveIdHook = (id: string) => unknown;

/**
 * #1411: the core `config` hook is async — it loads `openelement.config.ts`
 * through Vite's config loader — so every caller awaits it.
 */
async function callConfig(
  plugin: unknown,
  config: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const hook = (plugin as HookRecord).config;
  expect(hook, 'config hook must exist').toEqual(expect.anything());
  const result = await (hook as TestConfigHook)(config, { command: 'build', mode: 'production' });
  return result as Record<string, unknown>;
}

function callResolveId(plugin: unknown, id: string): unknown {
  const hook = (plugin as HookRecord).resolveId;
  expect(hook, 'resolveId hook must exist').toEqual(expect.anything());
  return (hook as TestResolveIdHook)(id);
}

function callLoad(plugin: unknown, id: string): unknown {
  const hook = (plugin as HookRecord).load;
  expect(hook, 'load hook must exist').toEqual(expect.anything());
  return (hook as TestLoadHook)(id);
}

// ─── Plugin Order & Structure ─────────────────────────────────

test('openPlugin: returns retained plugins in correct order', () => {
  const plugins = createOpenPlugin();
  expect(plugins.length).toEqual(9);

  const names = plugins.map((p) => p.name);
  expect(names).toEqual([
    'open:mdx',
    'open:core',
    // ADR-0164: the dev half of the island style asset protocol — serves the
    // sheet adapters for the requests the open:core compiled-element
    // transform (protocol-activated) emits.
    'open:style-assets-dev',
    // #1582: the dev half of the Tailwind preset (apply: 'serve'), inert
    // until the resolved options carry the `tailwind` key.
    'open:tailwind-preset-dev',
    'open:virtual-entry',
    '@hono/vite-dev-server',
    'open:island-transform',
    'open:build',
    // #951: dev-only (apply: 'serve') island client entry serving.
    'open:dev-island-client',
  ]);
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
  const tmp = mkdtempSync(join(tmpdir(), 'open-plugin-opts-'));
  const origCwd = process.cwd();
  try {
    setup?.(tmp);
    process.chdir(tmp);
    const plugins = createOpenPlugin(options);
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
    await callConfig(corePlugin);
    const configResolved = (corePlugin as { configResolved?: unknown }).configResolved;
    expect(configResolved, 'configResolved hook must exist').toEqual(expect.anything());
    (configResolved as (config: never) => void)({} as never);
    const buildStart = (corePlugin as { buildStart?: unknown }).buildStart;
    expect(buildStart, 'buildStart hook must exist').toEqual(expect.anything());
    await (buildStart as () => Promise<void>)();
    const code = callLoad(virtualPlugin, '\0virtual:open-hono-entry');
    expect(code, 'virtual entry load must return code').toEqual(expect.anything());
    return String(code);
  } finally {
    process.chdir(origCwd);
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

function writeRouteIndex(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export default () => "<h1>Hello</h1>"');
}

function writeIsland(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'my-counter.ts'), 'export const tagName = "my-counter"');
}

test('openPlugin: defaults routesDir to app/routes', async () => {
  const code = await renderVirtualEntry({}, (tmp) => writeRouteIndex(join(tmp, 'app', 'routes')));
  expect(code).toContain('/app/routes/index.ts');
});

test('openPlugin: defaults islandsDir to app/islands', async () => {
  const code = await renderVirtualEntry({}, (tmp) => writeIsland(join(tmp, 'app', 'islands')));
  expect(code).toContain('/app/islands/my-counter.ts');
});

test('openPlugin: respects custom routesDir', async () => {
  const code = await renderVirtualEntry({ routesDir: 'src/pages' }, (tmp) =>
    writeRouteIndex(join(tmp, 'src', 'pages')),
  );
  expect(code).toContain('/src/pages/index.ts');
});

test('openPlugin: respects custom islandsDir', async () => {
  const code = await renderVirtualEntry({ islandsDir: 'src/widgets' }, (tmp) =>
    writeIsland(join(tmp, 'src', 'widgets')),
  );
  expect(code).toContain('/src/widgets/my-counter.ts');
});

test('openPlugin: accepts default and custom componentsDir', () => {
  // componentsDir is only consumed by the build closeBundle phase; here we can
  // only assert both forms construct a valid pipeline.
  expect(createOpenPlugin({}).length).toEqual(9);
  expect(createOpenPlugin({ componentsDir: 'src/ui' }).length).toEqual(9);
});

// ─── Upgrade Strategy ─────────────────────────────────────────

test('openPlugin: island.upgradeStrategy flows into the SSR admission plan', async () => {
  const setup = (tmp: string) => writeIsland(join(tmp, 'app', 'islands'));

  // Default ('idle'): local islands are SSR-admitted and imported by the entry.
  const defaultCode = await renderVirtualEntry({}, setup);
  expect(defaultCode).toContain('import * as __island_my_counter');

  // 'only': islands are excluded from SSR and marked client-only in the plan.
  const onlyCode = await renderVirtualEntry({ island: { upgradeStrategy: 'only' } }, setup);
  expect(onlyCode.includes('import * as __island_my_counter')).toEqual(false);
  expect(onlyCode).toContain('client-only');

  // 'load' / 'visible' remain valid construction options.
  expect(createOpenPlugin({ island: { upgradeStrategy: 'load' } }).length).toEqual(9);
  expect(createOpenPlugin({ island: { upgradeStrategy: 'visible' } }).length).toEqual(9);
});

// ─── Invalid Options ──────────────────────────────────────────

test('openPlugin: rejects script tags in headExtras', () => {
  assertThrowsIncludes(
    () => createOpenPlugin({ headExtras: '<script>alert(1)</script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

test('openPlugin: rejects script tags in inject.headFragments', () => {
  assertThrowsIncludes(
    () => createOpenPlugin({ inject: { headFragments: ['<script src="/x.js"></script>'] } }),
    Error,
    'inject.headFragments must not contain <script> tags',
  );
});

test('openPlugin: handles empty options object', () => {
  const plugins = createOpenPlugin({});
  expect(plugins.length).toEqual(9);
});

test('openPlugin: handles undefined options', () => {
  const plugins = createOpenPlugin();
  expect(plugins.length).toEqual(9);
});

// ─── Virtual Entry Plugin Behaviors ───────────────────────────

test('openPlugin: virtual-entry resolves virtual:open-hono-entry', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const resolved = callResolveId(virtualPlugin, 'virtual:open-hono-entry');
  expect(resolved).toEqual(expect.anything());
  expect(resolved).toEqual('\0virtual:open-hono-entry');
});

test('openPlugin: virtual-entry resolves virtual:open-build-trigger', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const resolved = callResolveId(virtualPlugin, 'virtual:open-build-trigger');
  expect(resolved).toEqual(expect.anything());
  expect(resolved).toEqual('\0virtual:open-build-trigger');
});

test('openPlugin: virtual-entry resolveId returns undefined for unknown IDs', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const result = callResolveId(virtualPlugin, 'some-random-module');
  expect(result).toEqual(undefined);
});

test('openPlugin: virtual-entry load returns code for resolved entry ID', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const code = callLoad(virtualPlugin, '\0virtual:open-hono-entry');
  expect(code).toEqual(expect.anything());
  // The entry imports the generated-app factory — the WinterCG assembly
  // (#1560); no composition framework appears in the entry.
  expect(code as string).toContain('createGeneratedApp');
  expect(code as string).not.toContain("from 'hono'");
});

test('openPlugin: virtual-entry load returns null export for build trigger', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const code = callLoad(virtualPlugin, '\0virtual:open-build-trigger');
  expect(code).toEqual(expect.anything());
  expect(code).toEqual('export default null;');
});

test('openPlugin: virtual-entry load returns undefined for unknown IDs', () => {
  const plugins = createOpenPlugin({});
  const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;

  const result = callLoad(virtualPlugin, 'unknown-virtual-id');
  expect(result).toEqual(undefined);
});

// ─── Core Plugin Hooks ────────────────────────────────────────

test('openPlugin: core plugin has config hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  expect(corePlugin.config).toEqual(expect.anything());
  expect(typeof corePlugin.config).toEqual('function');
});

test('openPlugin: core plugin has configResolved hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  expect(corePlugin.configResolved).toEqual(expect.anything());
  expect(typeof corePlugin.configResolved).toEqual('function');
});

test('openPlugin: core plugin has buildStart hook', () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  expect(corePlugin.buildStart).toEqual(expect.anything());
  expect(typeof corePlugin.buildStart).toEqual('function');
});

test('openPlugin: core config sets chunkSizeWarningLimit', async () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = await callConfig(corePlugin);
  const build = result.build as Record<string, unknown>;
  expect(build.chunkSizeWarningLimit).toEqual(1500);
});

test('openPlugin: core config includes rollupOptions with build trigger input', async () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = await callConfig(corePlugin);
  const build = result.build as Record<string, unknown>;
  const rollupOptions = build.rollupOptions as Record<string, unknown>;
  const input = rollupOptions.input as string[];

  expect(input).toEqual(expect.anything());
  expect(input).toEqual(expect.arrayContaining(['virtual:open-build-trigger']));
});

test('openPlugin: core config sorts aliases by subpath specificity', async () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;

  const result = await callConfig(corePlugin, {
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

  expect(coreCsrIndex >= 0).toEqual(true);
  expect(coreRootIndex >= 0).toEqual(true);
  expect(coreCsrIndex < coreRootIndex).toEqual(true);
});

// ─── Island Transform Plugin ──────────────────────────────────

test('openPlugin: island-transform plugin exists with correct name', () => {
  const plugins = createOpenPlugin({});
  const islandPlugin = plugins.find((p) => p.name === 'open:island-transform')!;

  expect(islandPlugin).toEqual(expect.anything());
  expect(islandPlugin.name).toEqual('open:island-transform');
});

test('openPlugin: island-transform has transform hook', () => {
  const plugins = createOpenPlugin({});
  const islandPlugin = plugins.find((p) => p.name === 'open:island-transform')!;

  expect(islandPlugin.transform, 'island transform must have transform hook').toEqual(
    expect.anything(),
  );
});

// ─── Build Plugin ─────────────────────────────────────────────

test('openPlugin: build plugin exists', () => {
  const plugins = createOpenPlugin({});
  const buildPlugin = plugins.find((p) => p.name === 'open:build')!;

  expect(buildPlugin).toEqual(expect.anything());
});

// ─── Dev Server Plugin ────────────────────────────────────────

test('openPlugin: dev server plugin is @hono/vite-dev-server', () => {
  const plugins = createOpenPlugin({});
  const devServerPlugin = plugins.find((p) => p.name === '@hono/vite-dev-server')!;

  expect(devServerPlugin).toEqual(expect.anything());
});

test('openPlugin: SSG mode (default) includes @hono/vite-dev-server (9 plugins)', () => {
  const plugins = createOpenPlugin({});
  expect(plugins.length).toEqual(9);
  expect(plugins.find((p) => p.name === '@hono/vite-dev-server')).toEqual(expect.anything());
});

test('openPlugin: explicit SSG mode includes @hono/vite-dev-server', () => {
  const plugins = createOpenPlugin({ mode: 'ssg' });
  expect(plugins.length).toEqual(9);
  expect(plugins.find((p) => p.name === '@hono/vite-dev-server')).toEqual(expect.anything());
});

// ─── packageIslands Option ────────────────────────────────────

test('openPlugin: accepts packageIslands option', () => {
  const plugins = createOpenPlugin({ packageIslands: ['@acme/components'] });
  expect(plugins).toEqual(expect.anything());
  expect(plugins.length).toEqual(9);
});

test('openPlugin: accepts empty packageIslands', () => {
  const plugins = createOpenPlugin({ packageIslands: [] });
  expect(plugins).toEqual(expect.anything());
  expect(plugins.length).toEqual(9);
});

test('openPlugin: accepts multiple packageIslands', () => {
  const plugins = createOpenPlugin({
    packageIslands: ['@acme/components', '@openelement/element'],
  });
  expect(plugins).toEqual(expect.anything());
});

// ─── packageIslands → the resolved config's ssr.noExternal (KR-10a) ───
//
// The config LOADER derives the list (app-config.ts, covered by
// app-config.test.ts); these pin the OTHER half of the wiring: the derived
// list must reach the config object Vite actually resolves, because the dev
// server's SSR environment externalizes by that list. Only the packed
// consumer felt the gap (`Unknown file extension ".css"`); the workspace
// consumers masked it through the pnpm symlink layout.

test('openPlugin: packageIslands reaches the config return as ssr.noExternal', async () => {
  const plugins = createOpenPlugin({ packageIslands: ['@acme/components', '@openelement/ui'] });
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = await callConfig(corePlugin);
  const ssr = result.ssr as { noExternal?: string[] };
  expect(ssr?.noExternal).toEqual(['@acme/components', '@openelement/ui']);
});

test('openPlugin: no packageIslands leaves the config return without an ssr key', async () => {
  const plugins = createOpenPlugin({});
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = await callConfig(corePlugin);
  // Absent, not an empty list: an empty list would merge as a no-op either
  // way, but the resolved config must stay byte-identical to a build that
  // never mentioned the option.
  expect(result.ssr).toEqual(undefined);
});

test('openPlugin: an explicit ssr.noExternal without packageIslands still reaches the config', async () => {
  // The low-level face (`createOpenPlugin`) takes FrameworkOptions directly;
  // a caller that states its own externalization list keeps it.
  const plugins = createOpenPlugin({ ssr: { noExternal: ['lit'] } });
  const corePlugin = plugins.find((p) => p.name === 'open:core')!;
  const result = await callConfig(corePlugin);
  const ssr = result.ssr as { noExternal?: unknown[] };
  expect(ssr?.noExternal).toEqual(['lit']);
});

// ─── CORS Origin Edge Cases ───────────────────────────────────

test('openPlugin: accepts middleware.corsOrigin as string', () => {
  const plugins = createOpenPlugin({ middleware: { corsOrigin: 'https://example.com' } });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: accepts middleware.corsOrigin as array', () => {
  const plugins = createOpenPlugin({
    middleware: { corsOrigin: ['https://a.com', 'https://b.com'] },
  });
  expect(plugins).toEqual(expect.anything());
});

// ─── HTML Config ──────────────────────────────────────────────

test('openPlugin: accepts html config with title', () => {
  const plugins = createOpenPlugin({ html: { title: 'My App' } });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: accepts html config with lang', () => {
  const plugins = createOpenPlugin({ html: { lang: 'zh-CN' } });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: accepts full html config', () => {
  const plugins = createOpenPlugin({ html: { lang: 'ja', title: 'テスト' } });
  expect(plugins).toEqual(expect.anything());
});

// ─── Inject Structured API ────────────────────────────────────

test('openPlugin: inject.stylesheets string form', () => {
  const plugins = createOpenPlugin({
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: inject.stylesheets object form with integrity', () => {
  const plugins = createOpenPlugin({
    inject: {
      stylesheets: [
        {
          href: 'https://cdn.example.com/app.css',
          integrity: 'sha384-abc',
        },
      ],
    },
  });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: inject.scripts with defer', () => {
  const plugins = createOpenPlugin({
    inject: { scripts: [{ src: 'https://cdn.example.com/app.js', defer: true }] },
  });
  expect(plugins).toEqual(expect.anything());
});

test('openPlugin: headExtras and inject work together (headExtras wins)', () => {
  const plugins = createOpenPlugin({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://cdn.example.com/app.css'] },
  });
  expect(plugins).toEqual(expect.anything());
});
