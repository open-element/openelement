/**
 * M08 S2 acceptance lane — the authored M06 Board across the full
 * SSR → real-Chromium parse → claim → update → dispose chain.
 *
 * This file is deliberately separate from `generated-leaf.claim-list.*`: it is
 * one acceptance vertical for the same S2 authored Board, not a second list
 * contract suite. It records:
 *
 *   S  Node `__ssr` with one-shot request host bindings; no owner, scope,
 *      subscription, DOM cleanup or `connect`; exact S2 wire bytes.
 *   K  real Chromium parses those bytes; the generated claim adopts the parsed
 *      nodes, the equal seed has 0 claim-period mutations, DOM/focus/selection
 *      identity is preserved, and the claim's subscription/owner deltas are
 *      measured (not copied from an earlier run).
 *   U  private draft, sibling condition toggle, keyed reorder, same-key
 *      replacement, insert and delete; per-phase deltas, node identity, and
 *      marker movement.
 *   D  `dispose(false)` keeps borrowed DOM and closes every live subscription;
 *      a second claim does not double the accounting; `dispose(true)` removes
 *      the region. Negative claims open no subscription and never delete
 *      borrowed nodes.
 *
 * LOCAL Chromium 147.0.7727.15 only. This is not M13 and it is not an M08 exit:
 * the full TSX-18/TSX-30 rows, the source-located claim diagnostics and the
 * full claim-negative set remain open. The permitted seed state is the single
 * definition in `docs/architecture/m08-list-wire.md` §4.1: equal values are
 * clean, while a different dynamic value is an allowed activation write
 * recorded as non-clean (the `permitted difference` case below). The real
 * void/`<input>` SSR→claim vertical belongs to the input lane; this file keeps
 * a boundary check only and carries focus/selection on a `contenteditable`
 * element, not on an input and not on a property channel.
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
import { signal as nodeSignal } from '../../../element/src/internal/signal/framework.ts';
import { LifetimeScope } from '../../../element/src/internal/compiled/lifetime-scope.ts';

const FILE = '/proj/src/m08-s2-acceptance.tsx';
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

/**
 * The M06 authored S2 Board, with one qualification-only static focus carrier.
 * The condition is a sibling of the list, the key is `item.id`, and the private
 * draft is the component-local `count` signal (the admitted M06 shape).
 * `contenteditable` is an ordinary static attribute; it is not a property
 * channel and it is not pretending to be the unqualified `<input>` obligation.
 */
const S2_BOARD = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
    <p id="draft" contenteditable="true">note</p>
  </section>;
}
`;

const S2_INITIAL = [
  { id: 'a', label: 'A' },
  { id: 'c', label: 'C' },
];

/** The exact S2 Board wire (condition sibling + keyed list + text pairs). */
const S2_WIRE =
  '<section><!--oe:when--><p class="on">open</p><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:k:s:63--><li><!--oe:t:0-->C<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:/each--></ul>';
const FOCUS_CARRIER = '<p id="draft" contenteditable="true">note</p>';
const S2_SSR = `${S2_WIRE}${FOCUS_CARRIER}</section>`;

const ENTRY_LOCAL_SIGNAL = `import { signal } from '@openelement/element';
function Rows(props) {
  const items = signal([{ id: 'a' }]);
  return <ul>{items.value.map((item) => { const draft = signal(item.id); return <li key={item.id}>{draft.value}</li>; })}</ul>;
}
`;

const VOID_INPUT = `function InputFocus(props) {
  return <section><p id="draft" contenteditable="true">note</p><input id="field" /><span>x</span></section>;
}
`;

const ROW_PRIVATE_DRAFT = `import { signal } from '@openelement/element';
function Row(props) { const draft = signal(props.item.id); return <li>{draft.value}</li>; }
function Rows(props) { const items = signal([{ id: 'a' }]); return <ul>{items.value.map((item) => <Row key={item.id} item={item} />)}</ul>; }
`;

const UNSUPPORTED_KEY = `import { signal } from '@openelement/element';
function Unsupported(props) {
  const items = signal([{ id: 'a', label: 'A' }]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
function UnsupportedObject(props) {
  const items = signal([{ id: {}, label: 'A' }]);
  return <ul>{items.value.map((item) => <li key={item}>{item.label}</li>)}</ul>;
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

function compile(authoredSource: string): Fixture {
  const front = compileFunctionModule(authoredSource, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
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

function extractExportedFunction(module: string, name: string): string {
  const marker = `export function ${name}(`;
  const start = module.indexOf(marker);
  if (start < 0) throw new Error(`missing exported function ${name}`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < module.length; index++) {
    const char = module[index]!;
    if (char === '{') {
      depth += 1;
      opened = true;
    } else if (char === '}') {
      depth -= 1;
      if (opened && depth === 0) return module.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated exported function ${name}`);
}

interface Probe {
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

function probe(): Probe {
  return RUNTIME.runtimeProbe.snapshot() as Probe;
}

interface RequestSignal<T> {
  readonly value: T;
}

function requestSignal<T>(initial: T): { signal: RequestSignal<T>; subscribes: () => number } {
  const inner = nodeSignal(initial);
  let subscribeCount = 0;
  const signal: RequestSignal<T> = {
    get value(): T {
      return inner.value;
    },
    set value(next: T) {
      inner.value = next;
    },
    subscribe(): () => void {
      subscribeCount += 1;
      throw new Error('SSR must not subscribe to a request binding');
    },
  } as RequestSignal<T> & { subscribe(): () => void };
  return { signal, subscribes: () => subscribeCount };
}

interface RequestHost {
  readonly host: {
    readonly bindings: Record<string, unknown>;
    connect(): void;
    onConnect(): void;
    disconnect(): void;
  };
  readonly reads: Record<string, number>;
  readonly connectCalls: readonly string[];
}

/** One-shot request host: each binding name is read at most once. */
function requestHost(values: Record<string, unknown>): RequestHost {
  const reads: Record<string, number> = {};
  const bindings: Record<string, unknown> = {};
  const connectCalls: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(bindings, name, {
      enumerable: true,
      configurable: false,
      get() {
        const count = (reads[name] ?? 0) + 1;
        reads[name] = count;
        if (count > 1) throw new Error(`one-shot request binding "${name}" read twice`);
        return value;
      },
    });
  }
  const host = {
    bindings,
    connect: () => {
      connectCalls.push('connect');
    },
    onConnect: () => {
      connectCalls.push('onConnect');
    },
    disconnect: () => {
      connectCalls.push('disconnect');
    },
  };
  return { host, reads, connectCalls };
}

const BOARD_FIXTURE = compile(S2_BOARD);
const BOARD_LOADED = BOARD_FIXTURE.loaded;

function renderS2(items: readonly unknown[] = S2_INITIAL, open = true, count = 0): string {
  const request = requestHost({
    open: requestSignal(open).signal,
    items: requestSignal(items).signal,
    count: requestSignal(count).signal,
  });
  return ssr(BOARD_LOADED, 'Board')({}, request.host);
}

function browserHarnessModule(module: string): string {
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

beforeAll(async () => {
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-m08-s2-acceptance-'));
  const entry = join(runtimeBundleDir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, readEntryKeyMarker } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
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
  console.log(`[M08-S2] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

async function newPage(generated: Fixture): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: browserHarnessModule(generated.module) });
  return page;
}

interface BrowserProbe {
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

describe('M08 S2 acceptance — S: request-time SSR boundary', () => {
  const generated = BOARD_FIXTURE;
  const loaded = BOARD_LOADED;

  test('one-shot host bindings produce the exact S2 wire without owner/subscription/connect', () => {
    const open = requestSignal(true);
    const items = requestSignal(S2_INITIAL);
    const count = requestSignal(0);
    const request = requestHost({
      open: open.signal,
      items: items.signal,
      count: count.signal,
    });

    RUNTIME.runtimeProbe.reset();
    const html = ssr(loaded, 'Board')({}, request.host);
    const after = probe();

    expect(html).toBe(S2_SSR);
    expect(request.reads).toEqual({ count: 1, items: 1, open: 1 });
    expect(open.subscribes()).toBe(0);
    expect(items.subscribes()).toBe(0);
    expect(count.subscribes()).toBe(0);
    expect(request.connectCalls).toEqual([]);
    expect(after).toMatchObject({
      projections: 0,
      regions: 0,
      owners: 0,
      nodes: 0,
      rangeCleanups: 0,
      subscriptions: 0,
      unsubscribed: 0,
      lineageAccepted: 0,
      lineageRejected: 0,
      disposed: 0,
    });

    const body = extractExportedFunction(generated.module, 'Board__ssr');
    for (const forbidden of [
      'createRecipe(',
      'insertRecipe(',
      'claimRecipe(',
      'LifetimeScope',
      'bindSignalWrites(',
      'connect(',
      'subscribe(',
    ]) {
      expect(body, `SSR body must not contain ${forbidden}`).not.toContain(forbidden);
    }

    // The same request host is single-use. A second SSR needs a fresh host.
    expect(() => ssr(loaded, 'Board')({}, request.host)).toThrow(/one-shot/);
  });

  test('SSR evaluates the request state once per call and never retains it', () => {
    const first = requestHost({
      open: requestSignal(true).signal,
      items: requestSignal(S2_INITIAL).signal,
      count: requestSignal(0).signal,
    });
    const second = requestHost({
      open: requestSignal(false).signal,
      items: requestSignal([{ id: 'a', label: 'A' }]).signal,
      count: requestSignal(2).signal,
    });

    expect(ssr(loaded, 'Board')({}, first.host)).toBe(S2_SSR);
    expect(ssr(loaded, 'Board')({}, second.host)).toBe(
      `<section><!--oe:when--><em class="off">closed</em><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->2<!--oe:/t:1--></li><!--oe:/each--></ul>${FOCUS_CARRIER}</section>`,
    );
    expect(first.reads).toEqual({ count: 1, items: 1, open: 1 });
    expect(second.reads).toEqual({ count: 1, items: 1, open: 1 });
  });

  test('gap: an entry-local signal is refused by the frontend (not an admitted private-draft path)', () => {
    const front = compileFunctionModule(ENTRY_LOCAL_SIGNAL, FILE, {
      importClassifier: CLASSIFIER,
    });
    expect(front.diagnostics.map((item) => item.code)).toContain('OEC9042');
    expect(front.module).toBeNull();
  });

  test('gap: an unsupported object key is rejected by SSR before any string is returned', () => {
    const unsupported = compile(UNSUPPORTED_KEY);
    const items = requestSignal([{ id: {}, label: 'A' }]);
    const request = requestHost({ items: items.signal });
    let caught: { readonly code?: string; readonly message?: string } | null = null;
    try {
      ssr(unsupported.loaded, 'UnsupportedObject')({}, request.host);
    } catch (error) {
      caught = error as { readonly code?: string; readonly message?: string };
    }
    expect(caught?.code).toBe('OEIR_LEAF_UNSUPPORTED_KEY');
    expect(caught?.message).toContain('list key must be');
    expect(items.subscribes()).toBe(0);
    expect(request.reads).toEqual({ items: 1 });
    expect(request.connectCalls).toEqual([]);
  });

  test('gap: a Row component with a private draft inside a list entry is refused', () => {
    const front = compileFunctionModule(ROW_PRIVATE_DRAFT, FILE, {
      importClassifier: CLASSIFIER,
    });
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!);
    expect(generated.module).toBeNull();
    expect(generated.diagnostics.map((item) => item.code)).toContain(
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
    );
  });

  test('boundary: void input SSR/focus is the input lane obligation; this vertical records no input evidence', () => {
    const input = compile(VOID_INPUT);
    const factory = input.loaded.createInputFocusRecipe;
    expect(typeof factory).toBe('function');
    const scope = new LifetimeScope();
    const recipe = (factory as (owner: unknown, host: unknown) => Record<string, unknown>)(scope, {
      bindings: {},
      propsChanged: nodeSignal(0),
    });
    expect('claim' in recipe).toBe(true);
    // This acceptance vertical intentionally does not prove the input
    // obligation. Its focus/selection carrier is a static contenteditable
    // attribute, not a void input. The input lane owns the
    // SSR→parse→pre-claim-edit→claim vertical; this file neither asserts that
    // producer's absence nor claims its result.
    expect(S2_BOARD).toContain('contenteditable="true"');
    expect(S2_BOARD).not.toContain('<input');
    scope.dispose(false);
  });
});

interface BrowserBoardResult {
  readonly claim: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly focusPreserved: boolean;
    readonly selectionPreserved: boolean;
    readonly nodeIdentity: boolean;
    readonly branchIdentity: boolean;
    readonly draftIdentity: boolean;
    readonly classification: {
      readonly structure: string;
      readonly values: string;
      readonly clean: boolean;
    };
  };
  readonly draft: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly liSame: boolean;
    readonly texts: readonly string[];
  };
  readonly reorder: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly sameObjects: boolean;
    readonly texts: readonly string[];
    readonly markers: readonly string[];
  };
  readonly replacement: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly sameObjects: boolean;
    readonly texts: readonly string[];
  };
  readonly insert: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly kept: boolean;
    readonly count: number;
    readonly texts: readonly string[];
  };
  readonly remove: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly kept: boolean;
    readonly count: number;
    readonly texts: readonly string[];
  };
  readonly toggle: {
    readonly mutations: readonly string[];
    readonly probe: BrowserProbe;
    readonly branchReplaced: boolean;
    readonly sectionSame: boolean;
    readonly listSame: boolean;
    readonly draftSame: boolean;
  };
  readonly dispose: {
    readonly liveBefore: number;
    readonly defaultDelta: BrowserProbe;
    readonly detachedStillThere: boolean;
    readonly reclaimProbe: BrowserProbe;
    readonly reclaimMutations: readonly string[];
    readonly reclaimIdentity: boolean;
    readonly detachDelta: BrowserProbe;
    readonly childrenAfterDetach: number;
  };
}

describe('M08 S2 acceptance — K/U/D: real Chromium claim, update and dispose', () => {
  test('equal seed, private draft, keyed reorder, same-key replacement, insert/delete, dispose modes', async () => {
    const generated = BOARD_FIXTURE;
    const html = renderS2();
    const page = await newPage(generated);

    const result = (await page.evaluate(async (serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { readonly nodes: readonly Node[]; dispose(detach?: boolean): void };
        readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
        readonly signal: <T>(value: T) => { value: T };
        readonly runtimeProbe: {
          reset(): void;
          snapshot(): {
            projections: number;
            regions: number;
            owners: number;
            nodes: number;
            rangeCleanups: number;
            subscriptions: number;
            unsubscribed: number;
            lineageAccepted: number;
            lineageRejected: number;
            disposed: number;
          };
        };
      }
      interface Factories {
        readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
      }
      interface Probe {
        projections: number;
        regions: number;
        owners: number;
        nodes: number;
        rangeCleanups: number;
        subscriptions: number;
        unsubscribed: number;
        lineageAccepted: number;
        lineageRejected: number;
        disposed: number;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const probe = (): Probe => runtime.runtimeProbe.snapshot();
      const delta = (before: Probe, after: Probe): Probe => ({
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
      });
      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      const collect = (observer: MutationObserver, pending: readonly string[]): string[] => {
        const out = [...pending];
        for (const record of observer.takeRecords()) out.push(record.type);
        return out;
      };
      const comments = (root: ParentNode): string[] => {
        const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      const sameNodes = (before: readonly Node[], after: readonly Node[]): boolean =>
        before.length === after.length && before.every((node, index) => node === after[index]);
      const sameNodeLists = (
        before: readonly (readonly Node[])[],
        after: readonly (readonly Node[])[],
      ): boolean =>
        before.length === after.length &&
        before.every((nodes, index) => {
          const next = after[index];
          return next !== undefined && sameNodes(nodes, next);
        });

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const ul = section.querySelector('ul') as Element;
      const draftEl = section.querySelector('#draft') as HTMLElement;
      const branch = section.querySelector('p.on') as Element;
      const lis = [...ul.querySelectorAll('li')];
      const serverTexts = lis.map((li) => li.textContent);
      const sectionNodes = [...section.childNodes];
      const ulNodes = [...ul.childNodes];
      const liNodes = lis.map((li) => [...li.childNodes]);
      const draftText = draftEl.firstChild as Text;

      draftEl.focus();
      const range = document.createRange();
      range.setStart(draftText, 1);
      range.setEnd(draftText, 4);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const focusBefore = document.activeElement === draftEl;
      const selectionBefore =
        selection?.anchorNode === draftText &&
        selection.anchorOffset === 1 &&
        selection.focusOffset === 4;

      const open = runtime.signal(true);
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      const count = runtime.signal(0);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe(scope, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });

      const pending: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) pending.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      const claimMutations = collect(observer, pending.splice(0));
      const claimProbe = probe();
      const afterClaimLis = [...ul.querySelectorAll('li')];
      const claim = {
        mutations: claimMutations,
        probe: claimProbe,
        focusPreserved:
          focusBefore &&
          selectionBefore &&
          document.activeElement === draftEl &&
          selection?.anchorNode === draftText &&
          selection.anchorOffset === 1 &&
          selection.focusOffset === 4,
        selectionPreserved:
          selection?.anchorNode === draftText &&
          selection.anchorOffset === 1 &&
          selection.focusOffset === 4,
        nodeIdentity:
          host.firstChild === section &&
          sameNodes(sectionNodes, [...section.childNodes]) &&
          section.querySelector('ul') === ul &&
          sameNodes(ulNodes, [...ul.childNodes]) &&
          sameNodeLists(
            liNodes,
            afterClaimLis.map((li) => [...li.childNodes]),
          ),
        branchIdentity: section.querySelector('p.on') === branch,
        draftIdentity:
          section.querySelector('#draft') === draftEl && draftEl.firstChild === draftText,
        classification: {
          structure: 'equal',
          values: serverTexts.every((text, index) => text === afterClaimLis[index]?.textContent)
            ? 'equal'
            : 'different',
          clean: claimMutations.length === 0,
        },
      };

      let before = probe();
      count.value = 9;
      await flush();
      const draft = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        liSame: afterClaimLis.every((li, index) => [...ul.querySelectorAll('li')][index] === li),
        texts: [...ul.querySelectorAll('li')].map((li) => li.textContent),
      };

      before = probe();
      items.value = [
        { id: 'c', label: 'C' },
        { id: 'a', label: 'A' },
      ];
      await flush();
      const reordered = [...ul.querySelectorAll('li')];
      const reorder = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        sameObjects: reordered[0] === lis[1] && reordered[1] === lis[0],
        texts: reordered.map((li) => li.textContent),
        markers: comments(ul),
      };

      before = probe();
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const replaced = [...ul.querySelectorAll('li')];
      const replacement = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        sameObjects: replaced[0] === lis[0] && replaced[1] === lis[1],
        texts: replaced.map((li) => li.textContent),
      };

      before = probe();
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const inserted = [...ul.querySelectorAll('li')];
      const insert = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        kept: inserted[0] === lis[0] && inserted[2] === lis[1],
        count: inserted.length,
        texts: inserted.map((li) => li.textContent),
      };

      before = probe();
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const removed = [...ul.querySelectorAll('li')];
      const remove = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        kept: removed[0] === lis[0] && removed[1] === lis[1],
        count: removed.length,
        texts: removed.map((li) => li.textContent),
      };

      before = probe();
      open.value = false;
      await flush();
      const toggle = {
        mutations: collect(observer, pending.splice(0)),
        probe: delta(before, probe()),
        branchReplaced:
          section.querySelector('p.on') === null && section.querySelector('em.off') !== null,
        sectionSame: host.firstChild === section,
        listSame: section.querySelector('ul') === ul,
        draftSame: section.querySelector('#draft') === draftEl,
      };

      const liveBefore = probe().subscriptions - probe().unsubscribed;
      const beforeDispose = probe();
      projection.dispose(false);
      const defaultDelta = delta(beforeDispose, probe());
      const detachedStillThere = host.contains(section);
      projection.dispose(true);
      const stillThereAfterNoopDetach = host.contains(section);

      // A fresh claim of the same server bytes must account from zero, not add
      // a second copy of the disposed projection's subscriptions.
      open.value = true;
      items.value = [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ];
      count.value = 0;
      host.innerHTML = serverHtml;
      const section2 = host.firstChild as Element;
      const ul2 = section2.querySelector('ul') as Element;
      const draft2 = section2.querySelector('#draft') as HTMLElement;
      const draftText2 = draft2.firstChild as Text;
      draft2.focus();
      const range2 = document.createRange();
      range2.setStart(draftText2, 1);
      range2.setEnd(draftText2, 4);
      selection?.removeAllRanges();
      selection?.addRange(range2);
      const lis2 = [...ul2.querySelectorAll('li')];
      const pending2: string[] = [];
      const observer2 = new MutationObserver((records) => {
        for (const record of records) pending2.push(record.type);
      });
      observer2.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createBoardRecipe(scope2, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });
      const projection2 = runtime.claimRecipe(scope2, recipe2, host);
      const reclaimMutations = collect(observer2, pending2.splice(0));
      const reclaimProbe = probe();
      const reclaim = {
        probe: reclaimProbe,
        mutations: reclaimMutations,
        identity:
          host.firstChild === section2 &&
          section2.querySelector('ul') === ul2 &&
          [...ul2.querySelectorAll('li')].every((li, index) => li === lis2[index]) &&
          draft2.firstChild === draftText2,
      };
      observer2.disconnect();

      const beforeDetach = probe();
      projection2.dispose(true);
      const detachDelta = delta(beforeDetach, probe());
      const childrenAfterDetach = host.childNodes.length;
      observer.disconnect();

      return {
        claim,
        draft,
        reorder,
        replacement,
        insert,
        remove,
        toggle,
        dispose: {
          liveBefore,
          defaultDelta,
          detachedStillThere: detachedStillThere && stillThereAfterNoopDetach,
          reclaimProbe,
          reclaimMutations,
          reclaimIdentity: reclaim.identity,
          detachDelta,
          childrenAfterDetach,
        },
      };
    }, html)) as BrowserBoardResult;

    expect(result.claim.mutations).toEqual([]);
    expect(result.claim.probe).toMatchObject({
      owners: 1,
      projections: 1,
      regions: 1,
      rangeCleanups: 1,
      unsubscribed: 0,
      disposed: 0,
    });
    const claimSubscriptions = result.claim.probe.subscriptions;
    expect(claimSubscriptions).toBeGreaterThanOrEqual(2);
    expect(result.claim.focusPreserved).toBe(true);
    expect(result.claim.selectionPreserved).toBe(true);
    expect(result.claim.nodeIdentity).toBe(true);
    expect(result.claim.branchIdentity).toBe(true);
    expect(result.claim.draftIdentity).toBe(true);
    // Explicit permitted-seed classification for the equal case: the SSR text
    // values equal the post-claim values and the claim made no DOM mutation.
    expect(result.claim.classification).toEqual({
      structure: 'equal',
      values: 'equal',
      clean: true,
    });

    expect(result.draft.mutations).toEqual(['characterData', 'characterData']);
    expect(result.draft.probe).toEqual({
      projections: 0,
      regions: 0,
      owners: 0,
      nodes: 0,
      rangeCleanups: 0,
      subscriptions: 0,
      unsubscribed: 0,
      lineageAccepted: 0,
      lineageRejected: 0,
      disposed: 0,
    });
    expect(result.draft.liSame).toBe(true);
    expect(result.draft.texts).toEqual(['A: 9', 'C: 9']);

    expect(result.reorder.probe.subscriptions).toBe(0);
    expect(result.reorder.probe.unsubscribed).toBe(0);
    expect(result.reorder.probe.owners).toBe(0);
    expect(result.reorder.mutations).toContain('childList');
    expect(result.reorder.mutations).not.toContain('characterData');
    expect(result.reorder.sameObjects).toBe(true);
    expect(result.reorder.texts).toEqual(['C: 9', 'A: 9']);
    // The list-level wire is anchor + one key per entry + end, in moved order.
    // Text pairs live inside each li; they are not list-level markers.
    expect(
      result.reorder.markers.filter(
        (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
      ),
    ).toEqual(['oe:each', 'oe:k:s:63', 'oe:k:s:61', 'oe:/each']);

    expect(result.replacement.probe.subscriptions).toBe(0);
    expect(result.replacement.probe.unsubscribed).toBe(0);
    expect(result.replacement.sameObjects).toBe(true);
    expect(result.replacement.texts).toEqual(['A2: 9', 'C: 9']);

    expect(result.insert.probe.subscriptions).toBe(1);
    expect(result.insert.probe.unsubscribed).toBe(0);
    expect(result.insert.kept).toBe(true);
    expect(result.insert.count).toBe(3);
    expect(result.insert.texts).toEqual(['A2: 9', 'B: 9', 'C: 9']);

    expect(result.remove.probe.subscriptions).toBe(0);
    expect(result.remove.probe.unsubscribed).toBe(1);
    expect(result.remove.kept).toBe(true);
    expect(result.remove.count).toBe(2);
    expect(result.remove.texts).toEqual(['A2: 9', 'C: 9']);

    expect(result.toggle.probe.subscriptions).toBe(0);
    expect(result.toggle.probe.unsubscribed).toBe(0);
    expect(result.toggle.branchReplaced).toBe(true);
    expect(result.toggle.sectionSame).toBe(true);
    expect(result.toggle.listSame).toBe(true);
    expect(result.toggle.draftSame).toBe(true);

    for (const phase of [
      result.draft,
      result.reorder,
      result.replacement,
      result.insert,
      result.remove,
      result.toggle,
    ]) {
      expect(phase.probe.owners).toBe(0);
      expect(phase.probe.projections).toBe(0);
      expect(phase.probe.disposed).toBe(0);
    }

    expect(result.dispose.liveBefore).toBe(claimSubscriptions);
    expect(result.dispose.defaultDelta).toMatchObject({
      subscriptions: 0,
      unsubscribed: claimSubscriptions,
      disposed: 1,
    });
    expect(result.dispose.detachedStillThere).toBe(true);
    expect(result.dispose.reclaimMutations).toEqual([]);
    expect(result.dispose.reclaimProbe).toMatchObject({
      owners: 1,
      projections: 1,
      subscriptions: claimSubscriptions,
      unsubscribed: 0,
      disposed: 0,
    });
    expect(result.dispose.reclaimProbe.subscriptions).not.toBe(claimSubscriptions * 2);
    expect(result.dispose.reclaimIdentity).toBe(true);
    expect(result.dispose.detachDelta).toMatchObject({
      subscriptions: 0,
      unsubscribed: claimSubscriptions,
      disposed: 1,
    });
    expect(result.dispose.childrenAfterDetach).toBe(0);

    console.log(
      `[M08-S2] claim subs=${result.claim.probe.subscriptions} owners=${result.claim.probe.owners} projections=${result.claim.probe.projections} rangeCleanups=${result.claim.probe.rangeCleanups}; ` +
        `draft Δsubs=${result.draft.probe.subscriptions} Δowners=${result.draft.probe.owners}; ` +
        `reorder Δsubs=${result.reorder.probe.subscriptions} Δowners=${result.reorder.probe.owners}; ` +
        `replace Δsubs=${result.replacement.probe.subscriptions} Δowners=${result.replacement.probe.owners}; ` +
        `insert Δsubs=${result.insert.probe.subscriptions} Δowners=${result.insert.probe.owners}; ` +
        `remove Δsubs=${result.remove.probe.subscriptions} Δunsub=${result.remove.probe.unsubscribed}; ` +
        `dispose(false) Δunsub=${result.dispose.defaultDelta.unsubscribed}; reclaim subs=${result.dispose.reclaimProbe.subscriptions} owners=${result.dispose.reclaimProbe.owners}; ` +
        `dispose(true) Δunsub=${result.dispose.detachDelta.unsubscribed} children=${result.dispose.childrenAfterDetach}`,
    );

    await page.close();
  }, 120_000);
});

interface MismatchCase {
  readonly label: string;
  readonly html: string;
  readonly items: readonly unknown[];
}

interface MismatchOutcome {
  readonly label: string;
  readonly error: string | null;
  readonly code: string | null;
  readonly mutations: readonly string[];
  readonly probe: BrowserProbe;
  readonly domSame: boolean;
}

interface MismatchMatrixResult {
  readonly outcomes: readonly MismatchOutcome[];
  readonly retry: {
    readonly error: string | null;
    readonly probe: BrowserProbe;
    readonly mutations: readonly string[];
    readonly texts: readonly string[];
    readonly identity: boolean;
  };
}

describe('M08 S2 acceptance — claim negatives', () => {
  test('missing/extra/seed-structure failures open no subscription and keep borrowed DOM', async () => {
    const valid = renderS2();
    const page = await newPage(BOARD_FIXTURE);
    const cases: readonly MismatchCase[] = [
      {
        label: 'server extra entry',
        html: valid,
        items: [{ id: 'a', label: 'A' }],
      },
      {
        label: 'duplicate wire over client',
        html: renderS2([
          { id: 'a', label: 'A' },
          { id: 'a', label: 'A2' },
        ]),
        items: [{ id: 'a', label: 'A' }],
      },
      {
        label: 'missing key marker',
        html: valid.replace('<!--oe:k:s:61-->', ''),
        items: S2_INITIAL,
      },
      {
        label: 'missing list end marker',
        html: valid.replace('<!--oe:/each-->', ''),
        items: S2_INITIAL,
      },
      {
        label: 'extra tail node',
        html: valid.replace('</ul>', '</ul><i>extra</i>'),
        items: S2_INITIAL,
      },
      {
        label: 'server/client branch mismatch',
        html: renderS2(S2_INITIAL, false, 0),
        items: S2_INITIAL,
      },
    ];

    const result = (await page.evaluate(
      ({ inputCases, retryHtml }) => {
        interface Runtime {
          readonly claimRecipe: (
            owner: unknown,
            recipe: unknown,
            parent: Node,
          ) => { dispose(detach?: boolean): void };
          readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
          readonly signal: <T>(value: T) => { value: T };
          readonly runtimeProbe: {
            reset(): void;
            snapshot(): Probe;
          };
        }
        interface Probe {
          projections: number;
          regions: number;
          owners: number;
          nodes: number;
          rangeCleanups: number;
          subscriptions: number;
          unsubscribed: number;
          lineageAccepted: number;
          lineageRejected: number;
          disposed: number;
        }
        interface Factories {
          readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
        }
        interface InputCase {
          readonly label: string;
          readonly html: string;
          readonly items: readonly unknown[];
        }
        interface Outcome {
          readonly label: string;
          readonly error: string | null;
          readonly code: string | null;
          readonly mutations: readonly string[];
          readonly probe: Probe;
          readonly domSame: boolean;
        }
        const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
        const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
        const sameNodes = (before: readonly Node[], after: readonly Node[]): boolean =>
          before.length === after.length && before.every((node, index) => node === after[index]);
        const run = (input: InputCase): Outcome => {
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          host.innerHTML = input.html;
          const section = host.firstChild as Element;
          const beforeHtml = host.innerHTML;
          const beforeNodes = [...section.childNodes];
          const open = runtime.signal(true);
          const items = runtime.signal(input.items);
          const count = runtime.signal(0);
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createBoardRecipe(scope, {
            props: {},
            bindings: { open, items, count },
            propsChanged: runtime.signal(0),
          });
          const pending: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) pending.push(record.type);
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          runtime.runtimeProbe.reset();
          let error: string | null = null;
          let code: string | null = null;
          try {
            runtime.claimRecipe(scope, recipe, host);
            error = 'NO_THROW';
            code = 'NO_THROW';
          } catch (caught) {
            const failure = caught as { readonly code?: string; readonly message?: string };
            error = failure.message ?? String(caught);
            code = failure.code ?? null;
          }
          for (const record of observer.takeRecords()) pending.push(record.type);
          observer.disconnect();
          const probe = runtime.runtimeProbe.snapshot();
          const afterSection = host.firstChild;
          const domSame =
            afterSection === section &&
            beforeHtml === host.innerHTML &&
            sameNodes(beforeNodes, [...section.childNodes]);
          scope.dispose(false);
          return {
            label: input.label,
            error,
            code,
            mutations: [...pending],
            probe,
            domSame,
          };
        };

        const outcomes = inputCases.map(run);

        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = retryHtml;
        const section = host.firstChild as Element;
        const beforeNodes = [...section.childNodes];
        const open = runtime.signal(true);
        const items = runtime.signal([
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ]);
        const count = runtime.signal(0);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createBoardRecipe(scope, {
          props: {},
          bindings: { open, items, count },
          propsChanged: runtime.signal(0),
        });
        const pending: string[] = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) pending.push(record.type);
        });
        observer.observe(host, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        runtime.runtimeProbe.reset();
        let retryError: string | null = null;
        let projection: { dispose(detach?: boolean): void } | null = null;
        try {
          projection = runtime.claimRecipe(scope, recipe, host);
        } catch (caught) {
          retryError = caught instanceof Error ? caught.message : String(caught);
        }
        for (const record of observer.takeRecords()) pending.push(record.type);
        observer.disconnect();
        const retryProbe = runtime.runtimeProbe.snapshot();
        const retryIdentity =
          host.firstChild === section &&
          sameNodes(beforeNodes, [...section.childNodes]) &&
          [...host.querySelectorAll('li')].length === 2;
        const retryTexts = [...host.querySelectorAll('li')].map((li) => li.textContent);
        projection?.dispose(true);
        scope.dispose(false);
        return {
          outcomes,
          retry: {
            error: retryError,
            probe: retryProbe,
            mutations: [...pending],
            texts: retryTexts,
            identity: retryIdentity,
          },
        };
      },
      { inputCases: cases, retryHtml: valid },
    )) as MismatchMatrixResult;

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual([
      'OEIR_LEAF_CLAIM_MISMATCH',
      'OEIR_LEAF_CLAIM_MISMATCH',
      'OEIR_LEAF_CLAIM_MISMATCH',
      'OEIR_LEAF_CLAIM_MISMATCH',
      'OEIR_LEAF_CLAIM_MISMATCH',
      'OEIR_LEAF_CLAIM_MISMATCH',
    ]);
    for (const outcome of result.outcomes) {
      expect(outcome.error, outcome.label).not.toBeNull();
      expect(outcome.probe.subscriptions, outcome.label).toBe(0);
      expect(outcome.probe.unsubscribed, outcome.label).toBe(0);
      expect(outcome.mutations, outcome.label).toEqual([]);
      expect(outcome.domSame, outcome.label).toBe(true);
    }

    // A failed claim must not leak into the next claim of the same bytes.
    expect(result.retry.error).toBeNull();
    expect(result.retry.probe).toMatchObject({
      owners: 1,
      projections: 1,
      unsubscribed: 0,
    });
    expect(result.retry.probe.subscriptions).toBe(result.retry.texts.length + 2);
    expect(result.retry.mutations).toEqual([]);
    expect(result.retry.identity).toBe(true);
    expect(result.retry.texts).toEqual(['A: 0', 'C: 0']);
    await page.close();
  }, 120_000);

  test('client-extra seeds insert (non-clean) and duplicate keys keep occurrence identity', async () => {
    const valid = renderS2();
    const duplicate = renderS2([
      { id: 'a', label: 'A' },
      { id: 'a', label: 'A2' },
      { id: 'c', label: 'C' },
    ]);
    const page = await newPage(BOARD_FIXTURE);

    const result = (await page.evaluate(
      ({ validHtml, duplicateHtml }) => {
        interface Runtime {
          readonly claimRecipe: (
            owner: unknown,
            recipe: unknown,
            parent: Node,
          ) => { dispose(detach?: boolean): void };
          readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
          readonly signal: <T>(value: T) => { value: T };
          readonly runtimeProbe: { reset(): void; snapshot(): Probe };
        }
        interface Probe {
          projections: number;
          regions: number;
          owners: number;
          nodes: number;
          rangeCleanups: number;
          subscriptions: number;
          unsubscribed: number;
          lineageAccepted: number;
          lineageRejected: number;
          disposed: number;
        }
        interface Factories {
          readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
        }
        const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
        const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
        const comments = (root: ParentNode): string[] => {
          const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
          const found: string[] = [];
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            found.push((node as Comment).nodeValue ?? '');
          }
          return found;
        };
        const claimOnce = (
          serverHtml: string,
          clientItems: readonly unknown[],
        ): {
          error: string | null;
          code: string | null;
          mutations: string[];
          probe: Probe;
          texts: string[];
          kept: boolean;
          distinct: number;
          markers: string[];
        } => {
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          host.innerHTML = serverHtml;
          const ul = host.firstChild as Element;
          const wireLis = [...ul.querySelectorAll('li')];
          const open = runtime.signal(true);
          const items = runtime.signal(clientItems);
          const count = runtime.signal(0);
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createBoardRecipe(scope, {
            props: {},
            bindings: { open, items, count },
            propsChanged: runtime.signal(0),
          });
          const pending: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) pending.push(record.type);
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          runtime.runtimeProbe.reset();
          let error: string | null = null;
          let code: string | null = null;
          let projection: { dispose(detach?: boolean): void } | null = null;
          try {
            projection = runtime.claimRecipe(scope, recipe, host);
          } catch (caught) {
            const failure = caught as { readonly code?: string; readonly message?: string };
            error = failure.message ?? String(caught);
            code = failure.code ?? null;
          }
          for (const record of observer.takeRecords()) pending.push(record.type);
          observer.disconnect();
          const probe = runtime.runtimeProbe.snapshot();
          const after = [...ul.querySelectorAll('li')];
          const keptClientExtra =
            after.length === 3 && after[0] === wireLis[0] && after[2] === wireLis[1];
          const keptDuplicate =
            after.length === 3 &&
            after[0] === wireLis[2] &&
            after[1] === wireLis[0] &&
            after[2] === wireLis[1];
          const markers = comments(ul).filter(
            (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
          );
          const result = {
            error,
            code,
            mutations: [...pending],
            probe,
            texts: after.map((li) => li.textContent),
            keptClientExtra,
            keptDuplicate,
            distinct: new Set(after).size,
            markers,
          };
          projection?.dispose(true);
          scope.dispose(false);
          return result;
        };

        return {
          clientExtra: claimOnce(validHtml, [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ]),
          duplicate: claimOnce(duplicateHtml, [
            { id: 'c', label: 'C' },
            { id: 'a', label: 'A' },
            { id: 'a', label: 'A2' },
          ]),
        };
      },
      { validHtml: valid, duplicateHtml: duplicate },
    )) as {
      readonly clientExtra: {
        readonly error: string | null;
        readonly code: string | null;
        readonly mutations: readonly string[];
        readonly probe: BrowserProbe;
        readonly texts: readonly string[];
        readonly keptClientExtra: boolean;
        readonly keptDuplicate: boolean;
        readonly distinct: number;
        readonly markers: readonly string[];
      };
      readonly duplicate: {
        readonly error: string | null;
        readonly code: string | null;
        readonly mutations: readonly string[];
        readonly probe: BrowserProbe;
        readonly texts: readonly string[];
        readonly keptClientExtra: boolean;
        readonly keptDuplicate: boolean;
        readonly distinct: number;
        readonly markers: readonly string[];
      };
    };

    expect(result.clientExtra.error).toBeNull();
    expect(result.clientExtra.probe.unsubscribed).toBe(0);
    expect(result.clientExtra.probe.subscriptions).toBe(result.clientExtra.texts.length + 2);
    expect(result.clientExtra.mutations).toContain('childList');
    expect(result.clientExtra.texts).toEqual(['A: 0', 'B: 0', 'C: 0']);
    expect(result.clientExtra.keptClientExtra).toBe(true);
    expect(result.clientExtra.distinct).toBe(3);
    expect(result.clientExtra.markers).toEqual([
      'oe:each',
      'oe:k:s:61',
      'oe:k:s:62',
      'oe:k:s:63',
      'oe:/each',
    ]);

    expect(result.duplicate.error).toBeNull();
    expect(result.duplicate.probe.unsubscribed).toBe(0);
    expect(result.duplicate.probe.subscriptions).toBe(result.duplicate.texts.length + 2);
    expect(result.duplicate.mutations).toContain('childList');
    expect(result.duplicate.mutations).not.toContain('characterData');
    expect(result.duplicate.texts).toEqual(['C: 0', 'A: 0', 'A2: 0']);
    expect(result.duplicate.keptDuplicate).toBe(true);
    expect(result.duplicate.distinct).toBe(3);
    expect(result.duplicate.markers).toEqual([
      'oe:each',
      'oe:k:s:63',
      'oe:k:s:61',
      'oe:k:s:61',
      'oe:/each',
    ]);
    await page.close();
  }, 120_000);
});

interface UnsupportedMountResult {
  readonly mountedHtml: string;
  readonly mountedMarkers: readonly string[];
  readonly error: string | null;
  readonly code: string | null;
  readonly probe: BrowserProbe;
  readonly domSame: boolean;
  readonly claimedMarkers: readonly string[];
}

describe('M08 S2 acceptance — unsupported keys', () => {
  test('mount writes oe:k:u and the claim rejects it without deleting borrowed DOM', async () => {
    const generated = compile(UNSUPPORTED_KEY);
    const page = await newPage(generated);
    const result = (await page.evaluate(() => {
      interface Runtime {
        readonly insertRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { dispose(detach?: boolean): void };
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { dispose(detach?: boolean): void };
        readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
        readonly signal: <T>(value: T) => { value: T };
        readonly runtimeProbe: { reset(): void; snapshot(): Probe };
      }
      interface Probe {
        projections: number;
        regions: number;
        owners: number;
        nodes: number;
        rangeCleanups: number;
        subscriptions: number;
        unsubscribed: number;
        lineageAccepted: number;
        lineageRejected: number;
        disposed: number;
      }
      interface Factories {
        readonly createUnsupportedObjectRecipe: (owner: unknown, host: unknown) => unknown;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const comments = (root: ParentNode): string[] => {
        const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      const items = runtime.signal([{ id: {}, label: 'A' }]);
      const hostRecord = {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      };
      const mountScope = new runtime.LifetimeScope();
      const mounted = runtime.insertRecipe(
        mountScope,
        factories.createUnsupportedObjectRecipe(mountScope, hostRecord),
        host,
      );
      const mountedHtml = host.innerHTML;
      const mountedMarkers = comments(host);
      const mountedUl = host.firstChild as Element;
      const mountedNodes = [...mountedUl.childNodes];
      mounted.dispose(false);

      const claimScope = new runtime.LifetimeScope();
      const claimRecipe = factories.createUnsupportedObjectRecipe(claimScope, hostRecord);
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let code: string | null = null;
      try {
        runtime.claimRecipe(claimScope, claimRecipe, host);
        error = 'NO_THROW';
        code = 'NO_THROW';
      } catch (caught) {
        const failure = caught as { readonly code?: string; readonly message?: string };
        error = failure.message ?? String(caught);
        code = failure.code ?? null;
      }
      const probe = runtime.runtimeProbe.snapshot();
      const claimedMarkers = comments(host);
      const domSame =
        host.firstChild === mountedUl &&
        mountedHtml === host.innerHTML &&
        mountedNodes.every((node, index) => node === mountedUl.childNodes[index]);
      claimScope.dispose(false);
      return {
        mountedHtml,
        mountedMarkers,
        error,
        code,
        probe,
        domSame,
        claimedMarkers,
      };
    })) as UnsupportedMountResult;

    expect(result.mountedHtml).toContain('<!--oe:k:u-->');
    expect(result.mountedMarkers).toContain('oe:k:u');
    expect(result.error).toContain('unsupported entry key kind');
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.probe).toMatchObject({
      subscriptions: 0,
      unsubscribed: 0,
    });
    expect(result.domSame).toBe(true);
    expect(result.claimedMarkers).toEqual(result.mountedMarkers);
    await page.close();
  }, 120_000);

  test('a claimed-list update to an unsupported key fails before mutation and recovers', async () => {
    const page = await newPage(BOARD_FIXTURE);
    const html = renderS2();
    const result = (await page.evaluate(async (serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { dispose(detach?: boolean): void };
        readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
        readonly signal: <T>(value: T) => { value: T };
        readonly runtimeProbe: { reset(): void; snapshot(): Probe };
      }
      interface Probe {
        projections: number;
        regions: number;
        owners: number;
        nodes: number;
        rangeCleanups: number;
        subscriptions: number;
        unsubscribed: number;
        lineageAccepted: number;
        lineageRejected: number;
        disposed: number;
      }
      interface Factories {
        readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const comments = (root: ParentNode): string[] => {
        const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const lis = [...ul.querySelectorAll('li')];
      const open = runtime.signal(true);
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      const count = runtime.signal(0);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe(scope, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      const claimedHtml = ul.innerHTML;
      const claimedNodes = [...ul.childNodes];
      const claimedMarkers = comments(ul);
      const beforeFailure = runtime.runtimeProbe.snapshot();

      let updateError: string | null = null;
      let updateCode: string | null = null;
      try {
        items.value = [{ id: {}, label: 'X' }];
        updateError = 'NO_THROW';
        updateCode = 'NO_THROW';
      } catch (caught) {
        const failure = caught as { readonly code?: string; readonly message?: string };
        updateError = failure.message ?? String(caught);
        updateCode = failure.code ?? null;
      }
      await flush();
      const afterFailure = runtime.runtimeProbe.snapshot();
      const afterFailureNodes = [...ul.childNodes];
      const afterFailureHtml = ul.innerHTML;
      const afterFailureMarkers = comments(ul);
      const failure = {
        error: updateError,
        code: updateCode,
        domSame:
          afterFailureHtml === claimedHtml &&
          claimedNodes.length === afterFailureNodes.length &&
          claimedNodes.every((node, index) => node === afterFailureNodes[index]),
        markersSame:
          afterFailureMarkers.length === claimedMarkers.length &&
          afterFailureMarkers.every((marker, index) => marker === claimedMarkers[index]),
        noUnsupportedMarker: !afterFailureMarkers.includes('oe:k:u'),
        subscriptionsSame:
          afterFailure.subscriptions === beforeFailure.subscriptions &&
          afterFailure.unsubscribed === beforeFailure.unsubscribed,
      };

      items.value = [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ];
      await flush();
      const recoveredLis = [...ul.querySelectorAll('li')];
      const recovered = {
        texts: recoveredLis.map((li) => li.textContent),
        sameObjects: recoveredLis[0] === lis[0] && recoveredLis[1] === lis[1],
        subscriptions: runtime.runtimeProbe.snapshot().subscriptions,
      };
      projection.dispose(true);
      scope.dispose(false);
      return { failure, recovered };
    }, html)) as {
      readonly failure: {
        readonly error: string | null;
        readonly code: string | null;
        readonly domSame: boolean;
        readonly markersSame: boolean;
        readonly noUnsupportedMarker: boolean;
        readonly subscriptionsSame: boolean;
      };
      readonly recovered: {
        readonly texts: readonly string[];
        readonly sameObjects: boolean;
        readonly subscriptions: number;
      };
    };

    expect(result.failure.error).toContain('list key must be');
    expect(result.failure.code).toBe('OEIR_LEAF_UNSUPPORTED_KEY');
    expect(result.failure.domSame).toBe(true);
    expect(result.failure.markersSame).toBe(true);
    expect(result.failure.noUnsupportedMarker).toBe(true);
    expect(result.failure.subscriptionsSame).toBe(true);
    expect(result.recovered.texts).toEqual(['A: 0', 'C: 0']);
    expect(result.recovered.sameObjects).toBe(true);
    expect(result.recovered.subscriptions).toBe(result.recovered.texts.length + 2);
    await page.close();
  }, 120_000);
});

describe('M08 S2 acceptance — permitted difference', () => {
  test('a different dynamic value keeps the structure, writes, and is classified non-clean', async () => {
    const page = await newPage(BOARD_FIXTURE);
    const html = renderS2(S2_INITIAL, true, 0);
    const result = (await page.evaluate(async (serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { dispose(detach?: boolean): void };
        readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
        readonly signal: <T>(value: T) => { value: T };
        readonly runtimeProbe: { reset(): void; snapshot(): Probe };
      }
      interface Probe {
        projections: number;
        regions: number;
        owners: number;
        nodes: number;
        rangeCleanups: number;
        subscriptions: number;
        unsubscribed: number;
        lineageAccepted: number;
        lineageRejected: number;
        disposed: number;
      }
      interface Factories {
        readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const flush = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const ul = section.querySelector('ul') as Element;
      const seededLis = [...ul.querySelectorAll('li')];
      const serverTexts = seededLis.map((li) => li.textContent);
      const open = runtime.signal(true);
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      // The server seed was produced with count=0; the client starts at 7.
      const count = runtime.signal(7);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe(scope, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });
      const pending: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) pending.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let projection: { dispose(detach?: boolean): void } | null = null;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      await flush();
      for (const record of observer.takeRecords()) pending.push(record.type);
      observer.disconnect();
      const claimedLis = [...ul.querySelectorAll('li')];
      const claimedTexts = claimedLis.map((li) => li.textContent);
      const probe = runtime.runtimeProbe.snapshot();
      const classification = {
        structure:
          error === null && claimedLis.every((li, index) => li === seededLis[index])
            ? 'equal'
            : 'different',
        values: serverTexts.every((text, index) => text === claimedTexts[index])
          ? 'equal'
          : 'different',
        clean: pending.length === 0,
      };
      projection?.dispose(true);
      scope.dispose(false);
      return { error, mutations: [...pending], texts: claimedTexts, classification, probe };
    }, html)) as {
      readonly error: string | null;
      readonly mutations: readonly string[];
      readonly texts: readonly (string | null)[];
      readonly classification: {
        readonly structure: string;
        readonly values: string;
        readonly clean: boolean;
      };
      readonly probe: BrowserProbe;
    };

    expect(result.error).toBeNull();
    expect(result.mutations.filter((type) => type === 'characterData')).toHaveLength(2);
    expect(result.texts).toEqual(['A: 7', 'C: 7']);
    expect(result.probe.subscriptions).toBe(result.texts.length + 2);
    // Explicit permitted-seed classification: the list structure is equal but
    // the dynamic values differ, so the activation write is allowed and the
    // result is non-clean. This is not a missing reject/strict gate.
    expect(result.classification).toEqual({
      structure: 'equal',
      values: 'different',
      clean: false,
    });
    await page.close();
  }, 120_000);
});

describe('M08 S2 acceptance — duplicate reconnect', () => {
  test('a claim-inserted duplicate survives dispose(false) and a fresh reclaim without double accounting', async () => {
    const page = await newPage(BOARD_FIXTURE);
    const html = renderS2([{ id: 'a', label: 'A' }], true, 0);
    const result = (await page.evaluate((serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { dispose(detach?: boolean): void };
        readonly LifetimeScope: new () => { dispose(detach?: boolean): void };
        readonly signal: <T>(value: T) => { value: T };
        readonly runtimeProbe: { reset(): void; snapshot(): Probe };
      }
      interface Probe {
        projections: number;
        regions: number;
        owners: number;
        nodes: number;
        rangeCleanups: number;
        subscriptions: number;
        unsubscribed: number;
        lineageAccepted: number;
        lineageRejected: number;
        disposed: number;
      }
      interface Factories {
        readonly createBoardRecipe: (owner: unknown, host: unknown) => unknown;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const comments = (root: ParentNode): string[] => {
        const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const ul = section.querySelector('ul') as Element;
      const open = runtime.signal(true);
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A2' },
      ]);
      const count = runtime.signal(0);
      const hostRecord = {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      };
      runtime.runtimeProbe.reset();
      const firstScope = new runtime.LifetimeScope();
      const first = runtime.claimRecipe(
        firstScope,
        factories.createBoardRecipe(firstScope, hostRecord),
        host,
      );
      const firstLis = [...ul.querySelectorAll('li')];
      const firstMarkers = comments(ul).filter(
        (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
      );
      const firstProbe = runtime.runtimeProbe.snapshot();
      first.dispose(false);
      const afterDefault = runtime.runtimeProbe.snapshot();

      const pending: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) pending.push(record.type);
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      runtime.runtimeProbe.reset();
      const secondScope = new runtime.LifetimeScope();
      const second = runtime.claimRecipe(
        secondScope,
        factories.createBoardRecipe(secondScope, hostRecord),
        host,
      );
      for (const record of observer.takeRecords()) pending.push(record.type);
      observer.disconnect();
      const secondLis = [...ul.querySelectorAll('li')];
      const secondMarkers = comments(ul).filter(
        (marker) => marker === 'oe:each' || marker === 'oe:/each' || marker.startsWith('oe:k:'),
      );
      const secondProbe = runtime.runtimeProbe.snapshot();
      const identity =
        host.firstChild === section &&
        section.querySelector('ul') === ul &&
        secondLis.length === 2 &&
        secondLis[0] === firstLis[0] &&
        secondLis[1] === firstLis[1];
      const texts = secondLis.map((li) => li.textContent);
      second.dispose(true);
      firstScope.dispose(false);
      secondScope.dispose(false);
      return {
        firstMarkers,
        secondMarkers,
        afterDefault,
        identity,
        texts,
        mutations: [...pending],
        firstProbe,
        secondProbe,
        childrenAfterDetach: host.childNodes.length,
      };
    }, html)) as {
      readonly firstMarkers: readonly string[];
      readonly secondMarkers: readonly string[];
      readonly afterDefault: BrowserProbe;
      readonly identity: boolean;
      readonly texts: readonly string[];
      readonly mutations: readonly string[];
      readonly firstProbe: BrowserProbe;
      readonly secondProbe: BrowserProbe;
      readonly childrenAfterDetach: number;
    };

    expect(result.firstMarkers).toEqual(['oe:each', 'oe:k:s:61', 'oe:k:s:61', 'oe:/each']);
    expect(result.texts).toEqual(['A: 0', 'A2: 0']);
    expect(result.identity).toBe(true);
    expect(result.mutations).toEqual([]);
    expect(result.afterDefault.unsubscribed).toBe(result.firstProbe.subscriptions);
    expect(result.secondProbe).toMatchObject({
      owners: 1,
      projections: 1,
      unsubscribed: 0,
    });
    expect(result.secondProbe.subscriptions).toBe(result.firstProbe.subscriptions);
    expect(result.secondProbe.subscriptions).not.toBe(result.firstProbe.subscriptions * 2);
    expect(result.secondMarkers).toEqual(result.firstMarkers);
    expect(result.childrenAfterDetach).toBe(0);
    console.log(
      `[M08-S2] duplicate reconnect subs=${result.firstProbe.subscriptions}->${result.secondProbe.subscriptions} ` +
        `owners=${result.secondProbe.owners} unsubscribed=${result.secondProbe.unsubscribed} mutations=${result.mutations.length}`,
    );
    await page.close();
  }, 120_000);
});
