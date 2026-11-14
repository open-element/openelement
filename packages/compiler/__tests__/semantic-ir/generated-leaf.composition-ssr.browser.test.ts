/**
 * M08 composition SSR — real Chromium vertical (LOCAL, chromium only).
 *
 * Node produces the composition server string (`Duo__ssr` / `Page__ssr`); the
 * real browser parser owns the node shape; the generated shared-cursor claim
 * adopts it with 0 claim-period mutations. The probe proves the authored
 * composition sites are independent projections, not two roots pretending to
 * be two projections:
 *
 *   Duo:  one root + two insertion projections for the SAME recipe
 *         (projections=3, owners=3, regions=3, subscriptions=2).
 *   Page: one root + one component-reference claim + two children projections
 *         for the SAME `{props.children}` recipe (projections=3, owners=4,
 *         subscriptions=2).
 *
 * A later signal write updates every projection; `dispose(false)` closes the
 * live subscriptions and keeps the borrowed DOM; a fresh claim on fresh bytes
 * re-accounts from zero (not double); `dispose(true)` removes the root region.
 *
 * This is one engine and one shape class. It is not M13 and not an M08 exit.
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
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/m08-composition-ssr.tsx';

const SOURCE = `import { signal } from '@openelement/element';
function Duo(props) {
  const label = signal('x');
  const item = <span class="item">{label.value}</span>;
  return <div class="duo">{item}{item}</div>;
}
function Frame(props) {
  return <div class="frame">{props.children}{props.children}</div>;
}
function Page(props) {
  const label = signal('x');
  return <section class="page"><Frame><b class="only">{label.value}</b></Frame></section>;
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

const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
const generated = generateLeafModule(front.module!);
if (front.diagnostics.length > 0 || generated.module === null || generated.diagnostics.length > 0) {
  throw new Error(
    `fixture failed: ${[...front.diagnostics, ...generated.diagnostics]
      .map((item) => item.message)
      .join('\n')}`,
  );
}
const MODULE = generated.module;
const LOADED = instantiate(MODULE);

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

function ssr(name: string): SsrFunction {
  const value = LOADED[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

function browserHarnessModule(module: string): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const factories = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  return `(function () {\n${body}\nwindow.__oeModule = { ${factories.join(', ')} };\n})();\n`;
}

let runtimeBundle = '';
let runtimeBundleDir = '';
let browser: Browser;

beforeAll(async () => {
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-m08-composition-ssr-'));
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
  console.log(`[M08-composition] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

async function newPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: browserHarnessModule(MODULE) });
  return page;
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

const DUO_WIRE =
  '<div class="duo"><span class="item"><!--oe:t:0-->x<!--oe:/t:0--></span><span class="item"><!--oe:t:0-->x<!--oe:/t:0--></span></div>';

describe('M08 composition SSR — real Chromium, same recipe twice', () => {
  test('one root + two insertion projections; update isolation; dispose(false)/fresh claim/dispose(true)', async () => {
    const page = await newPage();
    const nodeOutput = ssr('Duo')({}, { bindings: { label: nodeSignal('x') } });
    expect(nodeOutput).toBe(DUO_WIRE);

    const result = (await page.evaluate(async (serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { readonly nodes: readonly Node[]; dispose(detach?: boolean): void };
        readonly insertRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { readonly nodes: readonly Node[] };
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
        readonly createDuoRecipe: (owner: unknown, host: unknown) => unknown;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: Factories }).__oeModule;
      const snapshot = () => runtime.runtimeProbe.snapshot();
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
      const pending: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) pending.push(record.type);
      });
      const takeMutations = (): string[] => {
        const out = [...pending.splice(0)];
        for (const record of observer.takeRecords()) out.push(record.type);
        return out;
      };

      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      const root = host.firstChild as Element;
      const spans = [...root.querySelectorAll('.item')];
      // Mount the same recipe in a real document and serialize it: the Node
      // `__ssr` bytes must be the mount's structure, not a lookalike.
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createDuoRecipe(mountScope, {
        props: {},
        bindings: { label: runtime.signal('x') },
        propsChanged: runtime.signal(0),
      });
      const mountContainer = document.createElement('div');
      runtime.insertRecipe(mountScope, mountRecipe, mountContainer);
      const mountSerialized = mountContainer.innerHTML;
      mountScope.dispose(true);
      const label = runtime.signal('x');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createDuoRecipe(scope, {
        props: {},
        bindings: { label },
        propsChanged: runtime.signal(0),
      });

      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      await flush();
      const claimMutations = takeMutations();
      const claim = {
        probe: snapshot(),
        mutations: claimMutations,
        nodes: projection.nodes.length,
        rootIdentity: host.firstChild === root,
        spanIdentity: spans.length === 2 && spans.every((span) => root.contains(span)),
        spanObjectsDiffer: spans[0] !== spans[1],
      };

      label.value = 'y';
      await flush();
      const update = {
        mutations: takeMutations(),
        texts: [...root.querySelectorAll('.item')].map((span) => span.textContent),
        sameObjects: [...root.querySelectorAll('.item')].every(
          (span, index) => span === spans[index],
        ),
        probe: snapshot(),
      };

      const beforeDispose = snapshot();
      projection.dispose(false);
      const dispose = {
        delta: delta(beforeDispose, snapshot()),
        stillAttached: host.contains(root),
        texts: [...root.querySelectorAll('.item')].map((span) => span.textContent),
        mutations: takeMutations(),
      };

      // A fresh claim of the same server bytes must account from zero, not add
      // a second copy of the disposed projection's subscriptions.
      host.innerHTML = serverHtml;
      // Drop the replacement mutations: the fresh claim's 0-mutation record
      // starts after the new bytes are in the document.
      observer.takeRecords();
      pending.length = 0;
      const root2 = host.firstChild as Element;
      const spans2 = [...root2.querySelectorAll('.item')];
      const label2 = runtime.signal('x');
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createDuoRecipe(scope2, {
        props: {},
        bindings: { label: label2 },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projection2 = runtime.claimRecipe(scope2, recipe2, host);
      await flush();
      const reclaim = {
        probe: snapshot(),
        mutations: takeMutations(),
        identity:
          host.firstChild === root2 &&
          spans2.length === 2 &&
          [...root2.querySelectorAll('.item')].every((span, index) => span === spans2[index]),
      };

      const beforeDetach = snapshot();
      projection2.dispose(true);
      const detach = {
        delta: delta(beforeDetach, snapshot()),
        children: host.childNodes.length,
      };
      observer.disconnect();
      return { mountSerialized, claim, update, dispose, reclaim, detach };
    }, nodeOutput)) as {
      readonly mountSerialized: string;
      readonly claim: {
        readonly probe: Probe;
        readonly mutations: readonly string[];
        readonly nodes: number;
        readonly rootIdentity: boolean;
        readonly spanIdentity: boolean;
        readonly spanObjectsDiffer: boolean;
      };
      readonly update: {
        readonly mutations: readonly string[];
        readonly texts: readonly string[];
        readonly sameObjects: boolean;
        readonly probe: Probe;
      };
      readonly dispose: {
        readonly delta: Probe;
        readonly stillAttached: boolean;
        readonly texts: readonly string[];
        readonly mutations: readonly string[];
      };
      readonly reclaim: {
        readonly probe: Probe;
        readonly mutations: readonly string[];
        readonly identity: boolean;
      };
      readonly detach: { readonly delta: Probe; readonly children: number };
    };

    // Real mount → serialize equals the Node SSR bytes byte-for-byte.
    expect(result.mountSerialized).toBe(nodeOutput);

    // The claim opened the root projection and exactly two insertion
    // projections for the same recipe. This cannot be produced by two roots.
    expect(result.claim.mutations).toEqual([]);
    expect(result.claim.nodes).toBe(1);
    expect(result.claim.probe).toMatchObject({
      projections: 3,
      regions: 3,
      owners: 3,
      nodes: 3,
      rangeCleanups: 3,
      subscriptions: 2,
      unsubscribed: 0,
      // The root claim and each insertion projection take the lineage check.
      lineageAccepted: 3,
      lineageRejected: 0,
      disposed: 0,
    });
    expect(result.claim.rootIdentity).toBe(true);
    expect(result.claim.spanIdentity).toBe(true);
    expect(result.claim.spanObjectsDiffer).toBe(true);

    // One live write updates both projection regions through their own owners.
    expect(result.update.mutations).toEqual(['characterData', 'characterData']);
    expect(result.update.texts).toEqual(['y', 'y']);
    expect(result.update.sameObjects).toBe(true);
    expect(result.update.probe).toMatchObject({
      projections: 3,
      regions: 3,
      owners: 3,
      subscriptions: 2,
      unsubscribed: 0,
    });

    // dispose(false) closes both live subscriptions and keeps borrowed DOM.
    expect(result.dispose.delta).toMatchObject({
      subscriptions: 0,
      unsubscribed: 2,
      disposed: 1,
      projections: 0,
    });
    expect(result.dispose.stillAttached).toBe(true);
    expect(result.dispose.texts).toEqual(['y', 'y']);
    expect(result.dispose.mutations).toEqual([]);

    // Fresh bytes, fresh claim: 2 subscriptions, not 4.
    expect(result.reclaim.mutations).toEqual([]);
    expect(result.reclaim.identity).toBe(true);
    expect(result.reclaim.probe).toMatchObject({
      projections: 3,
      regions: 3,
      owners: 3,
      nodes: 3,
      rangeCleanups: 3,
      subscriptions: 2,
      unsubscribed: 0,
      lineageAccepted: 3,
      lineageRejected: 0,
    });

    // dispose(true) removes the root and both projection regions.
    expect(result.detach.delta).toMatchObject({ unsubscribed: 2, disposed: 1 });
    expect(result.detach.children).toBe(0);

    console.log(
      `[M08-composition] same-recipe claim projections=${result.claim.probe.projections} regions=${result.claim.probe.regions} owners=${result.claim.probe.owners} subs=${result.claim.probe.subscriptions} update=${result.update.texts.join('/')} disposeFalseUnsub=${result.dispose.delta.unsubscribed} reclaimSubs=${result.reclaim.probe.subscriptions} detachChildren=${result.detach.children}`,
    );
    await page.close();
  }, 120_000);
});

describe('M08 composition SSR — real Chromium, repeated children projection', () => {
  test('one renderer called at two projection sites; both regions update and dispose together', async () => {
    const page = await newPage();
    const nodeOutput = ssr('Page')({}, { bindings: { label: nodeSignal('x') } });
    expect(nodeOutput).toBe(
      '<section class="page"><div class="frame">' +
        '<b class="only"><!--oe:t:0-->x<!--oe:/t:0--></b>' +
        '<b class="only"><!--oe:t:0-->x<!--oe:/t:0--></b>' +
        '</div></section>',
    );

    const result = (await page.evaluate(async (serverHtml) => {
      interface Runtime {
        readonly claimRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { readonly nodes: readonly Node[]; dispose(detach?: boolean): void };
        readonly insertRecipe: (
          owner: unknown,
          recipe: unknown,
          parent: Node,
        ) => { readonly nodes: readonly Node[] };
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
        readonly createPageRecipe: (owner: unknown, host: unknown) => unknown;
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
      const root = host.firstChild as Element;
      const only = [...root.querySelectorAll('.only')];
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createPageRecipe(mountScope, {
        props: {},
        bindings: { label: runtime.signal('x') },
        propsChanged: runtime.signal(0),
      });
      const mountContainer = document.createElement('div');
      runtime.insertRecipe(mountScope, mountRecipe, mountContainer);
      const mountSerialized = mountContainer.innerHTML;
      mountScope.dispose(true);
      const label = runtime.signal('x');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createPageRecipe(scope, {
        props: {},
        bindings: { label },
        propsChanged: runtime.signal(0),
      });
      runtime.runtimeProbe.reset();
      const projection = runtime.claimRecipe(scope, recipe, host);
      await flush();
      const claimProbe = runtime.runtimeProbe.snapshot();
      label.value = 'z';
      await flush();
      const update = {
        texts: [...root.querySelectorAll('.only')].map((node) => node.textContent),
        sameObjects: [...root.querySelectorAll('.only')].every(
          (node, index) => node === only[index],
        ),
        probe: runtime.runtimeProbe.snapshot(),
      };
      const before = runtime.runtimeProbe.snapshot();
      projection.dispose(false);
      const after = runtime.runtimeProbe.snapshot();
      const dispose = {
        unsubscribed: after.unsubscribed - before.unsubscribed,
        stillAttached: host.contains(root),
        texts: [...root.querySelectorAll('.only')].map((node) => node.textContent),
      };
      return { mountSerialized, claimProbe, update, dispose };
    }, nodeOutput)) as {
      readonly mountSerialized: string;
      readonly claimProbe: Probe;
      readonly update: {
        readonly texts: readonly string[];
        readonly sameObjects: boolean;
        readonly probe: Probe;
      };
      readonly dispose: {
        readonly unsubscribed: number;
        readonly stillAttached: boolean;
        readonly texts: readonly string[];
      };
    };

    expect(result.mountSerialized).toBe(nodeOutput);

    // One root claim + two children projections. The Frame component itself is
    // one child scope, not a third claimRecipe projection; the probe counts
    // owners allocated by claimRecipe, so 3 is the exact multisets here.
    expect(result.claimProbe).toMatchObject({
      projections: 3,
      regions: 3,
      owners: 3,
      subscriptions: 2,
      lineageAccepted: 3,
    });
    expect(result.update.texts).toEqual(['z', 'z']);
    expect(result.update.sameObjects).toBe(true);
    expect(result.update.probe).toMatchObject({
      projections: 3,
      regions: 3,
      owners: 3,
      subscriptions: 2,
    });
    expect(result.dispose.unsubscribed).toBe(2);
    expect(result.dispose.stillAttached).toBe(true);
    expect(result.dispose.texts).toEqual(['z', 'z']);

    console.log(
      `[M08-composition] children claim projections=${result.claimProbe.projections} owners=${result.claimProbe.owners} subs=${result.claimProbe.subscriptions} update=${result.update.texts.join('/')} disposeUnsub=${result.dispose.unsubscribed}`,
    );
    await page.close();
  }, 120_000);
});
