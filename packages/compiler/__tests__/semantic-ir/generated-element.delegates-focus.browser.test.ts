/**
 * M09-2a — the authored `delegatesFocus` island end to end (LOCAL, Chromium).
 *
 * This is the D-delegatesFocus vertical: the author writes
 * `root: 'shadow', delegatesFocus: true` in the island sidecar, the compiler
 * lane reads both facts from the authored AST, the descriptor carries
 * `delegatesFocus: true`, and the emitted `<Name>__ssrHost` threads the typed
 * DSD option into the canonical template. Node produces the host HTML; the
 * real browser parser adopts the declarative shadow root WITH
 * `shadowrootdelegatesfocus`; the generated class claims that root (never
 * calling `attachShadow`) and reports the same fact the descriptor pins.
 *
 * Asserted, in order:
 *
 * - the authored sidecar → lane output: the descriptor carries
 *   `delegatesFocus: true` and the host wrapper passes
 *   `dsd: { delegatesFocus: true }`;
 * - the host bytes carry exactly `shadowrootmode="open"
 *   shadowrootdelegatesfocus` (no other `shadowroot*` attribute);
 * - parser adoption + claim: the claimed root's `delegatesFocus` is true,
 *   zero claim-period mutations, node identity preserved, and the shell never
 *   called `attachShadow`;
 * - REAL focus delegation: `host.focus()` moves focus to the first focusable
 *   descendant inside the shadow root;
 * - disconnect → reconnect claims the retained root again with the same fact
 *   and no second `attachShadow`, and focus delegation still works;
 * - `dispose(false)` keeps the tree; `dispose(true)` removes exactly the
 *   owned region on a fresh claim;
 * - CSR: a client-created element calls
 *   `attachShadow({ mode: 'open', delegatesFocus: true })` and delegates
 *   focus too;
 * - the negative control that makes the DSD threading load-bearing: a host
 *   template WITHOUT the typed DSD option, claimed by the same
 *   `delegatesFocus: true` descriptor, fails closed with the shell's
 *   `OEIR_SHELL_ROOT_OPTION_MISMATCH` ("delegatesFocus mismatch") instead of
 *   silently losing focus delegation.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix, not
 * properties/events/forms/styles, and not the router's production wiring.
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
const ISLAND_ID = `${ISLANDS_DIR}/profile-focus.tsx`;

const ISLAND_SOURCE =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow', " +
  'delegatesFocus: true });\n' +
  'function ProfileFocus() {\n' +
  '  return <section><input id="field" placeholder="type" /><p id="panel">hello</p></section>;\n' +
  '}\n' +
  'export default ProfileFocus;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  serializeGeneratedElementHtml: (input: unknown) => string;
  ProfileFocus__ssr: (props: unknown, host?: unknown) => string;
  ProfileFocus__ssrHost: (props: unknown, lightChildren?: string) => string;
  createProfileFocusRecipe: (owner: unknown, host: unknown) => unknown;
}

declare global {
  interface Window {
    __oeFocus: PageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';
let compiledCode = '';
let tag = '';

interface BundleResult {
  readonly file: string;
  readonly moduleIds: readonly string[];
}

/** Real Vite build of the real emitted module plus the real shell. */
async function buildBundle(dir: string, islandModule: string): Promise<BundleResult> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leaf = join(dir, 'island.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leaf, islandModule);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export const { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, leafClaimMismatch } = claimInvariants;`,
      `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export const { emitComment, MARKERS, markerText, rangeMarker, textSlotMarker } = markers;`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    entry,
    [
      `export { default as GeneratedElement, ProfileFocus__ssr, ProfileFocus__ssrHost, createProfileFocusRecipe } from './island.js';`,
      `export { createGeneratedElementClass, serializeGeneratedElementHtml } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      '',
    ].join('\n'),
  );
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
      lib: { entry, formats: ['iife'], name: '__oeFocus', fileName: () => 'focus.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined)
    throw new Error('the delegatesFocus vertical bundle produced no chunk');
  const file = join(dir, 'focus.js');
  writeFileSync(file, chunk.code);
  return { file, moduleIds: (chunk.moduleIds ?? []).map((id) => id.replaceAll('\\', '/')) };
}

/**
 * The page-side observation harness. Plain JavaScript on purpose: it is
 * injected as an untransformed script tag, unlike the `page.evaluate`
 * callbacks, which the test transform has already stripped of types.
 */
const PAGE_SETUP = `
  window.__oeProbe = { attachShadowCalls: 0 };
  const originalAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    window.__oeProbe.attachShadowCalls += 1;
    return originalAttach.call(this, init);
  };
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeObserve = (target) => {
    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
    return { records, stop: () => { records.push(...observer.takeRecords()); observer.disconnect(); } };
  };
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-focus-'));
  // The ONE host site fact producer: path-derived tag; the lane reads the
  // root and the focus fact from the authored sidecar.
  const site = createGeneratedElementSiteResolver(ISLANDS_DIR)(ISLAND_ID);
  expect(site).not.toBeNull();
  tag = site!.tag;
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, ISLAND_ID, { site: site! });
  expect(compiled).not.toBeNull();
  compiledCode = compiled!.code;
  bundleFile = (await buildBundle(tempDir, compiledCode)).file;
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('M09-2a authored delegatesFocus island (Chromium)', () => {
  test('the lane + emitter own the focus fact (Node half)', () => {
    expect(tag).toBe('profile-focus');
    expect(compiledCode).toContain('root: "shadow-open"');
    expect(compiledCode).toContain('delegatesFocus: true');
    expect(compiledCode).toContain('dsd: { delegatesFocus: true },');
    expect(compiledCode).toContain('export function ProfileFocus__ssrHost(props, lightChildren) {');
  });

  test('sidecar -> lane class -> DSD claim -> focus delegation -> reconnect -> dispose', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFocus;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const observe = (
          window as unknown as {
            __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
          }
        ).__oeObserve;

        customElements.define(tagName, mod.GeneratedElement);
        const hostHtml = mod.ProfileFocus__ssrHost(undefined);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const panelBefore = shadow.querySelector('#panel')!;
        const fieldBefore = shadow.querySelector('#field')! as HTMLElement;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        const claimed = {
          tag: host.localName,
          mode: shadow.mode,
          delegatesFocus: shadow.delegatesFocus,
          mutations: observer.records.length,
          identity: shadow.querySelector('#panel') === panelBefore,
          count: shadow.querySelectorAll('#panel').length,
          attachShadowCalls: probe.attachShadowCalls,
        };

        // Real focus delegation: focusing the host reaches the shadow input.
        host.focus();
        await tick();
        const focused = {
          host: document.activeElement === host,
          field: shadow.activeElement === fieldBefore,
          id: (shadow.activeElement as HTMLElement | null)?.id ?? null,
        };

        // Disconnect -> reconnect: the retained root is claimed again.
        frame.remove();
        await tick();
        document.body.append(frame);
        await tick();
        const reconnected = {
          sameRoot: host.shadowRoot === shadow,
          delegatesFocus: shadow.delegatesFocus,
          identity: shadow.querySelector('#panel') === panelBefore,
          count: shadow.querySelectorAll('#panel').length,
          attachShadowCalls: probe.attachShadowCalls,
        };
        host.focus();
        await tick();
        const focusedAfterReconnect = shadow.activeElement === fieldBefore;

        // dispose(false) keeps the tree; a fresh claim observes dispose(true).
        (host as unknown as { dispose: (detach?: boolean) => void }).dispose(false);
        const afterPlain = {
          identity: shadow.querySelector('#panel') === panelBefore,
          children: shadow.childNodes.length,
        };
        const detachFrame = document.createElement('div');
        detachFrame.setHTMLUnsafe(hostHtml);
        const detachHost = detachFrame.firstElementChild as HTMLElement;
        const detachShadow = detachHost.shadowRoot!;
        document.body.append(detachFrame);
        await tick();
        const secondClaim = {
          identity: detachShadow.querySelector('#panel') !== null,
          delegatesFocus: detachShadow.delegatesFocus,
        };
        (detachHost as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
        const afterDetach = {
          children: detachShadow.childNodes.length,
          panel: detachShadow.querySelector('#panel') === null,
        };

        return {
          hostHtml,
          claimed,
          focused,
          reconnected,
          focusedAfterReconnect,
          afterPlain,
          secondClaim,
          afterDetach,
        };
      }, tag);

      // The template carries the one typed DSD option and nothing else.
      expect(result.hostHtml).toContain(
        '<template shadowrootmode="open" shadowrootdelegatesfocus>',
      );
      expect(result.hostHtml).not.toContain('shadowrootclonable');
      expect(result.claimed).toEqual({
        tag: 'profile-focus',
        mode: 'open',
        delegatesFocus: true,
        mutations: 0,
        identity: true,
        count: 1,
        attachShadowCalls: 0,
      });
      expect(result.focused).toEqual({ host: true, field: true, id: 'field' });
      expect(result.reconnected).toEqual({
        sameRoot: true,
        delegatesFocus: true,
        identity: true,
        count: 1,
        attachShadowCalls: 0,
      });
      expect(result.focusedAfterReconnect).toBe(true);
      expect(result.afterPlain).toEqual({ identity: true, children: 1 });
      expect(result.secondClaim).toEqual({ identity: true, delegatesFocus: true });
      expect(result.afterDetach).toEqual({ children: 0, panel: true });
    } finally {
      await page.close();
    }
  });

  test('CSR attaches an open root with delegatesFocus true', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFocus;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName);
        document.body.append(host);
        await tick();
        const shadow = host.shadowRoot!;
        const field = shadow.querySelector('#field') as HTMLElement;
        host.focus();
        await tick();
        return {
          mode: shadow.mode,
          delegatesFocus: shadow.delegatesFocus,
          attachShadowCalls: probe.attachShadowCalls,
          identity: shadow.querySelector('#panel') !== null,
          field: shadow.activeElement === field,
        };
      }, tag);
      expect(result).toEqual({
        mode: 'open',
        delegatesFocus: true,
        attachShadowCalls: 1,
        identity: true,
        field: true,
      });
    } finally {
      await page.close();
    }
  });

  test('a host template without the DSD option fails closed instead of losing delegation', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(
        ({ noFocusTag }) => {
          const mod = window.__oeFocus;
          // The same descriptor fact, but the host template is built WITHOUT
          // the typed option: the parser adopts a root with delegatesFocus
          // false, so the shell's root-option check must refuse the claim.
          const content = mod.ProfileFocus__ssr(undefined, undefined);
          const hostHtml = mod.serializeGeneratedElementHtml({
            tag: noFocusTag,
            root: 'open',
            content,
          });
          const NoFocus = mod.createGeneratedElementClass({
            tag: noFocusTag,
            root: 'shadow-open',
            delegatesFocus: true,
            properties: [],
            createRecipe: mod.createProfileFocusRecipe,
          });
          customElements.define(noFocusTag, NoFocus);
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(hostHtml);
          const host = frame.firstElementChild as HTMLElement;
          const adopted = {
            root: host.shadowRoot !== null,
            delegatesFocus: host.shadowRoot?.delegatesFocus ?? null,
            templateFocus: hostHtml.includes('shadowrootdelegatesfocus'),
          };
          try {
            host.connectedCallback();
            return { adopted, code: null, message: '' };
          } catch (error) {
            return {
              adopted,
              code: (error as { code?: string }).code ?? null,
              message: (error as { message?: string }).message ?? '',
            };
          }
        },
        { noFocusTag: 'profile-no-focus' },
      );
      expect(result.adopted).toEqual({ root: true, delegatesFocus: false, templateFocus: false });
      expect(result.code).toBe('OEIR_SHELL_ROOT_OPTION_MISMATCH');
      expect(result.message).toContain('delegatesFocus mismatch');
    } finally {
      await page.close();
    }
  });
});
