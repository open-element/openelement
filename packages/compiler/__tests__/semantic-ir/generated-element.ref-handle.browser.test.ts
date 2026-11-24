/**
 * `16b-REF` author-facing node handle — REAL Chromium lifetime evidence.
 *
 * The compiler half is `generated-element.ref-handle.test.ts`. This suite is
 * the runtime half: a real generated element module for an admitted island root
 * is bundled with the real recipe/`LifetimeScope` runtime and the real
 * generated-element shell, registered as a Custom Element in Chromium, and
 * exercised through the platform connection lifecycle.
 *
 * The acceptance the execution plan names — "ref lifetime across
 * mount/claim/update/disconnect" — is asserted as four separate facts:
 *
 * - MOUNT populates (`current` is the created node, the notification ran, the
 *   handle is the SAME object the retained factory built);
 * - CLAIM populates on an SSR-shaped host (the server's `__ssrHost` bytes are
 *   parsed into DSD, the component adopts them; `current` is the ADOPTED node,
 *   not a freshly created one — asserted by node identity against the parsed
 *   DOM);
 * - DISCONNECT clears (`current` is `null` and the author cleanup ran exactly
 *   once for that detach);
 * - RECONNECT repopulates the SAME handle object with the same
 *   (retained-DOM) node, and the cleanup did not run a second time for the
 *   reconnect itself.
 *
 * Plus the ordering rule the plain `ref` channel already had: the author
 * cleanup runs BEFORE the handle is cleared, so a cleanup observing
 * `current` still sees the node; and the cleanup runs exactly once per detach
 * even when it throws (the existing first-error rule).
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
 * Shadow root, deliberately: a shadow descriptor emits the `<Name>__ssrHost`
 * DSD producer, which is the ONLY way F2/F4 can exercise a real SSR-shaped host
 * (a light root's producer is the parameterless `<Name>__ssr` content string,
 * consumed by the light serializer — a different slice's carrier).
 */
function sidecar(properties: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    'export const openElement = defineIslandConfig({\n' +
    "  root: 'shadow',\n" +
    `  properties: { ${properties} },\n` +
    '});\n'
  );
}

const SIDECAR = sidecar('seed: { default: 0 }');

/**
 * The main fixture: a handle with a notification that journals every attach and
 * detach, plus a retained setup local so the handle demonstrably rides the
 * retained record. `probe()` is the ONLY way the test reads the handle: the
 * notification stores the handle object itself on `globalThis`, so a rebuilt
 * handle is detectable by identity.
 */
const REF_SOURCE =
  SIDECAR +
  "import { ref } from '@openelement/element';\n" +
  'function RefCard(props: { seed: number }) {\n' +
  '  const field = ref<HTMLElement>((element) => {\n' +
  '    // The notification closes over the handle it belongs to, which is the\n' +
  '    // documented shape: it is erased into the same factory, so `field` is the\n' +
  '    // retained handle. Publishing it here is what makes a REBUILT handle\n' +
  '    // detectable by object identity across connections.\n' +
  '    globalThis.__oeRefHandle = field;\n' +
  '    globalThis.__oeRefHandles.push(field);\n' +
  '    globalThis.__oeRefJournal.push(element === null ? "detach" : "attach");\n' +
  '    globalThis.__oeRefTargets.push(element);\n' +
  '    // Ordering: the cleanup must observe the node, so it records what it\n' +
  '    // sees rather than assuming it.\n' +
  '    return () => {\n' +
  '      globalThis.__oeRefCleanupSawNode.push(field.current !== null);\n' +
  '    };\n' +
  '  });\n' +
  '  return <input id="field" ref={field} />;\n' +
  '}\n' +
  'export default RefCard;\n';

/**
 * A second fixture whose cleanup THROWS. The existing ref channel runs the
 * cleanup inside `try { … } finally { handler(null) }`, so a throwing cleanup
 * must not skip the detach notification and must not leave `current` set.
 */
const THROWING_CLEANUP_SOURCE =
  SIDECAR +
  "import { ref } from '@openelement/element';\n" +
  'function ThrowingCard(props: { seed: number }) {\n' +
  '  const field = ref<HTMLElement>((element) => {\n' +
  '    globalThis.__oeRefHandle = field;\n' +
  '    globalThis.__oeRefThrowAttach = (globalThis.__oeRefThrowAttach ?? 0) + 1;\n' +
  '    return () => {\n' +
  '      globalThis.__oeRefThrowCount = (globalThis.__oeRefThrowCount ?? 0) + 1;\n' +
  '      throw new Error("cleanup boom");\n' +
  '    };\n' +
  '  });\n' +
  '  return <input id="field" ref={field} />;\n' +
  '}\n' +
  'export default ThrowingCard;\n';

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  __oeElementTag: string;
  RefCard__ssrHost?: (props: unknown, lightChildren?: string) => string;
  ThrowingCard__ssrHost?: (props: unknown, lightChildren?: string) => string;
}

declare global {
  interface Window {
    __oeRef: PageRuntime;
    __oeRefThrow: PageRuntime;
    __oeTick: () => Promise<void>;
    __oeRefJournal: string[];
    __oeRefTargets: Array<HTMLElement | null>;
    __oeRefHandles: Array<unknown>;
    __oeRefHandle: unknown;
    __oeRefCleanupSawNode: boolean[];
    __oeRefThrowCount: number;
  }
}

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
  window.__oeRefJournal = [];
  window.__oeRefTargets = [];
  window.__oeRefHandles = [];
  window.__oeRefHandle = null;
  window.__oeRefCleanupSawNode = [];
  window.__oeRefThrowCount = 0;
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
  const ssrExport = new RegExp(`export function (${component}__ssrHost)\\(`).exec(islandModule);
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

let browser: Browser;
let tempDir = '';
let mainBundle = '';
let mainTag = '';
let throwBundle = '';
let throwTag = '';

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-16b-ref-'));
  const main = compileIsland('ref-lifetime', REF_SOURCE);
  mainTag = main.tag;
  // The erasure invariant, asserted on the real module before it is bundled:
  // the emitted text carries the handle construction and no intrinsic call.
  expect(main.code).toContain('fn.current = element;');
  expect(main.code).not.toMatch(/from\s+"@openelement\/element"/);
  mainBundle = await buildBundle(tempDir, main.code, 'main', '__oeRef', main.component);

  const throwing = compileIsland('ref-throwing-cleanup', THROWING_CLEANUP_SOURCE);
  throwTag = throwing.tag;
  throwBundle = await buildBundle(
    tempDir,
    throwing.code,
    'throwing',
    '__oeRefThrow',
    throwing.component,
  );

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

describe('16b-REF node handle lifetime (Chromium)', () => {
  test('F1 mount populates; disconnect clears; reconnect repopulates the SAME handle', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRef;
        const tick = window.__oeTick;
        window.__oeRefJournal = [];
        window.__oeRefTargets = [];
        window.__oeRefHandles = [];
        window.__oeRefHandle = null;
        window.__oeRefCleanupSawNode = [];
        customElements.define(tagName, mod.GeneratedElement);

        // ── MOUNT (CSR: the element creates its own node) ──────────────────
        const host = document.createElement(tagName);
        document.body.append(host);
        await tick();
        const mountedNode = host.shadowRoot!.querySelector('#field') as HTMLElement;
        const mounted = {
          journal: [...window.__oeRefJournal],
          currentIsNode:
            window.__oeRefHandle !== null && window.__oeRefHandle.current === mountedNode,
          attachCount: window.__oeRefJournal.length,
        };

        // ── DISCONNECT ─────────────────────────────────────────────────────
        host.remove();
        await tick();
        const disconnected = {
          journal: [...window.__oeRefJournal],
          currentIsNull: window.__oeRefHandle !== null && window.__oeRefHandle.current === null,
          cleanupSawNode: [...window.__oeRefCleanupSawNode],
        };

        // ── RECONNECT (the retained DOM is claimed again) ───────────────────
        document.body.append(host);
        await tick();
        const reclaimedNode = host.shadowRoot!.querySelector('#field') as HTMLElement;
        const reconnected = {
          journal: [...window.__oeRefJournal],
          currentIsNode:
            window.__oeRefHandle !== null && window.__oeRefHandle.current === reclaimedNode,
          sameNodeReclaimed: reclaimedNode === mountedNode,
          cleanupSawNode: [...window.__oeRefCleanupSawNode],
        };

        // ── IDENTITY: every notification saw the SAME handle object ─────────
        const first = window.__oeRefHandles[0];
        const identityStable = window.__oeRefHandles.every((handle) => handle === first);

        // ── DISPOSE: the disconnect cleanup ran once more, never twice ──────
        (host as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
        await tick();
        const disposed = {
          journal: [...window.__oeRefJournal],
          currentIsNull: window.__oeRefHandle !== null && window.__oeRefHandle.current === null,
        };

        return { mounted, disconnected, reconnected, identityStable, disposed };
      }, mainTag);

      // Attach populates `current` with the CREATED node.
      expect(result.mounted).toEqual({
        journal: ['attach'],
        currentIsNode: true,
        attachCount: 1,
      });
      // Disconnect clears it, and the author cleanup ran ONCE for that detach —
      // and it observed the node still populated (cleanup-before-clear order).
      expect(result.disconnected).toEqual({
        journal: ['attach', 'detach'],
        currentIsNull: true,
        cleanupSawNode: [true],
      });
      // Reconnect repopulates the SAME handle object with the SAME retained node.
      expect(result.reconnected).toEqual({
        journal: ['attach', 'detach', 'attach'],
        currentIsNode: true,
        sameNodeReclaimed: true,
        cleanupSawNode: [true],
      });
      // The handle object is the retained one, not a per-connect rebuild.
      expect(result.identityStable).toBe(true);
      // Dispose is one more detach: cleanup ran exactly twice in total (once
      // per detach), and `current` is cleared.
      expect(result.disposed).toEqual({
        journal: ['attach', 'detach', 'attach', 'detach'],
        currentIsNull: true,
      });
    } finally {
      await page.close();
    }
  });

  test('F2 claim populates on an SSR-shaped host with the ADOPTED node', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRef;
        const tick = window.__oeTick;
        window.__oeRefJournal = [];
        window.__oeRefTargets = [];
        window.__oeRefHandles = [];
        window.__oeRefHandle = null;
        window.__oeRefCleanupSawNode = [];
        customElements.define(tagName, mod.GeneratedElement);

        // The SSR producer emits the light-root host bytes; parsing them creates
        // the DOM the client will ADOPT (never create).
        const ssrHost = mod.RefCard__ssrHost;
        if (ssrHost === undefined) throw new Error('the fixture emitted no SSR host producer');
        const hostHtml = ssrHost({ seed: 0 });
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        // A shadow descriptor's DSD template is parsed into the root the host
        // already carries: those are the server's nodes, adopted not created.
        const serverNode = host.shadowRoot!.querySelector('#field') as HTMLElement;
        document.body.append(frame);
        await tick();

        const claimedNode = host.shadowRoot!.querySelector('#field') as HTMLElement;
        const claimed = {
          journal: [...window.__oeRefJournal],
          isTheServerNode: claimedNode === serverNode,
          currentIsServerNode:
            window.__oeRefHandle !== null && window.__oeRefHandle.current === serverNode,
        };

        // Sanity: the claim path installed the handle on the borrowed node, and
        // its detach clears exactly that reference.
        host.remove();
        await tick();
        const detached = {
          currentIsNull: window.__oeRefHandle !== null && window.__oeRefHandle.current === null,
          journal: [...window.__oeRefJournal],
        };
        return { hostHtml, claimed, detached };
      }, mainTag);

      expect(result.hostHtml).toContain('<template shadowrootmode="open">');
      // Claim: `current` is the server-rendered node the client adopted, so the
      // ref is populated on claim exactly as on mount.
      expect(result.claimed).toEqual({
        journal: ['attach'],
        isTheServerNode: true,
        currentIsServerNode: true,
      });
      expect(result.detached).toEqual({
        currentIsNull: true,
        journal: ['attach', 'detach'],
      });
    } finally {
      await page.close();
    }
  });

  test('F3 a throwing cleanup still clears the handle and runs once per detach', async () => {
    const page = await openPage(throwBundle);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeRefThrow;
        const tick = window.__oeTick;
        window.__oeRefThrowCount = 0;
        window.__oeRefHandle = null;
        const errors: string[] = [];
        const onError = (event: ErrorEvent): void => {
          errors.push(
            String((event.error as { message?: string } | null)?.message ?? event.message),
          );
        };
        window.addEventListener('error', onError);
        customElements.define(tagName, mod.GeneratedElement);
        const host = document.createElement(tagName);
        document.body.append(host);
        await tick();
        const attached = window.__oeRefHandle !== null && window.__oeRefHandle.current !== null;
        host.remove();
        await tick();
        window.removeEventListener('error', onError);
        return {
          attached,
          currentIsNull: window.__oeRefHandle !== null && window.__oeRefHandle.current === null,
          throwCount: window.__oeRefThrowCount,
          errors,
        };
      }, throwTag);
      expect(result.attached).toBe(true);
      // The `finally { handler(null) }` in the existing channel is what makes
      // this true: a throwing cleanup cannot leave a stale `current`.
      expect(result.currentIsNull).toBe(true);
      expect(result.throwCount).toBe(1);
      // The throw is platform dispatch after the scope cleanup completed; the
      // channel deliberately does not swallow it (the 16b-EB boundary is the
      // mechanism for reporting an author cleanup failure).
      expect(result.errors).toContain('cleanup boom');
    } finally {
      await page.close();
    }
  });

  test('F4 the SSR producer is client-only: it runs no notification and builds no handle', async () => {
    const page = await openPage(mainBundle);
    try {
      const result = await page.evaluate((tagName) => {
        const mod = window.__oeRef;
        window.__oeRefJournal = [];
        window.__oeRefHandles = [];
        window.__oeRefHandle = null;
        const ssrHost = mod.RefCard__ssrHost;
        if (ssrHost === undefined) throw new Error('the fixture emitted no SSR host producer');
        const html = ssrHost({ seed: 0 });
        return {
          html,
          journal: [...window.__oeRefJournal],
          handleBuilt: window.__oeRefHandle !== null,
          handleCount: window.__oeRefHandles.length,
          definesTag: mod.__oeElementTag === tagName,
        };
      }, mainTag);
      expect(result.html).toContain('<template shadowrootmode="open">');
      expect(result.html).toContain('id="field"');
      expect(result.journal).toEqual([]);
      expect(result.handleBuilt).toBe(false);
      expect(result.handleCount).toBe(0);
      expect(result.definesTag).toBe(true);
    } finally {
      await page.close();
    }
  });
});
