/**
 * `16b-EB` author-facing error boundary — REAL Chromium evidence.
 *
 * A real generated element module for an admitted island root is bundled with
 * the real recipe/LifetimeScope runtime and the real generated-element shell,
 * registered as a Custom Element in Chromium, and exercised through the platform
 * lifecycle. Authored callbacks observe themselves through `globalThis` (the
 * function-component expression model admits ECMAScript builtins, not
 * `window`/`document`); no generated code is hand-written and the shell/runtime
 * are the shipped modules, not stubs.
 *
 * The THREE capture points this suite pins:
 *
 * 1. CONNECT/CLAIM — the `connectedCallback` catch the shell already had. With
 *    a registered handler it runs the handler instead of letting the error
 *    escape, and the element is left in its DEFINED post-failure state (no
 *    projection, no listeners installed, a later reconnect retries from
 *    scratch). With NO handler the pre-existing rollback-and-rethrow is
 *    unchanged.
 * 2. UPDATE — a throwing sink refresh (a tracked slot whose expression throws on
 *    a later props commit) is reported to the handler and the subscription stays
 *    live, so a subsequent good commit writes the DOM again.
 * 3. EVENT DISPATCH — a throwing DOM listener is reported instead of escaping as
 *    uncaught platform dispatch, and the listener still works on the next click.
 *
 * Also pinned:
 *
 * - a THROWING handler surfaces ITS error (not the original), for both the
 *   connect and the update phase;
 * - the `env` shape: `host` is the real element, `error` is the thrown value
 *   (identity, not a wrapper), `signal.aborted` is true for a connect-phase
 *   failure and false for an update-phase one, `states` is the live
 *   `CustomStateSet`;
 * - the SSR producer runs no handler and propagates a producer throw; the
 *   enclosing render can opt into literal nested fallback, which the client
 *   claims under the existing DOM identity.
 *
 * One engine (Chromium), LOCAL. Not an M13 matrix row, not a public API freeze.
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

function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  root: 'light',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const SIDECAR = sidecar('seed: { default: 0 }, explode: { default: false }');

/**
 * CONNECT-phase fixture: the component throws from its own connect replay path
 * (an `onConnect` callback is part of the connect/claim pass), guarded by a
 * handler that records the env. The element must end the failed connect with NO
 * projection and NO listeners, and the SAME host must be able to connect again
 * once the throw source is cleared — that is what "defined state after a caught
 * connect error" means concretely.
 */
const CONNECT_THROW_SOURCE =
  `import { onConnect, onError } from '@openelement/element';\n` +
  SIDECAR +
  'function ConnectBoundary(props: { seed: number; explode: boolean }) {\n' +
  '  onError((env) => {\n' +
  "    globalThis.__oeEbJournal.push('caught-connect');\n" +
  '    globalThis.__oeEbHosts.push(env.host);\n' +
  '    globalThis.__oeEbErrorsCaught.push(env.error);\n' +
  '    globalThis.__oeEbAborted.push(env.signal.aborted);\n' +
  '  });\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeEbJournal.push('connect');\n" +
  '    if (props.explode) throw new Error("connect boom");\n' +
  '  });\n' +
  '  return (\n' +
  '    <button onClick={() => { globalThis.__oeEbJournal.push("click"); }}>\n' +
  '      {props.seed}\n' +
  '    </button>\n' +
  '  );\n' +
  '}\n' +
  'export default ConnectBoundary;\n';

/**
 * UPDATE-phase fixture: the tracked slot expression throws for one specific row
 * value — the local arrow is called INLINE at its sink (migration-note R1), so
 * the slot really is a bound refresh edge and the throw happens INSIDE the
 * subscription callback. The first commit is clean, the second throws, the third
 * must still write (the subscription stayed live).
 */
const UPDATE_THROW_SOURCE =
  `import { onError } from '@openelement/element';\n` +
  SIDECAR +
  'function UpdateBoundary(props: { seed: number; explode: boolean }) {\n' +
  '  onError((env) => {\n' +
  "    globalThis.__oeEbJournal.push('caught-update');\n" +
  '    globalThis.__oeEbErrorsCaught.push(env.error);\n' +
  '    globalThis.__oeEbAborted.push(env.signal.aborted);\n' +
  '  });\n' +
  '  const label = (seed: number, explode: boolean) => {\n' +
  '    if (explode) throw new Error("slot boom");\n' +
  '    return seed;\n' +
  '  };\n' +
  '  return <span>{label(props.seed, props.explode)}</span>;\n' +
  '}\n' +
  'export default UpdateBoundary;\n';

/**
 * EVENT-phase fixture: the click handler throws on the row value 1 only. The
 * handler must be REPORTED, not escape as uncaught dispatch, and the next click
 * (row value 0) must still run.
 */
const EVENT_THROW_SOURCE =
  `import { onError } from '@openelement/element';\n` +
  SIDECAR +
  'function EventBoundary(props: { seed: number; explode: boolean }) {\n' +
  '  onError((env) => {\n' +
  "    globalThis.__oeEbJournal.push('caught-event');\n" +
  '    globalThis.__oeEbErrorsCaught.push(env.error);\n' +
  '    globalThis.__oeEbAborted.push(env.signal.aborted);\n' +
  '  });\n' +
  '  return (\n' +
  '    <button\n' +
  '      onClick={() => {\n' +
  '        globalThis.__oeEbJournal.push("click");\n' +
  '        if (props.explode) throw new Error("event boom");\n' +
  '      }}\n' +
  '    >\n' +
  '      {props.seed}\n' +
  '    </button>\n' +
  '  );\n' +
  '}\n' +
  'export default EventBoundary;\n';

/**
 * THROWING-HANDLER fixture: the handler itself throws for a connect-phase
 * failure. Its error must be what the page sees — the original must not be the
 * surfaced one.
 */
const HANDLER_THROW_SOURCE =
  `import { onConnect, onError } from '@openelement/element';\n` +
  SIDECAR +
  'function HandlerThrow(props: { seed: number; explode: boolean }) {\n' +
  '  onError(() => { throw new Error("handler boom"); });\n' +
  '  onConnect(() => { if (props.explode) throw new Error("connect boom"); });\n' +
  '  return <p>{props.seed}</p>;\n' +
  '}\n' +
  'export default HandlerThrow;\n';

/**
 * NO-HANDLER control: the same failing connect path without the intrinsic. The
 * throw must still roll back AND escape, exactly as before `16b-EB`.
 */
const NO_HANDLER_SOURCE =
  `import { onConnect } from '@openelement/element';\n` +
  SIDECAR +
  'function NoBoundary(props: { seed: number; explode: boolean }) {\n' +
  '  onConnect(() => { if (props.explode) throw new Error("connect boom"); });\n' +
  '  return <p>{props.seed}</p>;\n' +
  '}\n' +
  'export default NoBoundary;\n';

/**
 * NO-HANDLER control for the UPDATE and EVENT phases: the same two throwing
 * sites as the update/event fixtures, without the intrinsic. Both throws must
 * reach the platform — that is what makes D4/D5 evidence that the GUARD is the
 * capture point rather than something else in the runtime.
 */
const NO_HANDLER_UPDATE_SOURCE =
  SIDECAR +
  'function NoBoundaryUpdate(props: { seed: number; explode: boolean }) {\n' +
  '  const label = (seed: number, explode: boolean) => {\n' +
  '    if (explode) throw new Error("slot boom");\n' +
  '    return seed;\n' +
  '  };\n' +
  '  return <span>{label(props.seed, props.explode)}</span>;\n' +
  '}\n' +
  'export default NoBoundaryUpdate;\n';

const NO_HANDLER_EVENT_SOURCE =
  SIDECAR +
  'function NoBoundaryEvent(props: { seed: number; explode: boolean }) {\n' +
  '  return (\n' +
  '    <button\n' +
  '      onClick={() => {\n' +
  '        if (props.explode) throw new Error("event boom");\n' +
  '      }}\n' +
  '    >\n' +
  '      {props.seed}\n' +
  '    </button>\n' +
  '  );\n' +
  '}\n' +
  'export default NoBoundaryEvent;\n';

/**
 * DEPTH-1 RETAINED CHILD fixture. This is the ordering-sensitive case: the child
 * registers its handler from its own `<Child>__setup`, which runs AFTER the
 * retaining reference site already built the host literals it will read. Both
 * channels are getter-backed for exactly this reason. The child's tracked slot
 * throws on a later props commit, so a passing row proves the child's refresh
 * reached the ENCLOSING element's handler.
 */
const NESTED_SOURCE =
  `import { onError } from '@openelement/element';\n` +
  sidecar('seed: { default: 0 }, explode: { default: false }, show: { default: true }') +
  'function Child(props: { seed: number; explode: boolean }) {\n' +
  '  onError((env) => {\n' +
  "    globalThis.__oeEbJournal.push('caught-child');\n" +
  '    globalThis.__oeEbAborted.push(env.signal.aborted);\n' +
  '  });\n' +
  '  const label = (seed: number, explode: boolean) => {\n' +
  '    if (explode) throw new Error("child slot boom");\n' +
  '    return seed;\n' +
  '  };\n' +
  '  return <em>{label(props.seed, props.explode)}</em>;\n' +
  '}\n' +
  'function NestedHost(props: { seed: number; explode: boolean; show: boolean }) {\n' +
  '  return <span>{props.show ? <Child seed={props.seed} explode={props.explode} /> : null}</span>;\n' +
  '}\n' +
  'export default NestedHost;\n';

const SSR_FALLBACK_SOURCE =
  "import { onError } from '@openelement/element';\n" +
  sidecar('seed: { default: 0 }') +
  `export default function FallbackBoundary(props: { seed: number }) {
    onError(() => { globalThis.__oeEbJournal.push('caught-fallback'); });
    return (
      <section>
        <error-boundary-update explode><strong>fallback</strong></error-boundary-update>
        <error-boundary-connect seed="8"></error-boundary-connect>
        <output>{props.seed}</output>
      </section>
    );
  }`;

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  __oeElementTag: string;
  [name: string]: unknown;
}

declare global {
  interface Window {
    __oeEbConnect: PageRuntime;
    __oeEbUpdate: PageRuntime;
    __oeEbEvent: PageRuntime;
    __oeEbHandlerThrow: PageRuntime;
    __oeEbNoHandler: PageRuntime;
    __oeEbNoHandlerUpdate: PageRuntime;
    __oeEbNoHandlerEvent: PageRuntime;
    __oeEbNested: PageRuntime;
    __oeEbFallback: PageRuntime & {
      renderToString: typeof import('../../../element/src/index.ts').renderToString;
    };
    __oeEbTick: () => Promise<void>;
    __oeEbErrors: string[];
    __oeEbJournal: string[];
    __oeEbHosts: HTMLElement[];
    __oeEbErrorsCaught: unknown[];
    __oeEbAborted: boolean[];
  }
}

let browser: Browser;
let tempDir = '';
const bundles = new Map<string, string>();
const tags = new Map<string, string>();

const PAGE_SETUP = `
  window.__oeEbTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeEbErrors = [];
  window.__oeEbJournal = [];
  window.__oeEbHosts = [];
  window.__oeEbErrorsCaught = [];
  window.__oeEbAborted = [];
  window.addEventListener('error', (event) => {
    window.__oeEbErrors.push(
      event.error && event.error.message ? event.error.message : event.message,
    );
  });
`;

async function buildBundle(
  dir: string,
  islandModule: string,
  name: string,
  globalName: string,
  component: string,
  includeServerRenderer: boolean,
): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const island = join(dir, `${name}-island.js`);
  const entry = join(dir, `${name}-entry.ts`);
  writeFileSync(island, islandModule);
  const ssrExport = new RegExp(`export function (${component}__ssr)\\(`).exec(islandModule);
  const entryLines = [
    `export { default as GeneratedElement } from './${name}-island.js';`,
    `export { __oeElementTag } from './${name}-island.js';`,
    ...(ssrExport === null ? [] : [`export { ${ssrExport[1]} } from './${name}-island.js';`]),
    ...(includeServerRenderer
      ? [`export { renderToString } from ${JSON.stringify(join(element, '../index.ts'))};`]
      : []),
    '',
  ];
  writeFileSync(entry, entryLines.join('\n'));
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: {
      alias: {
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: join(element, 'compiled/leaf-runtime.ts'),
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(element, 'compiled/generated-element/shell.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: globalName,
        fileName: () => `${name}.js`,
      },
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

function compileIsland(
  name: string,
  source: string,
): { code: string; tag: string; component: string } {
  const file = `${ISLANDS_DIR}/${name}.tsx`;
  const site = siteFor(file);
  expect(site).not.toBeNull();
  const compiled = compileGeneratedElementIfAdmitted(source, file, { site: site! });
  expect(compiled).not.toBeNull();
  return { code: compiled!.code, tag: compiled!.tag, component: compiled!.component };
}

async function openPage(bundleKey: string, html = ''): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  await page.addScriptTag({ path: bundles.get(bundleKey)! });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-eb-boundary-'));
  const fixtures: Array<[string, string, string, string]> = [
    ['connect', 'error-boundary-connect', CONNECT_THROW_SOURCE, '__oeEbConnect'],
    ['update', 'error-boundary-update', UPDATE_THROW_SOURCE, '__oeEbUpdate'],
    ['event', 'error-boundary-event', EVENT_THROW_SOURCE, '__oeEbEvent'],
    ['handlerThrow', 'error-boundary-handler-throw', HANDLER_THROW_SOURCE, '__oeEbHandlerThrow'],
    ['noHandler', 'error-boundary-no-handler', NO_HANDLER_SOURCE, '__oeEbNoHandler'],
    [
      'noHandlerUpdate',
      'error-boundary-no-handler-update',
      NO_HANDLER_UPDATE_SOURCE,
      '__oeEbNoHandlerUpdate',
    ],
    [
      'noHandlerEvent',
      'error-boundary-no-handler-event',
      NO_HANDLER_EVENT_SOURCE,
      '__oeEbNoHandlerEvent',
    ],
    ['nested', 'error-boundary-nested', NESTED_SOURCE, '__oeEbNested'],
    ['fallback', 'error-boundary-fallback', SSR_FALLBACK_SOURCE, '__oeEbFallback'],
  ];
  for (const [key, name, source, globalName] of fixtures) {
    const compiled = compileIsland(name, source);
    tags.set(key, compiled.tag);
    bundles.set(
      key,
      await buildBundle(
        tempDir,
        compiled.code,
        name,
        globalName,
        compiled.component,
        key === 'fallback',
      ),
    );
  }
  browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('16b-EB error boundary (Chromium)', () => {
  test('D1 a caught CONNECT throw leaves a defined element: no projection, no listeners, a later reconnect retries', async () => {
    const page = await openPage('connect');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbConnect;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        host.seed = 1;
        host.explode = true;
        document.body.append(host);
        await tick();
        const afterFailure = {
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
          caught: window.__oeEbErrorsCaught.slice(),
          aborted: window.__oeEbAborted.slice(),
          hostsMatch: window.__oeEbHosts.every((entry) => entry === host),
          childCount: host.childNodes.length,
          text: host.textContent,
          // No generated node exists, so no listener can be attached to one.
          hasButton: host.querySelector('button') !== null,
        };
        // The throw source is cleared: the SAME element must retry from scratch.
        host.explode = false;
        document.body.removeChild(host);
        await tick();
        document.body.append(host);
        await tick();
        const afterRetry = {
          journal: window.__oeEbJournal.slice(),
          childCount: host.childNodes.length,
          text: host.textContent,
          tag: host.firstElementChild?.tagName ?? null,
        };
        // The listener installed by the successful retry must work.
        const button = host.querySelector('button');
        button?.click();
        await tick();
        const afterClick = { journal: window.__oeEbJournal.slice() };
        return { afterFailure, afterRetry, afterClick };
      }, tags.get('connect')!);
      // The handler ran (not the platform): no uncaught error escaped.
      expect(result.afterFailure.errors).toEqual([]);
      expect(result.afterFailure.journal).toEqual(['connect', 'caught-connect']);
      // env shape: real element, connect-phase signal already aborted.
      expect(result.afterFailure.hostsMatch).toBe(true);
      expect(result.afterFailure.aborted).toEqual([true]);
      // DEFINED STATE: no generated DOM, so no projection and no listener
      // attached to a generated node.
      expect(result.afterFailure.childCount).toBe(0);
      expect(result.afterFailure.text).toBe('');
      expect(result.afterFailure.hasButton).toBe(false);
      // A later reconnect retries and succeeds from scratch. The retry
      // MOUNTING (rather than failing a claim against an empty host) is the
      // proof that the failed attempt did not corrupt the region fact.
      expect(result.afterRetry.text).toBe('1');
      expect(result.afterRetry.tag).toBe('BUTTON');
      expect(result.afterRetry.childCount).toBe(1);
      // The listener the retry installed works; the failed attempt left none.
      expect(result.afterClick.journal).toEqual(['connect', 'caught-connect', 'connect', 'click']);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D2 NO handler keeps the pre-16b-EB behaviour: rollback AND rethrow, nothing mounted', async () => {
    const page = await openPage('noHandler');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbNoHandler;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        host.seed = 1;
        host.explode = true;
        document.body.append(host);
        await tick();
        const afterFailure = {
          errors: window.__oeEbErrors.slice(),
          childCount: host.childNodes.length,
        };
        host.explode = false;
        document.body.removeChild(host);
        await tick();
        document.body.append(host);
        await tick();
        return { afterFailure, retryText: host.textContent };
      }, tags.get('noHandler')!);
      // The error escaped to the platform (unchanged), and nothing was mounted.
      expect(result.afterFailure.errors).toContain('connect boom');
      expect(result.afterFailure.childCount).toBe(0);
      // The rollback is unchanged: the same element can retry.
      expect(result.retryText).toBe('1');
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D3 a throwing HANDLER surfaces ITS error, not the original', async () => {
    const page = await openPage('handlerThrow');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbHandlerThrow;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        host.seed = 1;
        host.explode = true;
        document.body.append(host);
        await tick();
        return {
          errors: window.__oeEbErrors.slice(),
          childCount: host.childNodes.length,
        };
      }, tags.get('handlerThrow')!);
      // The handler's own error is what reaches the page...
      expect(result.errors).toContain('handler boom');
      // ...and the ORIGINAL connect error is not the one surfaced.
      expect(result.errors).not.toContain('connect boom');
      // The rollback still ran: no projection.
      expect(result.childCount).toBe(0);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D4 a throwing UPDATE-phase slot is reported and the subscription stays live', async () => {
    const page = await openPage('update');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbUpdate;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        document.body.append(host);
        await tick();
        const mounted = { text: host.textContent, journal: window.__oeEbJournal.slice() };
        // A clean commit: the sink writes.
        host.seed = 5;
        await tick();
        const clean = { text: host.textContent, journal: window.__oeEbJournal.slice() };
        // A throwing commit: the refresh throws inside the subscription.
        host.explode = true;
        await tick();
        const thrown = {
          text: host.textContent,
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
          aborted: window.__oeEbAborted.slice(),
        };
        // The subscription is still live: a later clean commit must write again.
        host.explode = false;
        host.seed = 9;
        await tick();
        const recovered = {
          text: host.textContent,
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
        };
        return { mounted, clean, thrown, recovered };
      }, tags.get('update')!);
      // Mount renders the clean branch (explode is false by default).
      expect(result.mounted.text).toBe('0');
      expect(result.clean.text).toBe('5');
      // The throwing commit was REPORTED, not thrown to the platform.
      expect(result.thrown.errors).toEqual([]);
      expect(result.thrown.journal).toEqual(['caught-update']);
      // Update-phase scope: the instance signal is live, so `aborted` is false.
      expect(result.thrown.aborted).toEqual([false]);
      // The subscription survived: the next clean commit writes the DOM.
      expect(result.recovered.text).toBe('9');
      expect(result.recovered.errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D5 a throwing EVENT handler is reported and the listener still works', async () => {
    const page = await openPage('event');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbEvent;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        host.seed = 1;
        document.body.append(host);
        await tick();
        const button = host.querySelector('button')!;
        // A clean click: the listener runs.
        button.click();
        await tick();
        const clean = {
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
        };
        // A throwing click: reported, not uncaught.
        host.explode = true;
        button.click();
        await tick();
        const thrown = {
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
          aborted: window.__oeEbAborted.slice(),
        };
        // The listener is still installed: the next clean click runs.
        host.explode = false;
        button.click();
        await tick();
        return { clean, thrown, after: { journal: window.__oeEbJournal.slice() } };
      }, tags.get('event')!);
      expect(result.clean.journal).toEqual(['click']);
      expect(result.thrown.errors).toEqual([]);
      expect(result.thrown.journal).toEqual(['click', 'click', 'caught-event']);
      expect(result.thrown.aborted).toEqual([false]);
      expect(result.after.journal).toEqual(['click', 'click', 'caught-event', 'click']);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D5b WITHOUT a handler the same update-phase throw escapes synchronously (the guard is the capture point)', async () => {
    const page = await openPage('noHandlerUpdate');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbNoHandlerUpdate;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        document.body.append(host);
        await tick();
        const mounted = window.__oeEbErrors.slice();
        host.seed = 4;
        await tick();
        const clean = { text: host.textContent, errors: window.__oeEbErrors.slice() };
        // The refresh runs synchronously inside the props commit, so the throw
        // surfaces out of the SETTER — the unchanged pre-`16b-EB` behaviour.
        let setterThrew = '';
        try {
          host.explode = true;
        } catch (error) {
          setterThrew = (error as Error).message;
        }
        return { mounted, clean, setterThrew, errors: window.__oeEbErrors.slice() };
      }, tags.get('noHandlerUpdate')!);
      // The mount and the clean commit write normally and report nothing...
      expect(result.mounted).toEqual([]);
      expect(result.clean.text).toBe('4');
      expect(result.clean.errors).toEqual([]);
      // ...and the throwing commit escapes out of the property setter, unchanged.
      expect(result.setterThrew).toBe('slot boom');
      expect(result.errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D5c WITHOUT a handler the same event throw escapes as uncaught dispatch', async () => {
    const page = await openPage('noHandlerEvent');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbNoHandlerEvent;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
        };
        host.seed = 1;
        document.body.append(host);
        await tick();
        const button = host.querySelector('button')!;
        button.click();
        await tick();
        const clean = window.__oeEbErrors.slice();
        host.explode = true;
        button.click();
        await tick();
        return { clean, thrown: window.__oeEbErrors.slice() };
      }, tags.get('noHandlerEvent')!);
      expect(result.clean).toEqual([]);
      expect(result.thrown).toContain('event boom');
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D7 a depth-1 retained child reports through the ENCLOSING element (the getter ordering case)', async () => {
    const page = await openPage('nested');
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeEbNested;
        const tick = window.__oeEbTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          explode: boolean;
          show: boolean;
        };
        document.body.append(host);
        await tick();
        const mounted = { text: host.textContent, journal: window.__oeEbJournal.slice() };
        host.seed = 3;
        await tick();
        const clean = { text: host.textContent, journal: window.__oeEbJournal.slice() };
        // The CHILD's tracked slot throws; the child's handler was registered
        // from `<Child>__setup`, i.e. AFTER the retaining site built the host
        // literal it reads its sink from.
        let setterThrew = '';
        try {
          host.explode = true;
        } catch (error) {
          setterThrew = (error as Error).message;
        }
        const thrown = {
          text: host.textContent,
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
          aborted: window.__oeEbAborted.slice(),
        };
        host.explode = false;
        host.seed = 8;
        await tick();
        return {
          mounted,
          clean,
          thrown,
          setterThrew,
          recovered: { text: host.textContent, errors: window.__oeEbErrors.slice() },
        };
      }, tags.get('nested')!);
      expect(result.mounted.text).toBe('0');
      // The child's throwing commit was reported, never thrown at the page.
      expect(result.setterThrew).toBe('');
      expect(result.thrown.errors).toEqual([]);
      expect(result.thrown.journal).toEqual(['caught-child']);
      // The update-phase scope is the instance's, so it is live.
      expect(result.thrown.aborted).toEqual([false]);
      // The child's subscription keeps working through the enclosing element.
      expect(result.recovered.text).toBe('8');
      expect(result.recovered.errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D6 the SSR producer invokes no handler and never swallows a producer throw', async () => {
    const page = await openPage('update');
    try {
      const result = await page.evaluate(() => {
        const mod = window.__oeEbUpdate;
        const ssr = mod.UpdateBoundary__ssr as (props: unknown, host: unknown) => string;
        const clean = ssr({ seed: 7, explode: false }, undefined);
        let thrownMessage = '';
        let didThrow = false;
        try {
          ssr({ seed: 7, explode: true }, undefined);
        } catch (error) {
          didThrow = true;
          thrownMessage = (error as Error).message;
        }
        return {
          clean,
          didThrow,
          thrownMessage,
          journal: window.__oeEbJournal.slice(),
          errors: window.__oeEbErrors.slice(),
        };
      });
      expect(result.clean).toContain('<span');
      expect(result.clean).toContain('7');
      // The handler is CLIENT-owned: the server render never runs it.
      expect(result.journal).toEqual([]);
      // A producer throw is NOT swallowed: the render fails, as before.
      expect(result.didThrow).toBe(true);
      expect(result.thrownMessage).toBe('slot boom');
      expect(result.journal).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('D8 render-level fallback keeps the existing DOM when the generated parent claims', async () => {
    const server = await openPage('fallback');
    const rendered = await (async () => {
      try {
        await server.addScriptTag({ path: bundles.get('update')! });
        await server.addScriptTag({ path: bundles.get('connect')! });
        return await server.evaluate(() => {
          const { renderToString, GeneratedElement, __oeElementTag } = window.__oeEbFallback;
          const failing = window.__oeEbUpdate;
          const healthy = window.__oeEbConnect;
          customElements.define(failing.__oeElementTag, failing.GeneratedElement);
          customElements.define(healthy.__oeElementTag, healthy.GeneratedElement);

          const options = {
            componentClass: GeneratedElement,
            props: { seed: 3 },
            ssrRenderableTags: [failing.__oeElementTag, healthy.__oeElementTag],
          };
          const errors: string[] = [];
          const html = renderToString(__oeElementTag, {
            ...options,
            onNestedFailure: (error) => errors.push((error as Error).message),
          });
          const unexpanded = renderToString(__oeElementTag, {
            ...options,
            ssrRenderableTags: [healthy.__oeElementTag],
          });
          let unhandled = '';
          try {
            renderToString(__oeElementTag, options);
          } catch (error) {
            unhandled = (error as Error).message;
          }
          return { html, unexpanded, errors, unhandled, journal: window.__oeEbJournal };
        });
      } finally {
        await server.close();
      }
    })();

    expect(rendered.errors).toEqual(['slot boom']);
    expect(rendered.unhandled).toBe('slot boom');
    expect(rendered.journal).toEqual([]);
    expect(rendered.html).toBe(rendered.unexpanded);
    expect(rendered.html).toContain('<strong>fallback</strong>');
    expect(rendered.html).toMatch(/<error-boundary-connect[^>]*data-oe-light[^>]*><button/);

    const page = await openPage('fallback', rendered.html);
    try {
      const result = await page.evaluate(() => {
        const { GeneratedElement, __oeElementTag } = window.__oeEbFallback;
        const host = document.querySelector(__oeElementTag) as HTMLElement & { seed: number };
        const region = host.firstElementChild!;
        const fallback = host.querySelector('error-boundary-update');
        const fallbackContent = fallback?.firstElementChild;
        const sibling = host.querySelector('error-boundary-connect');
        const siblingContent = sibling?.firstElementChild;
        const output = host.querySelector('output')!;
        const observer = new MutationObserver(() => {});
        observer.observe(host, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });

        customElements.define(__oeElementTag, GeneratedElement);
        const claimed = {
          upgraded: host instanceof GeneratedElement,
          mutations: observer.takeRecords().length,
          seed: output.textContent,
          sameHost: document.querySelector(__oeElementTag) === host,
          sameRegion: host.firstElementChild === region,
          sameFallback:
            fallback !== null &&
            fallbackContent?.textContent === 'fallback' &&
            host.querySelector('error-boundary-update') === fallback &&
            fallback.firstElementChild === fallbackContent,
          sameSibling:
            sibling !== null &&
            siblingContent?.tagName === 'BUTTON' &&
            host.querySelector('error-boundary-connect') === sibling &&
            sibling.firstElementChild === siblingContent,
        };
        observer.disconnect();

        host.seed = 9;
        return {
          claimed,
          updated: output.textContent,
          sameOutput: host.querySelector('output') === output,
          errors: window.__oeEbErrors,
          journal: window.__oeEbJournal,
        };
      });
      expect(result).toEqual({
        claimed: {
          upgraded: true,
          mutations: 0,
          seed: '3',
          sameHost: true,
          sameRegion: true,
          sameFallback: true,
          sameSibling: true,
        },
        updated: '9',
        sameOutput: true,
        errors: [],
        journal: [],
      });
    } finally {
      await page.close();
    }
  }, 120_000);
});
