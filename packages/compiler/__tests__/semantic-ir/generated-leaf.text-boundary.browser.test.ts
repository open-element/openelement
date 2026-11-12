/**
 * M08 text boundary — real Chromium parse → claim → update vertical.
 *
 * The server string is the generated `__ssr` output (Node side, real runtime
 * modules), the browser parser owns the nodes, and the generated claim adopts
 * exactly those nodes. LOCAL Chromium only: this is not M13 and not a browser
 * qualification. It is the slice's proof that adjacent and empty text slots
 * claim with zero equal-seed mutations, keep per-slot identity, lazily insert
 * on empty→non-empty, retain the node on non-empty→empty, update independently,
 * and clean up on `dispose(true)`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { signal } from '../../../element/src/internal/signal/framework.ts';

const FILE = '/proj/src/text-boundary-browser.tsx';
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

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

const SOURCE = `import { signal } from '@openelement/element';
function Adjacent(props) {
  return <p>{props.a}: {props.b}</p>;
}
function StaticRuns(props) {
  return <p><>A</>B</p>;
}
function ConstantEmpty(props) {
  const label = '';
  return <p>{label}</p>;
}
function Empty(props) {
  const value = signal('');
  return <p>{value.value}</p>;
}
function RootText(props) {
  const value = signal('');
  return <>{value.value}</>;
}
function Child(props) {
  return <>{props.text}</>;
}
function Parent(props) {
  const value = signal('');
  return <div><Child text={value.value} /><i>after</i></div>;
}
function ChildSlot(props) {
  return <b>{props.text}</b>;
}
function ParentSlot(props) {
  const label = signal('');
  return <div><ChildSlot text={label.value} /><span>expected</span></div>;
}
function TableCell(props) {
  return <table><tbody><tr><td><p>{props.value}</p></td></tr></tbody></table>;
}
`;

const RUNTIME = { ...compiledRuntime };
const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

interface Fixture {
  readonly module: string;
  readonly loaded: Record<string, unknown>;
}

function fixture(): Fixture {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return { module: generated.module!, loaded: instantiate(generated.module!) };
}

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

function ssr(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

function harnessModule(module: string): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const names = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  return `(function () {\n${body}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

let runtimeBundle = '';
let runtimeBundleDir = '';
let browser: Browser;
let page: Page;

beforeAll(async () => {
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-text-boundary-browser-'));
  const entry = join(runtimeBundleDir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { computed, signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: runtimeBundleDir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeRuntime', fileName: () => 'runtime.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('runtime bundle produced no chunk');
  runtimeBundle = chunk.code;
  browser = await chromium.launch();
  console.log(`[M08-text-boundary] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

interface Prepared {
  readonly generated: Fixture;
}

async function prepare(): Promise<Prepared> {
  const generated = fixture();
  page = await browser.newPage();
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: harnessModule(generated.module) });
  return { generated };
}

interface PairSnapshot {
  readonly claimError: string | null;
  readonly claimMutations: number;
  readonly nodes: readonly string[];
  readonly sameRoot: boolean;
  readonly sameStart: boolean;
  readonly sameEnd: boolean;
  readonly textA: string;
  readonly textB: string;
  readonly staticText: string;
  readonly updateMutations: readonly string[];
  readonly textBNodeSame: boolean;
  readonly startSameAfterUpdate: boolean;
  readonly endSameAfterUpdate: boolean;
  readonly afterDefaultDispose: number;
  readonly afterDetachDispose: number;
}

describe('M08 text boundary — Chromium parse and claim', () => {
  test('adjacent slots: equal seed is zero-mutation, per-slot update, identity and dispose', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'Adjacent')({ a: '1', b: '2' }, { bindings: {} });
    const result = (await page.evaluate(async (serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const parsed = host.firstChild as Element;
      const p = parsed as Element;

      const props = { a: '1', b: '2' };
      const propsChanged = runtime.signal(0);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createAdjacentRecipe!(scope, {
        props,
        bindings: {},
        propsChanged,
      });

      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const claimMutations = mutations.length;

      const before = [...p.childNodes];
      const startA = before[0]!;
      const textA = before[1] as Text;
      const endA = before[2]!;
      const staticText = before[3]!;
      const startB = before[4]!;
      const textB = before[5] as Text;
      const endB = before[6]!;
      const sameStart = before[0] === startA && before[2] === endA;
      const sameEnd = before[4] === startB && before[6] === endB;
      const nodes = before.map((node) =>
        node.nodeType === 8 ? `C:${node.nodeValue ?? ''}` : `T:${node.nodeValue ?? ''}`,
      );

      props.a = '9';
      propsChanged.value += 1;
      await Promise.resolve();
      await Promise.resolve();
      for (const record of observer.takeRecords()) mutations.push(record.type);

      const textAAfter = textA.nodeValue;
      const textBAfter = textB.nodeValue;
      const textBNodeSame = p.childNodes[5] === textB;
      const startSameAfterUpdate = p.childNodes[0] === startA;
      const endSameAfterUpdate = p.childNodes[6] === endB;
      const staticTextAfter = staticText.nodeValue;

      observer.disconnect();
      projection?.dispose(false);
      const afterDefaultDispose = host.childNodes.length;
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createAdjacentRecipe!(scope2, {
        props,
        bindings: {},
        propsChanged: runtime.signal(0),
      });
      const second = runtime.claimRecipe(scope2, recipe2, host);
      second.dispose(true);
      const afterDetachDispose = host.childNodes.length;

      return {
        claimError,
        claimMutations,
        nodes,
        sameRoot: projection !== undefined && projection.nodes[0] === parsed,
        sameStart,
        sameEnd,
        textA: textAAfter,
        textB: textBAfter,
        staticText: staticTextAfter,
        updateMutations: mutations.slice(claimMutations),
        textBNodeSame,
        startSameAfterUpdate,
        endSameAfterUpdate,
        afterDefaultDispose,
        afterDetachDispose,
      };
    }, html)) as PairSnapshot;

    expect(result.claimError).toBeNull();
    expect(result.claimMutations).toBe(0);
    expect(result.nodes).toEqual([
      'C:oe:t:0',
      'T:1',
      'C:oe:/t:0',
      'T:: ',
      'C:oe:t:1',
      'T:2',
      'C:oe:/t:1',
    ]);
    expect(result.sameRoot).toBe(true);
    expect(result.sameStart).toBe(true);
    expect(result.sameEnd).toBe(true);
    expect(result.textA).toBe('9');
    expect(result.textB).toBe('2');
    expect(result.staticText).toBe(': ');
    expect(result.updateMutations).toEqual(['characterData']);
    expect(result.textBNodeSame).toBe(true);
    expect(result.startSameAfterUpdate).toBe(true);
    expect(result.endSameAfterUpdate).toBe(true);
    expect(result.afterDefaultDispose).toBe(1);
    expect(result.afterDetachDispose).toBe(0);
    await page.close();
  });

  test('empty slot: claim creates no node, update inserts one, empty keeps it, reuse stays one', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'Empty')({}, { bindings: { value: signal('') } });
    const result = (await page.evaluate(async (serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const parsed = host.firstChild as Element;
      const p = parsed;

      const props = {};
      const propsChanged = runtime.signal(0);
      const value = runtime.signal('');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createEmptyRecipe!(scope, {
        props,
        bindings: { value },
        propsChanged,
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const claimMutations = mutations.length;
      const start = p.childNodes[0]!;
      const end = p.childNodes[1]!;
      const beforeNodes = [...p.childNodes];

      value.value = 'hello';
      await Promise.resolve();
      await Promise.resolve();
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const inserted = p.childNodes[1] as Text;
      const afterInsert = {
        nodes: p.childNodes.length,
        startSame: p.childNodes[0] === start,
        endSame: p.childNodes[2] === end,
        text: inserted.nodeValue,
        insertMutations: mutations.slice(claimMutations),
      };
      const afterInsertCount = mutations.length;

      value.value = '';
      await Promise.resolve();
      await Promise.resolve();
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const afterEmpty = {
        nodes: p.childNodes.length,
        text: inserted.nodeValue,
        sameNode: p.childNodes[1] === inserted,
        mutations: mutations.slice(afterInsertCount),
      };
      const afterEmptyCount = mutations.length;

      value.value = 'again';
      await Promise.resolve();
      await Promise.resolve();
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const afterReuse = {
        nodes: p.childNodes.length,
        text: inserted.nodeValue,
        sameNode: p.childNodes[1] === inserted,
        mutations: mutations.slice(afterEmptyCount),
      };

      observer.disconnect();
      projection?.dispose(false);
      const afterDefaultDispose = host.childNodes.length;
      return {
        claimError,
        claimMutations,
        beforeNodes: beforeNodes.map((node) =>
          node.nodeType === 8 ? `C:${node.nodeValue ?? ''}` : `T:${node.nodeValue ?? ''}`,
        ),
        sameRoot: projection !== undefined && projection.nodes[0] === parsed,
        afterInsert,
        afterEmpty,
        afterReuse,
        afterDefaultDispose,
      };
    }, html)) as {
      claimError: string | null;
      claimMutations: number;
      beforeNodes: string[];
      sameRoot: boolean;
      afterInsert: {
        nodes: number;
        startSame: boolean;
        endSame: boolean;
        text: string;
        insertMutations: string[];
      };
      afterEmpty: { nodes: number; text: string; sameNode: boolean; mutations: string[] };
      afterReuse: { nodes: number; text: string; sameNode: boolean; mutations: string[] };
      afterDefaultDispose: number;
    };

    expect(result.claimError).toBeNull();
    expect(result.claimMutations).toBe(0);
    expect(result.beforeNodes).toEqual(['C:oe:t:0', 'C:oe:/t:0']);
    expect(result.sameRoot).toBe(true);
    expect(result.afterInsert).toMatchObject({
      nodes: 3,
      startSame: true,
      endSame: true,
      text: 'hello',
      insertMutations: ['childList'],
    });
    expect(result.afterEmpty).toMatchObject({
      nodes: 3,
      text: '',
      sameNode: true,
      mutations: ['characterData'],
    });
    expect(result.afterReuse).toMatchObject({
      nodes: 3,
      text: 'again',
      sameNode: true,
      mutations: ['characterData'],
    });
    expect(result.afterDefaultDispose).toBe(1);
    await page.close();
  });

  test('root slot: lazy text gets its own cleanup and dispose(true) leaves nothing', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'RootText')({}, { bindings: { value: signal('') } });
    expect(html).toBe('<!--oe:t:0--><!--oe:/t:0-->');
    const result = (await page.evaluate(async (serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const props = {};
      const propsChanged = runtime.signal(0);
      const value = runtime.signal('');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createRootTextRecipe!(scope, {
        props,
        bindings: { value },
        propsChanged,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      const adoptedAtClaim = projection?.nodes.length ?? -1;
      value.value = 'x';
      await Promise.resolve();
      await Promise.resolve();
      const afterInsert = {
        hostNodes: host.childNodes.length,
        text: host.childNodes[1]?.nodeValue ?? null,
      };
      projection?.dispose(true);
      return {
        claimError,
        adoptedAtClaim,
        afterInsert,
        afterDefaultDispose: -1,
        afterDetachDispose: host.childNodes.length,
      };
    }, html)) as {
      claimError: string | null;
      adoptedAtClaim: number;
      afterInsert: { hostNodes: number; text: string | null };
      afterDefaultDispose: number;
      afterDetachDispose: number;
    };

    expect(result.claimError).toBeNull();
    expect(result.adoptedAtClaim).toBe(2);
    expect(result.afterInsert).toEqual({ hostNodes: 3, text: 'x' });
    expect(result.afterDetachDispose).toBe(0);
    await page.close();
  });

  test('dispose(false) keeps a lazily created text and a second claim re-adopts it with zero mutation', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'RootText')({}, { bindings: { value: signal('') } });
    expect(html).toBe('<!--oe:t:0--><!--oe:/t:0-->');
    const result = (await page.evaluate(async (serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;

      const firstValue = runtime.signal('');
      const scope1 = new runtime.LifetimeScope();
      const first = runtime.claimRecipe(
        scope1,
        factories.createRootTextRecipe!(scope1, {
          props: {},
          bindings: { value: firstValue },
          propsChanged: runtime.signal(0),
        }),
        host,
      );
      const start = host.childNodes[0]!;
      const end = host.childNodes[1]!;
      firstValue.value = 'x';
      await Promise.resolve();
      await Promise.resolve();
      const text = host.childNodes[1] as Text;
      const afterInsert = { nodes: host.childNodes.length, text: text.nodeValue };

      first.dispose(false);
      const afterDefaultDispose = {
        nodes: host.childNodes.length,
        startSame: host.childNodes[0] === start,
        textSame: host.childNodes[1] === text,
        endSame: host.childNodes[2] === end,
      };

      const observer = new MutationObserver(() => {});
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      firstValue.value = 'y';
      await Promise.resolve();
      await Promise.resolve();
      const afterOldSignalRecords = observer.takeRecords();
      const afterOldSignal = { text: text.nodeValue, mutations: afterOldSignalRecords.length };
      observer.disconnect();

      const secondValue = runtime.signal('x');
      const scope2 = new runtime.LifetimeScope();
      const reclaimMutations: string[] = [];
      const reclaimObserver = new MutationObserver((records) => {
        for (const record of records) reclaimMutations.push(record.type);
      });
      reclaimObserver.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      const second = runtime.claimRecipe(
        scope2,
        factories.createRootTextRecipe!(scope2, {
          props: {},
          bindings: { value: secondValue },
          propsChanged: runtime.signal(0),
        }),
        host,
      );
      for (const record of reclaimObserver.takeRecords()) reclaimMutations.push(record.type);
      reclaimObserver.disconnect();
      const afterReclaim = {
        adopted: second.nodes.length,
        startSame: second.nodes[0] === start,
        textSame: second.nodes[1] === text,
        endSame: second.nodes[2] === end,
        text: text.nodeValue,
        mutations: reclaimMutations,
      };
      second.dispose(true);
      return {
        afterInsert,
        afterDefaultDispose,
        afterOldSignal,
        afterReclaim,
        afterDetachDispose: host.childNodes.length,
      };
    }, html)) as {
      afterInsert: { nodes: number; text: string | null };
      afterDefaultDispose: {
        nodes: number;
        startSame: boolean;
        textSame: boolean;
        endSame: boolean;
      };
      afterOldSignal: { text: string | null; mutations: number };
      afterReclaim: {
        adopted: number;
        startSame: boolean;
        textSame: boolean;
        endSame: boolean;
        text: string | null;
        mutations: string[];
      };
      afterDetachDispose: number;
    };

    expect(result.afterInsert).toEqual({ nodes: 3, text: 'x' });
    expect(result.afterDefaultDispose).toEqual({
      nodes: 3,
      startSame: true,
      textSame: true,
      endSame: true,
    });
    expect(result.afterOldSignal).toEqual({ text: 'x', mutations: 0 });
    expect(result.afterReclaim).toEqual({
      adopted: 3,
      startSame: true,
      textSame: true,
      endSame: true,
      text: 'x',
      mutations: [],
    });
    expect(result.afterDetachDispose).toBe(0);
    await page.close();
  });

  test('a failure after a child lazy insert is non-transactional and keeps borrowed nodes', async () => {
    const { generated } = await prepare();
    const childHtml = ssr(generated.loaded, 'ChildSlot')({ text: '' }, { bindings: {} });
    expect(childHtml).toBe('<b><!--oe:t:0--><!--oe:/t:0--></b>');
    // The parent expects `expected`; the server text is `wrong`, so the parent
    // static claim fails after the child's phase-2 lazy insert already ran.
    const html = `<div>${childHtml}<span>wrong</span></div>`;
    const result = (await page.evaluate(async (serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        readonly disposed: boolean;
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface ProbeCounts {
        readonly subscriptions: number;
        readonly unsubscribed: number;
        readonly owners: number;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
        runtimeProbe: { snapshot(): ProbeCounts };
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      const probe = runtime.runtimeProbe;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const label = runtime.signal('raised');
      const scope = new runtime.LifetimeScope();
      // The generated claim owns child scopes internally. Track them through
      // the public constructor's prototype so owner release is asserted, not
      // inferred from the probe counters alone.
      const scopePrototype = runtime.LifetimeScope.prototype as unknown as {
        child(): Scope;
      };
      const originalChild = scopePrototype.child;
      const childScopes: Scope[] = [];
      scopePrototype.child = function (this: unknown): Scope {
        const child = originalChild.call(this);
        childScopes.push(child);
        return child;
      };
      const recipe = factories.createParentSlotRecipe!(scope, {
        props: {},
        bindings: { label },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      const before = probe.snapshot();
      let claimError: string | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const after = probe.snapshot();
      const claimMutations = mutations.slice();
      const childScopeStates = childScopes.map((child) => child.disposed);
      scopePrototype.child = originalChild;
      const div = host.firstChild as Element;
      const b = div.firstChild as Element;
      const span = div.lastChild as Element;
      const snapshot = (node: Node): string =>
        node.nodeType === 8
          ? `C:${node.nodeValue ?? ''}`
          : node.nodeType === 3
            ? `T:${node.nodeValue ?? ''}`
            : `E:${(node as Element).localName}`;
      const divNodes = [...div.childNodes].map(snapshot);
      const bNodes = [...b.childNodes].map(snapshot);
      const spanNodes = [...span.childNodes].map(snapshot);

      // The child subscription must be gone: even though the runtime guard
      // would also ignore a disposed scope, the probe below proves unsubscribe.
      label.value = 'later';
      await Promise.resolve();
      await Promise.resolve();
      const afterMutationRecords = observer.takeRecords();
      observer.disconnect();
      const bText = (b.childNodes[1] as Text | undefined)?.nodeValue ?? null;
      return {
        claimError,
        claimMutations,
        subscriptionDelta: after.subscriptions - before.subscriptions,
        unsubscribedDelta: after.unsubscribed - before.unsubscribed,
        ownerDelta: after.owners - before.owners,
        childScopeStates,
        divNodes,
        bNodes,
        spanNodes,
        afterMutationMutations: afterMutationRecords.map((record) => record.type),
        bText,
        hostStillHasBorrowedNodes:
          host.firstChild === div && div.firstChild === b && div.lastChild === span,
      };
    }, html)) as {
      claimError: string | null;
      claimMutations: string[];
      subscriptionDelta: number;
      unsubscribedDelta: number;
      ownerDelta: number;
      childScopeStates: boolean[];
      divNodes: string[];
      bNodes: string[];
      spanNodes: string[];
      afterMutationMutations: string[];
      bText: string | null;
      hostStillHasBorrowedNodes: boolean;
    };

    expect(result.claimError).toContain('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.claimError).toContain('static text at /0/1/0');
    // This is the recorded non-transactional shape: the child's phase-2 lazy
    // insert is a real childList mutation before the parent fails. It is not a
    // "zero mutation on every failure" guarantee.
    expect(result.claimMutations).toEqual(['childList']);
    expect(result.subscriptionDelta).toBe(1);
    expect(result.unsubscribedDelta).toBe(1);
    expect(result.ownerDelta).toBeGreaterThanOrEqual(1);
    expect(result.childScopeStates.length).toBeGreaterThanOrEqual(1);
    expect(result.childScopeStates.every((disposed) => disposed)).toBe(true);
    expect(result.divNodes).toEqual(['E:b', 'E:span']);
    expect(result.bNodes).toEqual(['C:oe:t:0', 'T:raised', 'C:oe:/t:0']);
    expect(result.spanNodes).toEqual(['T:wrong']);
    expect(result.afterMutationMutations).toEqual([]);
    expect(result.bText).toBe('raised');
    expect(result.hostStillHasBorrowedNodes).toBe(true);
    await page.close();
  });

  test('shared cursor: a child root slot inserts during claim and the parent still finds its sibling', async () => {
    const { generated } = await prepare();
    const childHtml = ssr(generated.loaded, 'Child')({ text: '' }, { bindings: {} });
    expect(childHtml).toBe('<!--oe:t:0--><!--oe:/t:0-->');
    const html = `<div>${childHtml}<i>after</i></div>`;
    const result = (await page.evaluate((serverHtml) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const value = runtime.signal('raised');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createParentRecipe!(scope, {
        props: {},
        bindings: { value },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const div = host.firstChild as Element;
      observer.disconnect();
      return {
        claimError,
        mutations,
        childNodes: [...div.childNodes].map((node) =>
          node.nodeType === 8
            ? `C:${node.nodeValue ?? ''}`
            : node.nodeType === 3
              ? `T:${node.nodeValue ?? ''}`
              : `E:${(node as Element).localName}`,
        ),
        text: div.querySelector('i')?.textContent ?? null,
        sameRoot: projection !== undefined && projection.nodes[0] === div,
      };
    }, html)) as {
      claimError: string | null;
      mutations: string[];
      childNodes: string[];
      text: string | null;
      sameRoot: boolean;
    };

    expect(result.claimError).toBeNull();
    expect(result.mutations).toEqual(['childList']);
    expect(result.childNodes).toEqual(['C:oe:t:0', 'T:raised', 'C:oe:/t:0', 'E:i']);
    expect(result.text).toBe('after');
    expect(result.sameRoot).toBe(true);
    await page.close();
  });

  test('a zero-dependency empty slot claims without an early claim return', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'ConstantEmpty')({}, { bindings: {} });
    expect(html).toBe('<p><!--oe:t:0--><!--oe:/t:0--></p>');
    const result = (await page.evaluate((serverHtml) => {
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): { value: T };
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const parsed = host.firstChild as Element;
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createConstantEmptyRecipe!(scope, {
        props: {},
        bindings: {},
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();
      return {
        claimError,
        mutations,
        sameRoot: projection !== undefined && projection.nodes[0] === parsed,
      };
    }, html)) as {
      claimError: string | null;
      mutations: string[];
      sameRoot: boolean;
    };

    expect(result.claimError).toBeNull();
    expect(result.mutations).toEqual([]);
    expect(result.sameRoot).toBe(true);
    await page.close();
  });

  test('legal td/p text under a table is claimed in place with zero mutation', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'TableCell')({ value: 'x' }, { bindings: {} });
    expect(html).toBe(
      '<table><tbody><tr><td><p><!--oe:t:0-->x<!--oe:/t:0--></p></td></tr></tbody></table>',
    );
    const result = (await page.evaluate((serverHtml) => {
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): { value: T };
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const parsed = host.firstChild as Element;
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createTableCellRecipe!(scope, {
        props: { value: 'x' },
        bindings: {},
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();
      const paragraph = parsed.querySelector('td p');
      const text = [...(paragraph?.childNodes ?? [])].find(
        (node): node is Text => node.nodeType === 3,
      );
      return {
        claimError,
        mutations,
        sameRoot: projection !== undefined && projection.nodes[0] === parsed,
        text: text?.nodeValue ?? null,
        comments: [...(paragraph?.childNodes ?? [])]
          .filter((node) => node.nodeType === 8)
          .map((node) => node.nodeValue),
      };
    }, html)) as {
      claimError: string | null;
      mutations: string[];
      sameRoot: boolean;
      text: string | null;
      comments: (string | null)[];
    };

    expect(result.claimError).toBeNull();
    expect(result.mutations).toEqual([]);
    expect(result.sameRoot).toBe(true);
    expect(result.text).toBe('x');
    expect(result.comments).toEqual(['oe:t:0', 'oe:/t:0']);
    await page.close();
  });

  test('static adjacent text is one parsed run: claim stays zero-mutation', async () => {
    const { generated } = await prepare();
    const html = ssr(generated.loaded, 'StaticRuns')({}, { bindings: {} });
    expect(html).toBe('<p>AB</p>');
    const result = (await page.evaluate((serverHtml) => {
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): { value: T };
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const parsed = host.firstChild as Element;
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createStaticRunsRecipe!(scope, {
        props: {},
        bindings: {},
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      let claimError: string | null = null;
      let projection: Projection | undefined;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();
      const p = parsed;
      return {
        claimError,
        mutations,
        sameRoot: projection !== undefined && projection.nodes[0] === parsed,
        childNodes: [...p.childNodes].map((node) =>
          node.nodeType === 3 ? node.nodeValue : `#${node.nodeType}`,
        ),
      };
    }, html)) as {
      claimError: string | null;
      mutations: string[];
      sameRoot: boolean;
      childNodes: (string | null)[];
    };

    expect(result.claimError).toBeNull();
    expect(result.mutations).toEqual([]);
    expect(result.sameRoot).toBe(true);
    expect(result.childNodes).toEqual(['AB']);
    await page.close();
  });

  test('negative structures fail closed with the leaf mismatch and no fallback', async () => {
    const { generated } = await prepare();
    const good = ssr(generated.loaded, 'Empty')({}, { bindings: { value: signal('seed') } });
    const cases = [
      ['missing pair', '<p>seed</p>', /text boundary|missing node/],
      ['wrong ordinal', '<p><!--oe:t:1-->seed<!--oe:/t:1--></p>', /text boundary/],
      ['wrong end', '<p><!--oe:t:0-->seed<!--oe:t:0--></p>', /text boundary/],
      ['element inside pair', '<p><!--oe:t:0--><b>x</b><!--oe:/t:0--></p>', /text boundary/],
      ['two texts in pair', '<p><!--oe:t:0-->a<!--oe:t:0-->b<!--oe:/t:0--></p>', /text boundary/],
      ['foreign comment', '<p><!--foreign-->seed<!--oe:/t:0--></p>', /text boundary/],
      ['stripped markers', good.replace(/<!--oe:\/?t:\d+-->/g, ''), /text boundary/],
    ] as const;
    for (const [name, html, pattern] of cases) {
      const result = (await page.evaluate((serverHtml) => {
        interface Scope {
          dispose(detach?: boolean): void;
        }
        interface Projection {
          readonly nodes: readonly Node[];
          dispose(detach?: boolean): void;
        }
        interface Runtime {
          claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
          LifetimeScope: new () => Scope;
          signal<T>(value: T): { value: T };
        }
        const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
        const factories = (
          window as unknown as {
            __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
          }
        ).__oeModule;
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = serverHtml;
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createEmptyRecipe!(scope, {
          props: {},
          bindings: { value: runtime.signal('seed') },
          propsChanged: runtime.signal(0),
        });
        const mutations: string[] = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) mutations.push(record.type);
        });
        observer.observe(host, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        let claimError: string | null = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
        } catch (error) {
          claimError = error instanceof Error ? error.message : String(error);
        }
        for (const record of observer.takeRecords()) mutations.push(record.type);
        observer.disconnect();
        return { claimError, mutations };
      }, html)) as { claimError: string | null; mutations: string[] };

      expect(result.claimError, name).not.toBeNull();
      expect(result.claimError, name).toMatch(pattern);
      expect(result.mutations, name).toEqual([]);
    }
    await page.close();
  });

  test('CR/NUL: parser-normalized values are a legitimate claim write, not 0 mutation', async () => {
    const { generated } = await prepare();
    const cr = ssr(generated.loaded, 'Empty')({}, { bindings: { value: signal('a\rb') } });
    const nul = ssr(generated.loaded, 'Empty')({}, { bindings: { value: signal('a\0b') } });
    const result = (await page.evaluate(
      async ({ crHtml, nulHtml }) => {
        interface Scope {
          dispose(detach?: boolean): void;
        }
        interface Projection {
          readonly nodes: readonly Node[];
          dispose(detach?: boolean): void;
        }
        interface Runtime {
          claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
          LifetimeScope: new () => Scope;
          signal<T>(value: T): { value: T };
        }
        const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
        const factories = (
          window as unknown as {
            __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
          }
        ).__oeModule;
        const run = (serverHtml: string, value: string) => {
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          host.innerHTML = serverHtml;
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createEmptyRecipe!(scope, {
            props: {},
            bindings: { value: runtime.signal(value) },
            propsChanged: runtime.signal(0),
          });
          const mutations: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          let claimError: string | null = null;
          try {
            runtime.claimRecipe(scope, recipe, host);
          } catch (error) {
            claimError = error instanceof Error ? error.message : String(error);
          }
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          const p = host.firstChild as Element;
          return {
            claimError,
            mutations,
            text: (p.childNodes[1] as Text | undefined)?.nodeValue ?? null,
          };
        };
        return { cr: await run(crHtml, 'a\rb'), nul: await run(nulHtml, 'a\0b') };
      },
      { crHtml: cr, nulHtml: nul },
    )) as {
      cr: { claimError: string | null; mutations: string[]; text: string | null };
      nul: { claimError: string | null; mutations: string[]; text: string | null };
    };

    expect(result.cr.claimError).toBeNull();
    expect(result.cr.mutations).toEqual(['characterData']);
    expect(result.cr.text).toBe('a\rb');
    expect(result.nul.claimError).toBeNull();
    expect(result.nul.mutations).toEqual(['characterData']);
    expect(result.nul.text).toBe('a\0b');
    await page.close();
  });
});
