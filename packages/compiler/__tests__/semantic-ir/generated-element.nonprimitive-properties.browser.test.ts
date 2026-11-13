/**
 * M09 non-primitive property retention — LOCAL Chromium vertical.
 *
 * Authored sidecar (property-only array/object/trustedHtml rows) -> real lane
 * -> generated module -> Node/`__ssrHost` bytes -> parser DSD adoption ->
 * generated class claim; then real instance behavior in the browser:
 *
 * - default graphs are materialised fresh per element instance and are DEEP
 *   independent between instances (no shared module-level default graph);
 * - caller writes preserve the caller's reference (no clone) and refresh the
 *   claimed DOM through the shell's propsChanged channel;
 * - reconnect retains the SAME instance state/references; the pre-upgrade own
 *   property path validates and preserves the caller value;
 * - non-primitive rows expose no attribute/JSON channel: the host tag carries
 *   no such attributes, setAttribute on the name is ignored, and the property
 *   is the only channel;
 * - the existing trustedHtml brand is required for writes: a plain `{ html }`
 *   object or a string fails closed and is never promoted;
 * - wrong array/object shapes fail closed;
 * - the SSR host wrapper folds the in-process props record through the shell
 *   resolver (defaults fresh per render, supplied references preserved) and the
 *   claimed DOM shows the folded content. No server→client seed/JSON wire is
 *   claimed: the client instance keeps its own defaults (M11 transport gap).
 *
 * One engine (Chromium), LOCAL; not M09 exit, not M11 transport.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const FILE = '/proj/src/islands/np-card.tsx';
const SITE: GeneratedElementSite = { tag: 'np-card' };

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "import { trustedHtml, type TrustedHtml } from '@openelement/element';\n" +
  'export const openElement = defineIslandConfig({\n' +
  "  hydrate: 'idle',\n" +
  "  root: 'shadow',\n" +
  '  properties: {\n' +
  "    events: { attribute: false, default: [{ id: 'seed', body: 'default-row' }] },\n" +
  "    model: { attribute: false, default: { title: 'untitled', rows: ['a'] } },\n" +
  "    articleHtml: { attribute: false, default: trustedHtml('<b>safe</b>') },\n" +
  '  },\n' +
  '});\n';

const ISLAND_SOURCE = `${SIDECAR}
function NpCard(props: {
  events: Array<{ id: string; body: string }>;
  model: { title: string; rows: string[] };
  articleHtml: TrustedHtml;
}) {
  return (
    <section>
      <h2>{props.model.title}</h2>
      <ul>{props.events.map((entry) => <li key={entry.id}>{entry.body}</li>)}</ul>
    </section>
  );
}
export default NpCard;
`;

interface PageRuntime {
  NpElement: CustomElementConstructor;
  NpCard__ssr: (props?: unknown, host?: unknown) => string;
  NpCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createNpCardRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  trustedHtml: (html: string) => { readonly html: string };
}

declare global {
  interface Window {
    __oeNp: PageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';

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
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, readEntryKeyMarker } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    entry,
    [
      `export { default as NpElement, NpCard__ssr, NpCard__ssrHost, createNpCardRecipe } from './island.js';`,
      `export { createGeneratedElementClass } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      `export { trustedHtml } from ${JSON.stringify(join(element, 'core/security.ts'))};`,
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
      lib: { entry, formats: ['iife'], name: '__oeNp', fileName: () => 'np.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('the non-primitive vertical produced no chunk');
  const file = join(dir, 'np.js');
  writeFileSync(file, chunk.code);
  return file;
}

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-np-'));
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, FILE, { site: SITE });
  expect(compiled).not.toBeNull();
  expect(compiled!.code).toContain('__oePropertyDefault0');
  expect(compiled!.code).toContain('resolveGeneratedElementProps');
  expect(compiled!.code).toContain('default: "<b>safe</b>"');
  bundleFile = await buildBundle(tempDir, compiled!.code);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('non-primitive property retention on the generated element (Chromium)', () => {
  test('default graphs are deep-fresh per instance and SSR content claims', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.NpElement);
        const makeHost = (): HTMLElement => {
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(mod.NpCard__ssrHost(undefined));
          const host = frame.firstElementChild as HTMLElement;
          document.body.append(frame);
          return host;
        };
        const first = makeHost();
        const second = makeHost();
        await tick();
        const shadow = first.shadowRoot!;
        const listText = (host: HTMLElement): string =>
          [...host.shadowRoot!.querySelectorAll('li')].map((item) => item.textContent).join(',');
        const firstEvents = (first as unknown as { events: unknown[] }).events;
        const secondEvents = (second as unknown as { events: unknown[] }).events;
        const firstModel = (first as unknown as { model: { rows: string[] } }).model;
        const secondModel = (second as unknown as { model: { rows: string[] } }).model;
        const firstHtml = (first as unknown as { articleHtml: { html: string } }).articleHtml;
        const secondHtml = (second as unknown as { articleHtml: { html: string } }).articleHtml;
        // Mutating one instance's default graph (all depths) must not leak into
        // the other instance: the factory graph is per-materialisation, not a
        // shared module-level value.
        (firstEvents as Array<{ id: string }>)[0]!.id = 'mutated';
        firstModel.rows.push('mutated');
        return {
          shadowMode: shadow.mode,
          firstList: listText(first),
          secondList: listText(second),
          distinctEvents: firstEvents !== secondEvents,
          distinctRows: firstEvents[0] !== secondEvents[0],
          distinctModel: firstModel !== secondModel,
          distinctModelRows: firstModel.rows !== secondModel.rows,
          distinctHtml: firstHtml !== secondHtml,
          html: firstHtml.html,
          secondIdAfterMutation: (secondEvents as Array<{ id: string }>)[0]!.id,
          secondRowsAfterMutation: secondModel.rows.join(','),
          hostAttributes: first.getAttributeNames(),
        };
      }, SITE.tag);
      expect(result.shadowMode).toBe('open');
      expect(result.firstList).toBe('default-row');
      expect(result.secondList).toBe('default-row');
      expect(result.distinctEvents).toBe(true);
      expect(result.distinctRows).toBe(true);
      expect(result.distinctModel).toBe(true);
      expect(result.distinctModelRows).toBe(true);
      expect(result.distinctHtml).toBe(true);
      expect(result.html).toBe('<b>safe</b>');
      expect(result.secondIdAfterMutation).toBe('seed');
      expect(result.secondRowsAfterMutation).toBe('a');
      // Property-only rows never become attributes/JSON wire.
      expect(result.hostAttributes).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('caller writes preserve references, refresh the claim, survive reconnect and validate shape', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.NpElement);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(mod.NpCard__ssrHost(undefined));
        const host = frame.firstElementChild as HTMLElement;
        document.body.append(frame);
        await tick();
        const state = host as unknown as {
          events: Array<{ id: string; body: string }>;
          model: { title: string; rows: string[] };
          articleHtml: unknown;
        };
        const supplied = [{ id: 'w', body: 'written-row' }];
        state.events = supplied;
        state.model = { title: 'client-title', rows: ['fresh'] };
        await tick();
        const afterWrite = {
          sameReference: state.events === supplied,
          list: [...host.shadowRoot!.querySelectorAll('li')]
            .map((item) => item.textContent)
            .join(','),
          title: host.shadowRoot!.querySelector('h2')!.textContent,
        };
        // Attribute channel does not exist: the attribute is ignored.
        host.setAttribute('events', '[{"id":"attr"}]');
        await tick();
        const afterAttribute = {
          sameReference: state.events === supplied,
          list: [...host.shadowRoot!.querySelectorAll('li')]
            .map((item) => item.textContent)
            .join(','),
        };
        // Reconnect keeps the same instance state/references.
        frame.remove();
        await tick();
        document.body.append(frame);
        await tick();
        const afterReconnect = {
          sameReference: state.events === supplied,
          list: [...host.shadowRoot!.querySelectorAll('li')]
            .map((item) => item.textContent)
            .join(','),
          title: host.shadowRoot!.querySelector('h2')!.textContent,
        };
        const failures: Record<string, string | null> = {};
        const capture = (name: string, run: () => void): void => {
          try {
            run();
            failures[name] = null;
          } catch (error) {
            failures[name] = (error as { code?: string }).code ?? 'no-code';
          }
        };
        capture('plainHtml', () => {
          state.articleHtml = { html: '<b>forged</b>' };
        });
        capture('stringHtml', () => {
          state.articleHtml = '<b>forged</b>';
        });
        capture('wrongArray', () => {
          state.events = { id: 'not-array' } as never;
        });
        capture('wrongObject', () => {
          state.model = [] as never;
        });
        const branded = mod.trustedHtml('<i>branded</i>');
        state.articleHtml = branded;
        const trusted = {
          accepted: state.articleHtml === branded,
          failures,
        };
        return { afterWrite, afterAttribute, afterReconnect, trusted };
      }, SITE.tag);
      expect(result.afterWrite).toEqual({
        sameReference: true,
        list: 'written-row',
        title: 'client-title',
      });
      expect(result.afterAttribute).toEqual({ sameReference: true, list: 'written-row' });
      expect(result.afterReconnect).toEqual({
        sameReference: true,
        list: 'written-row',
        title: 'client-title',
      });
      expect(result.trusted).toEqual({
        accepted: true,
        failures: {
          plainHtml: 'OEIR_SHELL_UNTRUSTED_HTML_PROPERTY',
          stringHtml: 'OEIR_SHELL_UNTRUSTED_HTML_PROPERTY',
          wrongArray: 'OEIR_SHELL_PROPERTY_TYPE_MISMATCH',
          wrongObject: 'OEIR_SHELL_PROPERTY_TYPE_MISMATCH',
        },
      });
    } finally {
      await page.close();
    }
  });

  test('a pre-upgrade own value matching the claimed SSR structure wins and refreshes', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(mod.NpCard__ssrHost(undefined));
        const host = frame.firstElementChild as HTMLElement;
        // Same keyed identity as the SSR default so the claim/adoption is
        // structurally valid; the client value is still the pre-upgrade own
        // write and must win for the live props record.
        const supplied = [{ id: 'seed', body: 'pre-upgrade' }];
        (host as unknown as { events: unknown }).events = supplied;
        customElements.define(tagName, mod.NpElement);
        const appendErrors: string[] = [];
        const onAppendError = (event: ErrorEvent): void => {
          appendErrors.push(
            String((event.error as { message?: string } | null)?.message ?? event.message),
          );
        };
        window.addEventListener('error', onAppendError);
        document.body.append(frame);
        await tick();
        window.removeEventListener('error', onAppendError);
        const state = host as unknown as { events: Array<{ id: string; body: string }> };
        const adoptedList = [...host.shadowRoot!.querySelectorAll('li')]
          .map((item) => item.textContent)
          .join(',');
        // Adopted SSR DOM keeps the server bytes; the pre-upgrade client value
        // is the live property (no server→client seed wire – M11 transport gap).
        const errors: string[] = [];
        const onWriteError = (event: ErrorEvent): void => {
          errors.push(
            String((event.error as { message?: string } | null)?.message ?? event.message),
          );
        };
        window.addEventListener('error', onWriteError);
        const post = [{ id: 'seed', body: 'post-upgrade' }];
        state.events = post;
        await tick();
        await tick();
        window.removeEventListener('error', onWriteError);
        const refreshedList = [...host.shadowRoot!.querySelectorAll('li')]
          .map((item) => item.textContent)
          .join(',');
        return {
          sameReference: state.events === post,
          preUpgradeBody: supplied[0]!.body,
          adoptedList,
          refreshedList,
          claimErrors: appendErrors,
        };
      }, SITE.tag);
      expect(result).toEqual({
        sameReference: true,
        preUpgradeBody: 'pre-upgrade',
        adoptedList: 'pre-upgrade',
        refreshedList: 'post-upgrade',
        claimErrors: [],
      });
    } finally {
      await page.close();
    }
  });

  test('a pre-upgrade own value that changes the claim structure fails closed with a coded claim mismatch', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(mod.NpCard__ssrHost(undefined));
        const host = frame.firstElementChild as HTMLElement;
        // The server default list key is `seed`; the pre-upgrade client write
        // changes the key. Claim adopts against the server bytes, so the
        // structural key set no longer matches the live props: fail closed.
        const supplied = [{ id: 'pre', body: 'pre-upgrade' }];
        (host as unknown as { events: unknown }).events = supplied;
        const claimErrors: Array<Record<string, unknown>> = [];
        const onClaimError = (event: ErrorEvent): void => {
          const value = event.error as {
            name?: string;
            code?: string;
            phase?: string;
            severity?: string;
            recoverable?: boolean;
            message?: string;
          } | null;
          claimErrors.push({
            name: value?.name ?? null,
            code: value?.code ?? null,
            phase: value?.phase ?? null,
            severity: value?.severity ?? null,
            recoverable: value?.recoverable ?? null,
            authored: /\(authored .*:\d+:\d+\)$/.test(value?.message ?? ''),
            message: value?.message ?? event.message,
          });
        };
        window.addEventListener('error', onClaimError);
        customElements.define(tagName, mod.NpElement);
        document.body.append(frame);
        await tick();
        window.removeEventListener('error', onClaimError);
        const shadow = host.shadowRoot!;
        const state = host as unknown as {
          events: Array<{ id: string; body: string }>;
          model: { title: string };
          articleHtml: { html: string };
        };
        const listIn = (root: ParentNode): string =>
          [...root.querySelectorAll('li')].map((item) => item.textContent).join(',');
        const adoptedList = listIn(shadow);
        const post = [{ id: 'post', body: 'post-upgrade' }];
        state.events = post;
        await tick();
        const afterWriteList = listIn(shadow);
        // A second, clean instance still has its own deep-fresh defaults and a
        // distinct branded trustedHtml default (no shared module-level graph).
        const frame2 = document.createElement('div');
        frame2.setHTMLUnsafe(mod.NpCard__ssrHost(undefined));
        const second = frame2.firstElementChild as HTMLElement;
        document.body.append(frame2);
        await tick();
        const secondState = second as unknown as {
          events: Array<{ id: string; body: string }>;
          model: { title: string };
          articleHtml: { html: string };
        };
        return {
          claimErrors,
          adoptedList,
          afterWriteList,
          sameReference: state.events === post,
          borrowedChildren: shadow.childNodes.length,
          secondList: listIn(second.shadowRoot!),
          secondEvents: secondState.events.map((entry) => entry.id).join(','),
          secondTitle: secondState.model.title,
          secondHtml: secondState.articleHtml.html,
          secondEventsDistinct: secondState.events !== post,
          secondHtmlDistinct: secondState.articleHtml !== state.articleHtml,
        };
      }, SITE.tag);
      expect(result.claimErrors).toHaveLength(1);
      expect(result.claimErrors[0]).toMatchObject({
        name: 'OpenElementError',
        code: 'OEIR_LEAF_CLAIM_MISMATCH',
        phase: 'csr',
        severity: 'error',
        recoverable: false,
        authored: true,
      });
      expect(String(result.claimErrors[0]!.message)).toContain(
        'server entry key has no client item',
      );
      // Borrowed server DOM is retained; the failed claim leaves no
      // projection/subscription, so later writes cannot repaint it.
      expect(result.adoptedList).toBe('default-row');
      expect(result.afterWriteList).toBe('default-row');
      expect(result.sameReference).toBe(true);
      expect(result.borrowedChildren).toBe(1);
      // The failure did not disturb another instance's deep-fresh defaults.
      expect(result.secondList).toBe('default-row');
      expect(result.secondEvents).toBe('seed');
      expect(result.secondTitle).toBe('untitled');
      expect(result.secondHtml).toBe('<b>safe</b>');
      expect(result.secondEventsDistinct).toBe(true);
      expect(result.secondHtmlDistinct).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('CSR pre-upgrade array/object/trustedHtml props mount, refresh, reconnect and dispose', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        // No SSR bytes: a parser-created unknown element, own data properties,
        // then upgrade. This is the design's CSR pre-upgrade path (§8.5).
        const host = document.createElement(tagName);
        const events = [{ id: 'csr', body: 'csr-row' }];
        const model = { title: 'csr-title', rows: ['csr'] };
        const articleHtml = mod.trustedHtml('<b>csr-safe</b>');
        (host as unknown as { events: unknown }).events = events;
        (host as unknown as { model: unknown }).model = model;
        (host as unknown as { articleHtml: unknown }).articleHtml = articleHtml;
        const appendErrors: string[] = [];
        const onAppendError = (event: ErrorEvent): void => {
          appendErrors.push(
            String((event.error as { message?: string } | null)?.message ?? event.message),
          );
        };
        window.addEventListener('error', onAppendError);
        customElements.define(tagName, mod.NpElement);
        document.body.append(host);
        await tick();
        window.removeEventListener('error', onAppendError);
        const shadow = host.shadowRoot!;
        const state = host as unknown as {
          events: Array<{ id: string; body: string }>;
          model: { title: string; rows: string[] };
          articleHtml: unknown;
          dispose: (detachOwnedNodes?: boolean) => void;
        };
        const list = (): string =>
          [...shadow.querySelectorAll('li')].map((item) => item.textContent).join(',');
        const mounted = {
          errors: appendErrors,
          sameEvents: state.events === events,
          sameModel: state.model === model,
          sameHtml: state.articleHtml === articleHtml,
          list: list(),
          title: shadow.querySelector('h2')!.textContent,
          attributeNames: host.getAttributeNames(),
        };
        const writeEvents = [{ id: 'write', body: 'write-row' }];
        const writeModel = { title: 'write-title', rows: ['write'] };
        state.events = writeEvents;
        state.model = writeModel;
        await tick();
        const afterWrite = {
          sameEvents: state.events === writeEvents,
          sameModel: state.model === writeModel,
          list: list(),
          title: shadow.querySelector('h2')!.textContent,
        };
        host.remove();
        await tick();
        document.body.append(host);
        await tick();
        const afterReconnect = {
          sameEvents: state.events === writeEvents,
          list: list(),
          title: shadow.querySelector('h2')!.textContent,
        };
        // dispose(false): the owned DOM region stays for external teardown.
        state.dispose(false);
        const disposeKeep = shadow.childNodes.length;
        // A fresh default instance's dispose(true) removes the owned region.
        const second = document.createElement(tagName);
        document.body.append(second);
        await tick();
        const secondShadow = second.shadowRoot!;
        const secondBefore = secondShadow.childNodes.length;
        (second as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
        const secondAfter = secondShadow.childNodes.length;
        return {
          mounted,
          afterWrite,
          afterReconnect,
          disposeKeep,
          secondBefore,
          secondAfter,
        };
      }, SITE.tag);
      expect(result.mounted).toEqual({
        errors: [],
        sameEvents: true,
        sameModel: true,
        sameHtml: true,
        list: 'csr-row',
        title: 'csr-title',
        attributeNames: [],
      });
      expect(result.afterWrite).toEqual({
        sameEvents: true,
        sameModel: true,
        list: 'write-row',
        title: 'write-title',
      });
      expect(result.afterReconnect).toEqual({
        sameEvents: true,
        list: 'write-row',
        title: 'write-title',
      });
      expect(result.disposeKeep).toBeGreaterThan(0);
      expect(result.secondBefore).toBeGreaterThan(0);
      expect(result.secondAfter).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('a plain {html} pre-upgrade own value is never promoted to trustedHtml', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNp;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const host = document.createElement(tagName);
        (host as unknown as { articleHtml: unknown }).articleHtml = { html: '<b>forged</b>' };
        const errors: Array<Record<string, unknown>> = [];
        const onError = (event: ErrorEvent): void => {
          const value = event.error as {
            name?: string;
            code?: string;
            phase?: string;
            message?: string;
          } | null;
          errors.push({
            name: value?.name ?? null,
            code: value?.code ?? null,
            phase: value?.phase ?? null,
            message: value?.message ?? event.message,
          });
        };
        window.addEventListener('error', onError);
        customElements.define(tagName, mod.NpElement);
        document.body.append(host);
        await tick();
        window.removeEventListener('error', onError);
        const state = host as unknown as { articleHtml: { html: string } };
        return {
          errors,
          storedHtml: state.articleHtml.html,
          borrowedChildren: host.shadowRoot?.childNodes.length ?? 0,
        };
      }, SITE.tag);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        name: 'OpenElementError',
        code: 'OEIR_SHELL_UNTRUSTED_HTML_PROPERTY',
        phase: 'csr',
      });
      // The plain object is never stored; the default brand remains.
      expect(result.storedHtml).toBe('<b>safe</b>');
      expect(result.borrowedChildren).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('SSR host folds supplied props through the resolver without a JSON/attribute wire', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate((tagName) => {
        const mod = window.__oeNp;
        const supplied = {
          events: [{ id: 'server', body: 'server-row' }],
          model: { title: 'server-title', rows: ['server'] },
          articleHtml: mod.trustedHtml('<b>server-safe</b>'),
        };
        const hostHtml = mod.NpCard__ssrHost(supplied);
        let forgedCode: string | null = null;
        // The wrong-shape supplied row is read by the component (events.map),
        // so the getter-backed resolver validates it and fails closed.
        try {
          mod.NpCard__ssrHost({ events: { id: 'not-array' } });
        } catch (error) {
          forgedCode = (error as { code?: string }).code ?? 'no-code';
        }
        // An unused supplied trustedHtml row is never read, so a forged plain
        // value is not promoted and not executed.
        let unusedForgedCode: string | null = null;
        try {
          mod.NpCard__ssrHost({ articleHtml: { html: '<b>forged</b>' } });
        } catch (error) {
          unusedForgedCode = (error as { code?: string }).code ?? 'no-code';
        }
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        document.body.append(frame);
        customElements.define(tagName, mod.NpElement);
        const claimedList = [...host.shadowRoot!.querySelectorAll('li')]
          .map((item) => item.textContent)
          .join(',');
        return {
          hostHtml,
          claimedList,
          forgedCode,
          unusedForgedCode,
          clientEvents: (host as unknown as { events: Array<{ id: string }> }).events[0]!.id,
        };
      }, SITE.tag);
      expect(result.hostHtml).toContain('server-row');
      expect(result.hostHtml).not.toContain('events=');
      expect(result.hostHtml).not.toContain('model=');
      expect(result.hostHtml).not.toContain('articleHtml=');
      // SSR bytes show the folded server values; the client instance keeps its
      // own defaults because no seed wire exists (M11 transport gap).
      expect(result.claimedList).toBe('server-row');
      expect(result.clientEvents).toBe('seed');
      expect(result.forgedCode).toBe('OEIR_SHELL_PROPERTY_TYPE_MISMATCH');
      expect(result.unusedForgedCode).toBeNull();
    } finally {
      await page.close();
    }
  });
  test('SSR host reads supplied getters per read and never executes unused getters', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate((tagName) => {
        const mod = window.__oeNp;
        const reads = { events: 0, model: 0, articleHtml: 0 };
        const props = {
          get events() {
            reads.events += 1;
            return [{ id: 'getter', body: `row-${reads.events}` }];
          },
          get model() {
            reads.model += 1;
            return { title: `title-${reads.model}`, rows: ['r'] };
          },
          get articleHtml() {
            reads.articleHtml += 1;
            return mod.trustedHtml('<b>unused</b>');
          },
        };
        const before = { ...reads };
        const html = mod.NpCard__ssrHost(props);
        return {
          before,
          after: reads,
          html,
          site: tagName,
        };
      }, SITE.tag);
      // The fold itself executes no supplied getter.
      expect(result.before).toEqual({ events: 0, model: 0, articleHtml: 0 });
      // The leaf reads the two rendered rows once; the unused trustedHtml row
      // is not read at all.
      expect(result.after.events).toBeGreaterThanOrEqual(1);
      expect(result.after.model).toBeGreaterThanOrEqual(1);
      expect(result.after.articleHtml).toBe(0);
      expect(result.html).toContain('row-1');
      expect(result.html).toContain('title-1');
      expect(result.html).not.toContain('unused');
    } finally {
      await page.close();
    }
  });
  test('the shell materialises a client default once per instance (not per read)', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const mod = window.__oeNp;
        let factoryCalls = 0;
        const Ctor = mod.createGeneratedElementClass({
          tag: 'np-default-count',
          root: 'light',
          properties: [
            {
              name: 'events',
              attribute: null,
              type: 'array',
              reflect: false,
              default: () => {
                factoryCalls += 1;
                return [{ id: 'seed' }];
              },
            },
          ],
          createRecipe: () => ({ mount: () => [], createProps: () => ({}) }),
        });
        customElements.define('np-default-count', Ctor);
        const first = document.createElement('np-default-count') as HTMLElement & {
          events: unknown[];
        };
        const second = document.createElement('np-default-count') as HTMLElement & {
          events: unknown[];
        };
        const afterConstruction = factoryCalls;
        // Reads reuse the instance's materialised graph; they never invoke the
        // factory again.
        const firstReads = [first.events, first.events];
        const secondReads = [second.events, second.events];
        return {
          afterConstruction,
          afterReads: factoryCalls,
          sameRef: firstReads[0] === firstReads[1],
          distinctInstances: firstReads[0] !== secondReads[0],
        };
      });
      expect(result).toEqual({
        afterConstruction: 2,
        afterReads: 2,
        sameRef: true,
        distinctInstances: true,
      });
    } finally {
      await page.close();
    }
  });
});
