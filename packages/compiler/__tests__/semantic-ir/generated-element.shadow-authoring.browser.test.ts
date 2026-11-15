/**
 * M09-2a — the authored shadow island end to end (LOCAL, Chromium).
 *
 * This is the slice's vertical: the author writes `root: 'shadow'` in the
 * island sidecar, the compiler lane reads that fact from the sidecar
 * (D-root-source), emits the generated class plus `<Name>__ssrHost`, Node
 * produces the host HTML, and the real browser parser adopts the declarative
 * shadow root. The generated class then claims that root (never calling
 * `attachShadow`), a refresh lands in place, and the two dispose modes behave.
 *
 * Asserted, in order:
 *
 * - the tag is the PATH-DERIVED tag: the site fact comes from the router's own
 *   resolver (`createGeneratedElementSiteResolver`) over the island's module
 *   id, and the emitted host tag, the tag constant and the parsed host's
 *   `localName` are all asserted against it — no literal tag is typed in;
 * - the template carries exactly the requested shadowroot options
 *   (`shadowrootmode="open"`, no other `shadowroot*` attribute), the light
 *   children ride AFTER the template, and the platform-created root reports
 *   the requested mode (`host.shadowRoot.mode === 'open'`);
 * - the parser adopted the DSD root and the shell never called `attachShadow`;
 * - the claim is in place: ZERO claim-period mutations, node identity inside
 *   the shadow tree preserved, one node, and the host's light child is
 *   distributed by the root's own `<slot>` (never claimed, owned or deleted);
 * - a real refresh: the SAME `<p>` node in the claimed shadow tree re-renders
 *   after the shell-owned `propsChanged` signal is written through the
 *   attribute channel;
 * - `dispose(false)` keeps the tree, `dispose(true)` removes exactly the owned
 *   region and leaves the host's light child alone.
 *
 * The generated class is the lane's own artifact. The refresh half needs a
 * declared property, and M09-1a's lane gates a props parameter
 * (`OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS`) and every binding; the test
 * asserts that refusal, then builds the class over the SAME generated recipe
 * factory with the shell's landed descriptor record (one declared property).
 * Property/attribute authoring is M09-2b and is NOT claimed here.
 *
 * One engine (Chromium), LOCAL. Not M09 exit, not M09-1b registration, not the
 * M13 matrix, not styles/forms/events, and not `delegatesFocus`.
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
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';
import { readIslandRoot } from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';
import { REPO_ROOT } from './testlib/element-classifier.ts';

const ISLANDS_DIR = 'app/islands';

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow' });\n";

/** The author-facing island: a static shadow tree with a named slot. */
const STATIC_ID = `${ISLANDS_DIR}/profile-card.tsx`;
const STATIC_SOURCE = `${SIDECAR}
function ProfileCard() {
  return <section><slot name="title"></slot><p id="panel">hello</p></section>;
}
export default ProfileCard;
`;

/**
 * M09-2e / #1803: the same shadow shape with a `styles` sidecar entry. The host
 * producer grows the typed styleLinks channel and the claim skips the canonical
 * marked link prefix the DSD template declares.
 */
const STYLED_ID = `${ISLANDS_DIR}/styled-card.tsx`;
const STYLED_SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'idle', root: 'shadow', styles: ['./styled-card.css'] });\n";
const STYLED_SOURCE = `${STYLED_SIDECAR}
function StyledCard() {
  return <section><p id="styled">styled</p></section>;
}
export default StyledCard;
`;

/**
 * The refresh island. Its root takes props, which M09-1a's lane refuses
 * (`OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS`); it is emitted through the same
 * emitter so the DSD host bytes and the generated recipe stay the real ones.
 */
const LIVE_ID = `${ISLANDS_DIR}/live-card.tsx`;
const LIVE_SOURCE = `${SIDECAR}
function LiveCard(props) {
  return <section><p id="live">{props.label}</p></section>;
}
export default LiveCard;
`;

interface PageRuntime {
  GeneratedElement: CustomElementConstructor;
  ProfileCard__ssr: () => string;
  ProfileCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  LiveCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createLiveCardRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  StyledElement: CustomElementConstructor;
  StyledCard__ssrHost: (
    props: unknown,
    lightChildren?: string,
    attributes?: readonly (readonly [string, string])[],
    styleLinks?: readonly string[],
  ) => string;
}

declare global {
  interface Window {
    __oeVertical: PageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';

interface BundleResult {
  readonly file: string;
  readonly moduleIds: readonly string[];
}

/**
 * Real Vite build of the real emitted modules plus the real shell. The leaf
 * runtime specifier is aliased to a shim over this tree, exactly like the
 * landed M09-1a browser evidence, so nothing is re-implemented in the page.
 */
async function buildBundle(
  dir: string,
  staticModule: string,
  liveModule: string,
  styledModule: string,
): Promise<BundleResult> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leafStatic = join(dir, 'static.js');
  const leafLive = join(dir, 'live.js');
  const leafStyled = join(dir, 'styled.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leafStatic, staticModule);
  writeFileSync(leafLive, liveModule);
  writeFileSync(leafStyled, styledModule);
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
      `export { default as GeneratedElement, ProfileCard__ssr, ProfileCard__ssrHost } from './static.js';`,
      `export { LiveCard__ssrHost, createLiveCardRecipe } from './live.js';`,
      `export { default as StyledElement, StyledCard__ssrHost } from './styled.js';`,
      `export { createGeneratedElementClass } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
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
      lib: {
        entry,
        formats: ['iife'],
        name: '__oeVertical',
        fileName: () => 'shadow-authoring.js',
      },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('the shadow vertical bundle produced no chunk');
  const file = join(dir, 'shadow-authoring.js');
  writeFileSync(file, chunk.code);
  return { file, moduleIds: (chunk.moduleIds ?? []).map((id) => id.replaceAll('\\', '/')) };
}

function frontModule(source: string, id: string): FunctionModelModule {
  const front = compileFunctionModule(source, id, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

/** The lane-read root fact, exactly as `compileGeneratedElementIfAdmitted` reads it. */
function laneReadRoot(
  source: string,
  id: string,
): 'light' | 'shadow-open' | 'shadow-closed' | undefined {
  const read = readIslandRoot(typescriptParser.parseModule(source, id).sourceFile);
  expect(read.kind).toBe('root');
  return read.kind === 'root' ? read.root : undefined;
}

/** The path-derived site fact, from the router's ONE resolver. */
function siteFor(id: string): { tag: string } {
  const resolver = createGeneratedElementSiteResolver(ISLANDS_DIR);
  const site = resolver(id);
  expect(site).not.toBeNull();
  return site!;
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
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-2a-'));
  const staticSite = siteFor(STATIC_ID);
  const staticCompiled = compileGeneratedElementIfAdmitted(STATIC_SOURCE, STATIC_ID, {
    site: staticSite,
  });
  expect(staticCompiled).not.toBeNull();
  expect(staticCompiled!.code).toContain(
    'export function ProfileCard__ssrHost(props, lightChildren, attributes) {',
  );

  // The refresh island's root is read from the sidecar by the SAME reader the
  // lane uses; the lane itself refuses the props parameter (asserted below).
  const liveSite = siteFor(LIVE_ID);
  const liveRoot = laneReadRoot(LIVE_SOURCE, LIVE_ID);
  expect(liveRoot).toBe('shadow-open');
  const live = generateElementModule(frontModule(LIVE_SOURCE, LIVE_ID), liveSite, {
    rootComponent: 'LiveCard',
    root: liveRoot,
  });
  expect(live.diagnostics, live.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  expect(live.module).toContain(
    'export function LiveCard__ssrHost(props, lightChildren, attributes) {',
  );

  const styled = compileGeneratedElementIfAdmitted(STYLED_SOURCE, STYLED_ID, {
    site: { tag: 'styled-card' },
  });
  expect(styled).not.toBeNull();
  expect(styled!.code).toContain(
    'export function StyledCard__ssrHost(props, lightChildren, attributes, styleLinks) {',
  );
  bundleFile = (await buildBundle(tempDir, staticCompiled!.code, live.module!, styled!.code)).file;
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('M09-2a authored shadow island (Chromium)', () => {
  test('the lane refuses the props island the refresh half needs (M09-2b boundary)', () => {
    expect(() =>
      compileGeneratedElementIfAdmitted(LIVE_SOURCE, LIVE_ID, { site: siteFor(LIVE_ID) }),
    ).toThrowError(/OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS/);
  });

  test('sidecar root -> lane class -> host bytes -> DSD claim -> refresh -> dispose', async () => {
    const page = await openPage();
    try {
      const staticSite = siteFor(STATIC_ID);
      const liveSite = siteFor(LIVE_ID);
      const result = await page.evaluate(
        async ({ staticTag, liveTag }) => {
          const mod = window.__oeVertical;
          const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } })
            .__oeProbe;
          const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
          const observe = (
            window as unknown as {
              __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
            }
          ).__oeObserve;

          // ---- the author-facing island -------------------------------------
          customElements.define(staticTag, mod.GeneratedElement);
          const hostHtml = mod.ProfileCard__ssrHost(undefined, '<span slot="title">Title</span>');
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(hostHtml);
          const host = frame.firstElementChild as HTMLElement;
          const shadow = host.shadowRoot!;
          const panelBefore = shadow.querySelector('#panel')!;
          const lightChild = host.firstElementChild!;
          const observer = observe(shadow);
          document.body.append(frame);
          await tick();
          observer.stop();
          const claimed = {
            hostTag: host.localName,
            mode: shadow.mode,
            delegatesFocus: shadow.delegatesFocus,
            mutations: observer.records.length,
            identity: shadow.querySelector('#panel') === panelBefore,
            count: shadow.querySelectorAll('#panel').length,
            lightChildren: host.childNodes.length,
            slotted: shadow.querySelector('slot[name="title"]')!.assignedNodes().length,
            sameLightChild: host.firstElementChild === lightChild,
            attachShadowCalls: probe.attachShadowCalls,
          };

          // ---- dispose(false) keeps the tree -------------------------------
          (host as unknown as { dispose: (detach?: boolean) => void }).dispose(false);
          const afterPlain = {
            identity: shadow.querySelector('#panel') === panelBefore,
            childCount: shadow.childNodes.length,
            lightChild: host.firstElementChild === lightChild,
          };

          // ---- dispose(true) removes exactly the owned region ---------------
          // A second instance: the shell's one-shot ownership rule means a
          // dispose(true) after a dispose(false) has nothing left to detach
          // (asserted on the first instance by `afterPlain`), so the detach
          // mode is observed on a fresh claim of the same generated class.
          const detachFrame = document.createElement('div');
          detachFrame.setHTMLUnsafe(hostHtml);
          const detachHost = detachFrame.firstElementChild as HTMLElement;
          const detachShadow = detachHost.shadowRoot!;
          const detachLight = detachHost.firstElementChild!;
          const detachObserver = observe(detachShadow);
          document.body.append(detachFrame);
          await tick();
          detachObserver.stop();
          const secondClaim = {
            mutations: detachObserver.records.length,
            identity: detachShadow.querySelector('#panel') !== null,
          };
          (detachHost as unknown as { dispose: (detach?: boolean) => void }).dispose(true);
          const afterDetach = {
            children: detachShadow.childNodes.length,
            panel: detachShadow.querySelector('#panel') === null,
            lightChild: detachHost.firstElementChild === detachLight,
            lightCount: detachHost.childNodes.length,
          };

          // ---- the refresh half --------------------------------------------
          const LiveElement = mod.createGeneratedElementClass({
            tag: liveTag,
            root: 'shadow-open',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createRecipe: mod.createLiveCardRecipe,
          });
          customElements.define(liveTag, LiveElement);
          // The DSD bytes are produced for the props the host element will
          // actually carry (none: M09-1a declares no property and the host tag
          // has no attribute), so the claim below is mutation-free; the update
          // step then writes the attribute and watches the same node refresh.
          const liveHtml = mod.LiveCard__ssrHost({});
          const liveFrame = document.createElement('div');
          liveFrame.setHTMLUnsafe(liveHtml);
          const liveHost = liveFrame.firstElementChild as HTMLElement;
          const liveShadow = liveHost.shadowRoot!;
          const liveNodeBefore = liveShadow.querySelector('#live')!;
          const liveObserver = observe(liveShadow);
          document.body.append(liveFrame);
          await tick();
          liveObserver.stop();
          const liveClaimed = {
            text: liveNodeBefore.textContent,
            mutations: liveObserver.records.length,
            identity: liveShadow.querySelector('#live') === liveNodeBefore,
            attachShadowCalls: probe.attachShadowCalls,
          };
          const updateObserver = observe(liveShadow);
          liveHost.setAttribute('label', 'updated');
          await tick();
          updateObserver.stop();
          const updated = {
            text: liveNodeBefore.textContent,
            identity: liveShadow.querySelector('#live') === liveNodeBefore,
            count: liveShadow.querySelectorAll('#live').length,
            property: (liveHost as unknown as { label: string }).label,
            mutations: updateObserver.records.length,
          };

          return {
            hostHtml,
            claimed,
            afterPlain,
            secondClaim,
            afterDetach,
            liveHtml,
            liveClaimed,
            updated,
          };
        },
        { staticTag: staticSite.tag, liveTag: liveSite.tag },
      );

      // The tag is the path-derived one, in the emitted bytes and in the DOM.
      expect(staticSite.tag).toBe('profile-card');
      expect(liveSite.tag).toBe('live-card');
      expect(result.hostHtml.startsWith(`<${staticSite.tag}>`)).toBe(true);
      expect(result.hostHtml.endsWith(`</span></${staticSite.tag}>`)).toBe(true);
      // The template carries exactly the requested shadowroot options.
      expect(result.hostHtml).toContain('<template shadowrootmode="open">');
      expect(result.hostHtml.match(/shadowroot[a-z]*=/g) ?? []).toEqual(['shadowrootmode=']);
      expect(result.hostHtml.indexOf('</template>')).toBeLessThan(
        result.hostHtml.indexOf('<span slot="title">'),
      );
      expect(result.claimed.hostTag).toBe(staticSite.tag);
      expect(result.claimed.mode).toBe('open');
      expect(result.claimed.delegatesFocus).toBe(false);
      // DSD adopted by the parser, claimed in place, light child distributed.
      expect(result.claimed.attachShadowCalls).toBe(0);
      expect(result.claimed.mutations).toBe(0);
      expect(result.claimed.identity).toBe(true);
      expect(result.claimed.count).toBe(1);
      expect(result.claimed.lightChildren).toBe(1);
      expect(result.claimed.slotted).toBe(1);
      expect(result.claimed.sameLightChild).toBe(true);
      // dispose(false) keeps the tree; dispose(true) removes the owned region.
      expect(result.afterPlain).toEqual({ identity: true, childCount: 1, lightChild: true });
      expect(result.secondClaim).toEqual({ mutations: 0, identity: true });
      expect(result.afterDetach).toEqual({
        children: 0,
        panel: true,
        lightChild: true,
        lightCount: 1,
      });
      // The refresh: the same claimed node re-renders in place.
      expect(result.liveHtml.startsWith(`<${liveSite.tag}>`)).toBe(true);
      expect(result.liveHtml).toContain('<template shadowrootmode="open">');
      expect(result.liveClaimed.mutations).toBe(0);
      expect(result.liveClaimed.identity).toBe(true);
      expect(result.liveClaimed.text).toBe('');
      expect(result.updated.text).toBe('updated');
      expect(result.updated.identity).toBe(true);
      expect(result.updated.count).toBe(1);
      expect(result.updated.property).toBe('updated');
      expect(result.updated.mutations).toBeGreaterThan(0);
      expect(result.liveClaimed.attachShadowCalls).toBe(0);
    } finally {
      await page.close();
    }
  });
});

/**
 * M09-2e / #1803 — the styled shadow host's DSD link prefix (Chromium).
 *
 * The positive row proves the claim adopts the authored nodes AFTER the
 * canonical marked links, keeps exactly one link (no duplicate, no delete) and
 * records zero claim-period mutations. The negatives prove the skip is exact:
 * an unmarked `<link>` and a marked non-link node are NOT swallowed — the claim
 * fails closed on the structural mismatch instead of silently adopting past
 * them.
 */
describe('M09-2e styled shadow host DSD link prefix (Chromium)', () => {
  test('claim skips only the canonical marked link prefix', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const mod = window.__oeVertical;
        const probe = (window as unknown as { __oeProbe: { attachShadowCalls: number } }).__oeProbe;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const observe = (
          window as unknown as {
            __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
          }
        ).__oeObserve;
        customElements.define('styled-card', mod.StyledElement);
        const hostHtml = mod.StyledCard__ssrHost(undefined, undefined, undefined, [
          '/client/assets/styled-abc.css',
        ]);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const linkBefore = shadow.querySelector('link')!;
        const styledBefore = shadow.querySelector('#styled')!;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        return {
          hostHtml,
          mutations: observer.records.length,
          links: shadow.querySelectorAll('link').length,
          linkIdentity: shadow.querySelector('link') === linkBefore,
          marker: linkBefore.hasAttribute('data-oe-static-styles'),
          href: linkBefore.getAttribute('href'),
          styledIdentity: shadow.querySelector('#styled') === styledBefore,
          styledCount: shadow.querySelectorAll('#styled').length,
          attachShadowCalls: probe.attachShadowCalls,
        };
      });
      expect(result.hostHtml).toContain(
        '<link rel="stylesheet" href="/client/assets/styled-abc.css" data-oe-static-styles />',
      );
      expect(result.mutations).toBe(0);
      expect(result.links).toBe(1);
      expect(result.linkIdentity).toBe(true);
      expect(result.marker).toBe(true);
      expect(result.href).toBe('/client/assets/styled-abc.css');
      expect(result.styledIdentity).toBe(true);
      expect(result.styledCount).toBe(1);
      expect(result.attachShadowCalls).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('an unmarked link and a marked non-link are refused, not swallowed', async () => {
    for (const [name, mutate] of [
      ['unmarked link', (html: string) => html.replace(' data-oe-static-styles', '')],
      [
        'marked non-link',
        (html: string) =>
          html.replace(
            '<link rel="stylesheet" href="/client/assets/styled-abc.css" data-oe-static-styles />',
            '<div data-oe-static-styles=""></div>',
          ),
      ],
    ] as const) {
      const page = await openPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        const hostHtml = await page.evaluate(() =>
          window.__oeVertical.StyledCard__ssrHost(undefined, undefined, undefined, [
            '/client/assets/styled-abc.css',
          ]),
        );
        const mutated = mutate(hostHtml);
        expect(mutated, `${name}: the fixture mutation must apply`).not.toBe(hostHtml);
        await page.evaluate(async (html: string) => {
          customElements.define('styled-card', window.__oeVertical.StyledElement);
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(html);
          document.body.append(frame);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }, mutated);
        await page.waitForTimeout(50);
        expect(errors.join('\n'), `${name}: claim must fail closed`).toMatch(
          /expected element .* at \/0|mismatch|extra node/i,
        );
      } finally {
        await page.close();
      }
    }
  });

  test('the styled producer refuses an old 3-arg caller and an empty styleLinks list', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const mod = window.__oeVertical;
        const attempt = (run: () => string): { ok: boolean; value?: string; message?: string } => {
          try {
            return { ok: true, value: run() };
          } catch (error) {
            return { ok: false, message: String((error as Error).message ?? error) };
          }
        };
        return {
          // The old caller model: exactly the pre-M09-2e three-argument call.
          threeArg: attempt(() => mod.StyledCard__ssrHost(undefined, undefined, undefined)),
          empty: attempt(() => mod.StyledCard__ssrHost(undefined, undefined, undefined, [])),
          valid: attempt(() =>
            mod.StyledCard__ssrHost(undefined, undefined, undefined, [
              '/client/assets/styled-abc.css',
            ]),
          ),
          // The guard does not replace the canonical per-URL validation: a
          // non-empty list with an invalid href must still fail in the one
          // marked-link serializer, not here.
          invalidHref: attempt(() =>
            mod.StyledCard__ssrHost(undefined, undefined, undefined, ['javascript:alert(1)']),
          ),
        };
      });
      for (const [name, refused] of [
        ['three-argument caller', result.threeArg],
        ['empty styleLinks', result.empty],
      ] as const) {
        expect(refused.ok, `${name}: styled producer must fail closed`).toBe(false);
        expect(refused.message).toContain('OEIR_LEAF_MISSING_VALUE');
        expect(refused.message).toContain('styleLinks');
      }
      expect(result.invalidHref.ok).toBe(false);
      expect(result.invalidHref.message).toContain('component stylesheet href must be');
      expect(result.valid.ok).toBe(true);
      expect(result.valid.value).toContain(
        '<link rel="stylesheet" href="/client/assets/styled-abc.css" data-oe-static-styles />',
      );
      expect((result.valid.value ?? '').match(/<link\b/g)?.length).toBe(1);
    } finally {
      await page.close();
    }
  });
});
