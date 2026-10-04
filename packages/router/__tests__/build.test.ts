/**
 * @openelement/router - build / entry-generators tests
 *
 * ADR 0011: closeBundle writes metadata to ctx, not .openElement/build-metadata.json.
 * Tests verify OpenElementBuildContext fields instead of filesystem.
 */
import process from 'node:process';
import { beforeAll, describe, expect, test } from 'vitest';
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
  return { command, base, root: process.cwd() } as Record<string, unknown>;
}

// --- generateClientEntry tests -------------------------------------------------

describe('build - generateClientEntry', () => {
  test('returns empty comment when no islands', () => {
    const code = generateClientEntry([]);
    expect(code).toContain('No islands detected');
    expect(code.includes('hydrate')).toEqual(false);
  });

  test('generates dynamic imports for island files', () => {
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
    expect(code).toContain('import("/app/islands/my-counter.ts")');
    expect(code).toContain('import("/app/islands/theme-toggle.ts")');
  });

  test('islands self-register via dynamic import side effects', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // No explicit customElements.define() - islands self-register via dynamic import
    expect(code.includes("customElements.define('my-counter'")).toBeFalsy();
    expect(code.includes("customElements.get('my-counter')")).toBeFalsy();
  });

  test('no duplicate registration guards needed', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // No explicit customElements.define() - no duplicate guard needed
    expect(code.includes("if (!customElements.get('my-counter'))")).toBeFalsy();
  });

  test('includes openElement Client Entry comment', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    expect(code).toContain('openElement Client Entry');
  });

  test('no legacy SSR client imports (v0.5.0 CE-native upgrade)', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: browser CE spec handles upgrade
    expect(code.includes('lit-element-hydrate-support')).toEqual(false);
    expect(code.includes('litElementHydrateSupport')).toEqual(false);
    expect(code.includes('LitElement')).toEqual(false);
  });

  test('uses idle-time idle loading', () => {
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
    expect(code).toContain('idle: ["my-counter"]');
    expect(code).toContain('virtual:open-client-runtime/scheduler');
  });

  test('capture installs after __tags with the declared list, before island imports', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    const captureCall = 'ensurePreHydrationClickCapture(document, __tags);';
    expect(code).toContain(captureCall);
    expect(code.includes('ensurePreHydrationClickCapture();')).toEqual(false);
    const tagsIndex = code.indexOf('var __tags =');
    const captureIndex = code.indexOf(captureCall);
    // The island import() strings live inside __map factories defined
    // above; they only EXECUTE when the scheduler below invokes them, so
    // execution order is capture-before-scheduler, not string order.
    const schedulerIndex = code.indexOf('__schedule({');
    expect(tagsIndex >= 0 && captureIndex > tagsIndex).toEqual(true);
    expect(schedulerIndex > captureIndex).toEqual(true);
  });
});

// --- buildPlugin tests --------------------------------------------------------
// ADR 0011: closeBundle writes metadata to ctx fields, not .openElement/build-metadata.json.
// Tests create a real OpenElementBuildContext and verify fields after closeBundle().
// NOTE: Phase 2/3 (buildClient, buildSSG) require a real Vite project with
// routes/islands - they are exercised end to end by static-only-build.test.ts
// and the SSG pipeline tests instead.

test('buildPlugin - configResolved', () => {
  const plugin = buildPlugin();
  const config = makeConfig('build', '/base/');
  callHook(plugin.configResolved, config);
  // If we reach here without error, the hook ran.
  // We can't directly inspect `base` (it's closed over), but closeBundle will use it.
  expect(typeof plugin.name).toEqual('string');
  expect(plugin.name).toEqual('open:build');
});

describe('buildPlugin - closeBundle (build mode, no islands) writes to ctx', () => {
  let ctx: OpenElementBuildContext;

  beforeAll(async () => {
    ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('build');
    callHook(plugin.configResolved, config);

    // closeBundle will try Phase 2/3 which need a real project - catch and ignore
    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project - that's OK, we only test Phase 1
    }
  });

  test('ctx fields are populated by Phase 1', () => {
    expect(ctx.phase3.outDir).toEqual('dist');
    expect(ctx.phase3.base).toEqual('/');
    expect(ctx.phase3.ssrNoExternal.length).toEqual(0);
  });

  test('no islands in ctx', () => {
    expect(ctx.phase1.islandTagNames.length).toEqual(0);
    expect(ctx.phase1.packageManifests.length).toEqual(0);
    expect(ctx.phase1.packageIslandDecls.length).toEqual(0);
  });
});

describe('buildPlugin - closeBundle (dev mode, skips write)', () => {
  let ctx: OpenElementBuildContext;

  beforeAll(async () => {
    ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('serve'); // dev mode
    callHook(plugin.configResolved, config);
    await callAsyncHook(plugin.closeBundle);
  });

  test('does NOT write ctx fields in dev mode', () => {
    // In dev mode, closeBundle returns early - ctx fields should remain default
    expect(ctx.phase3.root).toEqual('');
    expect(ctx.phase3.outDir).toEqual('dist'); // default value
  });
});

describe('buildPlugin - custom outDir and options writes to ctx', () => {
  let ctx: OpenElementBuildContext;

  beforeAll(async () => {
    ctx = new OpenElementBuildContext({});
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
  });

  test('writes custom options to ctx', () => {
    expect(ctx.phase3.outDir).toEqual('custom-dist');
    expect(ctx.phase3.islandsDir).toEqual('src/islands');
    expect(ctx.phase3.routesDir).toEqual('src/routes');
    expect(ctx.phase3.html?.lang).toEqual('zh');
    expect(ctx.phase3.upgradeStrategy).toEqual('load');
  });
});

describe('buildPlugin - ssr.noExternal RegExp serialization writes to ctx', () => {
  let ctx: OpenElementBuildContext;

  beforeAll(async () => {
    ctx = new OpenElementBuildContext({});
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
  });

  test('serializes RegExp as __type objects in ctx', () => {
    expect(ctx.phase3.ssrNoExternal).toEqual(expect.anything());
    const first = ctx.phase3.ssrNoExternal[0] as { __type?: string; source?: string };
    expect(first.__type).toEqual('RegExp');
    expect(first.source).toEqual('@openelement\\/.*');
    expect(ctx.phase3.ssrNoExternal[1]).toEqual('lit');
  });
});

describe('buildPlugin - base without trailing slash ensures base ends with /', () => {
  let ctx: OpenElementBuildContext;

  beforeAll(async () => {
    ctx = new OpenElementBuildContext({});
    const plugin = buildPlugin({}, ctx);
    const config = makeConfig('build', '/base'); // no trailing slash
    callHook(plugin.configResolved, config);

    try {
      await callAsyncHook(plugin.closeBundle);
    } catch {
      // Phase 2/3 may fail without a real project
    }
  });

  test('ensures base ends with /', () => {
    expect(ctx.phase3.base).toEqual('/base/');
  });
});
