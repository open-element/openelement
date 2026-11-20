/**
 * M11/props × M06 condition — over-invalidation regression (LOCAL Chromium).
 *
 * `task-24` reproduced a contract violation in the generated element lane: the
 * condition refresh treats its first argument as `force`, and
 * `bindSignalWrites` delivers the signal VALUE. The generated element root's
 * `propsChanged` channel is a monotonically increasing number, so every
 * declared-property write used to force-rebuild the condition branch even when
 * the condition test was unchanged (branch DOM identity lost, branch children
 * re-mounted, owners/subscriptions churned). The fix subscribes condition
 * collectors through `() => refresh()` while entry/list collectors keep their
 * explicit `refresh(true)` calls.
 *
 * Asserted here on the real compiled module + real runtime bundle:
 *
 * - MOUNT: an unrelated same-value write is inert; an unrelated CHANGED write
 *   and an unrelated same-content array reference update only the dynamic text
 *   (0 childList), keep the branch/static node identity, and do not re-run the
 *   branch child's setup;
 * - the condition test actually changing replaces the branch exactly once and
 *   creates the branch child exactly once;
 * - CLAIM: on the real DSD bytes the claim-phase condition subscription behaves
 *   the same (unrelated write keeps the branch; a real toggle replaces once).
 *
 * One engine, LOCAL; not M09/M13 exit.
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
import { REPO_ROOT } from './testlib/element-classifier.ts';

const MOUNT_TAG = 'oe-condition-props-mount';
const CLAIM_TAG = 'oe-condition-props-claim';
const MOUNT_FILE = 'app/islands/condition-props-mount.tsx';
const CLAIM_FILE = 'app/islands/condition-props-claim.tsx';

function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  hydrate: 'idle',\n" +
    "  root: 'shadow',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const MOUNT_SOURCE =
  sidecar(
    "open: { default: false }, title: { default: 'A' }, " +
      "items: { attribute: false, default: [{ id: 'i1', body: 'one' }] }",
  ) +
  'function BranchChild(props: { title: string }) {\n' +
  '  const runs = (globalThis.__oeBranchChildRuns = (globalThis.__oeBranchChildRuns ?? 0) + 1);\n' +
  '  return <span id="branch-static">{props.title}:{runs}</span>;\n' +
  '}\n' +
  'function ConditionPropsMount(props: {\n' +
  '  open: boolean;\n' +
  '  title: string;\n' +
  '  items: Array<{ id: string; body: string }>;\n' +
  '}) {\n' +
  '  return (\n' +
  '    <div>\n' +
  '      <h1>{props.title}</h1>\n' +
  '      {props.open ? (\n' +
  '        <section id="branch"><BranchChild title={props.title} /></section>\n' +
  '      ) : null}\n' +
  '      <ul>{props.items.map((item) => <li key={item.id}>{item.body}</li>)}</ul>\n' +
  '    </div>\n' +
  '  );\n' +
  '}\n' +
  'export default ConditionPropsMount;\n';

const CLAIM_SOURCE =
  sidecar("open: { default: false }, title: { default: 'A' }") +
  'function ConditionPropsClaim(props: { open: boolean; title: string }) {\n' +
  '  return (\n' +
  '    <div>\n' +
  '      <h1>{props.title}</h1>\n' +
  '      {props.open ? <section id="branch"><span id="branch-static">on</span></section> : null}\n' +
  '    </div>\n' +
  '  );\n' +
  '}\n' +
  'export default ConditionPropsClaim;\n';

interface PageHost extends HTMLElement {
  open: boolean;
  title: string;
  items: Array<{ id: string; body: string }>;
}
interface PageWindow {
  __oeMounted: { Element: CustomElementConstructor };
  __oeClaimed: {
    Element: CustomElementConstructor;
    ConditionPropsClaim__ssrHost: (props: unknown, lightChildren?: string) => string;
  };
  __oeTick: () => Promise<void>;
  __oeBranchChildRuns?: number;
  __oeErrors: string[];
}
declare global {
  interface Window extends PageWindow {}
}

let browser: Browser;
let tempDir = '';
let mountBundle = '';
let claimBundle = '';

function buildShim(dir: string): string {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
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
      `export { abortInstancePass, beginInstancePass, endInstancePass, releaseChildInstance, releaseRetainedChildren, releaseUnderStructuralScope, retainChildInstance } from ${JSON.stringify(join(runtime, 'instance-ledger.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  return shim;
}

async function buildBundle(input: {
  readonly name: string;
  readonly globalName: string;
  readonly code: string;
  readonly component: string;
  readonly extraEntry: readonly string[];
}): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const island = join(tempDir, `${input.name}-island.js`);
  const entry = join(tempDir, `${input.name}-entry.ts`);
  writeFileSync(island, input.code);
  writeFileSync(
    entry,
    [
      `export { default as Element } from './${input.name}-island.js';`,
      ...input.extraEntry,
      `export { createGeneratedElementClass } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: tempDir,
    logLevel: 'silent',
    resolve: {
      alias: {
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: join(tempDir, 'runtime-shim.ts'),
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(element, 'compiled/generated-element/shell.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: input.globalName,
        fileName: () => `${input.name}.js`,
      },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('the condition vertical produced no chunk');
  const file = join(tempDir, `${input.name}.js`);
  writeFileSync(file, chunk.code);
  return file;
}

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeErrors = [];
  window.addEventListener('error', (event) => {
    window.__oeErrors.push(event.error && event.error.message ? event.error.message : event.message);
  });
`;

async function openPage(bundle: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-condition-props-'));
  buildShim(tempDir);
  const mount = compileGeneratedElementIfAdmitted(MOUNT_SOURCE, MOUNT_FILE, {
    site: { tag: MOUNT_TAG },
  });
  expect(mount).not.toBeNull();
  const claim = compileGeneratedElementIfAdmitted(CLAIM_SOURCE, CLAIM_FILE, {
    site: { tag: CLAIM_TAG },
  });
  expect(claim).not.toBeNull();
  mountBundle = await buildBundle({
    name: 'mount',
    globalName: '__oeMounted',
    code: mount!.code,
    component: mount!.component,
    extraEntry: [],
  });
  claimBundle = await buildBundle({
    name: 'claim',
    globalName: '__oeClaimed',
    code: claim!.code,
    component: claim!.component,
    extraEntry: [`export { ${claim!.ssrHostExport} } from './claim-island.js';`],
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('generated-element condition × declared props (Chromium)', () => {
  test('MOUNT: unrelated property writes keep the branch, identity and child setup; a real test change replaces once', async () => {
    const page = await openPage(mountBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const win = window as unknown as PageWindow;
        const mod = win.__oeMounted;
        const tick = win.__oeTick;
        customElements.define(tagName, mod.Element);
        const host = document.createElement(tagName) as PageHost;
        host.open = true;
        host.title = 'A';
        host.items = [{ id: 'i1', body: 'one' }];
        document.body.append(host);
        await tick();
        const shadow = host.shadowRoot!;
        let pending: Array<{ type: string; added: number; removed: number }> = [];
        const observer = new MutationObserver((records) => {
          pending.push(
            ...records.map((record) => ({
              type: record.type,
              added: record.addedNodes.length,
              removed: record.removedNodes.length,
            })),
          );
        });
        observer.observe(shadow, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        await tick();
        pending = [];
        const step = async (label: string, write: () => void) => {
          const beforeBranch = shadow.querySelector('#branch');
          const beforeStatic = shadow.querySelector('#branch-static');
          write();
          await tick();
          const records = pending;
          pending = [];
          return {
            label,
            branchPresent: shadow.querySelector('#branch') !== null,
            branchSame: shadow.querySelector('#branch') === beforeBranch,
            staticSame: shadow.querySelector('#branch-static') === beforeStatic,
            childList: records.filter((record) => record.type === 'childList').length,
            characterData: records.filter((record) => record.type === 'characterData').length,
            title: host.title,
            branchChildRuns: win.__oeBranchChildRuns ?? 0,
            h1: shadow.querySelector('h1')?.textContent ?? null,
          };
        };
        const sameValue = await step('unrelated same-value title', () => {
          host.title = 'A';
        });
        const changedValue = await step('unrelated changed title', () => {
          host.title = 'A2';
        });
        const sameContentArray = await step('unrelated new array, same content', () => {
          host.items = [{ id: 'i1', body: 'one' }];
        });
        const toggleOff = await step('condition test off', () => {
          host.open = false;
        });
        const toggleOn = await step('condition test on', () => {
          host.open = true;
        });
        return {
          sameValue,
          changedValue,
          sameContentArray,
          toggleOff,
          toggleOn,
          errors: win.__oeErrors,
        };
      }, MOUNT_TAG);
      expect(result.errors).toEqual([]);
      // Same-value write: fully inert (shell writeValue equality short-circuit).
      expect(result.sameValue).toMatchObject({
        branchPresent: true,
        branchSame: true,
        staticSame: true,
        childList: 0,
        branchChildRuns: 1,
      });
      // Unrelated CHANGED property: only the text slot may update; the branch
      // nodes keep identity and the branch child setup does NOT run again.
      expect(result.changedValue).toMatchObject({
        branchPresent: true,
        branchSame: true,
        staticSame: true,
        childList: 0,
        branchChildRuns: 1,
        h1: 'A2',
      });
      expect(result.changedValue.characterData).toBeGreaterThan(0);
      // A new array reference with the same content is still NOT a condition change.
      expect(result.sameContentArray).toMatchObject({
        branchPresent: true,
        branchSame: true,
        staticSame: true,
        childList: 0,
        branchChildRuns: 1,
      });
      // The condition test actually changing replaces the branch exactly once;
      // the branch child is created exactly once for the re-opened branch.
      // Removing the branch records the branch subtree's own child removal
      // (SECTION -> BranchChild span) plus the branch node removal (DIV), i.e.
      // two childList records for ONE branch replacement.
      expect(result.toggleOff).toMatchObject({
        branchPresent: false,
        childList: 2,
        branchChildRuns: 1,
      });
      expect(result.toggleOn).toMatchObject({
        branchPresent: true,
        childList: 1,
        branchChildRuns: 2,
      });
    } finally {
      await page.close();
    }
  });

  test('CLAIM: the claim-phase subscription ignores unrelated props values and replaces only on a real toggle', async () => {
    const page = await openPage(claimBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const win = window as unknown as PageWindow;
        const mod = win.__oeClaimed;
        const tick = win.__oeTick;
        customElements.define(tagName, mod.Element);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(mod.ConditionPropsClaim__ssrHost({ open: true, title: 'A' }));
        const host = frame.firstElementChild as PageHost;
        // Match the SSR value before the upgrade so the claim's structural
        // adoption is the only work (pre-upgrade own property wins).
        host.title = 'A';
        document.body.append(frame);
        await tick();
        const shadow = host.shadowRoot!;
        const claimed = {
          title: host.title,
          branchPresent: shadow.querySelector('#branch') !== null,
          h1: shadow.querySelector('h1')?.textContent ?? null,
        };
        let pending: Array<{ type: string; added: number; removed: number }> = [];
        const observer = new MutationObserver((records) => {
          pending.push(
            ...records.map((record) => ({
              type: record.type,
              added: record.addedNodes.length,
              removed: record.removedNodes.length,
            })),
          );
        });
        observer.observe(shadow, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        await tick();
        pending = [];
        const beforeBranch = shadow.querySelector('#branch');
        const beforeStatic = shadow.querySelector('#branch-static');
        host.title = 'A2';
        await tick();
        const afterUnrelated = {
          branchPresent: shadow.querySelector('#branch') !== null,
          branchSame: shadow.querySelector('#branch') === beforeBranch,
          staticSame: shadow.querySelector('#branch-static') === beforeStatic,
          childList: pending.filter((record) => record.type === 'childList').length,
          h1: shadow.querySelector('h1')?.textContent ?? null,
        };
        pending = [];
        host.open = false;
        await tick();
        const afterToggleOff = {
          branchPresent: shadow.querySelector('#branch') !== null,
          childList: pending.filter((record) => record.type === 'childList').length,
        };
        pending = [];
        host.open = true;
        await tick();
        const afterToggleOn = {
          branchPresent: shadow.querySelector('#branch') !== null,
          childList: pending.filter((record) => record.type === 'childList').length,
        };
        return { claimed, afterUnrelated, afterToggleOff, afterToggleOn, errors: win.__oeErrors };
      }, CLAIM_TAG);
      expect(result.errors).toEqual([]);
      expect(result.claimed).toEqual({ title: 'A', branchPresent: true, h1: 'A' });
      expect(result.afterUnrelated).toEqual({
        branchPresent: true,
        branchSame: true,
        staticSame: true,
        childList: 0,
        h1: 'A2',
      });
      expect(result.afterToggleOff).toEqual({ branchPresent: false, childList: 1 });
      expect(result.afterToggleOn).toEqual({ branchPresent: true, childList: 1 });
    } finally {
      await page.close();
    }
  });
});
