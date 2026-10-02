import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { join } from '@std/path';
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

test('v0.44 island delivery emits one scheduler for multi-element media islands', () => {
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

  expect((code.match(/createIslandScheduler/g) ?? []).length).toEqual(1);
  expect(code).toContain("media: ['oe-clock', 'oe-calendar']");
  expect(code).toContain("matchMedia('(prefers-reduced-motion: no-preference)')");
  expect(code).toContain('oe-clock');
  expect(code).toContain('oe-calendar');
});

test('v0.44 compiler behavior metadata controls exact client output', () => {
  const declarations = compilerBehaviorDeclarations(
    [
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
    ],
    'idle',
  );
  expect(declarations.map((entry) => entry.tagName)).toEqual(['oe-menu-button']);

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
  expect(code).toContain('"oe-menu-button": () => import("/app/components/menu-button.tsx")');
  expect(code).toContain('idle: ["oe-menu-button"]');
  expect(code.includes('oe-static-card')).toEqual(false);
});

test('v0.44 media delivery loads once when the query first matches', () => {
  const readyEvents: Array<{ strategy: string; islands: readonly string[] }> = [];
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  let loaded = 0;
  const scheduler = createIslandScheduler({
    idleFallbackTimeoutMs: 25,
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

  expect(typeof scheduler.observeVisible).toEqual('function');
  expect(loaded).toEqual(0);
  expect(readyEvents).toEqual([]);
  listeners[0]({ matches: true });
  listeners[0]({ matches: true });
  expect(loaded).toEqual(1);
  expect(readyEvents).toEqual([{ strategy: 'media', islands: ['oe-media'] }]);
});

test('v0.44 one capability module registers many native element constructors once', () => {
  const code = generateClientEntry([
    {
      tagName: 'oe-clock',
      tags: ['oe-clock', 'oe-calendar'],
      modulePath: './clock.ts',
      strategy: 'load',
      exportNames: { 'oe-clock': 'Clock', 'oe-calendar': 'Calendar' },
    },
  ]);

  expect((code.match(/import\(["']\.\/clock\.ts["']\)/g) ?? []).length).toEqual(1);
  expect(code).toContain('mod["Clock"]');
  expect(code).toContain('mod["Calendar"]');
  expect(code).toContain('customElements.define("oe-clock"');
  expect(code).toContain('customElements.define("oe-calendar"');
  expect(code).toContain("typeof __Ctor0_0 !== 'function'");
  expect((code.match(/createIslandScheduler/g) ?? []).length).toEqual(1);
});

test('v0.44 island metadata remains static and carries delivery aliases', () => {
  const meta = readIslandConfig(`
    export const openElement = defineIslandConfig({
      hydrate: 'media',
      media: '(min-width: 40rem)',
      tags: ['oe-clock', 'oe-calendar'],
      exportNames: { 'oe-clock': 'Clock', 'oe-calendar': 'Calendar' },
    });
  `);
  expect(meta).toEqual({
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
  expect(escapedMedia?.media).toEqual('(min-width: 40rem)');

  assertThrowsIncludes(
    () => readIslandConfig('export const openElement = defineIslandConfig({ tags: dynamicTags });'),
    Error,
    'openElement.tags must be an array of string literals',
  );
  assertThrowsIncludes(
    () =>
      readIslandConfig(
        "export const openElement = defineIslandConfig(makeConfig({ hydrate: 'load' }));",
      ),
    Error,
    'static object literal',
  );
  assertThrowsIncludes(
    () =>
      readIslandConfig("export const openElement = defineIslandConfig({ hydrate: 'load' }).value;"),
    Error,
    'one static object literal',
  );
});

test('v0.44 SSR admission expands one capability declaration per delivered tag', () => {
  const plan = buildSsrAdmissionPlan([
    {
      tagName: 'oe-clock',
      modulePath: './clock.ts',
      source: 'local',
      tags: ['oe-clock', 'oe-calendar'],
    } as unknown as Parameters<typeof buildSsrAdmissionPlan>[0][number],
  ]);

  expect(plan.renderableTags).toEqual(['oe-clock', 'oe-calendar']);
  expect(plan.clientOnlyTags).toEqual([]);
  expect(plan.decisions.map((decision) => decision.tagName)).toEqual(['oe-clock', 'oe-calendar']);
});

test('v0.44 compiler source records pass through the Vite source map', () => {
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
  expect(result?.map.x_openElement).toEqual(result?.program.sourceMap);
  expect(result?.map.sources).toEqual(['/src/clock.tsx']);
  expect(result?.map.sourcesContent).toEqual([source]);
});

test('v0.44 compiler hook transforms once and classifies HMR shape changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-element-alpha4-hmr-'));
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
    await writeFile(file, source);

    const plugins = createOpenPlugin();
    const core = plugins.find((plugin) => plugin.name === 'open:core');
    const compiler = compiledElementPlugin();
    if (!core || typeof core.transform !== 'function') {
      throw new Error('canonical compiler integration hook was not registered');
    }
    const transform = core.transform as unknown as (
      // Vite's `this.error()` accepts a string or a Rollup error object; the
      // compiler adapter passes the structured form since #1413.
      this: { error(error: string | { message: string }): never },
      code: string,
      id: string,
    ) => { code: string; map?: unknown } | null;
    const transformed = transform.call(
      {
        error: (error: string | { message: string }) => {
          throw new Error(typeof error === 'string' ? error : error.message);
        },
      },
      source,
      file,
    );
    if (!transformed) throw new Error('core compiler hook did not emit code');
    expect(transformed.code).toContain('__partProgram');
    expect(
      (compiler.transform as unknown as (code: string, id: string) => unknown)(
        transformed.code,
        file,
      ),
    ).toEqual(null);

    const sent: unknown[] = [];
    const hmr = () => {
      return {
        file,
        modules: [],
        server: { ws: { send: (message: unknown) => sent.push(message) } },
      };
    };
    if (typeof core.handleHotUpdate !== 'function') throw new Error('HMR hook missing');
    await writeFile(file, source.replace('this.count++;', 'this.count += 2;'));
    const compatible = await (core.handleHotUpdate as unknown as (input: unknown) => unknown)(
      hmr(),
    );
    expect(compatible).toEqual([]);
    expect(sent).toEqual([]);

    await writeFile(
      file,
      source.replace(
        '<button onClick={this.increment}>{this.count}</button>',
        '<div>{this.count}</div>',
      ),
    );
    const incompatible = await (core.handleHotUpdate as unknown as (input: unknown) => unknown)(
      hmr(),
    );
    expect(incompatible).toEqual([]);
    expect(sent).toEqual([{ type: 'full-reload' }]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('v0.44 critical assets serialize deterministic head resources and reject unsafe blocking URLs', () => {
  const result = buildCriticalHeadExtras({
    criticalAssets: {
      fonts: [{ href: '/font.woff2', type: 'font/woff2' }],
      styles: [{ css: '/* comment */ .card { color: red; }' }],
      inlineScripts: ['window.__ready = true;'],
    },
  });
  expect(result.headExtras!).toContain('<link rel="preload" as="font"');
  expect(result.headExtras!).toContain('<style>.card{color:red;}</style>');
  expect(result.headExtras!).toContain('<script>window.__ready = true;</script>');
  expect(result.allowHeadExtrasScripts).toEqual(true);

  assertThrowsIncludes(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ href: 'https://cdn.example.test/app.css' }] },
      }),
    Error,
    'cross-origin render-blocking stylesheet',
  );
});

test('v0.44 critical CSS preserves comment syntax inside quoted values', () => {
  const result = buildCriticalHeadExtras({
    criticalAssets: {
      styles: [{ css: '.icon::before { content: "/*keep*/"; color: red; }' }],
    },
  });

  expect(result.headExtras!).toContain(
    '<style>.icon::before{content:"/*keep*/";color:red;}</style>',
  );
});

test('v0.44 critical assets reject protocol-relative blocking styles', () => {
  assertThrowsIncludes(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ href: '//cdn.example.test/app.css' }] },
      }),
    Error,
    'cross-origin render-blocking stylesheet',
  );
});

test('v0.44 critical assets reject unsafe inline CSS', () => {
  assertThrowsIncludes(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ css: '@import url("https://cdn.example.test/app.css");' }] },
      }),
    Error,
    'Unsafe CSS',
  );
});

test('v0.44 critical CSS rejects unterminated comments', () => {
  assertThrowsIncludes(
    () =>
      buildCriticalHeadExtras({
        criticalAssets: { styles: [{ css: '.card { color: red; /* missing close' }] },
      }),
    Error,
    'unterminated CSS comment',
  );
});

test('v0.44 client delivery follows islands imported through a route component', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-element-alpha4-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    const componentsDir = join(root, 'app', 'components');
    await mkdir(routesDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });
    await writeFile(
      join(routesDir, 'index.tsx'),
      "import Content from '../components/content.tsx';\n" +
        "const documentation = '<oe-unused />'; // <oe-unused />\n" +
        'export default Content;\nvoid documentation;',
    );
    await writeFile(
      join(componentsDir, 'content.tsx'),
      'export default function Content() { return <oe-used />; }',
    );

    const ctx = new OpenElementBuildContext({});
    ctx.phase3.routesDir = 'app/routes';
    ctx.phase1.cachedRoutes = [
      {
        path: '/',
        filePath: 'index.tsx',
        type: 'page',
        varName: 'route_index',
      },
    ];

    const reachable = findReachableIslandTags(ctx, root, 'dist', ['oe-used', 'oe-unused']);
    expect([...reachable]).toEqual(['oe-used']);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('v0.44 client delivery keeps an explicitly imported island capability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-element-alpha9-capability-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    const componentsDir = join(root, 'app', 'components');
    const islandsDir = join(root, 'app', 'islands');
    await mkdir(routesDir, { recursive: true });
    await mkdir(componentsDir, { recursive: true });
    await mkdir(islandsDir, { recursive: true });
    await writeFile(
      join(routesDir, 'index.tsx'),
      "import Content from '../components/content.tsx';\nexport default Content;",
    );
    await writeFile(
      join(componentsDir, 'content.tsx'),
      "import '../islands/late-child.tsx';\n" +
        'export default function Content() { return <opaque-third-party />; }',
    );
    await writeFile(
      join(islandsDir, 'late-child.tsx'),
      "import { element, OpenElement, property } from '@openelement/element';\n" +
        "@element('oe-late-child')\n" +
        'export default class LateChild extends OpenElement { render() { return <span />; } }',
    );

    const ctx = new OpenElementBuildContext({});
    ctx.phase3.routesDir = 'app/routes';
    ctx.phase1.cachedRoutes = [
      {
        path: '/',
        filePath: 'index.tsx',
        type: 'page',
        varName: 'route_index',
      },
    ];

    const reachable = findReachableIslandTags(ctx, root, 'dist', ['oe-late-child']);
    expect([...reachable]).toEqual(['oe-late-child']);
  } finally {
    await rm(root, { recursive: true });
  }
});
