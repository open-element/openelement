import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { join } from 'node:path';
import { buildCriticalHeadExtras } from '../../src/vite/internal/ssg/critical-assets.ts';
import { compiledElementPlugin, compileElementModule } from '@openelement/element/compiler';
import { generateClientEntry } from '../../src/vite/internal/ssg/entry-client-codegen.ts';
import { createIslandScheduler } from '../../src/vite/internal/ssg/island-scheduler.ts';
import { readIslandConfig } from '../../src/vite/internal/ssg/island-scanner.ts';
import { buildSsrAdmissionPlan } from '../../src/vite/internal/ssg/entry-descriptor.ts';
import { OpenElementBuildContext } from '../../src/vite/build-context.ts';
import { findReachableIslandTags } from '../../src/cli/build-client.ts';
import { createOpenPlugin } from '../../src/vite/plugin.ts';
import { compilerBehaviorDeclarations } from '../../src/vite/internal/ssg/client-admission.ts';
import { buildClientIslandEntries } from '../../src/vite/internal/ssg/client-island-entries.ts';

Deno.test('v0.44 island delivery emits one scheduler for multi-element media islands', () => {
  const entries = [
    {
      tagName: 'oe-clock',
      modulePath: './clock.ts',
      strategy: 'media',
      media: '(prefers-reduced-motion: no-preference)',
    },
    {
      tagName: 'oe-calendar',
      modulePath: './calendar.ts',
      strategy: 'media',
      media: '(prefers-reduced-motion: no-preference)',
    },
  ] as unknown as Parameters<typeof generateClientEntry>[0];

  const code = generateClientEntry(entries);

  assertEquals((code.match(/createIslandScheduler/g) ?? []).length, 1);
  assertStringIncludes(code, "media: ['oe-clock', 'oe-calendar']");
  assertStringIncludes(code, "matchMedia('(prefers-reduced-motion: no-preference)')");
  assertStringIncludes(code, 'oe-clock');
  assertStringIncludes(code, 'oe-calendar');
});

Deno.test('v0.44 compiler behavior metadata controls exact client output', () => {
  const declarations = compilerBehaviorDeclarations([
    {
      tagName: 'oe-static-card',
      modulePath: '/app/components/static-card.tsx',
      compilerInteractionEvents: [],
    },
    {
      tagName: 'oe-menu-button',
      modulePath: '/app/components/menu-button.tsx',
      compilerInteractionEvents: ['click', 'keydown'],
    },
  ], 'idle');
  assertEquals(declarations.map((entry) => entry.tagName), ['oe-menu-button']);

  const entries = buildClientIslandEntries({
    root: '/project',
    islandsDir: 'app/islands',
    islandTagNames: [],
    islandFiles: [],
    islandMeta: {},
    packageIslandDecls: [],
    compilerBehaviorDecls: declarations,
    upgradeStrategy: 'idle',
  });
  const code = generateClientEntry(entries);
  assertStringIncludes(code, '"oe-menu-button": () => import("/app/components/menu-button.tsx")');
  assertStringIncludes(code, 'idle: ["oe-menu-button"]');
  assertEquals(code.includes('oe-static-card'), false);
});

Deno.test('v0.44 media delivery loads once when the query first matches', () => {
  const readyEvents: Array<{ strategy: string; islands: readonly string[] }> = [];
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  let loaded = 0;
  const scheduler = createIslandScheduler({
    log: { warn: () => {} },
    win: {
      CustomEvent: class {
        type: string;
        detail: unknown;
        constructor(type: string, init: { detail: unknown }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
    } as unknown as Window & typeof globalThis,
    doc: {
      readyState: 'complete',
      addEventListener: () => {},
      dispatchEvent: (event: { type: string; detail: { strategy: string; islands: string[] } }) => {
        if (event.type === 'open:ready') readyEvents.push(event.detail);
        return true;
      },
    } as unknown as Document,
    map: {
      'oe-media': () => {
        loaded++;
        return Promise.resolve();
      },
    },
    strategies: { load: [], idle: [], visible: [], media: ['oe-media'], only: [] },
    mediaQueries: {
      'oe-media': {
        matches: false,
        addEventListener: (_type, listener) => listeners.push(listener),
      },
    },
    onIslandLoaded: null,
  });

  assertEquals(typeof scheduler.observeVisible, 'function');
  assertEquals(loaded, 0);
  assertEquals(readyEvents, []);
  listeners[0]({ matches: true });
  listeners[0]({ matches: true });
  assertEquals(loaded, 1);
  assertEquals(readyEvents, [{ strategy: 'media', islands: ['oe-media'] }]);
});

Deno.test('v0.44 one capability module registers many native element constructors once', () => {
  const code = generateClientEntry([{
    tagName: 'oe-clock',
    tags: ['oe-clock', 'oe-calendar'],
    modulePath: './clock.ts',
    strategy: 'load',
    exportNames: { 'oe-clock': 'Clock', 'oe-calendar': 'Calendar' },
  }]);

  assertEquals((code.match(/import\(["']\.\/clock\.ts["']\)/g) ?? []).length, 1);
  assertStringIncludes(code, 'mod["Clock"]');
  assertStringIncludes(code, 'mod["Calendar"]');
  assertStringIncludes(code, 'customElements.define("oe-clock"');
  assertStringIncludes(code, 'customElements.define("oe-calendar"');
  assertStringIncludes(code, "typeof __Ctor0_0 !== 'function'");
  assertEquals((code.match(/createIslandScheduler/g) ?? []).length, 1);
});

Deno.test('v0.44 island metadata remains static and carries delivery aliases', () => {
  const meta = readIslandConfig(`
    export const openElement = defineIslandConfig({
      hydrate: 'media',
      media: '(min-width: 40rem)',
      tags: ['oe-clock', 'oe-calendar'],
      exportNames: { 'oe-clock': 'Clock', 'oe-calendar': 'Calendar' },
    });
  `);
  assertEquals(meta, {
    hydrate: 'media',
    media: '(min-width: 40rem)',
    tags: ['oe-clock', 'oe-calendar'],
    exportNames: { 'oe-clock': 'Clock', 'oe-calendar': 'Calendar' },
  });

  const escapedMedia = readIslandConfig(String.raw`
    export const openElement = defineIslandConfig({
      hydrate: 'media',
      media: '(min-width: 40\u0072em)',
    });
  `);
  assertEquals(escapedMedia?.media, '(min-width: 40rem)');

  assertThrows(
    () =>
      readIslandConfig(
        'export const openElement = defineIslandConfig({ tags: dynamicTags });',
      ),
    Error,
    'openElement.tags must be an array of string literals',
  );
  assertThrows(
    () =>
      readIslandConfig(
        "export const openElement = defineIslandConfig(makeConfig({ hydrate: 'load' }));",
      ),
    Error,
    'static object literal',
  );
  assertThrows(
    () =>
      readIslandConfig(
        "export const openElement = defineIslandConfig({ hydrate: 'load' }).value;",
      ),
    Error,
    'one static object literal',
  );
});

Deno.test('v0.44 SSR admission expands one capability declaration per delivered tag', () => {
  const plan = buildSsrAdmissionPlan([
    {
      tagName: 'oe-clock',
      modulePath: './clock.ts',
      source: 'local',
      tags: ['oe-clock', 'oe-calendar'],
    } as unknown as Parameters<typeof buildSsrAdmissionPlan>[0][number],
  ]);

  assertEquals(plan.renderableTags, ['oe-clock', 'oe-calendar']);
  assertEquals(plan.clientOnlyTags, []);
  assertEquals(plan.decisions.map((decision) => decision.tagName), ['oe-clock', 'oe-calendar']);
});

Deno.test('v0.44 compiler source records pass through the Vite source map', () => {
  // A10.2 (#1210): the map returned for Vite composition is the core's real
  // Source Map v3; the program's v1 provenance records ride along only as
  // supplementary x_openElement metadata.
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-clock')",
    'export class Clock extends OpenElement {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <div>{this.count}</div>; }',
    '}',
  ].join('\n');
  const result = compileElementModule(source, '/src/clock.tsx');
  assertEquals(result?.map.x_openElement, result?.program.sourceMap);
  assertEquals(result?.map.sources, ['/src/clock.tsx']);
  assertEquals(result?.map.sourcesContent, [source]);
});

Deno.test('v0.44 compiler hook transforms once and classifies HMR shape changes', async () => {
  const root = await Deno.makeTempDir({ prefix: 'open-element-alpha4-hmr-' });
  try {
    const file = join(root, 'counter.tsx');
    const source = [
      "import { element, OpenElement, property } from '@openelement/element';",
      "@element('oe-hmr-counter')",
      'export class HmrCounter extends OpenElement {',
      '  @property({ reflect: true }) count = 0;',
      '  increment() { this.count++; }',
      '  render() { return <button onClick={this.increment}>{this.count}</button>; }',
      '}',
    ].join('\n');
    await Deno.writeTextFile(file, source);

    const plugins = createOpenPlugin();
    const core = plugins.find((plugin) => plugin.name === 'open:core');
    const compiler = compiledElementPlugin();
    if (!core || typeof core.transform !== 'function') {
      throw new Error('canonical compiler integration hook was not registered');
    }
    const transform = core.transform as unknown as (
      this: { error(message: string): never },
      code: string,
      id: string,
    ) => { code: string; map?: unknown } | null;
    const transformed = transform.call(
      {
        error: (message) => {
          throw new Error(message);
        },
      },
      source,
      file,
    );
    if (!transformed) throw new Error('core compiler hook did not emit code');
    assertStringIncludes(transformed.code, '__partProgram');
    assertEquals(
      (compiler.transform as unknown as (code: string, id: string) => unknown)(
        transformed.code,
        file,
      ),
      null,
    );

    const sent: unknown[] = [];
    const hmr = () => {
      return {
        file,
        modules: [],
        server: { ws: { send: (message: unknown) => sent.push(message) } },
      };
    };
    if (typeof core.handleHotUpdate !== 'function') throw new Error('HMR hook missing');
    await Deno.writeTextFile(file, source.replace('this.count++;', 'this.count += 2;'));
    const compatible = await (core.handleHotUpdate as unknown as (input: unknown) => unknown)(
      hmr(),
    );
    assertEquals(compatible, []);
    assertEquals(sent, []);

    await Deno.writeTextFile(
      file,
      source.replace(
        '<button onClick={this.increment}>{this.count}</button>',
        '<div>{this.count}</div>',
      ),
    );
    const incompatible = await (core.handleHotUpdate as unknown as (input: unknown) => unknown)(
      hmr(),
    );
    assertEquals(incompatible, []);
    assertEquals(sent, [{ type: 'full-reload' }]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('v0.44 critical assets serialize deterministic head resources and reject unsafe blocking URLs', () => {
  const result = buildCriticalHeadExtras({
    criticalAssets: {
      fonts: [{ href: '/font.woff2', type: 'font/woff2' }],
      styles: [{ css: '/* comment */ .card { color: red; }' }],
      inlineScripts: ['window.__ready = true;'],
    },
  });
  assertStringIncludes(result.headExtras!, '<link rel="preload" as="font"');
  assertStringIncludes(result.headExtras!, '<style>.card{color:red;}</style>');
  assertStringIncludes(result.headExtras!, '<script>window.__ready = true;</script>');
  assertEquals(result.allowHeadExtrasScripts, true);

  assertThrows(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ href: 'https://cdn.example.test/app.css' }] },
      }),
    Error,
    'cross-origin render-blocking stylesheet',
  );
});

Deno.test('v0.44 critical CSS preserves comment syntax inside quoted values', () => {
  const result = buildCriticalHeadExtras({
    criticalAssets: {
      styles: [{ css: '.icon::before { content: "/*keep*/"; color: red; }' }],
    },
  });

  assertStringIncludes(
    result.headExtras!,
    '<style>.icon::before{content:"/*keep*/";color:red;}</style>',
  );
});

Deno.test('v0.44 critical assets reject protocol-relative blocking styles', () => {
  assertThrows(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ href: '//cdn.example.test/app.css' }] },
      }),
    Error,
    'cross-origin render-blocking stylesheet',
  );
});

Deno.test('v0.44 critical assets reject unsafe inline CSS', () => {
  assertThrows(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ css: '@import url("https://cdn.example.test/app.css");' }] },
      }),
    Error,
    'Unsafe CSS',
  );
});

Deno.test('v0.44 critical CSS rejects unterminated comments', () => {
  assertThrows(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ css: '.card { color: red; /* missing close' }] },
      }),
    Error,
    'unterminated CSS comment',
  );
});

Deno.test('v0.44 client delivery follows islands imported through a route component', async () => {
  const root = await Deno.makeTempDir({ prefix: 'open-element-alpha4-' });
  try {
    const routesDir = join(root, 'app', 'routes');
    const componentsDir = join(root, 'app', 'components');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.mkdir(componentsDir, { recursive: true });
    await Deno.writeTextFile(
      join(routesDir, 'index.tsx'),
      "import Content from '../components/content.tsx';\n" +
        "const documentation = '<oe-unused />'; // <oe-unused />\n" +
        'export default Content;\nvoid documentation;',
    );
    await Deno.writeTextFile(
      join(componentsDir, 'content.tsx'),
      'export default function Content() { return <oe-used />; }',
    );

    const ctx = new OpenElementBuildContext({});
    ctx.phase3.routesDir = 'app/routes';
    ctx.phase1.cachedRoutes = [{
      path: '/',
      filePath: 'index.tsx',
      type: 'page',
      varName: 'route_index',
    }];

    const reachable = findReachableIslandTags(
      ctx,
      root,
      'dist',
      ['oe-used', 'oe-unused'],
    );
    assertEquals([...reachable], ['oe-used']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('v0.44 client delivery keeps an explicitly imported island capability', async () => {
  const root = await Deno.makeTempDir({ prefix: 'open-element-alpha9-capability-' });
  try {
    const routesDir = join(root, 'app', 'routes');
    const componentsDir = join(root, 'app', 'components');
    const islandsDir = join(root, 'app', 'islands');
    await Deno.mkdir(routesDir, { recursive: true });
    await Deno.mkdir(componentsDir, { recursive: true });
    await Deno.mkdir(islandsDir, { recursive: true });
    await Deno.writeTextFile(
      join(routesDir, 'index.tsx'),
      "import Content from '../components/content.tsx';\nexport default Content;",
    );
    await Deno.writeTextFile(
      join(componentsDir, 'content.tsx'),
      "import '../islands/late-child.tsx';\n" +
        'export default function Content() { return <opaque-third-party />; }',
    );
    await Deno.writeTextFile(
      join(islandsDir, 'late-child.tsx'),
      "import { element, OpenElement, property } from '@openelement/element';\n" +
        "@element('oe-late-child')\n" +
        'export default class LateChild extends OpenElement { render() { return <span />; } }',
    );

    const ctx = new OpenElementBuildContext({});
    ctx.phase3.routesDir = 'app/routes';
    ctx.phase1.cachedRoutes = [{
      path: '/',
      filePath: 'index.tsx',
      type: 'page',
      varName: 'route_index',
    }];

    const reachable = findReachableIslandTags(ctx, root, 'dist', ['oe-late-child']);
    assertEquals([...reachable], ['oe-late-child']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
