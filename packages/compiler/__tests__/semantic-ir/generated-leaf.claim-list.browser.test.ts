/**
 * M08 list — real Chromium SSR→parse→claim→update→dispose vertical.
 *
 * The SSR string is produced by the generated `__ssr` on the Node side; the real
 * browser parser owns the nodes; the generated claim adopts exactly those nodes.
 * LOCAL Chromium only: not M13 and not M08 exit.
 *
 * Covered:
 *   - equal seed: zero claim-period mutations, marker/entry/text identity;
 *   - private draft: a count write refreshes its own slot without rebuilding an
 *     entry;
 *   - keyed reorder at update: the same `<li>` nodes move, markers move with
 *     them; childList moves are allowed and recorded as non-clean;
 *   - same-key replacement: identity kept, entry-local text re-renders;
 *   - insert/delete after a successful claim, with the list end as the fixed
 *     tail and entry-owner subscription accounting;
 *   - reorder at claim and server-empty → client insert (activation-only,
 *     explicitly non-clean);
 *   - duplicate-token multiplicity: mount→claim, claim insert→dispose(false)→
 *     reclaim, and cross-key reorder keep each occurrence's identity;
 *   - wire-more multiplicity / `u` mismatches: borrowed DOM untouched and no
 *     subscription opened;
 *   - an unsupported post-claim update fails closed before any DOM mutation
 *     (no `u` in the claimed tree) and recovers on the next legal value;
 *   - unkeyed positional claim and an entry-internal static directory claim;
 *   - dispose(false) keeps DOM and closes subscriptions, dispose(true) removes.
 *
 * The checks are DOM checks. Raw-byte/EOF truncation that the HTML parser
 * repairs into the same legal node is not distinguishable from a producer DOM
 * and is not asserted here; transport completeness is an HTTP/build property.
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
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/claim-list-browser.tsx';

const SOURCE = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
  </section>;
}
function Keyed(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
function Empty(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
function Unkeyed(props) {
  const items = signal(['a', 'b']);
  return <ul>{items.value.map((item) => <li>{item}</li>)}</ul>;
}
function DirectoryEntry(props) {
  const items = signal([{ id: 'a' }, { id: 'c' }]);
  return <ul>{items.value.map((item) => <li key={item.id}><b>x</b><i>y</i></li>)}</ul>;
}
function Unsupported(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item}>{item.label}</li>)}</ul>;
}
function Child(props) {
  return <b>child</b>;
}
function Panel(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  return <section><Child /><ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul><span>after</span></section>;
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
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-list-claim-browser-'));
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
  console.log(`[M08-list] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

async function prepare(): Promise<Fixture> {
  const generated = fixture();
  page = await browser.newPage();
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: harnessModule(generated.module) });
  return generated;
}

interface RuntimePage {
  claimRecipe(
    owner: unknown,
    recipe: unknown,
    parent: Node,
  ): {
    readonly nodes: readonly Node[];
    dispose(detach?: boolean): void;
  };
  insertRecipe(
    owner: unknown,
    recipe: unknown,
    parent: Node,
  ): { readonly nodes: readonly Node[]; dispose(detach?: boolean): void };
  LifetimeScope: new () => { dispose(detach?: boolean): void };
  signal<T>(value: T): { value: T };
  runtimeProbe: {
    reset(): void;
    snapshot(): {
      subscriptions: number;
      unsubscribed: number;
      owners: number;
      projections: number;
      rangeCleanups: number;
    };
  };
}

interface PageModule {
  [name: string]: (owner: unknown, host: unknown) => unknown;
}

interface Probe {
  subscriptions: number;
  unsubscribed: number;
  projections: number;
}

describe('M08 list — Chromium claim, update and dispose', () => {
  test('equal seed is zero-mutation; reorder/update/insert/delete keep entry identity', async () => {
    const generated = await prepare();
    const serverOpen = { value: true };
    const serverItems = {
      value: [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ],
    };
    const serverCount = { value: 0 };
    const html = ssr(generated.loaded, 'Board')(
      {},
      { bindings: { open: serverOpen, items: serverItems, count: serverCount } },
    );

    const result = (await page.evaluate(async (serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const ul = section.querySelector('ul') as Element;

      const open = runtime.signal(true);
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      const count = runtime.signal(0);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createBoardRecipe!(scope, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });

      const markers = [...ul.childNodes].filter((node) => node.nodeType === 8);
      const lis = [...ul.querySelectorAll('li')];
      const firstText = lis[0]!.childNodes[1] as Text;
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });

      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let projection: { readonly nodes: readonly Node[]; dispose(detach?: boolean): void } | null =
        null;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const claimMutations = mutations.length;
      const afterClaim = runtime.runtimeProbe.snapshot() as unknown as Probe;
      const seededIdentity = {
        sectionSame: host.firstChild === section,
        ulSame: section.querySelector('ul') === ul,
        liSame: [...ul.querySelectorAll('li')].every((li, index) => li === lis[index]),
        textSame: (ul.querySelectorAll('li')[0]!.childNodes[1] as Text) === firstText,
        markersSame: [...ul.childNodes]
          .filter((node) => node.nodeType === 8)
          .every((marker, index) => marker === markers[index]),
      };

      // Private draft: the count refresh touches only its own text slot.
      count.value = 9;
      await Promise.resolve();
      await Promise.resolve();
      const draft = {
        liSame: [...ul.querySelectorAll('li')].every((li, index) => li === lis[index]),
        texts: [...ul.querySelectorAll('li')].map((li) => li.textContent),
      };

      // Keyed reorder: nodes (and their key markers) move, not re-create.
      items.value = [
        { id: 'c', label: 'C' },
        { id: 'a', label: 'A' },
      ];
      await Promise.resolve();
      await Promise.resolve();
      const reordered = [...ul.querySelectorAll('li')];
      const reorder = {
        sameObjects: reordered[0] === lis[1] && reordered[1] === lis[0],
        texts: reordered.map((li) => li.textContent),
        markerCount: [...ul.childNodes].filter((node) => node.nodeType === 8).length,
      };

      // Same-key replacement: identity kept, entry-local text re-rendered.
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'c', label: 'C' },
      ];
      await Promise.resolve();
      await Promise.resolve();
      const replaced = [...ul.querySelectorAll('li')];
      const replacement = {
        sameObjects: replaced[0] === lis[0] && replaced[1] === lis[1],
        texts: replaced.map((li) => li.textContent),
      };

      // Insert a missing key; then delete an existing one (post-claim update).
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ];
      await Promise.resolve();
      await Promise.resolve();
      const inserted = [...ul.querySelectorAll('li')];
      const insert = {
        count: inserted.length,
        texts: inserted.map((li) => li.textContent),
        kept: inserted[0] === lis[0] && inserted[2] === lis[1],
      };
      const beforeDelete = runtime.runtimeProbe.snapshot();
      items.value = [
        { id: 'a', label: 'A2' },
        { id: 'c', label: 'C' },
      ];
      await Promise.resolve();
      await Promise.resolve();
      const deleted = [...ul.querySelectorAll('li')];
      const afterDelete = runtime.runtimeProbe.snapshot();
      const deletion = {
        count: deleted.length,
        texts: deleted.map((li) => li.textContent),
        unsubscribed: afterDelete.unsubscribed - beforeDelete.unsubscribed,
      };

      observer.disconnect();
      projection?.dispose(false);
      const afterDefaultDispose = {
        hostChildren: host.childNodes.length,
        sectionStillThere: host.contains(section),
      };

      // Re-claim the same DOM and detach-dispose to prove the range cleanup.
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createBoardRecipe!(scope2, {
        props: {},
        bindings: { open, items, count },
        propsChanged: runtime.signal(0),
      });
      const second = runtime.claimRecipe(scope2, recipe2, host);
      const afterSecondClaim = {
        ulSame: section.querySelector('ul') === ul,
        liSame: [...ul.querySelectorAll('li')].every((li, index) => li === deleted[index]),
      };
      second.dispose(true);
      const afterDetachDispose = host.childNodes.length;

      return {
        error,
        claimMutations,
        afterClaim,
        seededIdentity,
        draft,
        reorder,
        replacement,
        insert,
        deletion,
        afterDefaultDispose,
        afterSecondClaim,
        afterDetachDispose,
      };
    }, html)) as {
      error: string | null;
      claimMutations: number;
      afterClaim: Probe;
      seededIdentity: {
        sectionSame: boolean;
        ulSame: boolean;
        liSame: boolean;
        textSame: boolean;
        markersSame: boolean;
      };
      draft: { liSame: boolean; texts: string[] };
      reorder: { sameObjects: boolean; texts: string[]; markerCount: number };
      replacement: { sameObjects: boolean; texts: string[] };
      insert: { count: number; texts: string[]; kept: boolean };
      deletion: { count: number; texts: string[]; unsubscribed: number };
      afterDefaultDispose: { hostChildren: number; sectionStillThere: boolean };
      afterSecondClaim: { ulSame: boolean; liSame: boolean };
      afterDetachDispose: number;
    };

    expect(result.error).toBeNull();
    expect(result.claimMutations).toBe(0);
    expect(result.seededIdentity).toEqual({
      sectionSame: true,
      ulSame: true,
      liSame: true,
      textSame: true,
      markersSame: true,
    });
    expect(result.afterClaim).toMatchObject({
      subscriptions: 4,
      unsubscribed: 0,
      projections: 1,
    });
    expect(result.draft.liSame).toBe(true);
    expect(result.draft.texts).toEqual(['A: 9', 'C: 9']);
    expect(result.reorder.sameObjects).toBe(true);
    expect(result.reorder.texts).toEqual(['C: 9', 'A: 9']);
    // 2 list markers + 2 key markers (no per-entry end marker).
    expect(result.reorder.markerCount).toBe(4);
    expect(result.replacement.sameObjects).toBe(true);
    expect(result.replacement.texts).toEqual(['A2: 9', 'C: 9']);
    expect(result.insert.count).toBe(3);
    expect(result.insert.texts).toEqual(['A2: 9', 'B: 9', 'C: 9']);
    expect(result.insert.kept).toBe(true);
    expect(result.deletion.count).toBe(2);
    expect(result.deletion.texts).toEqual(['A2: 9', 'C: 9']);
    expect(result.deletion.unsubscribed).toBe(1);
    expect(result.afterDefaultDispose).toEqual({ hostChildren: 1, sectionStillThere: true });
    expect(result.afterSecondClaim).toEqual({ ulSame: true, liSame: true });
    expect(result.afterDetachDispose).toBe(0);
    await page.close();
  });

  test('reorder at claim and server-empty insert: same nodes move, insert is non-clean', async () => {
    const generated = await prepare();
    const serverItems = {
      value: [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ],
    };
    const html = ssr(generated.loaded, 'Keyed')({}, { bindings: { items: serverItems } });

    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const lis = [...ul.querySelectorAll('li')];
      const markers = [...ul.childNodes].filter((node) => node.nodeType === 8);
      const items = runtime.signal([
        { id: 'c', label: 'C' },
        { id: 'a', label: 'A' },
      ]);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createKeyedRecipe!(scope, {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const afterClaim = runtime.runtimeProbe.snapshot() as unknown as Probe;
      const reordered = [...ul.querySelectorAll('li')];
      const reorderMarkers = [...ul.childNodes].filter((node) => node.nodeType === 8);
      const reorder = {
        sameObjects: reordered[0] === lis[1] && reordered[1] === lis[0],
        texts: reordered.map((li) => li.textContent),
        markerSetSame:
          reorderMarkers.length === markers.length &&
          markers.every((marker) => reorderMarkers.includes(marker)),
        markerText: reorderMarkers.map((marker) => (marker as Comment).nodeValue),
        endLast: (ul.lastChild as Comment).nodeValue === 'oe:/each',
      };
      const mutationList = [...mutations];
      observer.disconnect();
      projection.dispose(true);
      return {
        afterClaim,
        reorder,
        mutationList,
      };
    }, html)) as {
      afterClaim: Probe;
      reorder: {
        sameObjects: boolean;
        texts: string[];
        markerSetSame: boolean;
        markerText: string[];
        endLast: boolean;
      };
      mutationList: string[];
    };

    expect(result.afterClaim.subscriptions).toBe(1);
    expect(result.reorder.sameObjects).toBe(true);
    expect(result.reorder.texts).toEqual(['C', 'A']);
    expect(result.reorder.markerSetSame).toBe(true);
    expect(result.reorder.markerText).toEqual(['oe:each', 'oe:k:s:63', 'oe:k:s:61', 'oe:/each']);
    expect(result.reorder.endLast).toBe(true);
    // A claim-time reorder is explicitly non-clean: childList moves happened,
    // but no character data was rewritten.
    expect(result.mutationList).toContain('childList');
    expect(result.mutationList).not.toContain('characterData');

    // Server-empty → client insert is activation work, not a 0-mutation claim.
    const emptyHtml = ssr(generated.loaded, 'Empty')({}, { bindings: { items: { value: [] } } });
    const insertResult = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ]);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createEmptyRecipe!(scope, {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const afterClaim = runtime.runtimeProbe.snapshot() as unknown as Probe;
      const nodes = [...ul.childNodes];
      const snapshot = {
        markers: nodes.filter((node) => node.nodeType === 8).length,
        liTexts: [...ul.querySelectorAll('li')].map((li) => li.textContent),
        endLast: (ul.lastChild as Comment).nodeValue === 'oe:/each',
        mutations: [...mutations],
        afterClaim,
      };
      observer.disconnect();
      projection.dispose(true);
      snapshot.disposedChildren = host.childNodes.length;
      return snapshot;
    }, emptyHtml)) as {
      markers: number;
      liTexts: string[];
      endLast: boolean;
      mutations: string[];
      afterClaim: Probe;
      disposedChildren: number;
    };

    expect(insertResult.markers).toBe(4);
    expect(insertResult.liTexts).toEqual(['A', 'B']);
    expect(insertResult.endLast).toBe(true);
    expect(insertResult.mutations).toContain('childList');
    expect(insertResult.afterClaim.subscriptions).toBe(1);
    expect(insertResult.disposedChildren).toBe(0);
    await page.close();
  });

  test('same-key replacement at claim and a duplicate client key: adopt once, insert the rest', async () => {
    const generated = await prepare();
    const serverItems = {
      value: [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ],
    };
    const serverHtml = ssr(generated.loaded, 'Keyed')({}, { bindings: { items: serverItems } });
    const singleHtml = ssr(generated.loaded, 'Keyed')(
      {},
      { bindings: { items: { value: [{ id: 'a', label: 'A' }] } } },
    );

    const result = (await page.evaluate(
      ({ serverHtml, singleHtml }) => {
        const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
        const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;

        const claimWith = (html: string, clientItems: unknown[]) => {
          host.innerHTML = html;
          const ul = host.firstChild as Element;
          const lis = [...ul.querySelectorAll('li')];
          const items = runtime.signal(clientItems);
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createKeyedRecipe!(scope, {
            props: {},
            bindings: { items },
            propsChanged: runtime.signal(0),
          });
          const mutations: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(host, { subtree: true, childList: true, characterData: true });
          runtime.runtimeProbe.reset();
          let error: string | null = null;
          try {
            runtime.claimRecipe(scope, recipe, host);
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          const after = [...ul.querySelectorAll('li')];
          return {
            error,
            sameObjects: after.every((li, index) => li === lis[index]),
            texts: after.map((li) => li.textContent),
            markers: [...ul.childNodes]
              .filter((node) => node.nodeType === 8)
              .map((node) => (node as Comment).nodeValue),
            mutations: [...mutations],
            probe: runtime.runtimeProbe.snapshot() as unknown as Probe,
          };
        };

        const sameKey = claimWith(serverHtml, [
          { id: 'a', label: 'A2' },
          { id: 'c', label: 'C' },
        ]);

        // Server [a]; client [a,a]: the first occurrence adopts the wire entry,
        // the duplicate inserts (mount's used-set semantics).
        const duplicateClient = claimWith(singleHtml, [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'A2' },
        ]);
        return { sameKey, duplicateClient };
      },
      { serverHtml, singleHtml },
    )) as {
      sameKey: {
        error: string | null;
        sameObjects: boolean;
        texts: string[];
        markers: string[];
        mutations: string[];
        probe: Probe;
      };
      duplicateClient: {
        error: string | null;
        sameObjects: boolean;
        texts: string[];
        markers: string[];
        mutations: string[];
        probe: Probe;
      };
    };

    expect(result.sameKey.error).toBeNull();
    expect(result.sameKey.sameObjects).toBe(true);
    expect(result.sameKey.texts).toEqual(['A2', 'C']);
    // Same-key replacement is a text write, not a structural claim mutation.
    expect(result.sameKey.mutations).toEqual(['characterData']);
    expect(result.sameKey.probe.subscriptions).toBe(1);

    expect(result.duplicateClient.error).toBeNull();
    // The first li is the adopted wire node; the duplicate key inserts a second.
    expect(result.duplicateClient.sameObjects).toBe(false);
    expect(result.duplicateClient.texts).toEqual(['A', 'A2']);
    expect(result.duplicateClient.markers).toEqual([
      'oe:each',
      'oe:k:s:61',
      'oe:k:s:61',
      'oe:/each',
    ]);
    expect(result.duplicateClient.mutations).toContain('childList');
    expect(result.duplicateClient.probe.subscriptions).toBe(1);
    await page.close();
  });

  test('shared cursor: list structure verifies before the activation queue opens anything', async () => {
    await prepare();

    const result = (await page.evaluate(() => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      const makeHost = () => {
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        const items = runtime.signal([
          { id: 'a', label: 'A' },
          { id: 'c', label: 'C' },
        ]);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createPanelRecipe!(scope, {
          props: {},
          bindings: { items },
          propsChanged: runtime.signal(0),
        });
        runtime.insertRecipe(scope, recipe, host);
        return { host, items };
      };

      // Equal seed on mount-produced DOM: shared cursor, 0 mutations.
      const equal = makeHost();
      const equalScope = new runtime.LifetimeScope();
      const equalRecipe = factories.createPanelRecipe!(equalScope, {
        props: {},
        bindings: { items: equal.items },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(equal.host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      let equalError: string | null = null;
      try {
        runtime.claimRecipe(equalScope, equalRecipe, equal.host);
      } catch (caught) {
        equalError = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      observer.disconnect();
      const equalProbe = runtime.runtimeProbe.snapshot() as unknown as Probe;

      // Extra sibling after the root: the root check must fire before the list
      // activation queue runs, so no items subscription is opened and no DOM
      // mutation happens.
      const late = makeHost();
      late.host.appendChild(document.createElement('i'));
      const lateScope = new runtime.LifetimeScope();
      const lateRecipe = factories.createPanelRecipe!(lateScope, {
        props: {},
        bindings: { items: late.items },
        propsChanged: runtime.signal(0),
      });
      const lateMutations: string[] = [];
      const lateObserver = new MutationObserver((records) => {
        for (const record of records) lateMutations.push(record.type);
      });
      lateObserver.observe(late.host, { subtree: true, childList: true, characterData: true });
      const before = [...late.host.childNodes];
      runtime.runtimeProbe.reset();
      let lateError: string | null = null;
      try {
        runtime.claimRecipe(lateScope, lateRecipe, late.host);
      } catch (caught) {
        lateError = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of lateObserver.takeRecords()) lateMutations.push(record.type);
      lateObserver.disconnect();
      const lateProbe = runtime.runtimeProbe.snapshot() as unknown as Probe;
      const after = [...late.host.childNodes];
      return {
        equalError,
        equalMutations: [...mutations],
        equalProbe,
        lateError,
        lateMutations,
        lateProbe,
        lateDomSame:
          before.length === after.length && before.every((node, index) => node === after[index]),
      };
    })) as {
      equalError: string | null;
      equalMutations: string[];
      equalProbe: Probe;
      lateError: string | null;
      lateMutations: string[];
      lateProbe: Probe;
      lateDomSame: boolean;
    };

    expect(result.equalError).toBeNull();
    expect(result.equalMutations).toEqual([]);
    expect(result.equalProbe.subscriptions).toBe(1);
    expect(result.lateError).toContain('extra node at /');
    expect(result.lateMutations).toEqual([]);
    expect(result.lateProbe).toMatchObject({
      subscriptions: 0,
      unsubscribed: 0,
      projections: 0,
      nodes: 0,
      rangeCleanups: 0,
    });
    expect(result.lateDomSame).toBe(true);
    await page.close();
  });

  test('mismatches: wire-more, duplicate wire and mount `u` leave borrowed DOM and open nothing', async () => {
    const generated = await prepare();
    const serverItems = {
      value: [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ],
    };
    const html = ssr(generated.loaded, 'Keyed')({}, { bindings: { items: serverItems } });

    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      const snapshot = (): { nodes: Node[]; html: string } => ({
        nodes: [...host.firstChild!.childNodes],
        html: host.innerHTML,
      });

      const runMismatch = (
        source: string,
        clientItems: unknown[],
      ): {
        error: string | null;
        code: string | null;
        same: boolean;
        subscriptions: number;
        unsubscribed: number;
      } => {
        host.innerHTML = source;
        const beforeHtml = host.innerHTML;
        const before = snapshot();
        const items = runtime.signal(clientItems);
        const scope = new runtime.LifetimeScope();
        const recipe = factories.createKeyedRecipe!(scope, {
          props: {},
          bindings: { items },
          propsChanged: runtime.signal(0),
        });
        runtime.runtimeProbe.reset();
        let error: string | null = null;
        let code: string | null = null;
        try {
          runtime.claimRecipe(scope, recipe, host);
          error = 'NO_THROW';
          code = 'NO_THROW';
        } catch (caught) {
          const value = caught as { code?: string; message?: string };
          error = value.message ?? String(caught);
          code = value.code ?? null;
        }
        const after = snapshot();
        const probe = runtime.runtimeProbe.snapshot();
        return {
          error,
          code,
          same:
            after.html === beforeHtml &&
            after.nodes.every((node, index) => node === before.nodes[index]),
          subscriptions: probe.subscriptions,
          unsubscribed: probe.unsubscribed,
        };
      };

      // wire [a,c] vs client [a]: wire-more would require deleting borrowed DOM.
      const wireMore = runMismatch(serverHtml, [{ id: 'a', label: 'A' }]);

      // Duplicate wire key with a single client occurrence: the extra borrowed
      // identity has no client item, so multiplicity is over the client count.
      const duplicateHtml = serverHtml.replace('<!--oe:k:s:63-->', '<!--oe:k:s:61-->');
      const duplicate = runMismatch(duplicateHtml, [{ id: 'a', label: 'A' }]);

      // Mount with an object key writes the mount-only `u` marker; claim rejects.
      host.innerHTML = '<div></div>';
      const container = host.firstChild as Element;
      const objectItems = runtime.signal([{ id: 'a', label: 'A' }]);
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createUnsupportedRecipe!(mountScope, {
        props: {},
        bindings: { items: objectItems },
        propsChanged: runtime.signal(0),
      });
      runtime.insertRecipe(mountScope, mountRecipe, container);
      const mountedHtml = container.innerHTML;
      const claimScope = new runtime.LifetimeScope();
      const claimRecipe = factories.createUnsupportedRecipe!(claimScope, {
        props: {},
        bindings: { items: objectItems },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      let unsupported: { error: string | null; code: string | null };
      const nodesBefore = [...container.childNodes];
      try {
        runtime.claimRecipe(claimScope, claimRecipe, container);
        unsupported = { error: 'NO_THROW', code: 'NO_THROW' };
      } catch (caught) {
        const value = caught as { code?: string; message?: string };
        unsupported = { error: value.message ?? String(caught), code: value.code ?? null };
      }
      const unsupportedProbe = runtime.runtimeProbe.snapshot();

      // A matching claim on the same wire succeeds after the failed rollback:
      // no owner/subscription is leaked by the failed attempt.
      host.innerHTML = serverHtml;
      const retryItems = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      const retryScope = new runtime.LifetimeScope();
      const retryRecipe = factories.createKeyedRecipe!(retryScope, {
        props: {},
        bindings: { items: retryItems },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      let retryError: string | null = null;
      try {
        runtime.claimRecipe(retryScope, retryRecipe, host);
      } catch (caught) {
        retryError = caught instanceof Error ? caught.message : String(caught);
      }
      const retryProbe = runtime.runtimeProbe.snapshot() as unknown as Probe;
      return {
        wireMore,
        duplicate,
        unsupported,
        mountedHtml,
        unsupportedMarker: nodesBefore
          .filter((node) => node.nodeType === 8)
          .map((node) => (node as Comment).nodeValue),
        unsupportedDomSame: [...container.childNodes].every(
          (node, index) => node === nodesBefore[index],
        ),
        unsupportedProbe: {
          subscriptions: unsupportedProbe.subscriptions,
          unsubscribed: unsupportedProbe.unsubscribed,
        },
        retryError,
        retrySubscriptions: retryProbe.subscriptions,
      };
    }, html)) as {
      wireMore: {
        error: string | null;
        code: string | null;
        same: boolean;
        subscriptions: number;
        unsubscribed: number;
      };
      duplicate: {
        error: string | null;
        code: string | null;
        same: boolean;
        subscriptions: number;
        unsubscribed: number;
      };
      unsupported: { error: string | null; code: string | null };
      mountedHtml: string;
      unsupportedMarker: string[];
      unsupportedDomSame: boolean;
      unsupportedProbe: { subscriptions: number; unsubscribed: number };
      retryError: string | null;
      retrySubscriptions: number;
    };

    expect(result.wireMore.error).toContain('server entry key has no client item');
    expect(result.wireMore.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.wireMore.same).toBe(true);
    expect(result.wireMore.subscriptions).toBe(0);
    expect(result.wireMore.unsubscribed).toBe(0);

    expect(result.duplicate.error).toContain('server entry key s:61 occurs 2 times, client has 1');
    expect(result.duplicate.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.duplicate.same).toBe(true);
    expect(result.duplicate.subscriptions).toBe(0);
    expect(result.duplicate.unsubscribed).toBe(0);

    expect(result.mountedHtml).toContain('<!--oe:k:u-->');
    expect(result.unsupported.error).toContain('unsupported entry key kind');
    expect(result.unsupported.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.unsupportedDomSame).toBe(true);
    expect(result.unsupportedProbe).toEqual({ subscriptions: 0, unsubscribed: 0 });

    expect(result.retryError).toBeNull();
    expect(result.retrySubscriptions).toBe(1);
    await page.close();
  });

  test('a mount tree with duplicate keys claims after dispose(false)', async () => {
    await prepare();
    const serverItems = [
      { id: 'a', label: 'A' },
      { id: 'a', label: 'A2' },
    ];
    const result = (await page.evaluate(
      ({ items: initialItems }) => {
        const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
        const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
        document.body.innerHTML = '<div id="container"></div>';
        const container = document.getElementById('container') as HTMLElement;
        const markers = (root: ParentNode): string[] => {
          const doc = (root as Node).ownerDocument ?? document;
          const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
          const found: string[] = [];
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            found.push((node as Comment).nodeValue ?? '');
          }
          return found;
        };
        const items = runtime.signal(initialItems);
        const recipeFor = (scope: unknown) =>
          factories.createKeyedRecipe!(scope, {
            props: {},
            bindings: { items },
            propsChanged: runtime.signal(0),
          });
        const mountScope = new runtime.LifetimeScope();
        const mountProjection = runtime.insertRecipe(mountScope, recipeFor(mountScope), container);
        const mountedLis = [...container.querySelectorAll('li')];
        const mountedMarkers = markers(container);
        mountProjection.dispose(false);

        const claimScope = new runtime.LifetimeScope();
        runtime.runtimeProbe.reset();
        let error: string | null = null;
        let projection: { dispose(detach?: boolean): void } | null = null;
        try {
          projection = runtime.claimRecipe(claimScope, recipeFor(claimScope), container);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        const claimedLis = [...container.querySelectorAll('li')];
        const probe = runtime.runtimeProbe.snapshot();
        const result = {
          error,
          sameObjects: claimedLis.every((li, index) => li === mountedLis[index]),
          texts: claimedLis.map((li) => li.textContent),
          mountedMarkers,
          claimedMarkers: markers(container),
          subscriptions: probe.subscriptions,
        };
        projection?.dispose(true);
        return result;
      },
      { items: serverItems },
    )) as {
      error: string | null;
      sameObjects: boolean;
      texts: string[];
      mountedMarkers: string[];
      claimedMarkers: string[];
      subscriptions: number;
    };

    expect(result.error).toBeNull();
    expect(result.subscriptions).toBe(1);
    expect(result.sameObjects).toBe(true);
    expect(result.texts).toEqual(['A', 'A2']);
    expect(result.mountedMarkers).toEqual([
      'oe:each',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    expect(result.claimedMarkers).toEqual(result.mountedMarkers);
    await page.close();
  });

  test('a claim-inserted duplicate survives dispose(false) and a fresh reclaim', async () => {
    const generated = await prepare();
    const singleHtml = ssr(generated.loaded, 'Keyed')(
      {},
      { bindings: { items: { value: [{ id: 'a', label: 'A' }] } } },
    );
    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const markers = (): string[] => {
        const walker = document.createTreeWalker(ul, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A2' },
      ]);
      const recipeFor = (scope: unknown) =>
        factories.createKeyedRecipe!(scope, {
          props: {},
          bindings: { items },
          propsChanged: runtime.signal(0),
        });
      const firstScope = new runtime.LifetimeScope();
      const firstClaim = runtime.claimRecipe(firstScope, recipeFor(firstScope), host);
      const firstLis = [...ul.querySelectorAll('li')];
      const firstMarkers = markers();
      const firstTexts = firstLis.map((li) => li.textContent);
      firstClaim.dispose(false);

      const reclaimScope = new runtime.LifetimeScope();
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let reclaim: { dispose(detach?: boolean): void } | null = null;
      try {
        reclaim = runtime.claimRecipe(reclaimScope, recipeFor(reclaimScope), host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const reclaimLis = [...ul.querySelectorAll('li')];
      const probe = runtime.runtimeProbe.snapshot();
      const result = {
        error,
        firstMarkers,
        reclaimMarkers: markers(),
        firstTexts,
        texts: reclaimLis.map((li) => li.textContent),
        sameObjects: reclaimLis.every((li, index) => li === firstLis[index]),
        subscriptions: probe.subscriptions,
      };
      reclaim?.dispose(true);
      return result;
    }, singleHtml)) as {
      error: string | null;
      firstMarkers: string[];
      reclaimMarkers: string[];
      firstTexts: string[];
      texts: string[];
      sameObjects: boolean;
      subscriptions: number;
    };

    expect(result.error).toBeNull();
    expect(result.subscriptions).toBe(1);
    expect(result.sameObjects).toBe(true);
    expect(result.firstTexts).toEqual(['A', 'A2']);
    expect(result.texts).toEqual(['A', 'A2']);
    expect(result.firstMarkers).toEqual([
      'oe:each',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    expect(result.reclaimMarkers).toEqual(result.firstMarkers);
    await page.close();
  });

  test('duplicate groups keep occurrence order across a cross-key reorder', async () => {
    const generated = await prepare();
    const reorderHtml = ssr(generated.loaded, 'Keyed')(
      {},
      {
        bindings: {
          items: {
            value: [
              { id: 'a', label: 'A' },
              { id: 'a', label: 'A2' },
              { id: 'c', label: 'C' },
            ],
          },
        },
      },
    );
    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const markers = (): string[] => {
        const walker = document.createTreeWalker(ul, NodeFilter.SHOW_COMMENT);
        const found: string[] = [];
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          found.push((node as Comment).nodeValue ?? '');
        }
        return found;
      };
      const wireLis = [...ul.querySelectorAll('li')];
      const items = runtime.signal([
        { id: 'c', label: 'C' },
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A2' },
      ]);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createKeyedRecipe!(scope, {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let projection: { dispose(detach?: boolean): void } | null = null;
      try {
        projection = runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const reordered = [...ul.querySelectorAll('li')];
      const probe = runtime.runtimeProbe.snapshot();
      const result = {
        error,
        sameObjects:
          reordered[0] === wireLis[2] && reordered[1] === wireLis[0] && reordered[2] === wireLis[1],
        texts: reordered.map((li) => li.textContent),
        markers: markers(),
        subscriptions: probe.subscriptions,
      };
      projection?.dispose(true);
      return result;
    }, reorderHtml)) as {
      error: string | null;
      sameObjects: boolean;
      texts: string[];
      markers: string[];
      subscriptions: number;
    };

    expect(result.error).toBeNull();
    expect(result.subscriptions).toBe(1);
    expect(result.sameObjects).toBe(true);
    expect(result.texts).toEqual(['C', 'A', 'A2']);
    expect(result.markers).toEqual([
      'oe:each',
      'oe:k:s:63',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:s:61',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    await page.close();
  });

  test('an unsupported post-claim update fails closed before mutation and recovers', async () => {
    const generated = await prepare();
    const html = ssr(generated.loaded, 'Keyed')(
      {},
      {
        bindings: {
          items: {
            value: [
              { id: 'a', label: 'A' },
              { id: 'c', label: 'C' },
            ],
          },
        },
      },
    );

    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const ul = host.firstChild as Element;
      const items = runtime.signal([
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ]);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createKeyedRecipe!(scope, {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      const claimedLis = [...ul.querySelectorAll('li')];
      const claimedNodes = [...ul.childNodes];
      const claimedHtml = ul.innerHTML;
      const claimedMarkers = [...ul.childNodes]
        .filter((node) => node.nodeType === 8)
        .map((node) => (node as Comment).nodeValue);
      const beforeFailure = runtime.runtimeProbe.snapshot();

      let updateError: string | null = null;
      let updateCode: string | null = null;
      try {
        items.value = [{ id: {}, label: 'X' }];
        updateError = 'NO_THROW';
      } catch (caught) {
        const value = caught as { code?: string; message?: string };
        updateError = value.message ?? String(caught);
        updateCode = value.code ?? null;
      }
      const afterFailureNodes = [...ul.childNodes];
      const afterFailureHtml = ul.innerHTML;
      const afterFailureMarkers = [...ul.childNodes]
        .filter((node) => node.nodeType === 8)
        .map((node) => (node as Comment).nodeValue);
      const afterFailure = runtime.runtimeProbe.snapshot();

      let recoveryError: string | null = null;
      try {
        items.value = [
          { id: 'a', label: 'A2' },
          { id: 'c', label: 'C2' },
        ];
      } catch (caught) {
        recoveryError = caught instanceof Error ? caught.message : String(caught);
      }
      const recoveredLis = [...ul.querySelectorAll('li')];
      const afterRecovery = runtime.runtimeProbe.snapshot();
      const recovery = {
        error: recoveryError,
        sameObjects: recoveredLis.every((li, index) => li === claimedLis[index]),
        texts: recoveredLis.map((li) => li.textContent),
        markers: [...ul.childNodes]
          .filter((node) => node.nodeType === 8)
          .map((node) => (node as Comment).nodeValue),
        subscriptions: afterRecovery.subscriptions,
      };
      projection.dispose(true);
      return {
        claimedHtml,
        claimedMarkers,
        updateError,
        updateCode,
        domSame:
          afterFailureHtml === claimedHtml &&
          afterFailureNodes.length === claimedNodes.length &&
          afterFailureNodes.every((node, index) => node === claimedNodes[index]),
        markersSame:
          afterFailureMarkers.length === claimedMarkers.length &&
          afterFailureMarkers.every((marker, index) => marker === claimedMarkers[index]),
        subscriptionsSame:
          afterFailure.subscriptions === beforeFailure.subscriptions &&
          afterFailure.unsubscribed === beforeFailure.unsubscribed,
        afterFailureMarkerText: afterFailureMarkers.join(','),
        recovery,
      };
    }, html)) as {
      claimedHtml: string;
      claimedMarkers: string[];
      updateError: string | null;
      updateCode: string | null;
      domSame: boolean;
      markersSame: boolean;
      subscriptionsSame: boolean;
      afterFailureMarkerText: string;
      recovery: {
        error: string | null;
        sameObjects: boolean;
        texts: string[];
        markers: string[];
        subscriptions: number;
      };
    };

    expect(result.updateError).toContain('list key must be');
    expect(result.updateCode).toBe('OEIR_LEAF_UNSUPPORTED_KEY');
    expect(result.domSame).toBe(true);
    expect(result.markersSame).toBe(true);
    expect(result.afterFailureMarkerText).not.toContain('u');
    expect(result.subscriptionsSame).toBe(true);
    expect(result.recovery.error).toBeNull();
    expect(result.recovery.sameObjects).toBe(true);
    expect(result.recovery.texts).toEqual(['A2', 'C2']);
    expect(result.recovery.markers).toEqual(['oe:each', 'oe:k:s:61', 'oe:k:s:63', 'oe:/each']);
    expect(result.recovery.subscriptions).toBe(1);
    await page.close();
  });

  test('unkeyed positional and entry static-directory claims are real-DOM round trips', async () => {
    const generated = await prepare();
    const unkeyedHtml = ssr(generated.loaded, 'Unkeyed')(
      {},
      { bindings: { items: { value: ['a', 'b'] } } },
    );
    const directoryHtml = ssr(generated.loaded, 'DirectoryEntry')(
      {},
      { bindings: { items: { value: [{ id: 'a' }, { id: 'c' }] } } },
    );

    const result = (await page.evaluate(
      async ({ unkeyedHtml, directoryHtml }) => {
        const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
        const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        const markers = (root: ParentNode): string[] => {
          const doc = (root as Node).ownerDocument ?? document;
          const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
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

        const claim = (html: string, factoryName: string, value: unknown[]) => {
          host.innerHTML = html;
          const ul = host.firstChild as Element;
          const lis = [...ul.querySelectorAll('li')];
          const leaves = [...ul.querySelectorAll('b, i')];
          const items = runtime.signal(value);
          const scope = new runtime.LifetimeScope();
          const recipe = factories[factoryName]!(scope, {
            props: {},
            bindings: { items },
            propsChanged: runtime.signal(0),
          });
          const mutations: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(host, { subtree: true, childList: true, characterData: true });
          runtime.runtimeProbe.reset();
          let error: string | null = null;
          let projection: { dispose(detach?: boolean): void } | null = null;
          try {
            projection = runtime.claimRecipe(scope, recipe, host);
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          const probe = runtime.runtimeProbe.snapshot();
          return {
            ul,
            items,
            lis,
            leaves,
            projection,
            error,
            mutations,
            subscriptions: probe.subscriptions,
            markers: markers(host),
            after: [...ul.querySelectorAll('li')],
          };
        };

        const unkeyed = claim(unkeyedHtml, 'createUnkeyedRecipe', ['a', 'b']);
        const unkeyedClaim = {
          error: unkeyed.error,
          mutations: unkeyed.mutations,
          subscriptions: unkeyed.subscriptions,
          markers: unkeyed.markers,
          sameObjects: unkeyed.after.every((li, index) => li === unkeyed.lis[index]),
        };
        unkeyed.items.value = ['a', 'b', 'c'];
        await flush();
        const expanded = {
          texts: [...unkeyed.ul.querySelectorAll('li')].map((li) => li.textContent),
          markers: markers(host),
          kept: [...unkeyed.ul.querySelectorAll('li')]
            .slice(0, 2)
            .every((li, index) => li === unkeyed.lis[index]),
        };
        unkeyed.items.value = ['a'];
        await flush();
        const shrunk = {
          texts: [...unkeyed.ul.querySelectorAll('li')].map((li) => li.textContent),
          markers: markers(host),
          kept: (unkeyed.ul.querySelector('li') as Element) === unkeyed.lis[0],
        };
        const unkeyedUpdate = { expanded, shrunk };

        const directory = claim(directoryHtml, 'createDirectoryEntryRecipe', [
          { id: 'a' },
          { id: 'c' },
        ]);
        const directoryClaim = {
          error: directory.error,
          mutations: directory.mutations,
          subscriptions: directory.subscriptions,
          markers: directory.markers,
          sameObjects: directory.after.every((li, index) => li === directory.lis[index]),
          leavesSame: [...directory.ul.querySelectorAll('b, i')].every(
            (leaf, index) => leaf === directory.leaves[index],
          ),
          texts: directory.after.map((li) => li.textContent),
        };
        directory.items.value = [{ id: 'c' }, { id: 'a' }];
        await flush();
        const reordered = [...directory.ul.querySelectorAll('li')];
        const directoryUpdate = {
          order: reordered.map((li) => li.textContent),
          sameObjects: reordered[0] === directory.lis[1] && reordered[1] === directory.lis[0],
          markers: markers(host),
        };
        unkeyed.projection?.dispose(true);
        directory.projection?.dispose(true);
        return {
          unkeyedClaim,
          unkeyedUpdate,
          directoryClaim,
          directoryUpdate,
        };
      },
      { unkeyedHtml, directoryHtml },
    )) as {
      unkeyedClaim: {
        error: string | null;
        mutations: string[];
        subscriptions: number;
        markers: string[];
        sameObjects: boolean;
      };
      unkeyedUpdate: {
        expanded: { texts: string[]; markers: string[]; kept: boolean };
        shrunk: { texts: string[]; markers: string[]; kept: boolean };
      };
      directoryClaim: {
        error: string | null;
        mutations: string[];
        subscriptions: number;
        markers: string[];
        sameObjects: boolean;
        leavesSame: boolean;
        texts: string[];
      };
      directoryUpdate: { order: string[]; sameObjects: boolean; markers: string[] };
    };

    // Unkeyed equal seed: positional markers, no claim-period mutation.
    expect(result.unkeyedClaim.error).toBeNull();
    expect(result.unkeyedClaim.mutations).toEqual([]);
    expect(result.unkeyedClaim.subscriptions).toBe(1);
    expect(result.unkeyedClaim.markers).toEqual([
      'oe:each',
      'oe:k:n:0',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:n:1',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    expect(result.unkeyedClaim.sameObjects).toBe(true);

    // Unkeyed update inserts index 2 and shrink-to-one keeps index 0's entry.
    expect(result.unkeyedUpdate.expanded.texts).toEqual(['a', 'b', 'c']);
    expect(result.unkeyedUpdate.expanded.markers).toEqual([
      'oe:each',
      'oe:k:n:0',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:n:1',
      'oe:t:0',
      'oe:/t:0',
      'oe:k:n:2',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    expect(result.unkeyedUpdate.expanded.kept).toBe(true);
    expect(result.unkeyedUpdate.shrunk.texts).toEqual(['a']);
    expect(result.unkeyedUpdate.shrunk.markers).toEqual([
      'oe:each',
      'oe:k:n:0',
      'oe:t:0',
      'oe:/t:0',
      'oe:/each',
    ]);
    expect(result.unkeyedUpdate.shrunk.kept).toBe(true);

    // An entry whose children are a static sibling directory carries the range
    // pair inside every entry, and the claim adopts the same leaf nodes.
    expect(result.directoryClaim.error).toBeNull();
    expect(result.directoryClaim.mutations).toEqual([]);
    expect(result.directoryClaim.subscriptions).toBe(1);
    expect(result.directoryClaim.sameObjects).toBe(true);
    expect(result.directoryClaim.leavesSame).toBe(true);
    expect(result.directoryClaim.texts).toEqual(['xy', 'xy']);
    expect(result.directoryClaim.markers).toEqual([
      'oe:each',
      'oe:k:s:61',
      'oe:r:0',
      'oe:/r:0',
      'oe:r:1',
      'oe:/r:1',
      'oe:k:s:63',
      'oe:r:0',
      'oe:/r:0',
      'oe:r:1',
      'oe:/r:1',
      'oe:/each',
    ]);

    // Reorder moves the same li nodes and their whole static directory ranges.
    expect(result.directoryUpdate.sameObjects).toBe(true);
    expect(result.directoryUpdate.order).toEqual(['xy', 'xy']);
    expect(result.directoryUpdate.markers).toEqual([
      'oe:each',
      'oe:k:s:63',
      'oe:r:0',
      'oe:/r:0',
      'oe:r:1',
      'oe:/r:1',
      'oe:k:s:61',
      'oe:r:0',
      'oe:/r:0',
      'oe:r:1',
      'oe:/r:1',
      'oe:/each',
    ]);
    await page.close();
  });
});
