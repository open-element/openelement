/**
 * M09 intrinsic event/ref channels on the generated Native Custom Element —
 * LOCAL Chromium vertical.
 *
 * The bounded capability is compiler-private codegen, not full authored CE
 * parity: authored JSX uses the existing `onClick` / `ref` attributes on
 * intrinsic elements; installation reuses the class-path ownership idioms and
 * the generated class stays a normal Custom Element (no new runtime module, no
 * package export, no callback API).
 *
 * Asserted, in real Chromium:
 *
 * - authored sidecar -> real lane -> generated module -> Node `__ssrHost`
 *   bytes -> parser-adopted DSD root -> claim: the event listener fires, the
 *   ref callback received the element, and no `onClick`/`ref` DOM attributes
 *   exist;
 * - disconnect runs the ref cleanup (`cleanup()` then `ref(null)`) and removes
 *   the listener; reconnect re-installs both under the fresh claim;
 * - CSR mount installs both, and a reconnect after mount claims the retained
 *   DOM with the listener/ref re-installed;
 * - `dispose(false)` keeps the claimed tree and `dispose(true)` removes the
 *   owned region;
 * - failure semantics: a claim mismatch installs NOTHING; a phase-2
 *   installation throw (non-callable ref handler) releases the already
 *   installed listener through the claim owner rollback while the borrowed DOM
 *   stays (bounded, nontransactional);
 * - a non-callable event handler fails with the coded
 *   `OEIR_LEAF_EVENT_HANDLER_INVALID` before any listener exists.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix; imported
 * handler/owned-signal carry stays refused by the generated-element lane and is
 * not claimed here (the failure test passes bindings by hand to exercise the
 * runtime precondition, not to claim production wiring).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const FILE = '/proj/src/islands/event-ref-card.tsx';
const FAILURE_FILE = '/proj/src/islands/failure-card.tsx';
const SITE: GeneratedElementSite = { tag: 'event-ref-card' };
const FAILURE_SITE: GeneratedElementSite = { tag: 'failure-card' };

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow' });\n";

/** The authored island: one listener and one ref on intrinsic elements. */
const ISLAND_SOURCE = `${SIDECAR}
function EventRefCard() {
  return (
    <section>
      <button
        id="hit"
        onClick={() => (globalThis.__hits = (globalThis.__hits ?? 0) + 1)}
      >
        hit
      </button>
      <input
        id="field"
        ref={(el) =>
          el === null
            ? undefined
            : ((globalThis.__refSeen = true), () => (globalThis.__refCleaned = true))}
      />
    </section>
  );
}
export default EventRefCard;
`;

/**
 * The failure island: a plain local button listener (installed first) followed
 * by a ref that reads an imported host binding. The bindings value is supplied
 * as a non-callable by the test, so the ref validation throws in claim phase 2
 * AFTER the listener was installed; the owner rollback must release it.
 */
const FAILURE_SOURCE = `${SIDECAR}import { badHandler } from './bad-handler';
function FailureCard() {
  return (
    <div>
      <button id="ok" onClick={() => (globalThis.__okHits = (globalThis.__okHits ?? 0) + 1)}>ok</button>
      <input id="bad" ref={badHandler} />
    </div>
  );
}
export default FailureCard;
`;

interface PageRuntime {
  EventRefElement: CustomElementConstructor;
  EventRefCard__ssr: (props?: unknown, host?: unknown) => string;
  EventRefCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createEventRefCardRecipe: (owner: unknown, host: unknown) => unknown;
  FailureCard__ssr: (props?: unknown, host?: unknown) => string;
  createFailureCardRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  serializeGeneratedElementHtml: (input: unknown) => string;
}

declare global {
  interface Window {
    __oeEventRef: PageRuntime;
    __okHits?: number;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';

function frontModule(source: string, id: string): FunctionModelModule {
  const front = compileFunctionModule(source, id, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

async function buildBundle(
  dir: string,
  islandModule: string,
  failureModule: string,
): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const islandFile = join(dir, 'island.js');
  const failureFile = join(dir, 'failure.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(islandFile, islandModule);
  writeFileSync(failureFile, failureModule);
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
      `export { default as EventRefElement, EventRefCard__ssr, EventRefCard__ssrHost, createEventRefCardRecipe } from './island.js';`,
      `export { FailureCard__ssr, createFailureCardRecipe } from './failure.js';`,
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
      lib: { entry, formats: ['iife'], name: '__oeEventRef', fileName: () => 'event-ref.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('the event/ref vertical produced no chunk');
  const file = join(dir, 'event-ref.js');
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
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-event-ref-'));
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, FILE, { site: SITE });
  expect(compiled).not.toBeNull();
  expect(compiled!.code).toContain('addEventListener("click"');
  expect(compiled!.code).toContain('OEIR_LEAF_REF_HANDLER_INVALID');

  // The failure island needs a host binding, which the generated-element lane
  // deliberately refuses; the module is emitted through the same emitter for
  // the runtime precondition test only (no production wiring claim).
  const failure = generateElementModule(frontModule(FAILURE_SOURCE, FAILURE_FILE), FAILURE_SITE, {
    rootComponent: 'FailureCard',
    root: 'shadow-open',
  });
  expect(failure.diagnostics, failure.diagnostics.map((item) => item.message).join('\n')).toEqual(
    [],
  );
  expect(failure.module).toContain('OEIR_LEAF_REF_HANDLER_INVALID');

  bundleFile = await buildBundle(tempDir, compiled!.code, failure.module!);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('M09 intrinsic event/ref on the generated native element (Chromium)', () => {
  test('authored sidecar -> SSR parse -> claim -> listener/ref -> reconnect -> dispose', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEventRef;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const win = window as unknown as {
          __hits?: number;
          __refSeen?: boolean;
          __refCleaned?: boolean;
        };
        win.__hits = 0;
        win.__refSeen = false;
        win.__refCleaned = false;
        customElements.define(tagName, mod.EventRefElement);

        const hostHtml = mod.EventRefCard__ssrHost(undefined);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const button = shadow.querySelector('#hit') as HTMLElement;
        const field = shadow.querySelector('#field') as HTMLInputElement;
        document.body.append(frame);
        await tick();

        const beforeClick = {
          hits: win.__hits,
          refSeen: win.__refSeen,
          attachShadowCalls: probe.attachShadowCalls,
          hasOnClickAttribute: host.hasAttribute('onClick') || button.hasAttribute('onClick'),
          hasRefAttribute: host.hasAttribute('ref') || field.hasAttribute('ref'),
          mode: shadow.mode,
        };
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const afterClicks = { hits: win.__hits };

        // Disconnect: the scope cleanup removes the listener and runs the ref
        // cleanup (unsubscribe + ref(null)).
        frame.remove();
        await tick();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const afterDisconnect = {
          hits: win.__hits,
          refCleaned: win.__refCleaned,
        };

        // Reconnect claims the retained root again with a fresh scope.
        const errors: string[] = [];
        const onError = (event: ErrorEvent): void => {
          errors.push(
            String((event.error as { message?: string } | null)?.message ?? event.message),
          );
        };
        window.addEventListener('error', onError);
        document.body.append(frame);
        await tick();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        window.removeEventListener('error', onError);
        const afterReconnect = {
          hits: win.__hits,
          refSeen: win.__refSeen,
          attachShadowCalls: probe.attachShadowCalls,
          errors,
        };

        // dispose(false) keeps the claimed tree; a fresh claim observes
        // dispose(true) removing exactly the owned region.
        (host as unknown as { dispose: (detach?: boolean) => void }).dispose(false);
        const afterPlain = { children: shadow.childNodes.length };
        const detachFrame = document.createElement('div');
        detachFrame.setHTMLUnsafe(hostHtml);
        const detachHost = detachFrame.firstElementChild as HTMLElement;
        const detachShadow = detachHost.shadowRoot!;
        document.body.append(detachFrame);
        await tick();
        (detachHost as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
        const afterDetach = { children: detachShadow.childNodes.length };

        return {
          hostHtml,
          beforeClick,
          afterClicks,
          afterDisconnect,
          afterReconnect,
          afterPlain,
          afterDetach,
        };
      }, SITE.tag);

      expect(result.hostHtml).toContain('<template shadowrootmode="open">');
      expect(result.hostHtml).not.toContain('onClick');
      expect(result.beforeClick).toEqual({
        hits: 0,
        refSeen: true,
        attachShadowCalls: 0,
        hasOnClickAttribute: false,
        hasRefAttribute: false,
        mode: 'open',
      });
      expect(result.afterClicks).toEqual({ hits: 2 });
      expect(result.afterDisconnect).toEqual({ hits: 2, refCleaned: true });
      expect(result.afterReconnect).toEqual({
        hits: 3,
        refSeen: true,
        attachShadowCalls: 0,
        errors: [],
      });
      expect(result.afterPlain).toEqual({ children: 1 });
      expect(result.afterDetach).toEqual({ children: 0 });
    } finally {
      await page.close();
    }
  });

  test('CSR mount installs both and a reconnect re-installs under the retained claim', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEventRef;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const win = window as unknown as {
          __hits?: number;
          __refSeen?: boolean;
          __refCleaned?: boolean;
        };
        win.__hits = 0;
        win.__refSeen = false;
        win.__refCleaned = false;
        customElements.define(tagName, mod.EventRefElement);
        const host = document.createElement(tagName);
        document.body.append(host);
        await tick();
        const shadow = host.shadowRoot!;
        const button = shadow.querySelector('#hit') as HTMLElement;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const mounted = { hits: win.__hits, refSeen: win.__refSeen };
        host.remove();
        await tick();
        const detached = { refCleaned: win.__refCleaned };
        document.body.append(host);
        await tick();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
          mounted,
          detached,
          reconnected: { hits: win.__hits, refSeen: win.__refSeen },
        };
      }, SITE.tag);
      expect(result.mounted).toEqual({ hits: 1, refSeen: true });
      expect(result.detached).toEqual({ refCleaned: true });
      expect(result.reconnected).toEqual({ hits: 2, refSeen: true });
    } finally {
      await page.close();
    }
  });

  test('claim mismatch installs nothing and borrowed DOM stays', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate((tagName) => {
        const mod = window.__oeEventRef;
        const win = window as unknown as { __hits?: number; __refSeen?: boolean };
        win.__hits = 0;
        win.__refSeen = false;
        customElements.define(tagName, mod.EventRefElement);
        const hostHtml = mod.EventRefCard__ssrHost(undefined);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const button = shadow.querySelector('#hit') as HTMLElement;
        // Corrupt the borrowed DOM so the claim's static text check fails.
        button.textContent = 'nope';
        let code: string | null = null;
        try {
          host.connectedCallback();
        } catch (error) {
          code = (error as { code?: string }).code ?? null;
        }
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
          code,
          hits: win.__hits,
          refSeen: win.__refSeen,
          borrowedChildren: shadow.childNodes.length,
        };
      }, SITE.tag);
      expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.hits).toBe(0);
      expect(result.refSeen).toBe(false);
      expect(result.borrowedChildren).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  test('a phase-2 installation throw releases the listener and keeps borrowed DOM', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate((tagName) => {
        const mod = window.__oeEventRef;
        window.__okHits = 0;
        const FailureElement = mod.createGeneratedElementClass({
          tag: tagName,
          root: 'shadow-open',
          // The test supplies the imported binding as a non-callable value;
          // this exercises the runtime precondition, not production carry.
          createBindings: () => ({ badHandler: 'not-a-function' }),
          createRecipe: mod.createFailureCardRecipe,
        });
        customElements.define(tagName, FailureElement);
        const hostHtml = mod.serializeGeneratedElementHtml({
          tag: tagName,
          root: 'open',
          content: mod.FailureCard__ssr(),
        });
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const button = shadow.querySelector('#ok') as HTMLElement;
        const bad = shadow.querySelector('#bad') as HTMLElement;
        let code: string | null = null;
        let message = '';
        try {
          host.connectedCallback();
        } catch (error) {
          code = (error as { code?: string }).code ?? null;
          message = String((error as { message?: string }).message ?? error);
        }
        const afterFailure = {
          code,
          message,
          hits: window.__okHits,
          refSeen: bad.dataset.refSeen ?? null,
          borrowedChildren: shadow.childNodes.length,
        };
        // The first listener was installed before the throwing ref step; the
        // owner rollback must have removed it.
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { afterFailure, hitsAfterClick: window.__okHits };
      }, FAILURE_SITE.tag);
      expect(result.afterFailure.message).toContain('OEIR_LEAF_REF_HANDLER_INVALID');
      expect(result.afterFailure.hits).toBe(0);
      expect(result.afterFailure.refSeen).toBeNull();
      expect(result.afterFailure.borrowedChildren).toBeGreaterThan(0);
      expect(result.hitsAfterClick).toBe(0);
    } finally {
      await page.close();
    }
  });
});
