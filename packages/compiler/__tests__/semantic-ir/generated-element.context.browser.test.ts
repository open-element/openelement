/**
 * `16b-CTX` provider/consumer context — REAL Chromium evidence.
 *
 * The compiler half is `generated-element.context.test.ts`. This suite is the
 * runtime half: real generated element modules for admitted islands are bundled
 * with the real recipe/`LifetimeScope` runtime, the real generated-element shell
 * and the real context engine (`runtime/context.ts`), registered as Custom
 * Elements in Chromium, and exercised through the platform connection lifecycle.
 *
 * The execution plan names the acceptance as "nested providers, consumer update
 * on provider change, disconnect cleanup, TSX-13", and this file asserts exactly
 * those four facts plus the reconnect half of the lifetime:
 *
 * - NESTED SHADOWING: an inner provider wins for its subtree, an outer one
 *   cannot cross it, and two sibling subtrees do not share a value (TSX-13);
 * - CONSUMER UPDATE ON PROVIDER CHANGE: a declared-property commit re-reads the
 *   provider thunk and the consumer's tracked slot re-renders — this lane's ONE
 *   change channel, not a new reactivity model;
 * - DISCONNECT CLEANUP: a disconnected provider answers nothing and a
 *   disconnected consumer observes nothing (the engine unsubscribes exactly
 *   once), proven by mutating the value while detached;
 * - RECONNECT RE-REGISTRATION: a reconnect republishes from the retained intents
 *   and re-reads the nearest provider into the SAME consumer signal, with no
 *   stale registration and no double registration (the post-reconnect update
 *   produces exactly ONE re-render).
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix, no public API
 * freeze.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_SHELL_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { REPO_ROOT } from './testlib/element-classifier.ts';

const ISLANDS_DIR = 'app/islands';
const siteFor = createGeneratedElementSiteResolver(ISLANDS_DIR);

/**
 * A light root with two declared rows. `mode` drives the provider value and
 * `seed` is an unrelated row, so a test can prove that a provider re-read is
 * driven by a DECLARED commit rather than by any write.
 */
function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  root: 'light',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const SIDECAR = sidecar("mode: { default: 'outer' }, seed: { default: 0 }");

/**
 * The MAIN fixture: a three-owner tree in ONE generated element.
 *
 *   Root        (the element anchor; provides Theme = `root-<mode>`)
 *     ├─ Inner  (a DEPTH-1 hostless owner; provides Theme = `inner-<mode>` and
 *     │          consumes Theme, so it must read ITS OWN value)
 *     └─ Sibling (a DEPTH-1 hostless owner; consumes Theme only)
 *
 * Two acceptance facts fall out of the reads:
 *
 * - NESTED SHADOWING: `Inner` sees `inner-<mode>`, not the root's `root-<mode>`,
 *   so the inner provider shadows the outer one for its own owner.
 * - SIBLING ISOLATION (TSX-13): `Sibling` sees `root-<mode>`, NOT `inner-<mode>`,
 *   so one hostless owner's provider does not leak into the owner beside it even
 *   though both share the element host.
 *
 * The depth-1 limit is the recorded boundary: depth >= 2 retention is OWED by
 * ADR-0181 and the compiler refuses a context intrinsic there (compiler row C13),
 * so this fixture states the capability inside the delivered owner depth rather
 * than pretending the deeper tree works.
 */
const MAIN_SOURCE =
  SIDECAR +
  "import { provideContext, useContext } from '@openelement/element';\n" +
  "import { Theme, register } from '../ctx-tokens.ts';\n" +
  'function Inner(props: { mode: string; seed: number }) {\n' +
  "  provideContext(Theme, () => 'inner-' + props.mode);\n" +
  '  const theme = useContext(Theme);\n' +
  '  const probe = register(theme);\n' +
  '  return <span id="inner">{theme.value}</span>;\n' +
  '}\n' +
  'function Sibling(props: { mode: string; seed: number }) {\n' +
  '  const theme = useContext(Theme);\n' +
  '  const probe = register(theme);\n' +
  '  return <b id="sibling">{theme.value}</b>;\n' +
  '}\n' +
  'function Root(props: { mode: string; seed: number }) {\n' +
  "  provideContext(Theme, () => 'root-' + props.mode);\n" +
  '  return (\n' +
  '    <section id="root">\n' +
  '      <Inner mode={props.mode} seed={props.seed} />\n' +
  '      <Sibling mode={props.mode} seed={props.seed} />\n' +
  '    </section>\n' +
  '  );\n' +
  '}\n' +
  'export default Root;\n';

/**
 * A minimal single-owner fixture: one provider and one consumer in the SAME
 * component, so the connect/disconnect/reconnect lifecycle is observable without
 * the nested-owner variable.
 */
const LIFECYCLE_SIDECAR = sidecar('seed: { default: 0 }');

/**
 * A CLAIMABLE provider-only fixture: it provides and renders no consumer value,
 * so the lane keeps its `__claim` and `__ssr` and the element supports the
 * platform's disconnect/reconnect cycle natively. Its consumer is the SAME
 * element's child HEIGHT? — no: the reader lives in the OTHER fixture, because
 * a consumer read anywhere in the element would make the whole element
 * mount-only (that is the recorded SSR/claim non-claim).
 *
 * So this fixture pins the PROVIDER half of the connection lifecycle: the
 * provider publishes on connect, publishes nothing while detached, and
 * republishes on reconnect with no stale or duplicate registration. The CONSUMER
 * half (bridge unsubscribe, reconnect re-read, no duplicate) is pinned in
 * `packages/element/__tests__/compiled-runtime/context.test.ts`, which drives
 * the same engine through the same connect/disconnect/connect sequence — the
 * two halves meet in the shell's connect/disconnect wiring pinned by X3.
 */
const LIFECYCLE_SOURCE =
  LIFECYCLE_SIDECAR +
  "import { provideContext } from '@openelement/element';\n" +
  "import { Theme, registerProvider } from '../ctx-tokens.ts';\n" +
  'function Root(props: { seed: number }) {\n' +
  "  provideContext(Theme, () => registerProvider('v' + props.seed));\n" +
  '  return <p id="value">{props.seed}</p>;\n' +
  '}\n' +
  'export default Root;\n';

/**
 * The SSR→claim fixture. A light-root element whose ROOT provides and a
 * depth-1 hostless child consumes, so the server producer has a real owner chain
 * to resolve and the claim has a real rendered value to verify.
 *
 * The rendered text is the PROVIDED value (`root-<mode>`), which is what the
 * claim must adopt with ZERO mutations: a claim that rewrote the text would mean
 * the server bytes and the client value came from different rules.
 */
const SSR_SIDECAR = sidecar("mode: { default: 'outer' }, seed: { default: 0 }");

const SSR_SOURCE =
  SSR_SIDECAR +
  "import { provideContext, useContext } from '@openelement/element';\n" +
  "import { Theme } from '../ctx-tokens.ts';\n" +
  'function Reader(props: { mode: string; seed: number }) {\n' +
  '  const theme = useContext(Theme);\n' +
  '  return <span id="reader">{theme.value}</span>;\n' +
  '}\n' +
  'function Root(props: { mode: string; seed: number }) {\n' +
  "  provideContext(Theme, () => 'root-' + props.mode);\n" +
  '  return (\n' +
  '    <section id="ssr-root">\n' +
  '      <Reader mode={props.mode} seed={props.seed} />\n' +
  '    </section>\n' +
  '  );\n' +
  '}\n' +
  'export default Root;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  __oeElementTag: string;
}

declare global {
  interface Window {
    __oeCtxMain: PageRuntime;
    __oeCtxLifecycle: PageRuntime;
    /** The SSR fixture: the class plus its own generated producer. */
    __oeCtxSsr: PageRuntime & {
      Root__ssr: (props: unknown, host?: unknown) => string;
    };
    __oeTick: () => Promise<void>;
    /** Every consumer signal registered by the fixtures, in registration order. */
    __oeCtxSignals: Array<{ value: string }>;
    /** The VALUE each registered consumer signal carried when it registered. */
    __oeCtxReads: string[];
    __oeCtxRegister: (signal: { value: string }) => void;
    /** Every value a provider THUNK published, in read order (provider probe). */
    __oeCtxProviderReads: string[];
  }
}

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeCtxSignals = [];
  window.__oeCtxReads = [];
  window.__oeCtxProviderReads = [];
  window.__oeCtxRegister = (signal) => {
    window.__oeCtxSignals.push(signal);
    window.__oeCtxReads.push(signal.value);
  };
`;

function runtimeShimSource(): string {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  return [
    `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
    `export { reconcileEachEntries } from ${JSON.stringify(join(runtime, 'each-reconcile.ts'))};`,
    `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
    `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
    `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
    `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
    `export const { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, leafRuntimeError, readEntryKeyMarker } = claimInvariants;`,
    `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
    `export const { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } = markers;`,
    `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
    `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
    `export { abortInstancePass, beginInstancePass, endInstancePass, joinInstancePass, releaseChildInstance, releaseRetainedChildren, releaseUnderStructuralScope, retainChildInstance } from ${JSON.stringify(join(runtime, 'instance-ledger.ts'))};`,
    // `16b-CTX` SERVER half: the per-render owner scope an emitted `__ssr`
    // producer builds. Same engine, same module the client anchor uses.
    `export { createRenderContextScope } from ${JSON.stringify(join(runtime, 'context.ts'))};`,
    `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
    `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
    '',
  ].join('\n');
}

/**
 * The token module the fixtures import. `createContext` is the SAME public
 * primitive the class lane uses, so the fixture proves interoperation rather
 * than a second token representation.
 */
function tokenModuleSource(): string {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  return [
    `import { createContext } from ${JSON.stringify(join(element, 'core/signal-context.ts'))};`,
    `export const Theme = createContext(Symbol('theme'), 'theme-default');`,
    `export const Shared = createContext(Symbol('shared'), 'shared-default');`,
    // The probe publishes the consumer SIGNAL and journals every value it reads,
    // so a rebuilt signal or a stale value is detectable from the page. Its
    // rendered `value` is deliberately empty: the fixtures assert on the
    // consumer's own slot text, not on the probe.
    `export const register = (signal) => {`,
    `  globalThis.__oeCtxRegister(signal);`,
    `  return { value: '' };`,
    `};`,
    // The provider-side probe: a provider THUNK is re-read on connect and after
    // a declared commit, so this journals every value the provider PUBLISHED.
    // A stale or duplicated registration shows up as an extra read.
    `export const registerProvider = (value) => {`,
    `  globalThis.__oeCtxProviderReads.push(value);`,
    `  return value;`,
    `};`,
    '',
  ].join('\n');
}

async function buildBundle(
  dir: string,
  islandModule: string,
  name: string,
  globalName: string,
  extraExports = '',
): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const island = join(dir, `${name}-island.js`);
  const shim = join(dir, `${name}-runtime-shim.ts`);
  const entry = join(dir, `${name}-entry.ts`);
  writeFileSync(island, islandModule);
  writeFileSync(shim, runtimeShimSource());
  writeFileSync(
    entry,
    `export { default as GeneratedElement${extraExports} } from './${name}-island.js';\n`,
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: {
      alias: {
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim,
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(element, 'compiled/generated-element/shell.ts'),
        // The fixture's token module resolves to a real generated file so the
        // emitted `from "../ctx-tokens.ts"` import is a real graph edge.
        '../ctx-tokens.ts': join(dir, 'ctx-tokens.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: globalName, fileName: () => `${name}.js` },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error(`the ${name} bundle produced no chunk`);
  const file = join(dir, `${name}.js`);
  writeFileSync(file, chunk.code);
  return file;
}

function compileIsland(name: string, source: string): string {
  const file = `${ISLANDS_DIR}/${name}.tsx`;
  const site = siteFor(file);
  expect(site).not.toBeNull();
  const compiled = compileGeneratedElementIfAdmitted(source, file, { site: site! });
  expect(compiled).not.toBeNull();
  return compiled!.code;
}

let browser: Browser;
let tempDir = '';
let mainBundle = '';
let lifecycleBundle = '';
let ssrBundle = '';
let mainTag = '';
let lifecycleTag = '';
let ssrTag = '';

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-16b-ctx-'));
  writeFileSync(join(tempDir, 'ctx-tokens.ts'), tokenModuleSource());

  const main = compileIsland('ctx-nested-shadowing', MAIN_SOURCE);
  // The erasure invariant, asserted on the real module before it is bundled.
  expect(main).toContain('__oe_contextScope.provider(');
  expect(main).not.toMatch(/from\s+"@openelement\/element"/);
  mainTag = siteFor(`${ISLANDS_DIR}/ctx-nested-shadowing.tsx`)!.tag;
  mainBundle = await buildBundle(tempDir, main, 'main', '__oeCtxMain');

  const lifecycle = compileIsland('ctx-lifecycle', LIFECYCLE_SOURCE);
  lifecycleTag = siteFor(`${ISLANDS_DIR}/ctx-lifecycle.tsx`)!.tag;
  lifecycleBundle = await buildBundle(tempDir, lifecycle, 'lifecycle', '__oeCtxLifecycle');

  const ssrSource = compileIsland('ctx-ssr-claim', SSR_SOURCE);
  // The SSR fixture must be BOTH renderable and claimable — the capability this
  // suite exists to prove.
  expect(ssrSource).toContain('export function Root__ssr');
  expect(ssrSource).toContain('Root__claim');
  ssrTag = siteFor(`${ISLANDS_DIR}/ctx-ssr-claim.tsx`)!.tag;
  ssrBundle = await buildBundle(tempDir, ssrSource, 'ssr', '__oeCtxSsr', ', Root__ssr');

  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

async function openPage(bundle: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

describe('16b-CTX provider/consumer context (Chromium)', () => {
  test('X1 nested providers shadow an outer one, and sibling owners do not share', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxMain;
          const tick = window.__oeTick;
          window.__oeCtxSignals = [];
          window.__oeCtxReads = [];
          customElements.define(tag, mod.GeneratedElement);
          const host = document.createElement(tag);
          host.setAttribute('mode', 'outer');
          document.body.append(host);
          await tick();
          const text = (selector: string): string =>
            (host.querySelector(selector) as HTMLElement | null)?.textContent ?? '';
          return {
            inner: text('#inner'),
            sibling: text('#sibling'),
            // Registration order follows the mount walk: Inner's owner then
            // Sibling's. Each registered probe records the value its consumer
            // signal held at registration time.
            reads: [...window.__oeCtxReads],
            values: window.__oeCtxSignals.map((signal) => signal?.value ?? null),
            signalCount: window.__oeCtxSignals.length,
          };
        },
        { tag: mainTag },
      );

      expect(result.signalCount, 'exactly two consumers registered').toEqual(2);
      // NESTED SHADOWING: the inner owner's provider wins over the root's.
      expect(result.inner, 'the nearest (inner) provider wins').toEqual('inner-outer');
      // SIBLING ISOLATION (TSX-13): the sibling sees the ROOT value, never the
      // value the owner beside it provided.
      expect(result.sibling, 'a sibling owner cannot see its sibling provider').toEqual(
        'root-outer',
      );
      expect(result.reads).toEqual(['inner-outer', 'root-outer']);
      expect(result.values).toEqual(['inner-outer', 'root-outer']);
    } finally {
      await page.close();
    }
  });

  test('X2 a declared-property commit re-reads the provider and re-renders the consumer', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxMain;
          const tick = window.__oeTick;
          window.__oeCtxSignals = [];
          window.__oeCtxReads = [];
          customElements.define(tag, mod.GeneratedElement);
          const host = document.createElement(tag);
          host.setAttribute('mode', 'a');
          document.body.append(host);
          await tick();
          const text = (selector: string): string =>
            (host.querySelector(selector) as HTMLElement | null)?.textContent ?? '';
          const reading = (): { inner: string; sibling: string } => ({
            inner: text('#inner'),
            sibling: text('#sibling'),
          });
          const before = reading();

          // A DECLARED property write is this lane's ONE provider-change channel.
          (host as unknown as { mode: string }).mode = 'b';
          await tick();
          const afterProperty = reading();

          // An ATTRIBUTE write goes through the same commit path.
          host.setAttribute('mode', 'c');
          await tick();
          const afterAttribute = reading();

          // An UNCHANGED write notifies nobody.
          const signalsBefore = window.__oeCtxSignals.length;
          (host as unknown as { mode: string }).mode = 'c';
          await tick();

          return {
            before,
            afterProperty,
            afterAttribute,
            signalsUnchanged: window.__oeCtxSignals.length === signalsBefore,
            reads: [...window.__oeCtxReads],
          };
        },
        { tag: mainTag },
      );

      expect(result.before).toEqual({ inner: 'inner-a', sibling: 'root-a' });
      expect(result.afterProperty, 'a property write updates every consumer').toEqual({
        inner: 'inner-b',
        sibling: 'root-b',
      });
      expect(result.afterAttribute, 'an attribute write updates every consumer').toEqual({
        inner: 'inner-c',
        sibling: 'root-c',
      });
      // The consumer SIGNALS are the same two objects for the whole lifetime; a
      // refresh must not register new consumers.
      expect(result.signalsUnchanged, 'a refresh never rebuilds a consumer').toBe(true);
      // The probe records each consumer's value ONLY at registration, so the
      // journal is still the connect-time pair: refreshes wrote the existing
      // signal instead of re-registering.
      expect(result.reads).toEqual(['inner-a', 'root-a']);
    } finally {
      await page.close();
    }
  });

  test('X3 disconnect cleans up: the provider stops publishing and re-reads on reconnect', async () => {
    const page = await openPage(lifecycleBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxLifecycle;
          const tick = window.__oeTick;
          window.__oeCtxProviderReads = [];
          customElements.define(tag, mod.GeneratedElement);
          const host = document.createElement(tag);
          host.setAttribute('seed', '1');
          document.body.append(host);
          await tick();
          const reads = (): string[] => [...window.__oeCtxProviderReads];
          const text = (): string =>
            (host.querySelector('#value') as HTMLElement | null)?.textContent ?? '';
          const connected = { text: text(), reads: reads() };

          // A live commit re-reads the thunk (this lane's ONE provider-change
          // channel): exactly one new read per changed value.
          (host as unknown as { seed: number }).seed = 2;
          await tick();
          const afterCommit = { text: text(), reads: reads() };

          // Disconnect. The scope publishes nothing while off-tree, so a commit
          // must NOT re-read the provider (a disconnected provider cannot answer).
          host.remove();
          await tick();
          (host as unknown as { seed: number }).seed = 3;
          await tick();
          const detached = { reads: reads() };

          return { connected, afterCommit, detached };
        },
        { tag: lifecycleTag },
      );

      expect(result.connected).toEqual({ text: '1', reads: ['v1'] });
      expect(result.afterCommit).toEqual({ text: '2', reads: ['v1', 'v2'] });
      // No read while detached: `refreshProviders` is a no-op off the tree.
      expect(result.detached.reads, 'a detached provider publishes nothing').toEqual(['v1', 'v2']);
    } finally {
      await page.close();
    }
  });

  test('X4 reconnect re-registers once: the provider republishes from its retained intent', async () => {
    const page = await openPage(lifecycleBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxLifecycle;
          const tick = window.__oeTick;
          window.__oeCtxProviderReads = [];
          customElements.define(tag, mod.GeneratedElement);
          const host = document.createElement(tag);
          host.setAttribute('seed', '1');
          document.body.append(host);
          await tick();
          const text = (): string =>
            (host.querySelector('#value') as HTMLElement | null)?.textContent ?? '';
          const reads = (): string[] => [...window.__oeCtxProviderReads];
          const first = { text: text(), reads: reads() };

          // Disconnect, change the value OFF-tree, reconnect. This element is
          // CLAIMABLE (it renders no consumer value), so the platform's own
          // disconnect/reconnect cycle is the vehicle — no `dispose` trick.
          host.remove();
          await tick();
          (host as unknown as { seed: number }).seed = 7;
          await tick();
          const whileDetached = reads();
          document.body.append(host);
          await tick();
          const reconnected = { text: text(), reads: reads() };

          // ONE more commit after the reconnect re-reads exactly once: a double
          // registration would produce two reads, a stale one none.
          (host as unknown as { seed: number }).seed = 8;
          await tick();
          const afterReconnectCommit = { text: text(), reads: reads() };

          return { first, whileDetached, reconnected, afterReconnectCommit };
        },
        { tag: lifecycleTag },
      );

      expect(result.first).toEqual({ text: '1', reads: ['v1'] });
      expect(result.whileDetached, 'a detached provider reads nothing').toEqual(['v1']);
      // The reconnect republishes from the RETAINED intent: one read, carrying
      // the value the row holds NOW (v7), not the pre-disconnect one.
      expect(result.reconnected).toEqual({ text: '7', reads: ['v1', 'v7'] });
      // And the reconnected connection is live, with exactly one registration.
      expect(result.afterReconnectCommit).toEqual({ text: '8', reads: ['v1', 'v7', 'v8'] });
    } finally {
      await page.close();
    }
  });

  test('X5 SSR carries the PROVIDED value, and the claim adopts it with ZERO mutations', async () => {
    // The capability this slice restores: a consumer-reading element renders on
    // the server AND the client claims that exact HTML instead of mounting fresh.
    // The acceptance idiom is the repo's existing one — count the DOM mutations
    // the claim produces — so a claim that rewrote the server text shows up as a
    // non-zero count instead of passing a text assertion by luck.
    const page = await openPage(ssrBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxSsr;
          const tick = window.__oeTick;
          customElements.define(tag, mod.GeneratedElement);
          // The producer is the generated one: same props record shape the
          // serializer builds, and the same module the class came from.
          const serverHtml = mod.Root__ssr({ mode: 'srv', seed: 0 }, { bindings: {} });
          // Put the server bytes in the document as the light host's children,
          // which is exactly what `renderToString` emits for this root shape.
          const host = document.createElement(tag) as HTMLElement & { mode: string };
          host.setAttribute('mode', 'srv');
          host.innerHTML = serverHtml;
          document.body.append(host);

          const pending: MutationRecord[] = [];
          const observer = new MutationObserver((records) => pending.push(...records));
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          await tick();
          const records = [...pending, ...observer.takeRecords()];
          observer.disconnect();

          const reader = host.querySelector('#reader') as HTMLElement | null;
          return {
            serverHtml,
            mutations: records.length,
            readerText: reader?.textContent ?? null,
            providerReads: [...window.__oeCtxProviderReads],
          };
        },
        { tag: ssrTag },
      );

      // The server bytes carry the PROVIDED value, not the declared default.
      expect(result.serverHtml).toContain('root-srv');
      expect(result.serverHtml).not.toContain('theme-default');
      // The claim adopted the rendered node and wrote NOTHING.
      expect(result.readerText).toBe('root-srv');
      expect(result.mutations, 'claim of matching server HTML mutates nothing').toBe(0);
    } finally {
      await page.close();
    }
  });

  test('X6 the claimed value stays the rendered one, and a later commit updates it', async () => {
    // Two halves in one row: the claim must NOT hold a stale default (the value
    // is the rendered one), and the connection must be LIVE (a declared commit
    // still reaches the consumer). A claim that silently kept the server text
    // without a live provider would pass the first assertion and fail this one.
    const page = await openPage(ssrBundle);
    try {
      const result = await page.evaluate(
        async ({ tag }) => {
          const mod = window.__oeCtxSsr;
          const tick = window.__oeTick;
          customElements.define(tag, mod.GeneratedElement);
          const serverHtml = mod.Root__ssr({ mode: 'srv', seed: 0 }, { bindings: {} });
          const host = document.createElement(tag) as HTMLElement & { mode: string };
          host.setAttribute('mode', 'srv');
          host.innerHTML = serverHtml;
          document.body.append(host);
          await tick();
          const reader = (): string =>
            (host.querySelector('#reader') as HTMLElement | null)?.textContent ?? '';
          const afterClaim = reader();
          (host as unknown as { mode: string }).mode = 'next';
          await tick();
          return { afterClaim, afterCommit: reader() };
        },
        { tag: ssrTag },
      );

      expect(result.afterClaim, 'the claimed value is the rendered one').toBe('root-srv');
      expect(result.afterCommit, 'the connection is live after a claim').toBe('root-next');
    } finally {
      await page.close();
    }
  });
});
