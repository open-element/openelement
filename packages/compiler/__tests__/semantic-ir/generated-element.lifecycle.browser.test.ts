/**
 * `16b-LC` author lifecycle intrinsics (owner-approved option 1a) — REAL
 * Chromium evidence.
 *
 * A real generated element module for an admitted island root is bundled with
 * the real recipe/LifetimeScope runtime and the real generated-element shell,
 * registered as a Custom Element in Chromium, and exercised through the
 * platform lifecycle. The authored callbacks only observe themselves through
 * `globalThis` (the function-component expression model admits ECMAScript
 * builtins, not `window`/`document`); no generated code is hand-written and the
 * shell/runtime are the shipped modules, not stubs.
 *
 * Asserted here:
 *
 * - `onConnect` runs on the INITIAL mount and again on EVERY reconnect claim,
 *   while the root setup still runs exactly once (retained instance record);
 *   its optional returned cleanup runs at every disconnection, never at setup;
 * - `onDispose` does NOT run on disconnect and runs exactly ONCE at explicit
 *   teardown, AFTER that connection's connect-cleanup (cleanup-first ordering
 *   preserved by the existing LifetimeScope cascade);
 * - a reconnect callback reads live props while the retained setup snapshot
 *   stays at its first-connect value (setup once, callback per connection);
 * - `dispose(false)` then reconnect is a NEW instance: setup runs again
 *   (dispose is not disconnect);
 * - the emitted SSR producer performs NO invocation: calling it returns HTML
 *   with every lifecycle counter untouched;
 * - a THROWING `onConnect` releases the cleanups already registered by earlier
 *   callbacks and rethrows into the shell's existing connect catch (the pass is
 *   aborted, the failed first connect mounts nothing); a THROWING cleanup never
 *   blocks the remaining cleanups (existing first-error rule) on both the
 *   connection and the disposal side.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not the M13 matrix, no
 * nested/hostless hook admission, no connection-scope helper channel, no
 * public API freeze.
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

const SIDECAR = sidecar('seed: { default: 0 }');

/**
 * Main fixture: a retained setup snapshot, TWO connect callbacks (the first one
 * returns a cleanup) and one dispose callback. Every callback records its own
 * invocation into `globalThis.__oeJournal`; the setup probe increments
 * `globalThis.__oeSetupRuns` (the SSR producer prunes it because the rendered
 * roots never read it).
 */
const LIFECYCLE_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  SIDECAR +
  'function LifeCard(props: { seed: number }) {\n' +
  '  const setupRuns = (globalThis.__oeSetupRuns = (globalThis.__oeSetupRuns ?? 0) + 1);\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('connect-1');\n" +
  '    globalThis.__oeSnapshotAtConnect = snapshot;\n' +
  '    globalThis.__oeLiveSeedAtConnect = props.seed;\n' +
  '    return () => { globalThis.__oeJournal.push("cleanup-1"); };\n' +
  '  });\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('connect-2');\n" +
  '  });\n' +
  '  onDispose(() => {\n' +
  "    globalThis.__oeJournal.push('dispose');\n" +
  '  });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default LifeCard;\n';

const NESTED_SIDECAR = sidecar('seed: { default: 0 }, showChild: { default: true }');

/**
 * Nested/hostless depth-1 fixture: a ROOT component retains a direct hostless
 * Child that declares both intrinsics. The Child's hooks are carried by its
 * own retained `<Child>__setup` record (no root hook, no dispatcher): connection
 * = the child projection's insertion, disposal = the retained owner's release
 * (structural removal or parent teardown).
 */
const NESTED_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  NESTED_SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const setupRuns = (globalThis.__oeNestedSetupRuns = (globalThis.__oeNestedSetupRuns ?? 0) + 1);\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('child-connect');\n" +
  '    globalThis.__oeNestedSnapshotAtConnect = snapshot;\n' +
  "    return () => { globalThis.__oeJournal.push('child-cleanup'); };\n" +
  '  });\n' +
  '  onDispose(() => {\n' +
  "    globalThis.__oeJournal.push('child-dispose');\n" +
  '  });\n' +
  '  return <em className="nested-child">{snapshot}</em>;\n' +
  '}\n' +
  'function NestedHost(props: { seed: number; showChild: boolean }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return (\n' +
  '    <span className="nested-root">\n' +
  '      <b>{rootSnapshot}</b>\n' +
  '      {props.showChild ? <Child seed={props.seed} /> : null}\n' +
  '    </span>\n' +
  '  );\n' +
  '}\n' +
  'export default NestedHost;\n';

/** Throwing nested connect: the child's FIRST callback registers a cleanup, the
 *  second throws; the parent's connect pass must release the child's entries and
 *  surface the original error (existing rollback, no new engine). */
const NESTED_THROW_SOURCE =
  `import { onConnect } from '@openelement/element';\n` +
  NESTED_SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('child-connect-1');\n" +
  "    return () => { globalThis.__oeJournal.push('child-cleanup-1'); };\n" +
  '  });\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('child-connect-2');\n" +
  "    throw new Error('nested onConnect boom');\n" +
  '  });\n' +
  '  return <em>{snapshot}</em>;\n' +
  '}\n' +
  'function NestedThrowHost(props: { seed: number; showChild: boolean }) {\n' +
  '  return <span>{props.showChild ? <Child seed={props.seed} /> : null}</span>;\n' +
  '}\n' +
  'export default NestedThrowHost;\n';

/**
 * SSR companion fixture: the SAME depth-1 child, but the root has no
 * conditional branch (the SSR serializer does not admit an unsupported
 * conditional shape, so the lifecycle fixture's root export is absent by
 * design). Calling this module's real root producer proves the nested child's
 * hooks never run on the server path.
 */
const NESTED_SSR_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  NESTED_SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const setupRuns = (globalThis.__oeNestedSetupRuns = (globalThis.__oeNestedSetupRuns ?? 0) + 1);\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('child-connect');\n" +
  '    globalThis.__oeNestedSnapshotAtConnect = snapshot;\n' +
  "    return () => { globalThis.__oeJournal.push('child-cleanup'); };\n" +
  '  });\n' +
  "  onDispose(() => { globalThis.__oeJournal.push('child-dispose'); });\n" +
  '  return <em>{snapshot}</em>;\n' +
  '}\n' +
  'function NestedSsrHost(props: { seed: number; showChild: boolean }) {\n' +
  '  return <span><Child seed={props.seed} /></span>;\n' +
  '}\n' +
  'export default NestedSsrHost;\n';

/**
 * Throw fixture: the first connect callback registers a cleanup, the second
 * throws. The existing shell connect catch must release the first cleanup and
 * abort the pass; the failed FIRST connect also runs the retained instance's
 * setup/disposal cleanups through the pre-existing rollback (the instance is
 * destroyed, not retained), which is recorded as observed rather than claimed as
 * a teardown.
 */
const CONNECT_THROW_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  SIDECAR +
  'function ThrowCard(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('connect-1');\n" +
  '    return () => { globalThis.__oeJournal.push("cleanup-1"); };\n' +
  '  });\n' +
  '  onConnect(() => {\n' +
  "    globalThis.__oeJournal.push('connect-2');\n" +
  "    throw new Error('onConnect boom');\n" +
  '  });\n' +
  '  onDispose(() => {\n' +
  "    globalThis.__oeJournal.push('dispose');\n" +
  '  });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default ThrowCard;\n';

/**
 * Connection-cleanup throw fixture: the second connection cleanup throws. On
 * disconnect the first-error rule must still run the remaining cleanup and
 * surface the first error through the platform handler.
 */
const CONNECTION_CLEANUP_THROW_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  SIDECAR +
  'function ConnCleanupCard(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {\n' +
  '    return () => { globalThis.__oeJournal.push("conn-cleanup-1"); };\n' +
  '  });\n' +
  '  onConnect(() => {\n' +
  '    return () => {\n' +
  '      globalThis.__oeJournal.push("conn-cleanup-2");\n' +
  "      throw new Error('connection cleanup boom');\n" +
  '    };\n' +
  '  });\n' +
  '  onDispose(() => { globalThis.__oeJournal.push("dispose"); });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default ConnCleanupCard;\n';

/**
 * Disposal-cleanup throw fixture: three onDispose callbacks, the middle one
 * throws. Disposal must attempt every remaining cleanup (LIFO), surface the
 * first error, and never suppress a later cleanup.
 */
const DISPOSE_CLEANUP_THROW_SOURCE =
  `import { onConnect, onDispose } from '@openelement/element';\n` +
  SIDECAR +
  'function DisposeCleanupCard(props: { seed: number }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  onConnect(() => {});\n' +
  '  onDispose(() => { globalThis.__oeJournal.push("dispose-1"); });\n' +
  '  onDispose(() => {\n' +
  "    globalThis.__oeJournal.push('dispose-2');\n" +
  "    throw new Error('dispose boom');\n" +
  '  });\n' +
  '  onDispose(() => { globalThis.__oeJournal.push("dispose-3"); });\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default DisposeCleanupCard;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  __oeElementTag: string;
  [name: string]: unknown;
}

declare global {
  interface Window {
    __oeLifecycle: PageRuntime;
    __oeMain: PageRuntime;
    __oeThrow: PageRuntime;
    __oeConnCleanup: PageRuntime;
    __oeDisposeCleanup: PageRuntime;
    __oeTick: () => Promise<void>;
    __oeErrors: string[];
    __oeJournal: string[];
    __oeSetupRuns: number | undefined;
    __oeSnapshotAtConnect: number | undefined;
    __oeLiveSeedAtConnect: number | undefined;
  }
}

let browser: Browser;
let nestedTag = '';
let nestedBundle = '';
let nestedThrowTag = '';
let nestedThrowBundle = '';
let nestedSsrBundle = '';
let nestedSsrTag = '';
let tempDir = '';
let mainBundle = '';
let throwBundle = '';
let connCleanupBundle = '';
let disposeCleanupBundle = '';
let mainTag = '';
let throwTag = '';
let connCleanupTag = '';
let disposeCleanupTag = '';

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeErrors = [];
  window.__oeJournal = [];
  window.addEventListener('error', (event) => {
    window.__oeErrors.push(event.error && event.error.message ? event.error.message : event.message);
  });
`;

/** The runtime shim the generated modules' one import specifier resolves to. */
function runtimeShimSource(): string {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  return [
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
  ].join('\n');
}

async function buildBundle(
  dir: string,
  islandModule: string,
  name: string,
  globalName: string,
  component: string,
): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const island = join(dir, `${name}-island.js`);
  const shim = join(dir, `${name}-runtime-shim.ts`);
  const entry = join(dir, `${name}-entry.ts`);
  writeFileSync(island, islandModule);
  writeFileSync(shim, runtimeShimSource());
  const ssrExport = new RegExp(`export function (${component}__ssr)\\(`).exec(islandModule);
  const entryLines = [
    `export { default as GeneratedElement } from './${name}-island.js';`,
    `export { __oeElementTag } from './${name}-island.js';`,
    ...(ssrExport === null ? [] : [`export { ${ssrExport[1]} } from './${name}-island.js';`]),
    '',
  ];
  writeFileSync(entry, entryLines.join('\n'));
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

async function openPage(bundle: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-lc-hooks-'));
  const main = compileIsland('lifecycle-hooks', LIFECYCLE_SOURCE);
  mainTag = main.tag;
  mainBundle = await buildBundle(tempDir, main.code, 'main', '__oeLifecycle', main.component);
  const thrown = compileIsland('lifecycle-connect-throw', CONNECT_THROW_SOURCE);
  throwTag = thrown.tag;
  throwBundle = await buildBundle(tempDir, thrown.code, 'throw', '__oeThrow', thrown.component);
  const connCleanup = compileIsland(
    'lifecycle-conn-cleanup-throw',
    CONNECTION_CLEANUP_THROW_SOURCE,
  );
  connCleanupTag = connCleanup.tag;
  connCleanupBundle = await buildBundle(
    tempDir,
    connCleanup.code,
    'conn-cleanup',
    '__oeConnCleanup',
    connCleanup.component,
  );
  const disposeCleanup = compileIsland(
    'lifecycle-dispose-cleanup-throw',
    DISPOSE_CLEANUP_THROW_SOURCE,
  );
  disposeCleanupTag = disposeCleanup.tag;
  disposeCleanupBundle = await buildBundle(
    tempDir,
    disposeCleanup.code,
    'dispose-cleanup',
    '__oeDisposeCleanup',
    disposeCleanup.component,
  );
  const nested = compileIsland('lifecycle-nested-browser', NESTED_SOURCE);
  nestedTag = nested.tag;
  nestedBundle = await buildBundle(tempDir, nested.code, 'nested', '__oeNested', nested.component);
  const nestedThrow = compileIsland('lifecycle-nested-throw-browser', NESTED_THROW_SOURCE);
  nestedThrowTag = nestedThrow.tag;
  nestedThrowBundle = await buildBundle(
    tempDir,
    nestedThrow.code,
    'nested-throw',
    '__oeNestedThrow',
    nestedThrow.component,
  );
  const nestedSsr = compileIsland('lifecycle-nested-ssr-browser', NESTED_SSR_SOURCE);
  nestedSsrTag = nestedSsr.tag;
  nestedSsrBundle = await buildBundle(
    tempDir,
    nestedSsr.code,
    'nested-ssr',
    '__oeNestedSsr',
    nestedSsr.component,
  );
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('16b-LC lifecycle hooks (Chromium)', () => {
  test('C1 onConnect runs per connection, its cleanup at disconnect, setup once; onDispose only at teardown', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeLifecycle;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        document.body.append(host);
        await tick();
        const mountedNode = host.firstChild;
        const mounted = {
          text: host.textContent,
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
          snapshotAtConnect: window.__oeSnapshotAtConnect,
          liveSeedAtConnect: window.__oeLiveSeedAtConnect,
        };
        host.remove();
        await tick();
        const disconnected = {
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
        };
        host.seed = 3;
        document.body.append(host);
        await tick();
        const reconnected = {
          text: host.textContent,
          sameNode: host.firstChild === mountedNode,
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
          snapshotAtConnect: window.__oeSnapshotAtConnect,
          liveSeedAtConnect: window.__oeLiveSeedAtConnect,
        };
        host.dispose(true);
        const afterDispose = {
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
        };
        host.dispose(true);
        const afterSecondDispose = { journal: window.__oeJournal.slice() };
        host.remove();
        await tick();
        document.body.append(host);
        await tick();
        const afterReconnectPostTeardown = {
          text: host.textContent,
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
        };
        const errors = window.__oeErrors.slice();
        return {
          mounted,
          disconnected,
          reconnected,
          afterDispose,
          afterSecondDispose,
          afterReconnectPostTeardown,
          errors,
        };
      }, mainTag);
      // Initial mount is a connection: BOTH callbacks ran, setup ran once.
      expect(result.mounted.text).toBe('1');
      expect(result.mounted.journal).toEqual(['connect-1', 'connect-2']);
      expect(result.mounted.setupRuns).toBe(1);
      expect(result.mounted.snapshotAtConnect).toBe(1);
      expect(result.mounted.liveSeedAtConnect).toBe(1);
      // Disconnect: the returned cleanup ran, onDispose did NOT, setup retained.
      expect(result.disconnected.journal).toEqual(['connect-1', 'connect-2', 'cleanup-1']);
      expect(result.disconnected.setupRuns).toBe(1);
      // Reconnect claims the retained DOM: callbacks re-run, setup does NOT, the
      // snapshot stays at first connect while live props reads see the new value.
      expect(result.reconnected.text).toBe('1');
      expect(result.reconnected.sameNode).toBe(true);
      expect(result.reconnected.journal).toEqual([
        'connect-1',
        'connect-2',
        'cleanup-1',
        'connect-1',
        'connect-2',
      ]);
      expect(result.reconnected.setupRuns).toBe(1);
      expect(result.reconnected.snapshotAtConnect).toBe(1);
      expect(result.reconnected.liveSeedAtConnect).toBe(3);
      // Explicit teardown: that connection's cleanup first, then onDispose, once.
      expect(result.afterDispose.journal).toEqual([
        'connect-1',
        'connect-2',
        'cleanup-1',
        'connect-1',
        'connect-2',
        'cleanup-1',
        'dispose',
      ]);
      // A second dispose is a one-shot no-op (never a second onDispose run).
      expect(result.afterSecondDispose.journal).toEqual(result.afterDispose.journal);
      // dispose is not disconnect: the next connect is a NEW instance, so setup
      // runs again and the live prop is snapshotted fresh.
      expect(result.afterReconnectPostTeardown.setupRuns).toBe(2);
      expect(result.afterReconnectPostTeardown.text).toBe('3');
      expect(result.errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('C2 a throwing onConnect releases the earlier cleanup and aborts the pass', async () => {
    const page = await openPage(throwBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeThrow;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & { seed: number };
        host.seed = 1;
        document.body.append(host);
        await tick();
        return {
          journal: window.__oeJournal.slice(),
          mountedChildCount: host.childNodes.length,
          errors: window.__oeErrors.slice(),
        };
      }, throwTag);
      // The first callback ran and registered a cleanup; the second threw. The
      // shell's existing connect catch released the registered cleanup, then
      // aborted the pass: nothing was mounted.
      expect(result.journal).toEqual(['connect-1', 'connect-2', 'cleanup-1', 'dispose']);
      expect(result.mountedChildCount).toBe(0);
      expect(result.errors.some((message) => message.includes('onConnect boom'))).toBe(true);
    } finally {
      await page.close();
    }
  }, 120_000);

  test('C3a a throwing connection cleanup does not block the remaining connection cleanup', async () => {
    const page = await openPage(connCleanupBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeConnCleanup;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        document.body.append(host);
        await tick();
        host.remove();
        await tick();
        const afterDisconnect = {
          journal: window.__oeJournal.slice(),
          errors: window.__oeErrors.slice(),
        };
        document.body.append(host);
        await tick();
        let disposeError = '';
        try {
          host.dispose(true);
        } catch (error) {
          disposeError = String((error as Error).message);
        }
        return {
          afterDisconnect,
          afterDispose: { journal: window.__oeJournal.slice(), disposeError },
        };
      }, connCleanupTag);
      // LIFO: the throwing second cleanup runs first, then the first cleanup
      // still runs; the first error surfaces to the platform handler.
      expect(result.afterDisconnect.journal).toEqual(['conn-cleanup-2', 'conn-cleanup-1']);
      expect(
        result.afterDisconnect.errors.some((message) =>
          message.includes('connection cleanup boom'),
        ),
      ).toBe(true);
      // Teardown of the reconnected connection: the same two cleanups run again
      // (LIFO) before the instance-lifetime disposal; the connection error is
      // still what surfaces first (the existing first-error rule).
      expect(result.afterDispose.journal).toEqual([
        'conn-cleanup-2',
        'conn-cleanup-1',
        'conn-cleanup-2',
        'conn-cleanup-1',
        'dispose',
      ]);
      expect(result.afterDispose.disposeError).toContain('connection cleanup boom');
    } finally {
      await page.close();
    }
  }, 120_000);

  test('C3b a throwing onDispose cleanup never blocks the remaining disposal cleanups', async () => {
    const page = await openPage(disposeCleanupBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeDisposeCleanup;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        document.body.append(host);
        await tick();
        let disposeError = '';
        try {
          host.dispose(true);
        } catch (error) {
          disposeError = String((error as Error).message);
        }
        return { journal: window.__oeJournal.slice(), disposeError };
      }, disposeCleanupTag);
      // LIFO: dispose-3, then the throwing dispose-2, then dispose-1 — every
      // cleanup attempted, the first error surfaces from dispose() itself.
      expect(result.journal).toEqual(['dispose-3', 'dispose-2', 'dispose-1']);
      expect(result.disposeError).toContain('dispose boom');
    } finally {
      await page.close();
    }
  }, 120_000);

  test('C4 the emitted SSR producer performs no lifecycle invocation', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(() => {
        const mod = window.__oeLifecycle;
        const ssr = mod.LifeCard__ssr as (props: unknown, host: unknown) => string;
        const html = ssr({ seed: 7 }, undefined);
        return {
          html,
          journal: window.__oeJournal.slice(),
          setupRuns: window.__oeSetupRuns,
          snapshotAtConnect: window.__oeSnapshotAtConnect,
        };
      });
      expect(typeof result.html).toBe('string');
      expect(result.html).toContain('<span');
      expect(result.html).toContain('7');
      // Never invoked on the server producer: no callback, no onDispose, no
      // setup side effect (the probe local is pruned from the SSR chunk).
      expect(result.journal).toEqual([]);
      expect(result.setupRuns).toBeUndefined();
      expect(result.snapshotAtConnect).toBeUndefined();
    } finally {
      await page.close();
    }
  }, 120_000);

  test('C5 a depth-1 nested hostless child connects per insertion, cleans at disconnect, setup once; SSR invokes nothing', async () => {
    // SSR first, on the unconditional fixture whose real root producer is
    // emitted: no child hook runs on the server path.
    const ssrPage = await openPage(nestedSsrBundle);
    try {
      const ssr = await ssrPage.evaluate(() => {
        const mod = window.__oeNestedSsr;
        const html = mod.NestedSsrHost__ssr({ seed: 1, showChild: true });
        return { html, journal: [...window.__oeJournal] };
      });
      expect(ssr.journal).toEqual([]);
      expect(ssr.html).toContain('<em>');
      expect(ssr.html).toContain('1<!--oe:/t:0-->');
    } finally {
      await ssrPage.close();
    }
    const page = await openPage(nestedSsrBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNestedSsr;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          showChild: boolean;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        host.showChild = true;
        document.body.append(host);
        await tick();
        const afterFirstConnect = [...window.__oeJournal];
        const setupRunsAfterFirst = window.__oeNestedSetupRuns;
        const snapshotAtConnect = window.__oeNestedSnapshotAtConnect;
        host.remove();
        await tick();
        const afterDisconnect = [...window.__oeJournal];
        const setupRunsAfterDisconnect = window.__oeNestedSetupRuns;
        document.body.append(host);
        await tick();
        const afterReconnect = [...window.__oeJournal];
        const setupRunsAfterReconnect = window.__oeNestedSetupRuns;
        host.dispose(true);
        await tick();
        return {
          afterFirstConnect,
          setupRunsAfterFirst,
          snapshotAtConnect,
          afterDisconnect,
          setupRunsAfterDisconnect,
          afterReconnect,
          setupRunsAfterReconnect,
          afterTeardown: [...window.__oeJournal],
          errors: window.__oeErrors,
        };
      }, nestedSsrTag);
      expect(result.errors).toEqual([]);
      expect(result.afterFirstConnect).toEqual(['child-connect']);
      expect(result.setupRunsAfterFirst).toBe(1);
      expect(result.snapshotAtConnect).toBe(1);
      expect(result.afterDisconnect).toEqual(['child-connect', 'child-cleanup']);
      expect(result.setupRunsAfterDisconnect).toBe(1);
      expect(result.afterReconnect).toEqual(['child-connect', 'child-cleanup', 'child-connect']);
      expect(result.setupRunsAfterReconnect).toBe(1);
      expect(result.afterTeardown).toEqual([
        'child-connect',
        'child-cleanup',
        'child-connect',
        'child-cleanup',
        'child-dispose',
      ]);
    } finally {
      await page.close();
    }
  });

  test('C5b structural removal disposes the retained depth-1 child exactly once', async () => {
    const page = await openPage(nestedBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNested;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          showChild: boolean;
          dispose: (detach?: boolean) => void;
        };
        host.seed = 1;
        host.showChild = true;
        document.body.append(host);
        await tick();
        const afterConnect = [...window.__oeJournal];
        const setupRunsAfterConnect = window.__oeNestedSetupRuns;
        // Structural removal of the retained child (condition flips): the
        // ledger releases the retained instance; its connection cleanup runs
        // first, then its onDispose exactly once.
        host.showChild = false;
        await tick();
        const afterStructuralRemoval = [...window.__oeJournal];
        host.dispose(true);
        await tick();
        return {
          afterConnect,
          setupRunsAfterConnect,
          afterStructuralRemoval,
          afterTeardown: [...window.__oeJournal],
          errors: window.__oeErrors,
        };
      }, nestedTag);
      expect(result.errors).toEqual([]);
      expect(result.afterConnect).toEqual(['child-connect']);
      expect(result.setupRunsAfterConnect).toBe(1);
      expect(result.afterStructuralRemoval).toEqual([
        'child-connect',
        'child-cleanup',
        'child-dispose',
      ]);
      // Parent teardown after the child was already released adds no duplicate
      // child disposal (except-once contract).
      expect(result.afterTeardown).toEqual(result.afterStructuralRemoval);
    } finally {
      await page.close();
    }
  });

  test('C6 a throwing nested child connect releases earlier cleanups and surfaces the original error', async () => {
    const page = await openPage(nestedThrowBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeNestedThrow;
        const tick = window.__oeTick;
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName) as HTMLElement & {
          seed: number;
          showChild: boolean;
        };
        host.seed = 1;
        host.showChild = true;
        document.body.append(host);
        await tick();
        return {
          journal: [...window.__oeJournal],
          errors: [...window.__oeErrors],
          connected: host.isConnected,
        };
      }, nestedThrowTag);
      // First child callback registered a cleanup, second threw: the shell's
      // connect catch released it and the original error surfaced.
      expect(result.errors.join('\n')).toContain('nested onConnect boom');
      expect(result.journal).toEqual(['child-connect-1', 'child-connect-2', 'child-cleanup-1']);
    } finally {
      await page.close();
    }
  });
});
