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
        `export { runtimeProbe } from ${JSON.stringify(`${REPO_ROOT}packages/element/src/internal/compiled/runtime/observability.ts`)};`,
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

// ─── M06 S2: stateful hostless list evidence ────────────────────────────────
// The same real-M04 runtime bundle is used (no stubs). These scenarios cover
// the S2 evidence: keyed reorder DOM identity, focus/selection preservation,
// insert/delete cleanup accounting, condition branch replacement, private
// draft isolation, and throwing-branch containment.

const BOARD_SOURCE = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
  </section>;
}
`;

const FOCUS_SOURCE = `import { signal } from '@openelement/element';
function Form(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}><input value={item.label} /></li>)}</ul>;
}
`;

const THROWING_BRANCH_SOURCE = `function Guard(props) {
  return <section>{props.explode ? <p title={props.boom}>x</p> : <em>safe</em>}</section>;
}
`;

interface S2Result {
  readonly steps: readonly Snapshot[];
  readonly identityPreserved: readonly boolean[];
  readonly focusPreserved: boolean | null;
  readonly selectionPreserved: boolean | null;
  readonly focusNodeIdentity: boolean | null;
  readonly subscriptionsBefore: number;
  readonly subscriptionsAfter: number;
  readonly unsubscribedBefore: number;
  readonly unsubscribedAfter: number;
  readonly thrown: string | null;
  readonly recovered: Snapshot | null;
}

async function runS2Scenario(page: Page, moduleCode: string, scenario: string): Promise<S2Result> {
  await page.addScriptTag({ content: harnessModule(moduleCode) });
  return page.evaluate(
    ({ scenario }) => {
      interface SignalLike<T> {
        readonly value: T;
        subscribe(fn: (value: T) => void): () => void;
      }
      interface Runtime {
        insertRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
          before?: Node | null,
        ) => { dispose(detach?: boolean): void; nodes: readonly Node[] };
        LifetimeScope: new () => unknown;
        signal: <T>(value: T) => SignalLike<T> & { value: T };
        runtimeProbe: { snapshot(): { subscriptions: number; unsubscribed: number } };
      }
      interface Counting<T> extends SignalLike<T> {
        value: T;
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
          [...(host.querySelectorAll('[data-count]') ?? [])].map((element) => [
            element.tagName.toLowerCase(),
            element.getAttribute('data-count'),
          ]),
        ),
        childCount: host.childNodes.length,
      });
      const counting = <T>(initial: T): Counting<T> => {
        const inner = runtime.signal(initial);
        // Keep the real signal surface (read/write/subscribe) so the generated
        // `bindSignalWrites` reads and the scenario writes both work.
        return {
          get value(): T {
            return inner.value;
          },
          set value(next: T) {
            (inner as { value: T }).value = next;
          },
          subscribe(fn: (value: T) => void) {
            return inner.subscribe(fn);
          },
        } as Counting<T>;
      };
      const result: S2Result = {
        steps: [],
        identityPreserved: [],
        focusPreserved: null,
        selectionPreserved: null,
        focusNodeIdentity: null,
        subscriptionsBefore: 0,
        subscriptionsAfter: 0,
        unsubscribedBefore: 0,
        unsubscribedAfter: 0,
        thrown: null,
        recovered: null,
      };

      if (scenario === 'board') {
        const open = counting(true);
        const items = counting([] as Array<{ id: string; label: string }>);
        const count = counting(0);
        const recipe = factories.createBoardRecipe!(scope, {
          props: {},
          bindings: { open, items, count },
          propsChanged: runtime.signal(0),
        });
        runtime.insertRecipe(scope, recipe, host);
        result.steps.push(snapshot());

        items.value = [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ];
        count.value = 7;
        result.steps.push(snapshot());
        const before = [...host.querySelectorAll('li')];

        // Keyed reorder: b, a, c — the DOM nodes must move, not re-create.
        items.value = [
          { id: 'b', label: 'B' },
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ];
        result.steps.push(snapshot());
        const after = [...host.querySelectorAll('li')];
        result.identityPreserved.push(
          before[0] === after[1],
          before[1] === after[0],
          before[2] === after[2],
        );

        // Private draft: an unrelated signal write only refreshes its own slot.
        const identityBefore = [...host.querySelectorAll('li')];
        count.value = 9;
        const identityAfter = [...host.querySelectorAll('li')];
        result.identityPreserved.push(
          identityBefore.every((node, index) => node === identityAfter[index]),
        );
        result.steps.push(snapshot());

        // Delete one entry: its owner/region and subscriptions are disposed.
        const probe = runtime.runtimeProbe;
        result.subscriptionsBefore = probe.snapshot().subscriptions;
        result.unsubscribedBefore = probe.snapshot().unsubscribed;
        items.value = [
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ];
        result.steps.push(snapshot());
        result.subscriptionsAfter = probe.snapshot().subscriptions;
        result.unsubscribedAfter = probe.snapshot().unsubscribed;
        open.value = false;
        result.steps.push(snapshot());
        open.value = true;
        result.steps.push(snapshot());
        return result;
      }

      if (scenario === 'focus') {
        const items = counting([
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]);
        const recipe = factories.createFormRecipe!(scope, {
          props: {},
          bindings: { items },
          propsChanged: runtime.signal(0),
        });
        runtime.insertRecipe(scope, recipe, host);
        result.steps.push(snapshot());
        const inputs = [...host.querySelectorAll('input')];
        const focused = inputs[1]!;
        focused.focus();
        focused.setSelectionRange(1, 1);
        items.value = [
          { id: 'b', label: 'B' },
          { id: 'a', label: 'A' },
        ];
        result.steps.push(snapshot());
        const afterInputs = [...host.querySelectorAll('input')];
        result.focusNodeIdentity = document.activeElement === focused;
        result.focusPreserved = document.activeElement === afterInputs[0];
        result.selectionPreserved = focused.selectionStart === 1 && focused.selectionEnd === 1;
        return result;
      }

      if (scenario === 'throwing-branch') {
        const props: Record<string, unknown> = { explode: false, label: 'x', boom: 'ok' };
        const propsChanged = runtime.signal(0);
        const recipe = factories.createGuardRecipe!(scope, {
          props,
          bindings: {},
          propsChanged,
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        result.steps.push(snapshot());
        Object.defineProperty(props, 'boom', {
          configurable: true,
          get() {
            throw new Error('OEIR_TEST_BRANCH_THROW');
          },
        });
        props.explode = true;
        try {
          propsChanged.value += 1;
        } catch (error) {
          result.thrown = String((error as Error).message);
        }
        result.steps.push(snapshot());
        props.explode = false;
        delete (props as { boom?: unknown }).boom;
        propsChanged.value += 1;
        result.recovered = snapshot();
        projection.dispose(true);
        return result;
      }

      return result;
    },
    { scenario },
  );
}

for (const engine of engines()) {
  describe(`M06 S2 — stateful hostless list in ${engine.name} (LOCAL evidence)`, () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      const runtimeCode = await buildRuntimeBundle();
      browser = await engine.launch();
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
      await page.addScriptTag({ content: runtimeCode });
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    test('keyed reorder preserves DOM identity; private draft and delete keep cleanup accounting', async () => {
      const board = generatedModule(BOARD_SOURCE);
      const result = await runS2Scenario(page, board, 'board');
      expect(result.steps[0]?.tags).toEqual(['section', 'p', 'ul']);
      expect(result.steps[1]?.tags).toEqual(['section', 'p', 'ul', 'li', 'li', 'li']);
      expect(result.steps[1]?.text).toBe('openA: 7B: 7C: 7');
      expect(result.steps[2]?.text).toBe('openB: 7A: 7C: 7');
      expect(result.identityPreserved.slice(0, 3)).toEqual([true, true, true]);
      expect(result.identityPreserved[3]).toBe(true);
      expect(result.steps[3]?.text).toBe('openB: 9A: 9C: 9');
      expect(result.steps[4]?.tags).toEqual(['section', 'p', 'ul', 'li', 'li']);
      expect(result.steps[4]?.text).toBe('openA: 9C: 9');
      // The deleted entry's subscription is closed on disposal.
      expect(result.unsubscribedAfter).toBeGreaterThan(result.unsubscribedBefore);
    });

    test('condition branch replacement swaps nodes without leaking the old branch', async () => {
      const result = await runS2Scenario(page, generatedModule(BOARD_SOURCE), 'board');
      const toggledOff = result.steps[5]!;
      const toggledOn = result.steps[6]!;
      expect(result.steps[0]?.tags).toContain('p');
      expect(toggledOff.tags).toEqual(['section', 'em', 'ul', 'li', 'li']);
      expect(toggledOff.text).toContain('closed');
      expect(toggledOff.tags).not.toContain('p');
      expect(toggledOn.tags).toEqual(['section', 'p', 'ul', 'li', 'li']);
      expect(toggledOn.text).toContain('open');
      expect(toggledOn.tags).not.toContain('em');
    });

    test('focus and selection survive a keyed reorder (nodes move, not re-created)', async () => {
      const result = await runS2Scenario(page, generatedModule(FOCUS_SOURCE), 'focus');
      expect(result.focusNodeIdentity).toBe(true);
      expect(result.focusPreserved).toBe(true);
      expect(result.selectionPreserved).toBe(true);
    });

    test('a throwing branch surfaces the error, removes no neighbour DOM and recovers', async () => {
      const result = await runS2Scenario(
        page,
        generatedModule(THROWING_BRANCH_SOURCE),
        'throwing-branch',
      );
      expect(result.thrown).toContain('OEIR_TEST_BRANCH_THROW');
      expect(result.steps[1]?.tags).toEqual(['section']);
      expect(result.recovered?.text).toBe('safe');
    });
  });
}

// ─── M06b1b S2b: owner isolation evidence ──────────────────────────────────
// The same real-M04 runtime bundle is used (no stubs). These scenarios evidence
// the M06b1a-1/-2 generated composition shapes in a real engine: component-
// reference mounts with per-read props, one reusable-JSX recipe inserted twice
// (two isolated projections/owners/regions), projection disposal isolation and
// the coded owner-lineage negatives. LOCAL chromium evidence only; three-engine
// qualification is M13 and is not claimed here.

const CHILD_PARENT_SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <li data-kind="child" data-label={props.label}>{props.text}</li>;
}
function Parent(props) {
  const label = signal('a');
  return <ul>
    <Child text={label.value} label="static" />
    <Child text="literal" label="second" />
  </ul>;
}
`;

const CHIP_SOURCE = `import { signal } from '@openelement/element';
function Chip(props) {
  const tone = signal('blue');
  const chip = <i class="chip" title={tone.value}>{tone.value}</i>;
  return <div><b>a</b>{chip}<span>{chip}</span></div>;
}
`;

const LEAF_SOURCE = `import { signal } from '@openelement/element';
function Leaf(props) {
  const label = signal('x');
  return <p class="leaf">{label.value}</p>;
}
`;

interface S2bSnapshot {
  readonly html: string;
  readonly text: string;
  readonly tags: string[];
  readonly childCount: number;
  readonly elements: readonly {
    readonly tag: string;
    readonly text: string;
    readonly title: string | null;
    readonly label: string | null;
    readonly className: string | null;
  }[];
}

interface S2bProbe {
  readonly projections: number;
  readonly regions: number;
  readonly owners: number;
  readonly nodes: number;
  readonly rangeCleanups: number;
  readonly subscriptions: number;
  readonly unsubscribed: number;
  readonly lineageAccepted: number;
  readonly lineageRejected: number;
  readonly disposed: number;
}

interface S2bResult {
  /** Host snapshots, recorded one per {@linkcode record} call. */
  readonly steps: readonly S2bSnapshot[];
  /** `runtimeProbe.snapshot()` after each step (aligned 1:1 with `steps`). */
  readonly probes: readonly S2bProbe[];
  /** Scenario-specific DOM identity observations. */
  readonly identities: readonly boolean[];
  /** Scenario-specific boolean observations. */
  readonly flags: readonly boolean[];
  /** Caught lineage failure codes (`null` when the thrown error carries none). */
  readonly codes: readonly (string | null)[];
}

async function runS2bScenario(
  page: Page,
  moduleCode: string,
  scenario: string,
): Promise<S2bResult> {
  await page.addScriptTag({ content: harnessModule(moduleCode) });
  return page.evaluate(
    ({ scenario }) => {
      interface SignalLike<T> {
        readonly value: T;
        subscribe(fn: (value: T) => void): () => void;
      }
      interface Scope {
        child(): Scope;
        dispose(detach?: boolean): void;
      }
      interface ProjectionHandle {
        readonly region: number;
        readonly owner: Scope;
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        insertRecipe: (
          owner: Scope,
          recipe: unknown,
          parent: Node,
          before?: Node | null,
        ) => ProjectionHandle;
        LifetimeScope: new () => Scope;
        signal: <T>(value: T) => SignalLike<T> & { value: T };
        runtimeProbe: { snapshot(): S2bProbe; reset(): void };
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
      const probe = runtime.runtimeProbe;
      probe.reset();
      const snapshot = (): S2bSnapshot => ({
        html: host.innerHTML,
        text: host.textContent ?? '',
        tags: [...host.querySelectorAll('*')].map((element) => element.tagName.toLowerCase()),
        childCount: host.childNodes.length,
        elements: [...host.querySelectorAll('*')].map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: element.textContent ?? '',
          title: element.getAttribute('title'),
          label: element.getAttribute('data-label'),
          className: element.getAttribute('class'),
        })),
      });
      const result: S2bResult = {
        steps: [],
        probes: [],
        identities: [],
        flags: [],
        codes: [],
      };
      const record = (): void => {
        result.steps.push(snapshot());
        result.probes.push(probe.snapshot());
      };
      record();

      // 1. Module-level child mount + per-read props. Two `<Child>` instances in
      // one parent: the dynamic prop is a per-read getter over the defining
      // (parent) scope and refreshes through `host.propDeps`; the static prop is
      // literal data. The parent keeps the two child instances' DOM distinct.
      if (scenario === 'component-refs') {
        const label = runtime.signal('a');
        const recipe = factories.createParentRecipe!(scope, {
          props: {},
          bindings: { label },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        record();
        const mountedChildren = [...host.querySelectorAll('li')];
        result.identities.push(
          mountedChildren.length === 2,
          mountedChildren[0] !== mountedChildren[1],
          mountedChildren[0]?.getAttribute('data-label') === 'static',
          mountedChildren[1]?.getAttribute('data-label') === 'second',
        );
        label.value = 'b';
        record();
        const refreshedChildren = [...host.querySelectorAll('li')];
        result.identities.push(
          mountedChildren[0] === refreshedChildren[0],
          mountedChildren[1] === refreshedChildren[1],
        );
        projection.dispose();
        record();
        label.value = 'c';
        record();
        return result;
      }

      // 2. TSX-09: one reusable-JSX value emitted as ONE inline `createRecipe`
      // projected at TWO `{chip}` sites. The root insertion plus the two site
      // insertions are three independent projections; a tone write refreshes
      // both copies, and the copies are distinct DOM nodes in authored order.
      if (scenario === 'reusable') {
        const tone = runtime.signal('blue');
        const recipe = factories.createChipRecipe!(scope, {
          props: {},
          bindings: { tone },
          propsChanged: runtime.signal(0),
        });
        const projection = runtime.insertRecipe(scope, recipe, host);
        record();
        const chips = [...host.querySelectorAll('i.chip')];
        result.identities.push(
          chips.length === 2,
          chips[0] !== chips[1],
          chips[0]?.parentElement?.tagName === 'DIV',
          chips[1]?.parentElement?.tagName === 'SPAN',
        );
        tone.value = 'red';
        record();
        const refreshedChips = [...host.querySelectorAll('i.chip')];
        result.identities.push(
          chips[0] === refreshedChips[0],
          chips[1] === refreshedChips[1],
          refreshedChips.every((chip) => chip.getAttribute('title') === 'red'),
        );
        projection.dispose();
        record();
        tone.value = 'green';
        record();
        return result;
      }

      // 3. TSX-23: the SAME generated recipe inserted twice through
      // `insertRecipe`. Two isolated projections: distinct region ids, owners,
      // props records and DOM nodes; a signal write refreshes both copies.
      if (scenario === 'same-recipe-twice') {
        const label = runtime.signal('x');
        const recipe = factories.createLeafRecipe!(scope, {
          props: {},
          bindings: { label },
          propsChanged: runtime.signal(0),
        });
        record();
        const first = runtime.insertRecipe(scope, recipe, host);
        const second = runtime.insertRecipe(scope, recipe, host);
        record();
        result.identities.push(
          first.region !== second.region,
          first.owner !== second.owner,
          first.nodes[0] !== second.nodes[0],
          host.childNodes[0] === first.nodes[0],
          host.childNodes[1] === second.nodes[0],
        );
        label.value = 'y';
        record();
        const leaves = [...host.querySelectorAll('p.leaf')];
        result.identities.push(
          leaves[0] === first.nodes[0],
          leaves[1] === second.nodes[0],
          leaves[0]?.textContent === 'y' && leaves[1]?.textContent === 'y',
        );
        return result;
      }

      // 4. Disposal isolation: with two projections live, `dispose(true)` on A
      // removes only A's region; B stays attached and keeps refreshing. Default
      // `dispose()` on B keeps its DOM attached (M04 disconnect/suspend path)
      // while closing its subscriptions.
      if (scenario === 'disposal-isolation') {
        const label = runtime.signal('x');
        const recipe = factories.createLeafRecipe!(scope, {
          props: {},
          bindings: { label },
          propsChanged: runtime.signal(0),
        });
        const a = runtime.insertRecipe(scope, recipe, host);
        const b = runtime.insertRecipe(scope, recipe, host);
        record();
        a.dispose(true);
        record();
        result.flags.push(
          a.nodes.every((node) => !node.isConnected),
          b.nodes.every((node) => node.isConnected),
        );
        label.value = 'y';
        record();
        b.dispose();
        record();
        result.flags.push(b.nodes.every((node) => node.isConnected));
        label.value = 'z';
        record();
        return result;
      }

      // 5. Owner-lineage negatives (TSX-26 shape, no children projection):
      // cross-owner and dead-owner projections fail closed with the catalogue
      // code, before any owner/DOM exists; a legal projection on the definition
      // owner and on one of its descendants is still admitted.
      if (scenario === 'lineage') {
        const codeOf = (error: unknown): string | null => {
          const code = (error as { code?: unknown }).code;
          return typeof code === 'string' ? code : null;
        };
        const reject = (owner: Scope, candidate: unknown): void => {
          try {
            runtime.insertRecipe(owner, candidate, host);
            result.codes.push('NO_THROW');
          } catch (error) {
            result.codes.push(codeOf(error));
          }
        };
        const hostRecord = (): unknown => ({
          props: {},
          bindings: { label: runtime.signal('x') },
          propsChanged: runtime.signal(0),
        });
        const definitionOwner = new runtime.LifetimeScope();
        const recipe = factories.createLeafRecipe!(definitionOwner, hostRecord());
        record();

        // (a) projection owner outside the definition subtree.
        const unrelated = new runtime.LifetimeScope();
        reject(unrelated, recipe);
        record();

        // (b) projection of a recipe whose definition owner is disposed.
        const deadDefinition = new runtime.LifetimeScope();
        const deadRecipe = factories.createLeafRecipe!(deadDefinition, hostRecord());
        deadDefinition.dispose();
        reject(scope, deadRecipe);
        record();

        // (c) projection into a disposed owner.
        const deadSite = new runtime.LifetimeScope();
        deadSite.dispose();
        reject(deadSite, recipe);
        record();

        // (d) legal: the definition owner itself and a live descendant.
        const legal = runtime.insertRecipe(definitionOwner, recipe, host);
        record();
        const descendantProjection = runtime.insertRecipe(definitionOwner.child(), recipe, host);
        record();
        result.identities.push(
          host.childNodes[0] === legal.nodes[0],
          host.childNodes[1] === descendantProjection.nodes[0],
        );
        return result;
      }

      return result;
    },
    { scenario },
  );
}

for (const engine of engines()) {
  describe(`M06b1b S2b — owner isolation in ${engine.name} (LOCAL evidence)`, () => {
    let browser: Browser;
    let page: Page;
    let engineVersion = '';

    beforeAll(async () => {
      const runtimeCode = await buildRuntimeBundle();
      browser = await engine.launch();
      engineVersion = browser.version();
      console.log(`[M06b1b-S2b] engine=${engine.name} version=${engineVersion}`);
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
      await page.addScriptTag({ content: runtimeCode });
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    test('component reference: module-level child mount, per-read props refresh, distinct instances', async () => {
      const result = await runS2bScenario(
        page,
        generatedModule(CHILD_PARENT_SOURCE),
        'component-refs',
      );
      // Mounted: two child instances in authored order; static prop rendered
      // from literal data, dynamic prop read through the parent-scope getter.
      expect(result.steps[1]?.tags).toEqual(['ul', 'li', 'li']);
      expect(result.steps[1]?.elements[1]).toMatchObject({ text: 'a', label: 'static' });
      expect(result.steps[1]?.elements[2]).toMatchObject({ text: 'literal', label: 'second' });
      expect(result.steps[1]?.text).toBe('aliteral');
      expect(result.identities.slice(0, 4)).toEqual([true, true, true, true]);
      // The dynamic child subscribes twice (data-label attribute + text) through
      // the parent bindings its prop expressions depend on.
      expect(result.probes[1]).toMatchObject({
        projections: 1,
        regions: 1,
        owners: 1,
        nodes: 1,
        rangeCleanups: 1,
        subscriptions: 2,
        unsubscribed: 0,
        lineageAccepted: 1,
        lineageRejected: 0,
        disposed: 0,
      });
      // A parent signal write refreshes the child's dynamic prop getter; the
      // static child and both DOM nodes keep their identity.
      expect(result.steps[2]?.elements[1]).toMatchObject({ text: 'b', label: 'static' });
      expect(result.steps[2]?.elements[2]).toMatchObject({ text: 'literal', label: 'second' });
      expect(result.steps[2]?.text).toBe('bliteral');
      expect(result.identities.slice(4)).toEqual([true, true]);
      // Default dispose keeps the parent region attached and closes the child
      // subscription; a later write no longer leaks into the detached instance.
      expect(result.steps[3]?.childCount).toBe(1);
      expect(result.steps[3]?.tags).toEqual(['ul', 'li', 'li']);
      expect(result.steps[3]?.text).toBe('bliteral');
      expect(result.probes[3]).toMatchObject({ disposed: 1, unsubscribed: 2 });
      expect(result.steps[4]?.text).toBe('bliteral');
      expect(engineVersion.length).toBeGreaterThan(0);
    });

    test('reusable JSX value: one recipe projected at two sites yields two independent copies', async () => {
      const result = await runS2bScenario(page, generatedModule(CHIP_SOURCE), 'reusable');
      expect(result.steps[1]?.tags).toEqual(['div', 'b', 'i', 'span', 'i']);
      expect(result.steps[1]?.elements[2]).toMatchObject({ tag: 'i', text: 'blue', title: 'blue' });
      expect(result.steps[1]?.elements[4]).toMatchObject({ tag: 'i', text: 'blue', title: 'blue' });
      expect(result.identities.slice(0, 4)).toEqual([true, true, true, true]);
      // One root projection + the two `{chip}` site projections: each insertion
      // owns one projection, region, owner and range cleanup; the two recipe
      // instances subscribe twice each (title attribute + text).
      expect(result.probes[1]).toMatchObject({
        projections: 3,
        regions: 3,
        owners: 3,
        nodes: 3,
        rangeCleanups: 3,
        subscriptions: 4,
        unsubscribed: 0,
        lineageAccepted: 3,
        lineageRejected: 0,
        disposed: 0,
      });
      // One tone write refreshes BOTH copies (distinct nodes, same signal).
      expect(result.steps[2]?.text).toBe('aredred');
      expect(result.identities.slice(4)).toEqual([true, true, true]);
      // Default dispose keeps the region and closes every instance subscription.
      expect(result.steps[3]?.childCount).toBe(1);
      expect(result.probes[3]).toMatchObject({ disposed: 1, unsubscribed: 4 });
      expect(result.steps[4]?.text).toBe('aredred');
    });

    test('one recipe inserted twice: isolated owners, regions and nodes, both refresh', async () => {
      const result = await runS2bScenario(page, generatedModule(LEAF_SOURCE), 'same-recipe-twice');
      // Creating a recipe allocates no owner, region or DOM (the insertion is
      // the only place those exist).
      expect(result.probes[1]).toEqual(result.probes[0]);
      expect(result.steps[1]?.childCount).toBe(0);
      // Two insertions => two projections/regions/owners/range cleanups/nodes
      // and two write subscriptions; both lineage checks admitted.
      const delta = (index: number): S2bProbe => {
        const after = result.probes[index]!;
        const before = result.probes[index - 1]!;
        return {
          projections: after.projections - before.projections,
          regions: after.regions - before.regions,
          owners: after.owners - before.owners,
          nodes: after.nodes - before.nodes,
          rangeCleanups: after.rangeCleanups - before.rangeCleanups,
          subscriptions: after.subscriptions - before.subscriptions,
          unsubscribed: after.unsubscribed - before.unsubscribed,
          lineageAccepted: after.lineageAccepted - before.lineageAccepted,
          lineageRejected: after.lineageRejected - before.lineageRejected,
          disposed: after.disposed - before.disposed,
        };
      };
      expect(delta(2)).toMatchObject({
        projections: 2,
        regions: 2,
        owners: 2,
        nodes: 2,
        rangeCleanups: 2,
        subscriptions: 2,
        unsubscribed: 0,
        lineageAccepted: 2,
        lineageRejected: 0,
        disposed: 0,
      });
      expect(result.identities.slice(0, 5)).toEqual([true, true, true, true, true]);
      expect(result.steps[2]?.tags).toEqual(['p', 'p']);
      expect(result.steps[2]?.text).toBe('xx');
      // One write refreshes both projections.
      expect(result.steps[3]?.text).toBe('yy');
      expect(result.identities.slice(5)).toEqual([true, true, true]);
    });

    test('disposal isolation: detach dispose removes only its region; default dispose keeps DOM', async () => {
      const result = await runS2bScenario(page, generatedModule(LEAF_SOURCE), 'disposal-isolation');
      expect(result.steps[1]?.childCount).toBe(2);
      // A's detach dispose removes A's region only; B's node stays attached.
      expect(result.steps[2]?.childCount).toBe(1);
      expect(result.steps[2]?.text).toBe('x');
      expect(result.flags.slice(0, 2)).toEqual([true, true]);
      expect(result.probes[2]).toMatchObject({ disposed: 1, unsubscribed: 1 });
      // B keeps refreshing after A is gone.
      expect(result.steps[3]?.text).toBe('y');
      // Default dispose keeps B's node attached (the M04 disconnect path) while
      // releasing its subscription; the subsequent write no longer lands.
      expect(result.steps[4]?.childCount).toBe(1);
      expect(result.steps[4]?.text).toBe('y');
      expect(result.flags[2]).toBe(true);
      expect(result.probes[4]).toMatchObject({ disposed: 2, unsubscribed: 2 });
      expect(result.steps[5]?.text).toBe('y');
    });

    test('owner lineage negatives: cross-owner and dead-owner projections are rejected with codes', async () => {
      const result = await runS2bScenario(page, generatedModule(LEAF_SOURCE), 'lineage');
      expect(result.codes).toEqual([
        'OE_KERNEL_ROOT_NOT_OWNED',
        'OE_KERNEL_DISPOSED',
        'OE_KERNEL_DISPOSED',
      ]);
      // Fail closed BEFORE any owner/region/DOM exists: the parent stays empty
      // and the rejected attempts allocate nothing (recipe creation included);
      // only the rejection counter moves.
      for (const index of [1, 2, 3, 4]) {
        expect(result.steps[index]?.childCount).toBe(0);
        expect(result.probes[index]).toMatchObject({
          projections: 0,
          regions: 0,
          owners: 0,
          nodes: 0,
          rangeCleanups: 0,
          subscriptions: 0,
          unsubscribed: 0,
          lineageAccepted: 0,
          disposed: 0,
        });
      }
      expect(result.probes[1]?.lineageRejected).toBe(0);
      expect(result.probes[2]?.lineageRejected).toBe(1);
      expect(result.probes[3]?.lineageRejected).toBe(2);
      expect(result.probes[4]?.lineageRejected).toBe(3);
      expect(result.probes[4]?.lineageAccepted).toBe(0);
      // Legal projections stay admitted: the definition owner itself, then one
      // of its live descendants.
      expect(result.probes[5]?.lineageAccepted).toBe(1);
      expect(result.probes[6]?.lineageAccepted).toBe(2);
      expect(result.probes[6]?.lineageRejected).toBe(3);
      expect(result.probes[6]?.projections).toBe(2);
      expect(result.steps[6]?.childCount).toBe(2);
      expect(result.steps[6]?.text).toBe('xx');
      expect(result.identities).toEqual([true, true]);
    });
  });
}
