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
 * - a real nested hostless child (component reference inside the same module)
 *   re-evaluates its own local snapshot when the parent reconnects, while the
 *   root keeps its retained value. That child behavior is a MEASURED
 *   characterization (the child's setup re-evaluates on the parent's reconnect),
 *   not acceptance: this fixture encodes no "must flip" contract and is not
 *   §4.1d evidence. Nested child RETENTION itself remains OWED for `16b-LC-2`
 *   and is not claimed here; the shell's recipe `mount`/`claim` wrapper
 *   re-invocation is not characterized as nested retention.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix, no nested
 * retention acceptance, no author lifecycle/signal capability.
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
const NESTED_ID = `${ISLANDS_DIR}/nested-seed.tsx`;

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
 * Row 4: the same root shape plus a real nested hostless child reference. The
 * child has its own local snapshot so its re-evaluation on the parent's
 * reconnect is observable — an OWED observation for `16b-LC-2`, never an
 * acceptance claim.
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

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
}

declare global {
  interface Window {
    __oeRootInstance: PageRuntime;
    __oeTick: () => Promise<void>;
    __oeErrors: string[];
  }
}

let browser: Browser;
let tempDir = '';
let seedBundle = '';
let nestedBundle = '';
let seedTag = '';
let nestedTag = '';

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeErrors = [];
  window.addEventListener('error', (event) => {
    window.__oeErrors.push(event.error && event.error.message ? event.error.message : event.message);
  });
`;

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
  const nested = compileIsland(NESTED_ID, NESTED_SOURCE);
  nestedTag = nested.tag;
  nestedBundle = await buildBundle(tempDir, nested.code, 'nested');
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

  test('R4 nested hostless child re-evaluates while the root keeps its setup (OWED, 16b-LC-2)', async () => {
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
        host.seed = 1;
        host.label = 'null';
        document.body.append(host);
        await tick();
        const rootNode = host.querySelector('b');
        const mounted = read();
        host.remove();
        await tick();
        host.seed = 3;
        document.body.append(host);
        await tick();
        const reconnected = read();
        const sameRootNode = host.querySelector('b') === rootNode;
        host.remove();
        const errors = window.__oeErrors.slice();
        return { mounted, reconnected, sameRootNode, errors };
      }, nestedTag);
      expect(result.errors).toEqual([]);
      expect(result.mounted).toEqual({ root: '1', child: '1' });
      // MEASURED characterization for 16b-LC-2, NOT acceptance: the root setup
      // snapshot is retained (own record, same node), while the nested hostless
      // child's own snapshot re-evaluates from the live prop getter during the
      // parent's reconnect. No "must flip" contract is encoded here, nested
      // child retention remains OWED and unclaimed, and this is not §4.1d
      // evidence.
      expect(result.reconnected).toEqual({ root: '1', child: '3' });
      expect(result.sameRootNode).toBe(true);
    } finally {
      await page.close();
    }
  });
});
