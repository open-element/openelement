/**
 * M09-2b — primitive property metadata end to end (LOCAL, Chromium).
 *
 * The author writes one typed props parameter and one sidecar `properties`
 * table; the compiler lane cross-checks them and emits the shell's landed
 * `GeneratedElementProperty` rows; the generated class then owns the platform
 * behavior (observed attributes, conversion, reflection, defaults,
 * pre-upgrade reconciliation) that M09-0/M09-shadow already landed.
 *
 * Asserted, in order:
 *
 * - parser-created SSR host markup (the canonical DSD producer plus host
 *   attributes, standing in for the M11 host-attribute serializer): the
 *   attributes are converted BEFORE the first render, the claim is
 *   mutation-free, and the recipe read the converted values;
 * - observedAttributes is exactly the attribute-channel rows (the
 *   `attribute: false` property is absent);
 * - attribute → property conversion for number/string, and a non-observed
 *   attribute is ignored;
 * - property → attribute reflection only for `reflect: true`;
 * - attribute removal restores the declared default in BOTH channels;
 * - disconnect → reconnect claims the retained root again with the retained
 *   property values and no new attachShadow;
 * - `dispose(false)` keeps the tree, `dispose(true)` removes exactly the owned
 *   region on a fresh claim;
 * - the pre-upgrade upgrade sequence: an own `el.count = 2` set before
 *   `customElements.define` wins over the replayed attribute, is reconciled by
 *   the shell and reflected;
 * - CSR mount: a client-created element converts attributes set before
 *   connect and renders from them.
 *
 * The host attribute population itself is M11's host-attribute serializer
 * (design §7.5); this vertical uses the canonical
 * `serializeGeneratedElementHtml` producer directly so the browser observes
 * the platform's real parser adoption rather than a fabricated string.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix; no
 * array/object/trustedHtml conversion, no custom converters, no CEM, no
 * forms/events/styles, no SSR host-attribute claim.
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
const ISLAND_ID = `${ISLANDS_DIR}/counter-card.tsx`;

const ISLAND_SOURCE =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  'export const openElement = defineIslandConfig({\n' +
  "  hydrate: 'idle',\n" +
  "  root: 'shadow',\n" +
  '  properties: {\n' +
  '    count: { reflect: true, default: 0 },\n' +
  "    label: { default: 'untitled' },\n" +
  '    padding: { attribute: false },\n' +
  '  },\n' +
  '});\n' +
  'function CounterCard(props: { count: number; label: string; padding: number }) {\n' +
  '  return (\n' +
  '    <section>\n' +
  '      <p id="count">{props.count}</p>\n' +
  '      <p id="label">{props.label}</p>\n' +
  '    </section>\n' +
  '  );\n' +
  '}\n' +
  'export default CounterCard;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  serializeGeneratedElementHtml: (input: unknown) => string;
  CounterCard__ssr: (props: unknown, host?: unknown) => string;
  CounterCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createCounterCardRecipe: (owner: unknown, host: unknown) => unknown;
}

declare global {
  interface Window {
    __oeProps: PageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';
let compiledCode = '';
let tag = '';

async function buildBundle(dir: string, islandModule: string): Promise<string> {
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
      `export { default as GeneratedElement, CounterCard__ssr, CounterCard__ssrHost, createCounterCardRecipe } from './island.js';`,
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
      lib: { entry, formats: ['iife'], name: '__oeProps', fileName: () => 'props.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined)
    throw new Error('the properties vertical bundle produced no chunk');
  const file = join(dir, 'props.js');
  writeFileSync(file, chunk.code);
  return file;
}

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
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-props-'));
  const site = createGeneratedElementSiteResolver(ISLANDS_DIR)(ISLAND_ID);
  expect(site).not.toBeNull();
  tag = site!.tag;
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, ISLAND_ID, { site: site! });
  expect(compiled).not.toBeNull();
  compiledCode = compiled!.code;
  bundleFile = await buildBundle(tempDir, compiledCode);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('M09-2b primitive property metadata (Chromium)', () => {
  test('the lane emits the cross-checked rows (Node half)', () => {
    expect(tag).toBe('counter-card');
    expect(compiledCode).toContain(
      '{ name: "count", attribute: "count", type: "number", reflect: true, default: 0 },',
    );
    expect(compiledCode).toContain(
      '{ name: "label", attribute: "label", type: "string", reflect: false, default: "untitled" },',
    );
    expect(compiledCode).toContain(
      '{ name: "padding", attribute: null, type: "number", reflect: false, default: 0 },',
    );
  });

  test('SSR attributes -> conversion -> reflection -> reconnect -> dispose', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeProps;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const observe = (
          window as unknown as {
            __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
          }
        ).__oeObserve;

        customElements.define(tagName, mod.GeneratedElement);
        const props = { count: 3, label: 'hi', padding: 0 };
        const content = mod.CounterCard__ssr(props, undefined);
        const hostHtml = mod.serializeGeneratedElementHtml({
          tag: tagName,
          root: 'open',
          attributes: [
            ['count', '3'],
            ['label', 'hi'],
          ],
          content,
        });
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const countNode = shadow.querySelector('#count')!;
        const labelNode = shadow.querySelector('#label')!;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        const claimed = {
          mutations: observer.records.length,
          count: (host as unknown as { count: number }).count,
          label: (host as unknown as { label: string }).label,
          padding: (host as unknown as { padding: number }).padding,
          countText: countNode.textContent,
          labelText: labelNode.textContent,
          observed: [
            ...((host.constructor as { observedAttributes?: readonly string[] })
              .observedAttributes ?? []),
          ],
          attachShadowCalls: probe.attachShadowCalls,
        };

        // Attribute -> property conversion, then a propsChanged refresh.
        host.setAttribute('count', '7');
        await tick();
        const afterAttribute = {
          count: (host as unknown as { count: number }).count,
          text: countNode.textContent,
          identity: shadow.querySelector('#count') === countNode,
        };

        // Property -> attribute reflection (count reflects, label does not).
        (host as unknown as { count: number }).count = 9;
        (host as unknown as { label: string }).label = 'hello';
        const afterProperty = {
          countAttribute: host.getAttribute('count'),
          labelAttribute: host.getAttribute('label'),
          countText: countNode.textContent,
        };

        // Removing a reflected attribute restores the declared default in both
        // channels; a property-only row ignores its (unobserved) attribute.
        host.removeAttribute('count');
        host.setAttribute('padding', '5');
        await tick();
        const afterRemoval = {
          count: (host as unknown as { count: number }).count,
          countAttribute: host.getAttribute('count'),
          countText: countNode.textContent,
          padding: (host as unknown as { padding: number }).padding,
        };

        // Disconnect -> reconnect claims the retained root again.
        frame.remove();
        await tick();
        document.body.append(frame);
        await tick();
        const reconnected = {
          sameRoot: host.shadowRoot === shadow,
          count: (host as unknown as { count: number }).count,
          label: (host as unknown as { label: string }).label,
          identity: shadow.querySelector('#count') === countNode,
          attachShadowCalls: probe.attachShadowCalls,
        };

        (host as unknown as { dispose: (detach?: boolean) => void }).dispose(false);
        const afterPlain = { identity: shadow.querySelector('#count') === countNode };

        const detachFrame = document.createElement('div');
        detachFrame.setHTMLUnsafe(hostHtml);
        const detachHost = detachFrame.firstElementChild as HTMLElement;
        const detachShadow = detachHost.shadowRoot!;
        document.body.append(detachFrame);
        await tick();
        (detachHost as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
        const afterDetach = {
          children: detachShadow.childNodes.length,
          count: detachShadow.querySelector('#count') === null,
        };

        return {
          hostHtml,
          claimed,
          afterAttribute,
          afterProperty,
          afterRemoval,
          reconnected,
          afterPlain,
          afterDetach,
        };
      }, tag);

      expect(result.hostHtml).toContain('<template shadowrootmode="open">');
      expect(result.hostHtml).toContain(' count="3"');
      expect(result.claimed).toEqual({
        mutations: 0,
        count: 3,
        label: 'hi',
        padding: 0,
        countText: '3',
        labelText: 'hi',
        observed: ['count', 'label'],
        attachShadowCalls: 0,
      });
      expect(result.afterAttribute).toEqual({ count: 7, text: '7', identity: true });
      expect(result.afterProperty).toEqual({
        countAttribute: '9',
        labelAttribute: 'hi',
        countText: '9',
      });
      expect(result.afterRemoval).toEqual({
        count: 0,
        countAttribute: '0',
        countText: '0',
        padding: 0,
      });
      expect(result.reconnected).toEqual({
        sameRoot: true,
        count: 0,
        label: 'hello',
        identity: true,
        attachShadowCalls: 0,
      });
      expect(result.afterPlain).toEqual({ identity: true });
      expect(result.afterDetach).toEqual({ children: 0, count: true });
    } finally {
      await page.close();
    }
  });

  test('pre-upgrade own property wins over the replayed attribute', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeProps;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const preUpgradeTag = `${tagName}-pre`;
        // Parser creates the (still unknown) element with the DSD template.
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(
          `<${preUpgradeTag} count="3" label="server"><template shadowrootmode="open"></template></${preUpgradeTag}>`,
        );
        const host = frame.firstElementChild as HTMLElement;
        (host as unknown as { count: number }).count = 2;
        // Upgrade after the own data property exists (the classic sequence).
        customElements.define(preUpgradeTag, mod.GeneratedElement);
        document.body.append(frame);
        await tick();
        const reconciled = {
          count: (host as unknown as { count: number }).count,
          label: (host as unknown as { label: string }).label,
          countAttribute: host.getAttribute('count'),
        };
        host.setAttribute('count', '4');
        await tick();
        return {
          reconciled,
          countAfterUpdate: (host as unknown as { count: number }).count,
          text: host.shadowRoot!.querySelector('#count')!.textContent,
        };
      }, tag);
      expect(result.reconciled).toEqual({ count: 2, label: 'server', countAttribute: '2' });
      expect(result.countAfterUpdate).toBe(4);
      expect(result.text).toBe('4');
    } finally {
      await page.close();
    }
  });

  test('CSR mount converts attributes set before connect', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeProps;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName);
        host.setAttribute('count', '5');
        host.setAttribute('label', 'client');
        document.body.append(host);
        await tick();
        const shadow = host.shadowRoot!;
        return {
          count: (host as unknown as { count: number }).count,
          label: (host as unknown as { label: string }).label,
          padding: (host as unknown as { padding: number }).padding,
          countText: shadow.querySelector('#count')!.textContent,
          labelText: shadow.querySelector('#label')!.textContent,
          observed: [
            ...((host.constructor as { observedAttributes?: readonly string[] })
              .observedAttributes ?? []),
          ],
          attachShadowCalls: probe.attachShadowCalls,
        };
      }, tag);
      expect(result).toEqual({
        count: 5,
        label: 'client',
        padding: 0,
        countText: '5',
        labelText: 'client',
        observed: ['count', 'label'],
        attachShadowCalls: 1,
      });
    } finally {
      await page.close();
    }
  });
});
