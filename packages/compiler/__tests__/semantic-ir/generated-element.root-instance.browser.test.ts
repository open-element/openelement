/**
 * T3 / 16b-LC-1 — root generated setup retention (LOCAL, Chromium).
 *
 * The compiler half of the retained-instance seam: a REAL generated module for
 * an admitted island root is bundled with the real recipe/LifetimeScope runtime
 * and the real generated-element shell, registered as a Custom Element in
 * Chromium, and exercised through the platform lifecycle.
 *
 * The root's local snapshots are setup work (M03 "evaluate once"). After T3
 * they are evaluated by the emitted `__oe_rootInstance(owner, host)` factory —
 * called by the shell's `createInstance` exactly once per element instance —
 * and `<Root>__mount`/`<Root>__claim` alias the retained record through
 * `Object.hasOwn` instead of re-evaluating the initializers.
 *
 * Asserted here:
 *
 * - ROOT RETENTION: first connect evaluates setup once; disconnect keeps it;
 *   a prop change while disconnected does NOT change the mounted text; the
 *   reconnect claim reuses the retained record and the same DOM node; an
 *   explicit `dispose(true)` destroys the instance, so a later connect runs
 *   setup again on a NEW instance and shows the live value;
 * - a setup value that legitimately is `undefined` is retained: the alias uses
 *   own-property presence, not a value check, so connect does not throw;
 * - a FAILED reconnect claim keeps the retained setup record: the retry claims
 *   the restored DOM with the retained snapshot, not the live prop;
 * - a setup factory throw fails the first connect, allocates no retained
 *   instance and mounts nothing; the next connect re-runs setup on a NEW
 *   instance and mounts successfully;
 * - T1 (`16b-LC-2` DEPTH-1): a DIRECT hostless child (a component reference in
 *   the same module's root body) retains its setup exactly once and the parent
 *   reconnect REUSES that record, so the reconnected child text stays the
 *   snapshot taken at first connect and the exported setup counter stays 1.
 *   This is the depth-1 acceptance only: a grandchild (depth >= 2) keeps
 *   today's legacy text and re-evaluating behavior (measured in T5 below, no
 *   new refusal, no semantic widening), and recipe/leaf bodies stay legacy.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix, no author
 * lifecycle/signal capability, no depth >= 2 retention claim.
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
const ISLAND_ID = `${ISLANDS_DIR}/seed-card.tsx`;

/**
 * Root setup: a local snapshot of a declared prop, a second local that can
 * throw (`JSON.parse`) so the failure row uses the real generated factory, and
 * a third local whose value legitimately is `undefined` so the aliases' `hasOwn`
 * semantics is exercised. `root: 'light'` keeps the observed DOM readable
 * without a shadow root; retention does not depend on the root mode.
 */
const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  'export const openElement = defineIslandConfig({\n' +
  "  root: 'light',\n" +
  '  properties: {\n' +
  '    seed: { default: 0 },\n' +
  "    label: { default: 'null' },\n" +
  '  },\n' +
  '});\n';

/** The same sidecar plus the `show` channel T2/T3 toggle. */
const SIDECAR_SHOW =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  'export const openElement = defineIslandConfig({\n' +
  "  root: 'light',\n" +
  '  properties: {\n' +
  '    seed: { default: 0 },\n' +
  "    label: { default: 'null' },\n" +
  '    show: { default: false },\n' +
  '  },\n' +
  '});\n';

/** Rows 1-3: one admitted root with three local setup snapshots. */
const SEED_SOURCE =
  SIDECAR +
  'function SeedCard(props: { seed: number; label: string }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  const parsed = JSON.parse(props.label);\n' +
  '  const missing = (props.label as any).nope;\n' +
  '  return <span className="seed">{snapshot}{missing}</span>;\n' +
  '}\n' +
  'export default SeedCard;\n';

/**
 * Rows 4-9: the same root shape plus a real DIRECT hostless child reference. The
 * child has its own local snapshot, so its retention (T1) / per-connect
 * lifetime (T2) / rollback (T3) and the depth >= 2 boundary (T5) are readable
 * from the real emitted module in Chromium.
 */
const NESTED_SOURCE =
  SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const childSnapshot = props.seed;\n' +
  '  return <em className="child">{childSnapshot}</em>;\n' +
  '}\n' +
  'function SeedHost(props: { seed: number; label: string }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <span className="root">\n' +
  '      <b className="root-value">{rootSnapshot}</b>\n' +
  '      <Child seed={props.seed} />\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default SeedHost;\n';

/**
 * T2/T3 pair: a conditional DIRECT hostless child. The branch boundary makes the
 * per-connect scope / release sites observable (hide removes the branch, show
 * rebuilds it), while the child is still a direct root-body reference.
 */
const CONDITION_SOURCE =
  SIDECAR_SHOW +
  'function Child(props: { seed: number }) {\n' +
  '  const childSnapshot = props.seed;\n' +
  '  return <em className="child">{childSnapshot}</em>;\n' +
  '}\n' +
  'function ConditionHost(props: { seed: number; label: string; show: boolean }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <span className="root">\n' +
  '      <b className="root-value">{rootSnapshot}</b>\n' +
  '      {props.show ? <Child seed={props.seed} /> : <i className="off">off</i>}\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default ConditionHost;\n';

/**
 * T5: DEPTH >= 2 boundary. Root -> retained Child -> Grand. `Grand` is
 * referenced from the leaf Child body, which is emitted legacy text by design,
 * so Grand keeps today's re-evaluating behavior. Depth >= 2 RETENTION remains
 * OWED (a protocol change, not this wiring lane); this fixture measures the
 * unchanged behavior, never a new refusal.
 */
const DEPTH2_SOURCE =
  SIDECAR +
  'function Grand(props: { seed: number }) {\n' +
  '  const grandSnapshot = props.seed;\n' +
  '  return <u className="grand">{grandSnapshot}</u>;\n' +
  '}\n' +
  'function Child(props: { seed: number }) {\n' +
  '  const childSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <em className="child">\n' +
  '      <b className="child-value">{childSnapshot}</b>\n' +
  '      <Grand seed={props.seed} />\n' +
  '    </em>\n' +
  '  );\n' +
  '}\n' +
  'function DepthHost(props: { seed: number; label: string }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <span className="root">\n' +
  '      <b className="root-value">{rootSnapshot}</b>\n' +
  '      <Child seed={props.seed} />\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default DepthHost;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
}

declare global {
  interface Window {
    __oeRootInstance: PageRuntime;
    __oeTick: () => Promise<void>;
    __oeErrors: string[];
    /** Test-only observation of real generated `<Name>__setup` invocations. */
    __oeSetupCounts: Record<string, number>;
    /** Test-only observation of real per-connect scope cleanups. */
    __oeConnects: Record<string, number>;
    /** Test-only switch read by the instrumented child body. */
    __oeFailChildMount: boolean;
    /** Test-only switch read by the instrumented setup factory. */
    __oeFailSetupCleanup: boolean;
  }
}

let browser: Browser;
let tempDir = '';
let seedBundle = '';
let nestedBundle = '';
let conditionBundle = '';
let depth2Bundle = '';
let seedTag = '';
let nestedTag = '';
let conditionTag = '';
let depth2Tag = '';
const NESTED_INSTRUMENTED_ID = `${ISLANDS_DIR}/nested-instrumented.tsx`;
const CONDITION_ID = `${ISLANDS_DIR}/nested-condition.tsx`;
const DEPTH2_ID = `${ISLANDS_DIR}/nested-depth2.tsx`;

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeErrors = [];
  window.__oeSetupCounts = {};
  window.__oeConnects = {};
  window.__oeFailChildMount = false;
  window.__oeFailSetupCleanup = false;
  window.addEventListener('error', (event) => {
    window.__oeErrors.push(event.error && event.error.message ? event.error.message : event.message);
  });
`;

/**
 * Test-only observation of the REAL generated module (no mock, no hand-written
 * generated code): inject counters / failure switches into the emitted
 * `<Name>__setup`, `<Name>__mount` and `<Name>__claim` bodies. The runtime
 * semantics under test are untouched — the injected lines only observe the real
 * setup invocation and register a real cleanup on the real per-connect scope.
 */
interface InstrumentOptions {
  /** Count real `<Name>__setup` invocations. */
  readonly setupCounts?: boolean;
  /** Count a real per-connect cleanup on the mount/claim scope. */
  readonly connectLifetimes?: boolean;
  /** Let the test register a throwing setup cleanup via a window switch. */
  readonly throwingSetupCleanup?: boolean;
  /** Let the test fail the child mount/claim via a window switch. */
  readonly failChildMount?: boolean;
  /**
   * Count setup evaluations of a LEGACY body (no `<Name>__setup` factory):
   * the inline initializers run once in the mount body and once in the claim
   * body, so both are counted at their start.
   */
  readonly legacySetupCounts?: boolean;
}

function injectAfterSignature(source: string, fnName: string, lines: readonly string[]): string {
  const header = `function ${fnName}(`;
  const index = source.indexOf(header);
  if (index < 0) throw new Error(`the generated module has no ${fnName} function`);
  if (source.indexOf(header, index + 1) >= 0) {
    throw new Error(`the generated module has more than one ${fnName} function`);
  }
  const lineEnd = source.indexOf('\n', index);
  return `${source.slice(0, lineEnd)}\n${lines.map((line) => `  ${line}`).join('\n')}${source.slice(lineEnd)}`;
}

function instrumentModule(code: string, component: string, options: InstrumentOptions): string {
  let out = code;
  const setupLines: string[] = [];
  if (options.setupCounts) {
    setupLines.push(
      `window.__oeSetupCounts[${JSON.stringify(component)}] = (window.__oeSetupCounts[${JSON.stringify(component)}] ?? 0) + 1;`,
    );
  }
  if (options.throwingSetupCleanup) {
    setupLines.push(
      `if (window.__oeFailSetupCleanup) __oe_owner.add(() => { throw new Error("child cleanup boom"); });`,
    );
  }
  if (setupLines.length > 0) {
    out = injectAfterSignature(out, `${component}__setup`, setupLines);
  }
  const mountLines: string[] = [];
  if (options.legacySetupCounts) {
    mountLines.push(
      `window.__oeSetupCounts[${JSON.stringify(component)}] = (window.__oeSetupCounts[${JSON.stringify(component)}] ?? 0) + 1;`,
    );
  }
  if (options.connectLifetimes) {
    mountLines.push(
      `window.__oeConnects[${JSON.stringify(component)}] = (window.__oeConnects[${JSON.stringify(component)}] ?? 0) + 1;`,
      `__oe_scope.add(() => { window.__oeConnects[${JSON.stringify(component)}] -= 1; });`,
    );
  }
  if (options.failChildMount) {
    mountLines.push(`if (window.__oeFailChildMount) throw new Error("child mount boom");`);
  }
  if (mountLines.length > 0) {
    out = injectAfterSignature(out, `${component}__mount`, mountLines);
    if (out.includes(`function ${component}__claim(`)) {
      out = injectAfterSignature(out, `${component}__claim`, mountLines);
    }
  }
  return out;
}

async function buildBundle(dir: string, islandModule: string, name: string): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const island = join(dir, `${name}-island.js`);
  const shim = join(dir, `${name}-runtime-shim.ts`);
  const entry = join(dir, `${name}-entry.ts`);
  writeFileSync(island, islandModule);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export const { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, leafRuntimeError, readEntryKeyMarker } = claimInvariants;`,
      `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export const { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } = markers;`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      // 16b-LC-2 depth-1 nested retention: the generated root pass bracket and
      // the ref-site retain/release text import this surface.
      `export { abortInstancePass, beginInstancePass, endInstancePass, releaseChildInstance, releaseRetainedChildren, releaseUnderStructuralScope, retainChildInstance } from ${JSON.stringify(join(runtime, 'instance-ledger.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(entry, `export { default as GeneratedElement } from './${name}-island.js';\n`);
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: {
      alias: {
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim,
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(element, 'compiled/generated-element/shell.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeRootInstance', fileName: () => `${name}.js` },
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

function compileIsland(id: string, source: string): { code: string; tag: string } {
  const site = createGeneratedElementSiteResolver(ISLANDS_DIR)(id);
  expect(site).not.toBeNull();
  const compiled = compileGeneratedElementIfAdmitted(source, id, { site: site! });
  expect(compiled).not.toBeNull();
  return { code: compiled!.code, tag: site!.tag };
}

async function openPage(bundle: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-t3-root-instance-'));
  const seed = compileIsland(ISLAND_ID, SEED_SOURCE);
  seedTag = seed.tag;
  seedBundle = await buildBundle(tempDir, seed.code, 'seed');
  // T1/T2: the same direct-hostless-child module, instrumented so the REAL
  // `<Child>__setup` count and the REAL per-connect scope cleanup are observable
  // (test-only observation lines; runtime semantics untouched).
  const nestedInstrumented = compileIsland(NESTED_INSTRUMENTED_ID, NESTED_SOURCE);
  nestedTag = nestedInstrumented.tag;
  nestedBundle = await buildBundle(
    tempDir,
    instrumentModule(nestedInstrumented.code, 'Child', {
      setupCounts: true,
      connectLifetimes: true,
      failChildMount: true,
    }),
    'nested',
  );
  // T2/T3: conditional direct child (branch boundary exercises R1/R2/R5 and the
  // per-connect lifetime). One bundle covers the setup-count, throwing-cleanup
  // and failed-construction rows through window switches.
  const condition = compileIsland(CONDITION_ID, CONDITION_SOURCE);
  conditionTag = condition.tag;
  conditionBundle = await buildBundle(
    tempDir,
    instrumentModule(condition.code, 'Child', {
      setupCounts: true,
      connectLifetimes: true,
      throwingSetupCleanup: true,
      failChildMount: true,
    }),
    'condition',
  );
  // T5: depth >= 2 boundary (Child retained, Grand legacy).
  const depth2 = compileIsland(DEPTH2_ID, DEPTH2_SOURCE);
  depth2Tag = depth2.tag;
  depth2Bundle = await buildBundle(
    tempDir,
    instrumentModule(instrumentModule(depth2.code, 'Child', { setupCounts: true }), 'Grand', {
      legacySetupCounts: true,
    }),
    'depth2',
  );
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('T3 root generated setup retention (Chromium)', () => {
  test('R1 root private setup survives disconnect/reconnect and re-runs only after dispose', async () => {
    const page = await openPage(seedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        host.label = '{"keep":1}';
        document.body.append(host);
        await tick();
        const mountedNode = host.firstChild;
        const mounted = { text: host.textContent, childCount: host.childNodes.length };
        host.remove();
        await tick();
        // A prop change while disconnected must not reach the retained setup.
        host.seed = 3;
        document.body.append(host);
        await tick();
        const reconnected = {
          text: host.textContent,
          sameNode: host.firstChild === mountedNode,
        };
        host.remove();
        await tick();
        host.dispose(true);
        document.body.append(host);
        await tick();
        const afterDispose = {
          text: host.textContent,
          sameNode: host.firstChild === mountedNode,
          childCount: host.childNodes.length,
        };
        const errors = window.__oeErrors.slice();
        return { mounted, reconnected, afterDispose, errors };
      }, seedTag);
      // No connect error: the `missing` snapshot is a legitimately `undefined`
      // value, so the alias own-property check (not a value check) accepted it.
      expect(result.errors).toEqual([]);
      expect(result.mounted).toEqual({ text: '1', childCount: 1 });
      // HEAD re-evaluates the setup local in `SeedCard__claim` and writes "3";
      // T3 must alias the retained record and keep "1".
      expect(result.reconnected).toEqual({ text: '1', sameNode: true });
      // dispose is not disconnect: the next connect creates a NEW instance and
      // evaluates setup again, so the live prop is observed.
      expect(result.afterDispose).toEqual({ text: '3', sameNode: false, childCount: 1 });
    } finally {
      await page.close();
    }
  });

  test('R2 a failed reconnect claim keeps the retained setup record', async () => {
    const page = await openPage(seedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const retainedSpan = host.firstChild;
        host.remove();
        await tick();
        host.seed = 3;
        // Structurally damage the owned region: the claim must fail closed
        // before any write and must not destroy the retained setup record.
        retainedSpan!.remove();
        const errorsBefore = window.__oeErrors.length;
        document.body.append(host);
        await tick();
        const failed = {
          childCount: host.childNodes.length,
          errors: window.__oeErrors.slice(errorsBefore),
        };
        // Restore the exact retained node, retry the claim.
        host.appendChild(retainedSpan!);
        host.remove();
        await tick();
        document.body.append(host);
        await tick();
        const retried = { text: host.textContent, sameNode: host.firstChild === retainedSpan };
        host.remove();
        return { failed, retried, errors: window.__oeErrors.slice() };
      }, seedTag);
      expect(result.failed.childCount).toBe(0);
      expect(result.failed.errors.length).toBe(1);
      expect(result.failed.errors[0]).toContain('OEIR_LEAF_CLAIM_MISMATCH');
      // The retained setup record survived the failed claim: the retry shows
      // the snapshot taken at first connect (1), not the live prop (3).
      expect(result.retried).toEqual({ text: '1', sameNode: true });
    } finally {
      await page.close();
    }
  });

  test('R3 a setup factory throw rolls back and the next connect re-runs setup', async () => {
    const page = await openPage(seedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 5;
        host.label = 'not-json';
        document.body.append(host);
        await tick();
        const failed = {
          childCount: host.childNodes.length,
          text: host.textContent,
          errors: window.__oeErrors.slice(),
        };
        host.remove();
        await tick();
        // Recover the authored input; the next connect must create a NEW
        // instance and evaluate setup again with the live values.
        host.label = '{"fixed":true}';
        document.body.append(host);
        await tick();
        const retried = { text: host.textContent, childCount: host.childNodes.length };
        host.remove();
        return { failed, retried };
      }, seedTag);
      expect(result.failed.childCount).toBe(0);
      expect(result.failed.text).toBe('');
      expect(result.failed.errors.length).toBe(1);
      expect(result.failed.errors[0]).toMatch(/JSON|Unexpected token/);
      expect(result.retried).toEqual({ text: '5', childCount: 1 });
    } finally {
      await page.close();
    }
  });

  test('R4 T1: a DIRECT hostless child retains its setup across the parent reconnect', async () => {
    const page = await openPage(nestedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        // The generated leaf writes static className attributes through the
        // literal `className` attribute channel (not the DOM `class`
        // property), so tag selectors keep this row independent of that
        // separate attribute-channel fact.
        const readRoot = () => host.querySelector('b')!.textContent;
        const read = () => ({ root: readRoot(), child: host.querySelector('em')!.textContent });
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const rootNode = host.querySelector('b');
        const mounted = { ...read(), setups: setups() };
        // 16b-LC-2 depth-1: remove -> change the prop while disconnected ->
        // re-append. The reconnect claim must REUSE the retained child record
        // (setup did not run again) and keep the snapshot taken at first
        // connect, while the root keeps its own retained setup too.
        host.remove();
        await tick();
        host.seed = 3;
        document.body.append(host);
        await tick();
        const reconnected = read();
        const reconnectedSetups = setups();
        const sameRootNode = host.querySelector('b') === rootNode;
        host.remove();
        const errors = window.__oeErrors.slice();
        return { mounted, reconnected, reconnectedSetups, sameRootNode, errors };
      }, nestedTag);
      expect(result.errors).toEqual([]);
      expect(result.mounted).toEqual({ root: '1', child: '1', setups: 1 });
      // DEPTH-1 acceptance: direct hostless child setup runs once and survives
      // the reconnect (root and child both read the snapshot taken at mount).
      expect(result.reconnected).toEqual({ root: '1', child: '1' });
      expect(result.reconnectedSetups).toBe(1);
      expect(result.sameRootNode).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('R5 T2: per-connect lifetime + condition; no ledger-state error', async () => {
    const page = await openPage(nestedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const connects = () => window.__oeConnects.Child ?? 0;
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        const childText = () => host.querySelector('em')!.textContent;
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const cycles: Array<{ connectsAfterConnect: number; connectsAfterDisconnect: number }> = [];
        for (let index = 0; index < 3; index += 1) {
          host.remove();
          await tick();
          const connectsAfterDisconnect = connects();
          document.body.append(host);
          await tick();
          cycles.push({ connectsAfterConnect: connects(), connectsAfterDisconnect });
        }
        const childAfterCycles = childText();
        const setupsAfterCycles = setups();
        // The discarded record is not resurrected: after the cycles the child
        // still shows the mount snapshot, and exactly one setup ever ran.
        host.remove();
        const errors = window.__oeErrors.slice();
        return { cycles, childAfterCycles, setupsAfterCycles, errors };
      }, nestedTag);
      // The per-connect scope is a plain child of the connection scope: every
      // disconnect runs its cleanup exactly once and every reconnect re-arms it.
      expect(result.cycles).toEqual([
        { connectsAfterConnect: 1, connectsAfterDisconnect: 0 },
        { connectsAfterConnect: 1, connectsAfterDisconnect: 0 },
        { connectsAfterConnect: 1, connectsAfterDisconnect: 0 },
      ]);
      expect(result.childAfterCycles).toBe('1');
      expect(result.setupsAfterCycles).toBe(1);
      // No stale child under the retained scope (the B1 failure identity would
      // surface as OEIR_INSTANCE_LEDGER_*).
      expect(result.errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('R6 T2b: condition off/on re-runs setup and discards the old record', async () => {
    const page = await openPage(conditionBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          show: boolean;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const connects = () => window.__oeConnects.Child ?? 0;
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        const childText = () => host.querySelector('em')?.textContent ?? null;
        host.seed = 1;
        host.label = 'null';
        host.show = true;
        document.body.append(host);
        await tick();
        const visible = { text: childText(), connects: connects(), setups: setups() };
        // Branch removal: R1 disposes the branch and releases the retained
        // entry; the per-connect cleanup ran, the DOM is gone.
        host.show = false;
        await tick();
        const hidden = {
          text: childText(),
          off: host.querySelector('i')?.textContent ?? null,
          connects: connects(),
        };
        // Re-entering the branch runs setup on a FRESH retained instance with
        // the live prop, never the discarded record.
        host.seed = 5;
        host.show = true;
        await tick();
        const retried = { text: childText(), setups: setups(), connects: connects() };
        host.remove();
        const errors = window.__oeErrors.slice();
        return { visible, hidden, retried, errors };
      }, conditionTag);
      expect(result.visible).toEqual({ text: '1', connects: 1, setups: 1 });
      expect(result.hidden).toEqual({ text: null, off: 'off', connects: 0 });
      expect(result.retried).toEqual({ text: '5', setups: 2, connects: 1 });
      expect(result.errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('R7 T3: rollback error discipline (throwing retained cleanup + failed construction)', async () => {
    // A) A throwing retained setup cleanup: the branch DOM is removed FIRST
    //    (dispose error precedence), the release error surfaces once, and a
    //    later structural change still rebuilds the branch.
    const pageA = await openPage(conditionBundle);
    try {
      const result = await pageA.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          show: boolean;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        const childText = () => host.querySelector('em')?.textContent ?? null;
        host.seed = 1;
        host.label = 'null';
        host.show = true;
        window.__oeFailSetupCleanup = true;
        document.body.append(host);
        await tick();
        const mounted = { text: childText(), setups: setups() };
        let removalError: string | null = null;
        try {
          host.show = false;
        } catch (error) {
          removalError = error instanceof Error ? error.message : String(error);
        }
        await tick();
        const afterRemoval = {
          child: childText(),
          off: host.querySelector('i')?.textContent ?? null,
        };
        // The refresh aborted after disposing the branch; a later change builds
        // a fresh branch with a fresh retained instance (setup ran again).
        window.__oeFailSetupCleanup = false;
        host.show = true;
        await tick();
        host.show = false;
        await tick();
        const retried = {
          child: childText(),
          off: host.querySelector('i')?.textContent ?? null,
          setups: setups(),
        };
        host.remove();
        const errors = window.__oeErrors.slice();
        return { mounted, removalError, afterRemoval, retried, errors };
      }, conditionTag);
      expect(result.mounted).toEqual({ text: '1', setups: 1 });
      expect(result.removalError).toContain('child cleanup boom');
      // dispose(true) removed the branch region even though the release threw.
      expect(result.afterRemoval).toEqual({ child: null, off: null });
      expect(result.retried).toEqual({ child: null, off: 'off', setups: 2 });
      expect(result.errors.filter((message) => message.includes('OEIR_INSTANCE_LEDGER_'))).toEqual(
        [],
      );
    } finally {
      await pageA.close();
    }

    // B) A failed construction in the NEW branch: R2 disposes + releases, then
    //    rethrows the ORIGINAL construction error and the retry re-runs setup.
    const pageB = await openPage(conditionBundle);
    try {
      const result = await pageB.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          show: boolean;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        const childText = () => host.querySelector('em')?.textContent ?? null;
        host.seed = 1;
        host.label = 'null';
        host.show = false;
        document.body.append(host);
        await tick();
        window.__oeFailChildMount = true;
        let constructionError: string | null = null;
        try {
          host.show = true;
        } catch (error) {
          constructionError = error instanceof Error ? error.message : String(error);
        }
        await tick();
        const setupsAfterFailure = setups();
        window.__oeFailChildMount = false;
        // The failed construction released the entry it created: the retry runs
        // setup on a FRESH retained instance, never a half-committed record.
        host.show = false;
        await tick();
        host.show = true;
        await tick();
        const retried = { text: childText(), setups: setups() };
        host.remove();
        const errors = window.__oeErrors.slice();
        return { constructionError, setupsAfterFailure, retried, errors };
      }, conditionTag);
      // The original construction error wins over both cleanup attempts (B2).
      expect(result.constructionError).toContain('child mount boom');
      expect(result.setupsAfterFailure).toBe(1);
      expect(result.retried).toEqual({ text: '1', setups: 2 });
      expect(result.errors.filter((message) => message.includes('OEIR_INSTANCE_LEDGER_'))).toEqual(
        [],
      );
    } finally {
      await pageB.close();
    }

    // C) Direct ref catch (R3) + failed-first-connect rollback: the original
    //    construction error surfaces, the pass is aborted and the instance is
    //    destroyed, so the next connect runs setup again on a NEW instance.
    const pageC = await openPage(nestedBundle);
    try {
      const result = await pageC.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        host.seed = 1;
        host.label = 'null';
        window.__oeFailChildMount = true;
        document.body.append(host);
        await tick();
        const failed = {
          childCount: host.childNodes.length,
          setups: setups(),
          errors: window.__oeErrors.slice(),
        };
        host.remove();
        await tick();
        window.__oeFailChildMount = false;
        document.body.append(host);
        await tick();
        const retried = {
          text: host.querySelector('em')?.textContent ?? null,
          setups: setups(),
          rootText: host.querySelector('b')?.textContent ?? null,
        };
        host.remove();
        return { failed, retried, errors: window.__oeErrors.slice() };
      }, nestedTag);
      expect(result.failed.childCount).toBe(0);
      expect(result.failed.setups).toBe(1);
      expect(result.failed.errors.length).toBe(1);
      expect(result.failed.errors[0]).toContain('child mount boom');
      expect(result.retried).toEqual({ text: '1', setups: 2, rootText: '1' });
      expect(result.errors.filter((message) => message.includes('OEIR_INSTANCE_LEDGER_'))).toEqual(
        [],
      );
    } finally {
      await pageC.close();
    }
  });

  test('R9 T1b: a failed reconnect claim aborts the pass but keeps the retained child entry', async () => {
    const page = await openPage(nestedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const setups = () => window.__oeSetupCounts.Child ?? 0;
        const childText = () => host.querySelector('em')?.textContent ?? null;
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const retainedRoot = host.firstChild;
        host.remove();
        await tick();
        // Structurally damage the owned region: the reconnect claim fails closed
        // and the shell aborts the root pass, which must evict ONLY entries
        // created in the failed attempt and keep the committed child entry.
        retainedRoot!.remove();
        const errorsBefore = window.__oeErrors.length;
        document.body.append(host);
        await tick();
        const failed = {
          childCount: host.childNodes.length,
          errors: window.__oeErrors.slice(errorsBefore),
        };
        // Restore the exact retained node and retry: the retained child record
        // is still there, so setup does not run again.
        host.appendChild(retainedRoot!);
        host.remove();
        await tick();
        host.seed = 3;
        document.body.append(host);
        await tick();
        const retried = { childText: childText(), setups: setups() };
        host.remove();
        return { failed, retried, errors: window.__oeErrors.slice() };
      }, nestedTag);
      expect(result.failed.childCount).toBe(0);
      expect(result.failed.errors.length).toBe(1);
      expect(result.failed.errors[0]).toContain('OEIR_LEAF_CLAIM_MISMATCH');
      // The committed child setup record survived the aborted claim: the retry
      // still shows the mount snapshot (1) and never re-ran setup.
      expect(result.retried).toEqual({ childText: '1', setups: 1 });
    } finally {
      await page.close();
    }
  });

  test("R8 T5: depth >= 2 keeps today's legacy text and re-evaluating semantics (OWED)", async () => {
    const page = await openPage(depth2Bundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRootInstance;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          label: string;
          dispose: (detach?: boolean) => void;
        };
        const read = () => ({
          childValue: host.querySelector('em b')?.textContent ?? null,
          grandValue: host.querySelector('em u')?.textContent ?? null,
        });
        const setups = () => ({
          childSetups: window.__oeSetupCounts.Child ?? 0,
          grandSetups: window.__oeSetupCounts.Grand ?? 0,
        });
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const mounted = { ...read(), ...setups() };
        host.remove();
        await tick();
        host.seed = 3;
        document.body.append(host);
        await tick();
        const reconnected = { ...read(), ...setups() };
        host.remove();
        const errors = window.__oeErrors.slice();
        return { mounted, reconnected, errors };
      }, depth2Tag);
      expect(result.errors).toEqual([]);
      expect(result.mounted).toEqual({
        childValue: '1',
        grandValue: '1',
        childSetups: 1,
        grandSetups: 1,
      });
      // OWED boundary: the retained Child keeps its setup (1), while the
      // GRANDCHILD (referenced from the leaf body, emitted legacy text) keeps
      // today's re-evaluating behavior: setup runs again during the reconnect
      // claim and the live prop (3) is shown. This is the unchanged depth >= 2
      // behavior, not a new refusal and not a retention expansion.
      expect(result.reconnected).toEqual({
        childValue: '1',
        grandValue: '3',
        childSetups: 1,
        grandSetups: 2,
      });
    } finally {
      await page.close();
    }
  });
});
