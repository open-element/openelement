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
 * F16 nested-light lift: an UNSTYLED shadow host whose root is a pure static
 * SIBLING DIRECTORY (a fragment of two fully static elements). The mount and the
 * SSR producer wrap each range in `oe:r:` markers, so the claim takes the M07b
 * directory consumer — the second claim form that must skip a leading marked
 * stylesheet-link run it does not own.
 */
const DIRECTORY_ID = `${ISLANDS_DIR}/directory-card.tsx`;
const DIRECTORY_SOURCE = `${SIDECAR}
function DirectoryCard() {
  return (
    <>
      <div id="dir-a">a</div>
      <div id="dir-b">b</div>
    </>
  );
}
export default DirectoryCard;
`;

/**
 * F16 side effect, pinned: the DECLARED case with the same directory root. It
 * used to take the general cursor walk (because the claim-prefix flag forced it
 * off the fast path) while the mount still emitted the `oe:r:` range markers,
 * so its own claim could not consume its own SSR. With the prefix rule scoped
 * to the TEMPLATE, the directory consumer owns both the marker parse and the
 * leading-link skip, and the declared case keeps the fast path.
 */
const STYLED_DIRECTORY_ID = `${ISLANDS_DIR}/styled-directory-card.tsx`;
const STYLED_DIRECTORY_SOURCE = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  hydrate: 'idle',
  root: 'shadow',
  styles: ['./styled-directory-card.css'],
});
function StyledDirectoryCard() {
  return (
    <>
      <div id="sdir-a">a</div>
      <div id="sdir-b">b</div>
    </>
  );
}
export default StyledDirectoryCard;
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
  DirectoryElement: CustomElementConstructor;
  DirectoryCard__ssrHost: (
    props: unknown,
    lightChildren?: string,
    attributes?: readonly (readonly [string, string])[],
    styleLinks?: readonly string[],
  ) => string;
  StyledDirectoryElement: CustomElementConstructor;
  StyledDirectoryCard__ssrHost: (
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
  directoryModule: string,
  styledDirectoryModule: string,
): Promise<BundleResult> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leafStatic = join(dir, 'static.js');
  const leafLive = join(dir, 'live.js');
  const leafStyled = join(dir, 'styled.js');
  const leafDirectory = join(dir, 'directory.js');
  const leafStyledDirectory = join(dir, 'styled-directory.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leafStatic, staticModule);
  writeFileSync(leafLive, liveModule);
  writeFileSync(leafStyled, styledModule);
  writeFileSync(leafDirectory, directoryModule);
  writeFileSync(leafStyledDirectory, styledDirectoryModule);
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
      `export { default as DirectoryElement, DirectoryCard__ssrHost } from './directory.js';`,
      `export { default as StyledDirectoryElement, StyledDirectoryCard__ssrHost } from './styled-directory.js';`,
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
    'export function ProfileCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
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
    'export function LiveCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
  );

  const styled = compileGeneratedElementIfAdmitted(STYLED_SOURCE, STYLED_ID, {
    site: { tag: 'styled-card' },
  });
  expect(styled).not.toBeNull();
  expect(styled!.code).toContain(
    'export function StyledCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
  );

  // F16: the directory root keeps the claim's fast path even without a
  // `styles` declaration, and the lifted link is skipped by the directory
  // consumer. The emitted claim must therefore call the M07b pair, not fall
  // back to the general walk.
  const directorySite = siteFor(DIRECTORY_ID);
  const directory = compileGeneratedElementIfAdmitted(DIRECTORY_SOURCE, DIRECTORY_ID, {
    site: directorySite,
  });
  expect(directory).not.toBeNull();
  expect(directory!.code).toContain(
    'export function DirectoryCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
  );
  expect(directory!.code).toContain('openStaticSiblingDirectory(');
  expect(directory!.code).toContain('...(styleLinks === undefined ? {} : { styleLinks }),');
  const styledDirectory = compileGeneratedElementIfAdmitted(
    STYLED_DIRECTORY_SOURCE,
    STYLED_DIRECTORY_ID,
    { site: siteFor(STYLED_DIRECTORY_ID) },
  );
  expect(styledDirectory).not.toBeNull();
  expect(styledDirectory!.code).toContain('openStaticSiblingDirectory(');
  expect(styledDirectory!.code).toContain('OEIR_LEAF_MISSING_VALUE: styleLinks');
  bundleFile = (
    await buildBundle(
      tempDir,
      staticCompiled!.code,
      live.module!,
      styled!.code,
      directory!.code,
      styledDirectory!.code,
    )
  ).file;
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

/**
 * F16 nested-light lift — an UNSTYLED shadow host's template prefix
 * (Chromium).
 *
 * The runtime lifts a nested LIGHT island's declared sheets into the enclosing
 * DSD template while it expands the child. That template can therefore begin
 * with canonical marked `<link>` nodes even when this module declares no
 * `styles` and carries no class candidate, so the claim must skip the leading
 * run as a TEMPLATE fact:
 *
 *   - the general cursor walk (single-root templates), and
 *   - the M07b directory consumer (pure static sibling-directory roots).
 *
 * The negatives prove the widened skip is still exact: the run is canonical
 * marked `<link>` nodes only, and anything else at or past the prefix remains
 * a structural mismatch (no unrelated mismatch is silenced).
 */
describe('F16 an unstyled shadow host skips the lifted link prefix (Chromium)', () => {
  test('the general walk adopts the content after a lifted link and keeps the link', async () => {
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
        customElements.define('profile-card', mod.GeneratedElement);
        // The page module declares no styles; the link is exactly what the
        // runtime lifts from a nested LIGHT child (`zag-combobox-light`).
        const hostHtml = mod.ProfileCard__ssrHost(undefined, undefined, undefined, [
          '/client/assets/lifted-light.css',
        ]);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const linkBefore = shadow.querySelector('link')!;
        const panelBefore = shadow.querySelector('#panel')!;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        return {
          hostHtml,
          firstNode:
            shadow.firstChild?.nodeType === 1 ? (shadow.firstChild as Element).nodeName : '',
          firstMarker:
            shadow.firstChild?.nodeType === 1
              ? (shadow.firstChild as Element).hasAttribute('data-oe-static-styles')
              : false,
          mutations: observer.records.length,
          links: shadow.querySelectorAll('link').length,
          linkIdentity: shadow.querySelector('link') === linkBefore,
          href: linkBefore.getAttribute('href'),
          rel: linkBefore.getAttribute('rel'),
          panelIdentity: shadow.querySelector('#panel') === panelBefore,
          panelCount: shadow.querySelectorAll('#panel').length,
          panelText: shadow.querySelector('#panel')?.textContent ?? null,
          attachShadowCalls: probe.attachShadowCalls,
        };
      });
      // The producer wrote the lifted link as the template's first node ...
      expect(result.hostHtml.startsWith('<profile-card')).toBe(true);
      expect(result.hostHtml).toContain(
        '<link rel="stylesheet" href="/client/assets/lifted-light.css" data-oe-static-styles />',
      );
      expect((result.hostHtml.match(/<link\b/g) ?? []).length).toBe(1);
      // ... and the claim adopted the content after it, borrowing the link.
      expect(result.firstNode).toBe('LINK');
      expect(result.firstMarker).toBe(true);
      expect(result.mutations).toBe(0);
      expect(result.links).toBe(1);
      expect(result.linkIdentity).toBe(true);
      expect(result.href).toBe('/client/assets/lifted-light.css');
      expect(result.rel).toBe('stylesheet');
      expect(result.panelIdentity).toBe(true);
      expect(result.panelCount).toBe(1);
      expect(result.panelText).toBe('hello');
      expect(result.attachShadowCalls).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('the directory claim adopts the ranges after a lifted link', async () => {
    const page = await openPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const result = await page.evaluate(async () => {
        const mod = window.__oeVertical;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const observe = (
          window as unknown as {
            __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
          }
        ).__oeObserve;
        customElements.define('directory-card', mod.DirectoryElement);
        const hostHtml = mod.DirectoryCard__ssrHost(undefined, undefined, undefined, [
          '/client/assets/lifted-light.css',
        ]);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const linkBefore = shadow.querySelector('link')!;
        const aBefore = shadow.querySelector('#dir-a')!;
        const bBefore = shadow.querySelector('#dir-b')!;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        return {
          hostHtml,
          mutations: observer.records.length,
          links: shadow.querySelectorAll('link').length,
          linkIdentity: shadow.querySelector('link') === linkBefore,
          aIdentity: shadow.querySelector('#dir-a') === aBefore,
          bIdentity: shadow.querySelector('#dir-b') === bBefore,
          aCount: shadow.querySelectorAll('#dir-a').length,
          bCount: shadow.querySelectorAll('#dir-b').length,
          text: shadow.textContent ?? null,
        };
      });
      // The SSR path really took the marker-prefixed directory shape...
      expect(result.hostHtml).toContain('data-oe-static-styles');
      expect(result.hostHtml).toContain('oe:r:0');
      expect(result.hostHtml).toContain('oe:r:1');
      // ... and the directory consumer skipped only the leading link.
      expect(result.mutations).toBe(0);
      expect(result.links).toBe(1);
      expect(result.linkIdentity).toBe(true);
      expect(result.aIdentity).toBe(true);
      expect(result.bIdentity).toBe(true);
      expect(result.aCount).toBe(1);
      expect(result.bCount).toBe(1);
      expect(result.text).toBe('ab');
      expect(errors, `the directory claim must not fail closed (${errors.join(' | ')})`).toEqual(
        [],
      );
    } finally {
      await page.close();
    }
  });

  test('a DECLARED directory host keeps the directory fast path and skips its own link', async () => {
    const page = await openPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const result = await page.evaluate(async () => {
        const mod = window.__oeVertical;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const observe = (
          window as unknown as {
            __oeObserve: (target: Node) => { records: MutationRecord[]; stop: () => void };
          }
        ).__oeObserve;
        customElements.define('styled-directory-card', mod.StyledDirectoryElement);
        const hostHtml = mod.StyledDirectoryCard__ssrHost(undefined, undefined, undefined, [
          '/client/assets/styled-directory.css',
        ]);
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(hostHtml);
        const host = frame.firstElementChild as HTMLElement;
        const shadow = host.shadowRoot!;
        const linkBefore = shadow.querySelector('link')!;
        const aBefore = shadow.querySelector('#sdir-a')!;
        const bBefore = shadow.querySelector('#sdir-b')!;
        const observer = observe(shadow);
        document.body.append(frame);
        await tick();
        observer.stop();
        return {
          hostHtml,
          mutations: observer.records.length,
          links: shadow.querySelectorAll('link').length,
          linkIdentity: shadow.querySelector('link') === linkBefore,
          href: linkBefore.getAttribute('href'),
          aIdentity: shadow.querySelector('#sdir-a') === aBefore,
          bIdentity: shadow.querySelector('#sdir-b') === bBefore,
          text: shadow.textContent ?? null,
        };
      });
      expect(result.hostHtml).toContain(
        '<link rel="stylesheet" href="/client/assets/styled-directory.css" data-oe-static-styles />',
      );
      expect(result.hostHtml).toContain('oe:r:0');
      expect(result.hostHtml).toContain('oe:r:1');
      expect(result.mutations).toBe(0);
      expect(result.links).toBe(1);
      expect(result.linkIdentity).toBe(true);
      expect(result.href).toBe('/client/assets/styled-directory.css');
      expect(result.aIdentity).toBe(true);
      expect(result.bIdentity).toBe(true);
      expect(result.text).toBe('ab');
      expect(errors, `the declared directory claim must not fail (${errors.join(' | ')})`).toEqual(
        [],
      );
    } finally {
      await page.close();
    }
  });

  test('a prefix that is not the canonical marked-link run still fails closed', async () => {
    for (const [name, mutate] of [
      // The marker is what makes a leading link borrowed delivery markup; a
      // plain link is authored content the claim never had.
      ['unmarked leading link', (html: string) => html.replace(' data-oe-static-styles', '')],
      // A marked link PAST the prefix is not swallowed: the content walk sees
      // it where the authored tree ends and reports the extra node.
      [
        'marked link after the first element',
        (html: string) =>
          html.replace(
            '<p id="panel">hello</p>',
            '<p id="panel">hello</p><link rel="stylesheet" href="/client/assets/late.css" data-oe-static-styles />',
          ),
      ],
    ] as const) {
      const page = await openPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        const hostHtml = await page.evaluate(() =>
          window.__oeVertical.ProfileCard__ssrHost(undefined, undefined, undefined, [
            '/client/assets/lifted-light.css',
          ]),
        );
        const html = mutate(hostHtml);
        expect(html, `${name}: the fixture mutation must apply`).not.toBe(hostHtml);
        await page.evaluate(async (mutated: string) => {
          const mod = window.__oeVertical;
          customElements.define('profile-card', mod.GeneratedElement);
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(mutated);
          document.body.append(frame);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }, html);
        await page.waitForTimeout(50);
        // Both claim forms report their own identity text: the general walk
        // says "expected element …"/"extra node", the directory consumer says
        // "static-seed: interior length …". Either way the row fails closed.
        expect(errors.join('\n'), `${name}: claim must fail closed`).toMatch(
          /expected element .* at \/0|mismatch|extra node|interior length/i,
        );
      } finally {
        await page.close();
      }
    }
  });
});
