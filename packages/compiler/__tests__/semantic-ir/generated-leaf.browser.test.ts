/**
 * M05 v2 — S1 generated-leaf evidence in a real engine (G1 draft; NOT the G1
 * record — the Lead compiles it and the owner signs).
 *
 * The generated artifact (M05 leaf-codegen v2 over the M03 model/registry) is
 * injected into a Playwright page together with a bundle of the real M04
 * runtime primitives (`packages/element/src/internal/compiled/runtime/*` plus
 * `lifetime-scope` and the signal framework). The artifact under test therefore
 * calls the real `createRecipe`/`insertRecipe`/`bindSignalWrites`/`displayValue`
 * surface, not stubs. Engine selection mirrors the repository matrix policy:
 * default chromium (the G1 draft engine); OE_BROWSER_MATRIX widens locally
 * (three-engine qualification is M13 and is NOT claimed here).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/leaf.tsx';
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

interface Engine {
  readonly name: string;
  readonly launch: () => Promise<Browser>;
}

/** Same OE_BROWSER_MATRIX contract as vitest.config.ts / the prototype harness. */
function engines(): Engine[] {
  const all: Engine[] = [
    { name: 'chromium', launch: () => chromium.launch() },
    { name: 'firefox', launch: () => firefox.launch() },
    { name: 'webkit', launch: () => webkit.launch() },
  ];
  switch (process.env.OE_BROWSER_MATRIX ?? 'chromium') {
    case '':
    case 'chromium':
      return [all[0]!];
    case 'firefox':
      return [all[1]!];
    case 'webkit':
      return [all[2]!];
    case 'full':
      return all;
    default:
      throw new Error(`unknown OE_BROWSER_MATRIX: ${process.env.OE_BROWSER_MATRIX}`);
  }
}

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

/** Compile one authored component and emit its generated leaf module. */
function generatedModule(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  if (front.diagnostics.length > 0) {
    throw new Error(`frontend refused: ${front.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const generated = generateLeafModule(front.module!);
  if (generated.module === null) {
    throw new Error(`codegen refused: ${generated.diagnostics.map((d) => d.code).join(', ')}`);
  }
  return generated.module;
}

/**
 * Rewrite the emitted ESM artifact for the page: the compiler-private runtime
 * specifier is resolved to the injected M04 bundle, and the factory exports are
 * exposed for the driver. This is the harness adapter; the artifact itself keeps
 * the real import shape.
 */
function harnessModule(module: string): string {
  const importLine = new RegExp(
    `^import \\{[^}]+\\} from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};$`,
    'm',
  );
  const names = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const withoutImport = module.replace(importLine, (line) => {
    const imported = line.slice(line.indexOf('{') + 1, line.indexOf('}')).trim();
    return `const { ${imported} } = window.__oeRuntime;`;
  });
  const body = withoutImport.replace(/^export function /gm, 'function ');
  // Each scenario injects its own module: wrap in an IIFE so consecutive
  // script tags cannot collide on their top-level runtime destructuring.
  return `(function () {\n${body}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

/** Build the M04 runtime primitives as a browser IIFE (real modules, not stubs). */
async function buildRuntimeBundle(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m05-runtime-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      [
        `export { createRecipe, insertRecipe } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/compiled/runtime/recipe.ts`)};`,
        `export { bindSignalWrites } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/compiled/runtime/bindings.ts`)};`,
        `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/compiled/runtime/values.ts`)};`,
        `export { LifetimeScope } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/compiled/lifetime-scope.ts`)};`,
        `export { signal, computed } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/signal/framework.ts`)};`,
        '',
      ].join('\n'),
    );
    const result = await build({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry,
          formats: ['iife'],
          name: '__oeRuntime',
          fileName: () => 'runtime.js',
        },
      },
    });
    const output = Array.isArray(result)
      ? result[0]!.output
      : (result as { output: unknown[] }).output;
    const chunk = (output as Array<{ type: string; code?: string }>).find(
      (entry) => entry.type === 'chunk',
    );
    if (chunk?.code === undefined) throw new Error('runtime bundle produced no chunk');
    return chunk.code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Snapshot {
  readonly html: string;
  readonly text: string;
  readonly tags: string[];
  readonly attributes: Record<string, string | null>;
  readonly childCount: number;
}

interface DriverResult {
  readonly mounted: Snapshot;
  readonly updated: Snapshot | null;
  readonly afterDefaultDispose: Snapshot | null;
  readonly afterDetachDispose: Snapshot | null;
  readonly throwingCleanup: {
    readonly threw: boolean;
    readonly message: string;
    readonly normalUnsubscribed: boolean;
  } | null;
  readonly emptyMountedChildCount: number | null;
}

/** Run one S1 scenario in the page. All host values are built with real signals. */
async function runScenario(
  page: Page,
  moduleCode: string,
  scenario: string,
): Promise<DriverResult> {
  await page.addScriptTag({ content: harnessModule(moduleCode) });
  return page.evaluate(
    ({ scenario }) => {
      interface SignalLike<T> {
        readonly value: T;
        subscribe(fn: (value: T) => void): () => void;
      }
      interface Runtime {
        createRecipe: unknown;
        insertRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
          before?: Node | null,
        ) => { dispose(detach?: boolean): void; nodes: readonly Node[] };
        LifetimeScope: new () => unknown;
        signal: <T>(value: T) => SignalLike<T> & { value: T };
        computed: <T>(fn: () => T) => SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      const host = document.getElementById('host') as HTMLElement;
      host.replaceChildren();
      const scope = new runtime.LifetimeScope();
      const snapshot = (): Snapshot => ({
        html: host.innerHTML,
        text: host.textContent ?? '',
        tags: [...host.querySelectorAll('*')].map((element) => element.tagName.toLowerCase()),
        attributes: Object.fromEntries(
          [...(host.firstElementChild?.attributes ?? [])].map((attribute) => [
            attribute.name,
            attribute.value,
          ]),
        ),
        childCount: host.childNodes.length,
      });
      const result: DriverResult = {
        mounted: snapshot(),
        updated: null,
        afterDefaultDispose: null,
        afterDetachDispose: null,
        throwingCleanup: null,
        emptyMountedChildCount: null,
      };
      const empty = snapshot();
      result.mounted = empty;

      if (scenario === 'counter') {
        const count = runtime.signal(0);
        const doubled = runtime.computed(() => count.value * 2);
        const propsChanged = runtime.signal(0);
        const hostValues = {
          props: { label: 'ready' },
          bindings: { count, doubled },
          propsChanged,
        };
        const recipe = factories.createCounterRecipe!(scope, hostValues);
        const projection = runtime.insertRecipe(scope, recipe, host);
        result.mounted = snapshot();
        count.value = 5;
        result.updated = snapshot();
        (hostValues.props as { label: string }).label = 'next';
        propsChanged.value += 1;
        result.updated = snapshot();
        projection.dispose();
        result.afterDefaultDispose = snapshot();
        return result;
      }

      if (scenario === 'detach') {
        const count = runtime.signal(1);
        const recipe = factories.createCounterRecipe!(scope, {
          props: { label: 'x' },
          bindings: { count, doubled: runtime.computed(() => count.value) },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        result.mounted = snapshot();
        projection.dispose(true);
        result.afterDetachDispose = snapshot();
        return result;
      }

      if (scenario === 'multi') {
        const recipe = factories.createMultiRecipe!(scope, {
          props: { title: 'x' },
          bindings: { label: runtime.signal('a') },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        result.mounted = snapshot();
        projection.dispose(true);
        result.afterDetachDispose = snapshot();
        return result;
      }

      if (scenario === 'empty') {
        const recipe = factories.createEmptyRecipe!(scope, { props: {}, bindings: {} });
        const projection = runtime.insertRecipe(scope, recipe, host);
        result.emptyMountedChildCount = host.childNodes.length;
        projection.dispose(true);
        return result;
      }

      if (scenario === 'throwing') {
        let normalUnsubscribed = false;
        const normal: SignalLike<number> = {
          value: 0,
          subscribe() {
            return () => {
              normalUnsubscribed = true;
            };
          },
        };
        const throwing: SignalLike<number> = {
          value: 0,
          subscribe() {
            return () => {
              throw new Error('OEIR_TEST_THROWING_CLEANUP');
            };
          },
        };
        const recipe = factories.createThrowingRecipe!(scope, {
          props: { label: 'x' },
          bindings: { normal, throwing },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        try {
          projection.dispose(true);
        } catch (error) {
          result.throwingCleanup = {
            threw: true,
            message: String((error as Error).message),
            normalUnsubscribed,
          };
        }
        result.afterDetachDispose = snapshot();
        return result;
      }

      return result;
    },
    { scenario },
  );
}

const COUNTER_SOURCE = `import { signal, computed } from '@openelement/element';
function Counter(props) {
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  return (
    <section data-count={count.value} data-doubled={doubled.value}>
      <p title={props.label}>{props.label}: {count.value} / {doubled.value}</p>
    </section>
  );
}
`;

const MULTI_SOURCE = `import { signal } from '@openelement/element';
function Multi(props) {
  const label = signal('a');
  return <><h1>{label.value}</h1><p title={props.title}>text</p></>;
}
`;

const EMPTY_SOURCE = 'function Empty(props) { return <></>; }\n';

const THROWING_SOURCE = `import { signal } from '@openelement/element';
function Throwing(props) {
  const normal = signal(0);
  const throwing = signal(0);
  return <div title={props.label}>{normal.value}:{throwing.value}</div>;
}
`;

for (const engine of engines()) {
  describe(`M05 leaf v2 — S1 generated code in ${engine.name} (G1 draft)`, () => {
    let browser: Browser;
    let page: Page;
    let engineVersion = '';

    beforeAll(async () => {
      const runtimeCode = await buildRuntimeBundle();
      browser = await engine.launch();
      engineVersion = browser.version();
      console.log(`[G1-draft] engine=${engine.name} version=${engineVersion}`);
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
      await page.addScriptTag({ content: runtimeCode });
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    test('single root: mount, signal+computed update, props refresh, default dispose keeps DOM', async () => {
      const result = await runScenario(page, generatedModule(COUNTER_SOURCE), 'counter');
      expect(result.mounted.tags).toEqual(['section', 'p']);
      expect(result.mounted.attributes['data-count']).toBe('0');
      expect(result.mounted.attributes['data-doubled']).toBe('0');
      expect(result.mounted.text).toBe('ready: 0 / 0');
      expect(result.updated?.attributes['data-count']).toBe('5');
      expect(result.updated?.attributes['data-doubled']).toBe('10');
      expect(result.updated?.text).toBe('next: 5 / 10');
      expect(result.afterDefaultDispose?.childCount).toBe(1);
      expect(engineVersion.length).toBeGreaterThan(0);
    });

    test('detach dispose removes the region from the host', async () => {
      const result = await runScenario(page, generatedModule(COUNTER_SOURCE), 'detach');
      expect(result.mounted.childCount).toBe(1);
      expect(result.afterDetachDispose?.childCount).toBe(0);
    });

    test('multi-root / fragment output mounts both roots in authored order', async () => {
      const result = await runScenario(page, generatedModule(MULTI_SOURCE), 'multi');
      expect(result.mounted.tags).toEqual(['h1', 'p']);
      expect(result.mounted.text).toBe('atext');
      expect(result.afterDetachDispose?.childCount).toBe(0);
    });

    test('empty output mounts no nodes and disposes cleanly', async () => {
      const result = await runScenario(page, generatedModule(EMPTY_SOURCE), 'empty');
      expect(result.emptyMountedChildCount).toBe(0);
    });

    test('a throwing cleanup does not block the remaining cleanup or region removal', async () => {
      const result = await runScenario(page, generatedModule(THROWING_SOURCE), 'throwing');
      expect(result.throwingCleanup?.threw).toBe(true);
      expect(result.throwingCleanup?.message).toContain('OEIR_TEST_THROWING_CLEANUP');
      expect(result.throwingCleanup?.normalUnsubscribed).toBe(true);
      expect(result.afterDetachDispose?.childCount).toBe(0);
    });
  });
}
