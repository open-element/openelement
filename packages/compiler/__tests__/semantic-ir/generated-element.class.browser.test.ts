/**
 * M09-1a — generated native element class evidence (LOCAL, Chromium).
 *
 * The emitted module is the real lane output: a real `compileFunctionModule`
 * + `generateLeafModule` prefix with the appended CE tail. It is bundled by a
 * real Vite build with the real runtime shim and the real M09-0/M09-shadow
 * shell, then registered from the page exactly as the island entry would do
 * (`customElements.define(tag, mod.default)`).
 *
 * Asserted facts:
 *
 * - the emitted and pre-tree-shake module graphs reach the shell and root but
 *   never the old Part Program backend;
 * - a parser-created host upgrades after define, mounts once, and the
 *   constructor reads zero attributes;
 * - a server-produced `<Profile>__ssr()` string is claimed in place with zero
 *   claim-period mutations and preserved node identity;
 * - an open DSD template produced by the canonical `serializeShadowTemplate`
 *   is adopted without `attachShadow`, claimed in place, and the shadow content
 *   keeps node identity;
 * - disconnect keeps the DOM and releases the owner; reconnect claims it with
 *   the same node identity and no duplicate mount; `dispose(true)` removes only
 *   the owned range;
 * - a hostless module's bundle never reaches the shell (the negative proof
 *   that hostless function components are not wrapped);
 * - registration stays caller-driven: loading the bundle defines nothing.
 *
 * One Chromium engine, LOCAL evidence. Not M09 exit, not M09-1b registration or
 * packaging, not properties/events/forms/styles, and not a browser matrix.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';
import { serializeShadowTemplate } from '../../../element/src/internal/compiled/dsd.ts';
import { REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/islands/profile.tsx';
const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'light' });\n";
const SOURCE = `${SIDECAR}
function Profile() {
  return <p id="profile">hello</p>;
}
export default Profile;
`;

/**
 * The same root component with a shadow sidecar. D-root-source (2026-11-13)
 * moved the root out of the host site fact and into the authored sidecar, so
 * the shadow evidence declares it where an author would: `root: 'shadow'`
 * (the DSD default) maps to the descriptor's `shadow-open`.
 */
const SHADOW_SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'shadow' });\n";
const SHADOW_SOURCE = `${SHADOW_SIDECAR}
function Profile() {
  return <p id="profile">hello</p>;
}
export default Profile;
`;

/**
 * The old Part Program backend plus the server-only serializer leaves. The
 * generated bundle may share the neutral recipe/value primitives, but it must
 * never acquire these modules. `internal/compiled/dsd.ts` is deliberately NOT
 * in this list: since M09-2a the generated element's internal entry re-exports
 * the browser-safe DSD producer (`generated-element/dsd-ssr.ts`), so `dsd.ts`
 * is in the light module's PARSE graph. The rendered graph — what ships — is
 * asserted separately below and must not contain it.
 */
const FORBIDDEN_MODULE_SUFFIXES = [
  '/internal/compiled/facade-host.ts',
  '/internal/compiled/runtime-program.ts',
  '/internal/compiled/runtime.ts',
  '/internal/compiled/runtime/kernel.ts',
  '/internal/compiled/runtime/program-kernel.ts',
  '/internal/compiled/runtime/parts.ts',
  '/internal/compiled/runtime/hydrate.ts',
  '/internal/compiled/runtime/fresh-dom.ts',
  '/internal/compiled/runtime/props.ts',
  '/internal/compiled/runtime/blocks.ts',
  '/internal/compiled/runtime/revive.ts',
  '/internal/compiled/runtime/error-boundary.ts',
  '/internal/compiled/runtime/pre-upgrade-events.ts',
  '/internal/compiled/runtime/hydrate-recovery.ts',
  '/internal/compiled/runtime/blocks-seam.ts',
  '/internal/compiled/runtime/hydrate-seam.ts',
  '/internal/compiled/server/index.ts',
  '/internal/compiled/server/shared.ts',
  '/internal/compiled/serializer/serialize-program.ts',
] as const;

interface BundleResult {
  readonly file: string;
  readonly moduleIds: readonly string[];
  readonly parsedModuleIds: readonly string[];
}

let browser: Browser;
let tempDir = '';

async function buildBundle(
  module: string,
  name: string,
  exports: readonly string[],
): Promise<BundleResult> {
  const dir = join(tempDir, name);
  mkdirSync(dir, { recursive: true });
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leaf = join(dir, 'leaf.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leaf, module);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export const { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } = claimInvariants;`,
      `export const assertTextSlotMarker = claimInvariants.assertTextSlotMarker;`,
      `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export const { emitComment, MARKERS, markerText, rangeMarker } = markers;`,
      `export const textSlotMarker = markers.textSlotMarker;`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(entry, exports.map((line) => `${line}\n`).join(''));
  const parsedModuleIds = new Set<string>();
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
    plugins: [
      {
        name: 'oe-m09-1a-module-graph',
        moduleParsed(info) {
          parsedModuleIds.add(info.id);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: '__oeM09',
        fileName: () => 'generated-element.js',
      },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('generated-element bundle produced no chunk');
  if (chunk.moduleIds === undefined || chunk.moduleIds.length === 0) {
    throw new Error('generated-element bundle carried no Vite output module IDs');
  }
  const file = join(dir, 'generated-element.js');
  writeFileSync(file, chunk.code);
  return {
    file,
    moduleIds: chunk.moduleIds.map((id) => id.replaceAll('\\', '/')),
    parsedModuleIds: [...parsedModuleIds].map((id) => id.replaceAll('\\', '/')),
  };
}

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

async function openPage(bundle: BundleResult): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ path: bundle.file });
  return page;
}

let lightBundle: BundleResult;
let shadowBundle: BundleResult;
let hostlessBundle: BundleResult;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-1a-'));
  const module = frontModule(SOURCE);
  const light = compileGeneratedElementIfAdmitted(SOURCE, FILE, {
    site: { tag: 'x-profile' },
  });
  const shadow = compileGeneratedElementIfAdmitted(SHADOW_SOURCE, FILE, {
    site: { tag: 'x-shadow-profile' },
  });
  expect(light).not.toBeNull();
  expect(shadow).not.toBeNull();
  const hostless = generateElementModule(module, null);
  expect(hostless.module).not.toBeNull();
  lightBundle = await buildBundle(light!.code, 'light', [
    "export { default as GeneratedElement } from './leaf.js';",
    "export { Profile__ssr } from './leaf.js';",
  ]);
  shadowBundle = await buildBundle(shadow!.code, 'shadow', [
    "export { default as GeneratedElement } from './leaf.js';",
    "export { Profile__ssr } from './leaf.js';",
  ]);
  hostlessBundle = await buildBundle(hostless.module!, 'hostless', [
    "export { Profile__ssr } from './leaf.js';",
  ]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('M09-1a generated element class (Chromium)', () => {
  test('the emitted graph reaches the shell and root and never the old backend', () => {
    for (const graph of [lightBundle.parsedModuleIds, lightBundle.moduleIds]) {
      expect(graph.some((id) => id.endsWith('/generated-element/shell.ts'))).toBe(true);
      expect(graph.some((id) => id.endsWith('/generated-element/root.ts'))).toBe(true);
      for (const suffix of FORBIDDEN_MODULE_SUFFIXES) {
        expect(
          graph.some((id) => id.endsWith(suffix)),
          suffix,
        ).toBe(false);
      }
    }
    // M09-2a, converted not weakened: the generated element's ONE internal
    // entry now also re-exports the browser-safe DSD host producer, so the
    // light module's PARSE graph carries `dsd.ts` (and its producer leaf). The
    // shipped artifact is the RENDERED graph, and there the producer must be
    // gone: a light module emits no `<Name>__ssrHost` and never calls it, so
    // tree-shaking drops both modules from the chunk. The light tail's bytes
    // are asserted unchanged in `generated-element.shadow-authoring.test.ts`.
    const rendered = lightBundle.moduleIds;
    expect(rendered.some((id) => id.endsWith('/internal/compiled/dsd.ts'))).toBe(false);
    expect(rendered.some((id) => id.endsWith('/generated-element/dsd-ssr.ts'))).toBe(false);
    expect(
      lightBundle.parsedModuleIds.some((id) => id.endsWith('/generated-element/dsd-ssr.ts')),
    ).toBe(true);
    expect(lightBundle.parsedModuleIds.some((id) => id.endsWith('/internal/compiled/dsd.ts'))).toBe(
      true,
    );
  });

  test('a hostless module bundle never reaches the shell', () => {
    for (const graph of [hostlessBundle.parsedModuleIds, hostlessBundle.moduleIds]) {
      expect(graph.some((id) => id.endsWith('/generated-element/shell.ts'))).toBe(false);
      expect(graph.some((id) => id.endsWith('/generated-element/root.ts'))).toBe(false);
    }
  });

  test('loading the bundle registers nothing; define is caller-driven', async () => {
    const page = await openPage(lightBundle);
    try {
      expect(await page.evaluate(() => customElements.get('x-profile') === undefined)).toBe(true);
      const result = await page.evaluate(() => {
        customElements.define('x-profile', window.__oeM09.GeneratedElement);
        const ctor = customElements.get('x-profile');
        let idempotent = true;
        try {
          if (!customElements.get('x-profile'))
            customElements.define('x-profile', window.__oeM09.GeneratedElement);
        } catch {
          idempotent = false;
        }
        return { registered: typeof ctor === 'function', idempotent };
      });
      expect(result).toEqual({ registered: true, idempotent: true });
    } finally {
      await page.close();
    }
  });

  test('parser-created host upgrades, mounts once and reads zero attributes in the constructor', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<x-profile id="parser-host"></x-profile>');
      await page.addScriptTag({ path: lightBundle.file });
      const result = await page.evaluate(() => {
        customElements.define('x-profile', window.__oeM09.GeneratedElement);
        const host = document.getElementById('parser-host')!;
        const upgraded = host instanceof customElements.get('x-profile')!;
        const html = host.innerHTML;
        // Constructor conformance: a fresh construction reads no attributes.
        let reads = 0;
        const originalGet = Element.prototype.getAttribute;
        const originalHas = Element.prototype.hasAttribute;
        Element.prototype.getAttribute = function (this: Element, name: string) {
          reads += 1;
          return originalGet.call(this, name);
        };
        Element.prototype.hasAttribute = function (this: Element, name: string) {
          reads += 1;
          return originalHas.call(this, name);
        };
        try {
          document.createElement('x-profile');
        } finally {
          Element.prototype.getAttribute = originalGet;
          Element.prototype.hasAttribute = originalHas;
        }
        return {
          upgraded,
          html,
          matches: host.querySelectorAll('#profile').length,
          reads,
        };
      });
      expect(result.upgraded).toBe(true);
      expect(result.html).toContain('<p id="profile">hello</p>');
      expect(result.matches).toBe(1);
      expect(result.reads).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('server __ssr content is claimed in place with zero mutations and node identity', async () => {
    const page = await openPage(lightBundle);
    try {
      await page.evaluate(() => {
        customElements.define('x-profile', window.__oeM09.GeneratedElement);
      });
      const result = await page.evaluate(async () => {
        const ssr = window.__oeM09.Profile__ssr();
        const host = document.createElement('x-profile');
        host.innerHTML = ssr;
        const before = host.querySelector('#profile')!;
        const container = document.createElement('div');
        document.body.append(container);
        const records: MutationRecord[] = [];
        const observer = new MutationObserver((list) => records.push(...list));
        // Observe the HOST, not the container: inserting the host is the test's
        // own append, not a claim-period mutation.
        observer.observe(host, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        container.append(host);
        await new Promise((resolve) => setTimeout(resolve, 0));
        records.push(...observer.takeRecords());
        observer.disconnect();
        return {
          ssr,
          mutations: records.length,
          identity: host.querySelector('#profile') === before,
          count: host.querySelectorAll('#profile').length,
        };
      });
      expect(result.ssr).toContain('id="profile"');
      expect(result.mutations).toBe(0);
      expect(result.identity).toBe(true);
      expect(result.count).toBe(1);
    } finally {
      await page.close();
    }
  });

  test('an open DSD root is adopted without attachShadow and claimed in place', async () => {
    const page = await openPage(shadowBundle);
    try {
      await page.evaluate(() => {
        customElements.define('x-shadow-profile', window.__oeM09.GeneratedElement);
      });
      const result = await page.evaluate(
        async (template) => {
          const dsd = template.replace('__OE_CONTENT__', window.__oeM09.Profile__ssr());
          let attachShadowCalls = 0;
          const originalAttach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
            attachShadowCalls += 1;
            return originalAttach.call(this, init);
          };
          try {
            const frame = document.createElement('div');
            frame.setHTMLUnsafe(`<x-shadow-profile>${dsd}</x-shadow-profile>`);
            const host = frame.firstElementChild as HTMLElement;
            const shadow = host.shadowRoot!;
            const before = shadow.querySelector('#profile');
            const records: MutationRecord[] = [];
            const observer = new MutationObserver((list) => records.push(...list));
            observer.observe(shadow, {
              subtree: true,
              childList: true,
              characterData: true,
              attributes: true,
            });
            document.body.append(frame);
            await new Promise((resolve) => setTimeout(resolve, 0));
            records.push(...observer.takeRecords());
            observer.disconnect();
            return {
              hasRoot: shadow !== null,
              attachShadowCalls,
              mutations: records.length,
              identity: shadow.querySelector('#profile') === before,
              count: shadow.querySelectorAll('#profile').length,
              lightChildren: host.childNodes.length,
            };
          } finally {
            Element.prototype.attachShadow = originalAttach;
          }
        },
        serializeShadowTemplate('open', '__OE_CONTENT__'),
      );
      expect(result.hasRoot).toBe(true);
      expect(result.attachShadowCalls).toBe(0);
      expect(result.mutations).toBe(0);
      expect(result.identity).toBe(true);
      expect(result.count).toBe(1);
      expect(result.lightChildren).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('disconnect retains DOM, reconnect claims it, and dispose(true) removes only owned nodes', async () => {
    const page = await openPage(lightBundle);
    try {
      await page.evaluate(() => {
        customElements.define('x-profile', window.__oeM09.GeneratedElement);
      });
      const result = await page.evaluate(async () => {
        const host = document.createElement('x-profile');
        document.body.append(host);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const first = host.querySelector('#profile');
        const mounted = host.querySelectorAll('#profile').length;
        // Disconnect keeps the DOM (dispose(false) path inside the shell) ...
        host.remove();
        const retained = host.querySelectorAll('#profile').length;
        // ... and reconnect claims with the same node identity, no duplicate.
        document.body.append(host);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const reconnected = host.querySelector('#profile');
        const afterReconnect = host.querySelectorAll('#profile').length;
        // An explicit plain disposal releases ownership but keeps the DOM.
        host.dispose(false);
        const afterPlainDispose = host.querySelectorAll('#profile').length;
        document.body.append(host);
        host.remove();
        document.body.append(host);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterSecondReconnect = host.querySelectorAll('#profile').length;
        // A detach disposal removes only the shell-owned range.
        const foreign = document.createElement('span');
        foreign.id = 'foreign';
        host.append(foreign);
        host.dispose(true);
        return {
          mounted,
          retained,
          identity: reconnected === first,
          afterReconnect,
          afterPlainDispose,
          afterSecondReconnect,
          profileAfterDetach: host.querySelectorAll('#profile').length,
          foreignAfterDetach: host.querySelectorAll('#foreign').length,
        };
      });
      expect(result).toEqual({
        mounted: 1,
        retained: 1,
        identity: true,
        afterReconnect: 1,
        afterPlainDispose: 1,
        afterSecondReconnect: 1,
        profileAfterDetach: 0,
        foreignAfterDetach: 1,
      });
    } finally {
      await page.close();
    }
  });
});

declare global {
  interface Window {
    __oeM09: {
      GeneratedElement: CustomElementConstructor;
      Profile__ssr: () => string;
    };
  }
}
