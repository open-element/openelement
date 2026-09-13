/**
 * @openelement/router - build / entry-generators tests (Deno)
 *
 * ADR 0011: closeBundle writes metadata to ctx, not .openElement/build-metadata.json.
 * Tests verify OpenElementBuildContext fields instead of filesystem.
 */
import { assertEquals, assertExists, assertFalse, assertStringIncludes } from '@std/assert';
import { generateClientEntry } from '../src/vite/internal/ssg/index.ts';
import { buildPlugin } from '../src/vite/build.ts';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';

type ObjectHook = {
  handler: (...args: unknown[]) => unknown;
};

/**
 * Call a Vite ObjectHook that may be a plain function or { handler, order? }.
 * Avoids TS2349 "not all constituents are callable".
 */
function callHook(hook: unknown, ...args: unknown[]): void {
  if (typeof hook === 'function') {
    hook(...args);
  } else if (hook && typeof hook === 'object' && 'handler' in hook) {
    (hook as ObjectHook).handler(...args);
  }
}

async function callAsyncHook(hook: unknown, ...args: unknown[]): Promise<void> {
  let result: unknown;
  if (typeof hook === 'function') {
    result = hook(...args);
  } else if (hook && typeof hook === 'object' && 'handler' in hook) {
    result = (hook as ObjectHook).handler(...args);
  }
  if (result instanceof Promise) await result;
}

function makeConfig(command: 'build' | 'serve', base = '/'): Record<string, unknown> {
  return { command, base, root: Deno.cwd() } as Record<string, unknown>;
}

// --- generateClientEntry tests -------------------------------------------------

Deno.test('build - generateClientEntry', async (t) => {
  await t.step('returns empty comment when no islands', () => {
    const code = generateClientEntry([]);
    assertStringIncludes(code, 'No islands detected');
    assertEquals(code.includes('hydrate'), false);
  });

  await t.step('generates dynamic imports for island files', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
      {
        tagName: 'theme-toggle',
        modulePath: '/app/islands/theme-toggle.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // All islands use dynamic import for CE auto-upgrade
    assertStringIncludes(code, 'import("/app/islands/my-counter.ts")');
    assertStringIncludes(code, 'import("/app/islands/theme-toggle.ts")');
  });

  await t.step('islands self-register via dynamic import side effects', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // No explicit customElements.define() - islands self-register via dynamic import
    assertFalse(code.includes("customElements.define('my-counter'"));
    assertFalse(code.includes("customElements.get('my-counter')"));
  });

  await t.step('no duplicate registration guards needed', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // No explicit customElements.define() - no duplicate guard needed
    assertFalse(code.includes("if (!customElements.get('my-counter'))"));
  });

  await t.step('includes openElement Client Entry comment', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    assertStringIncludes(code, 'openElement Client Entry');
  });

  await t.step('no legacy SSR client imports (v0.5.0 CE-native upgrade)', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: browser CE spec handles upgrade
    assertEquals(code.includes('lit-element-hydrate-support'), false);
    assertEquals(code.includes('litElementHydrateSupport'), false);
    assertEquals(code.includes('LitElement'), false);
  });

  await t.step('uses idle-time idle loading', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // #868: the scheduler module (bundled via virtual:open-client-runtime,
    // not inline) owns idle deferral — the entry wires the strategy.
    assertStringIncludes(code, 'idle: ["my-counter"]');
    assertStringIncludes(code, 'virtual:open-client-runtime/scheduler');
  });
});

// --- buildPlugin tests --------------------------------------------------------
// ADR 0011: closeBundle writes metadata to ctx fields, not .openElement/build-metadata.json.
// Tests create a real OpenElementBuildContext and verify fields after closeBundle().
// NOTE: Phase 2/3 (buildClient, buildSSG) require a real Vite project with
// routes/islands - they are tested in ssg-smoke.test.ts instead.

Deno.test('buildPlugin - configResolved', () => {
  const plugin = buildPlugin();
  const config = makeConfig('build', '/base/');
  callHook(plugin.configResolved, config);
  // If we reach here without error, the hook ran.
  // We can't directly inspect `base` (it's closed over), but closeBundle will use it.
  assertEquals(typeof plugin.name, 'string');
  assertEquals(plugin.name, 'open:build');
});

Deno.test({
  name: 'buildPlugin - closeBundle (build mode, no islands) writes to ctx',
  // Rolldown's SignalExit registers SIGINT/SIGTERM listeners during viteBuild()
  // that aren't cleaned up when the build fails. This is a known rolldown issue,
  // not a leak in our code. Sanitize ops to avoid false-positive leak detection.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('build');
    callHook(plugin.configResolved, config);

    // closeBundle will try Phase 2/3 which need a real project - catch and ignore
    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project - that's OK, we only test Phase 1
    }

    await t.step('ctx fields are populated by Phase 1', () => {
      assertEquals(ctx.phase3.outDir, 'dist');
      assertEquals(ctx.phase3.base, '/');
      assertEquals(ctx.phase3.ssrNoExternal.length, 0);
    });

    await t.step('no islands in ctx', () => {
      assertEquals(ctx.phase1.islandTagNames.length, 0);
      assertEquals(ctx.phase1.packageManifests.length, 0);
      assertEquals(ctx.phase1.packageIslandDecls.length, 0);
    });
  },
});

Deno.test({
  name: 'buildPlugin - closeBundle (dev mode, skips write)',
  // Previous build-mode tests spawn Vite SSR builds whose dangling async
  // fs.access (Deno.lstat) ops can leak across test boundaries.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('serve'); // dev mode
    callHook(plugin.configResolved, config);
    await callAsyncHook(plugin.closeBundle);

    await t.step('does NOT write ctx fields in dev mode', () => {
      // In dev mode, closeBundle returns early - ctx fields should remain default
      assertEquals(ctx.phase3.root, '');
      assertEquals(ctx.phase3.outDir, 'dist'); // default value
    });
  },
});

Deno.test({
  name: 'buildPlugin - custom outDir and options writes to ctx',
  // Rolldown/Vite SSR build spawns dangling async fs.access (Deno.lstat) ops
  // that the sanitizer flags as leaks. Same root cause as closeBundle test above.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const ctx = new OpenElementBuildContext({});
    const options = {
      build: { outDir: 'custom-dist' },
      islandsDir: 'src/islands',
      routesDir: 'src/routes',
      middleware: { cors: true },
      headExtras: '<meta name="theme-color" content="#000">',
      html: { lang: 'zh', title: 'My App' },
      island: { upgradeStrategy: 'load' as const },
    };
    const plugin = buildPlugin(options, ctx);
    const config = makeConfig('build');
    callHook(plugin.configResolved, config);

    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project
    }

    await t.step('writes custom options to ctx', () => {
      assertEquals(ctx.phase3.outDir, 'custom-dist');
      assertEquals(ctx.phase3.islandsDir, 'src/islands');
      assertEquals(ctx.phase3.routesDir, 'src/routes');
      assertEquals(ctx.phase3.html?.lang, 'zh');
      assertEquals(ctx.phase3.upgradeStrategy, 'load');
    });
  },
});

Deno.test({
  name: 'buildPlugin - SPA shell uses configured html title and lang',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${root}/app/routes`, { recursive: true });

      const ctx = new OpenElementBuildContext({ mode: 'spa' });
      const plugin = buildPlugin({
        mode: 'spa',
        routesDir: 'app/routes',
        build: { outDir: 'dist' },
        html: {
          lang: 'zh-CN',
          title: 'Reader <Alpha>',
        },
      }, ctx);
      const config = makeConfig('build');
      config.root = root;
      callHook(plugin.configResolved, config);

      await callAsyncHook(plugin.closeBundle);

      const html = await Deno.readTextFile(`${root}/dist/index.html`);
      assertStringIncludes(html, '<html lang="zh-CN">');
      assertStringIncludes(html, '<title>Reader &lt;Alpha&gt;</title>');
      assertStringIncludes(html, 'SPA fallback shell loaded');
      assertEquals(html.includes('/client-entry.js'), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: 'buildPlugin - SPA mode preserves existing Vite index.html',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${root}/dist`, { recursive: true });
      await Deno.mkdir(`${root}/app/routes`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/dist/index.html`,
        '<!doctype html><div id="root"></div><script type="module" src="/assets/reader-abc.js"></script>',
      );

      const ctx = new OpenElementBuildContext({ mode: 'spa' });
      const plugin = buildPlugin({
        mode: 'spa',
        routesDir: 'app/routes',
        build: { outDir: 'dist' },
      }, ctx);
      const config = makeConfig('build');
      config.root = root;
      callHook(plugin.configResolved, config);

      await callAsyncHook(plugin.closeBundle);

      const html = await Deno.readTextFile(`${root}/dist/index.html`);
      assertStringIncludes(html, '/assets/reader-abc.js');
      assertEquals(html.includes('/client-entry.js'), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: 'buildPlugin - ssr.noExternal RegExp serialization writes to ctx',
  // Rolldown/Vite SSR build spawns dangling async fs.access (Deno.lstat) ops
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const ctx = new OpenElementBuildContext({});
    const options = {
      ssr: { noExternal: [/@openelement\/.*/, 'lit'] },
    };
    const plugin = buildPlugin(options as never, ctx);
    const config = makeConfig('build');
    callHook(plugin.configResolved, config);

    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project
    }

    await t.step('serializes RegExp as __type objects in ctx', () => {
      assertExists(ctx.phase3.ssrNoExternal);
      const first = ctx.phase3.ssrNoExternal[0] as { __type?: string; source?: string };
      assertEquals(first.__type, 'RegExp');
      assertEquals(first.source, '@openelement\\/.*');
      assertEquals(ctx.phase3.ssrNoExternal[1], 'lit');
    });
  },
});

Deno.test({
  name: 'buildPlugin - base without trailing slash ensures base ends with /',
  // Rolldown/Vite SSR build spawns dangling async fs.access (Deno.lstat) ops
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('build', '/base'); // no trailing slash
    callHook(plugin.configResolved, config);

    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project
    }

    await t.step('ensures base ends with /', () => {
      assertEquals(ctx.phase3.base, '/base/');
    });
  },
});
