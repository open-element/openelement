/**
 * DSD stylesheet handoff — the claim-then-delete lifecycle in consumer form
 * (ADR-0164 §5; the "DSD stylesheet handoff" seam row in
 * docs/architecture/seams.md).
 *
 * Each scenario runs the way a real page consumes the boundary:
 *   - facade form: real OpenElement classes upgrade renderDsd output through
 *     the facade harness (mountSerialized simulates the browser's DSD
 *     upgrade + connect);
 *   - kernel/wire form: the claim executor and the element kernel against
 *     parsed serializer output, for the timing rows with no public
 *     observation point (scan phase, Part binding, owning recovery).
 *
 * ADR-0164 §5 scenario table, runtime rows:
 *   | Claim in progress (scan/binding) | node present | kernel applies shared sheet |
 *   | Claim succeeded (Parts bound)    | node removed | shared sheet only           |
 *   | Claim failed, recovery pending   | node kept    | recovery owns the rebuild   |
 *   | Recovery completed               | node removed | shared sheet only           |
 * The pre-upgrade and never-upgrade rows keep the node by construction
 * (no runtime runs) and are asserted here from the serializer side: the DSD
 * channel must stay untouched.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { claimExistingDom, PartProgramClaimError } from '../../src/internal/compiled/runtime.ts';
// The kernel resolves the claim executor through the seam (#1416); this file
// installs it exactly as the default '@openelement/element' entry does.
import '../../src/internal/compiled/runtime/claim-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { serializeCompiledProgram } from '../../src/internal/compiled/server/index.ts';
import {
  installFacadeDom,
  mountSerialized,
  toHtml,
  type FacadeElement,
  type FacadeShadowRoot,
} from '../compiled-runtime/facade-dom.ts';
import {
  parseHtml,
  TestDocument,
  type TestElement,
  type TestShadowRoot,
} from '../compiled-runtime/test-dom.ts';
import { testProgram, type TestProgramSpec } from '../compiled-runtime/test-program.ts';
import { Sig } from './claim-harness.ts';

const dom = installFacadeDom();

const { OpenElement, renderDsd, StyleSheet } = await import('@openelement/element');

/** The serializer's marker, spelled independently of the runtime constant. */
const DSD_STYLE_MARKER = 'data-oe-static-styles';

interface StyleRootView {
  childNodes: ArrayLike<unknown>;
  adoptedStyleSheets: unknown[];
}

function isMarkedStyleNode(node: unknown): boolean {
  const candidate = node as {
    nodeType?: number;
    localName?: string;
    tagName?: string;
    hasAttribute?: (name: string) => boolean;
  };
  if (!candidate || candidate.nodeType !== 1) return false;
  const tag = candidate.localName ?? candidate.tagName?.toLowerCase();
  return tag === 'style' && candidate.hasAttribute?.(DSD_STYLE_MARKER) === true;
}

function hasMarkedStyleNode(root: { childNodes: ArrayLike<unknown> }): boolean {
  return Array.from(root.childNodes).some(isMarkedStyleNode);
}

function styleRootOf(shadow: FacadeShadowRoot | null): StyleRootView {
  if (!shadow) throw new Error('expected an open shadow root');
  return shadow as unknown as StyleRootView;
}

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-dsd-handoff-${prefix}-${++tagCounter}`;
}

type CompiledMembers = Record<string, (this: never, ...args: never[]) => unknown>;

function defineCompiled(
  spec: TestProgramSpec,
  members: CompiledMembers = {},
  statics: Record<string, unknown> = {},
): CustomElementConstructor {
  const program = testProgram(spec);
  const ctor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  if (program.metadata.observedAttributes.length > 0) {
    ctor.observedAttributes = program.metadata.observedAttributes;
  }
  for (const [name, value] of Object.entries(members)) {
    (ctor.prototype as Record<string, unknown>)[name] = value;
  }
  for (const [name, value] of Object.entries(statics)) ctor[name] = value;
  dom.registry.define(spec.tag, ctor);
  return ctor;
}

function handoffSpec(tag: string): TestProgramSpec {
  return {
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
    properties: [
      {
        name: 'title',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'served',
      },
    ],
  };
}

/** Browser-style DSD upgrade of `html`, with a pre-connect observation window. */
function mountDsd(html: string, beforeConnect?: (element: FacadeElement) => void): FacadeElement {
  return mountSerialized(dom, html, beforeConnect);
}

// ─── Facade form: real OpenElement class, serialized DSD, browser-style upgrade ──

test('successful claim retires the DSD style node and keeps the shared adopted sheet', () => {
  const tag = uniqueTag('success');
  const sheet = new StyleSheet();
  sheet.replaceSync(`${tag} p { color: red; }`);
  let dsdHydrated = 0;
  const ctor = defineCompiled(
    handoffSpec(tag),
    {
      onDsdHydrated: function () {
        dsdHydrated++;
      },
    },
    { styles: sheet },
  );
  const html = renderDsd(tag, { componentClass: ctor }).html;
  // The first-paint channel is untouched: the serializer still emits the
  // marked node, so never-upgrade pages keep their styles.
  expect(html).toContain(`<style ${DSD_STYLE_MARKER}>`);

  let preUpgradeMarked: boolean | undefined;
  const el = mountDsd(html, (element) => {
    // Pre-upgrade row: the node serves first paint, nothing adopted yet.
    preUpgradeMarked = hasMarkedStyleNode(styleRootOf(element.shadowRoot));
  });
  expect(preUpgradeMarked, 'pre-upgrade: DSD node serves first paint').toBe(true);
  const root = styleRootOf(el.shadowRoot);
  expect(hasMarkedStyleNode(root), 'claimed: marked node retired after Part binding').toBe(false);
  expect(root.adoptedStyleSheets, 'shared adopted sheet retained').toEqual([sheet]);
  expect(dsdHydrated).toEqual(1);
  expect(toHtml(el.shadowRoot as unknown as Parameters<typeof toHtml>[0])).toContain('served');
});

test('claim cleanup keeps theme sheets adopted', () => {
  OpenElement._resetGlobalStyles();
  const themeSheet = new StyleSheet();
  themeSheet.replaceSync(':host { display: block; }');
  OpenElement.registerGlobalStyles([themeSheet]);
  try {
    const tag = uniqueTag('theme');
    const sheet = new StyleSheet();
    sheet.replaceSync(`${tag} p { color: red; }`);
    const ctor = defineCompiled(handoffSpec(tag), {}, { styles: sheet });
    const el = mountDsd(renderDsd(tag, { componentClass: ctor }).html);
    const root = styleRootOf(el.shadowRoot);
    expect(hasMarkedStyleNode(root)).toBe(false);
    expect(root.adoptedStyleSheets.includes(themeSheet), 'theme sheet survives claim cleanup').toBe(
      true,
    );
    expect(root.adoptedStyleSheets.includes(sheet), 'component sheet retained').toBe(true);
  } finally {
    OpenElement._resetGlobalStyles();
  }
});

test('fresh CSR adopts the shared sheet directly with no DSD node', () => {
  const tag = uniqueTag('fresh');
  const sheet = new StyleSheet();
  sheet.replaceSync(`${tag} p { color: red; }`);
  let csrRendered = 0;
  defineCompiled(
    handoffSpec(tag),
    {
      onCsrRendered: function () {
        csrRendered++;
      },
    },
    { styles: sheet },
  );
  const el = dom.document.createElement(tag) as unknown as {
    shadowRoot: FacadeShadowRoot | null;
  };
  dom.document.body.appendChild(el);
  expect(csrRendered, 'fresh activation').toEqual(1);
  const root = styleRootOf(el.shadowRoot);
  expect(hasMarkedStyleNode(root), 'client-created root carries no DSD node').toBe(false);
  expect(root.adoptedStyleSheets, 'direct adoption, nothing removed').toEqual([sheet]);
});

test('disconnect withdraws only this instance adoption; reconnect re-adopts without the DSD node', () => {
  const tag = uniqueTag('shared');
  const sheet = new StyleSheet();
  sheet.replaceSync(`${tag} p { color: red; }`);
  const ctor = defineCompiled(handoffSpec(tag), {}, { styles: sheet });
  const html = renderDsd(tag, { componentClass: ctor }).html;
  // Two instances share one sheet object (one module-level adapter export).
  const foreign = new StyleSheet();
  foreign.replaceSync('foreign { color: blue; }');
  const a = mountDsd(html);
  const b = mountDsd(html, (element) => {
    // A sheet the runtime never applied must survive every cleanup.
    styleRootOf(element.shadowRoot).adoptedStyleSheets.push(foreign);
  });
  const sheetsOf = (el: FacadeElement): StyleRootView => styleRootOf(el.shadowRoot);

  expect(sheetsOf(a).adoptedStyleSheets).toEqual([sheet]);
  expect(sheetsOf(b).adoptedStyleSheets, 'foreign + shared').toEqual([foreign, sheet]);
  expect(hasMarkedStyleNode(sheetsOf(a))).toBe(false);
  expect(hasMarkedStyleNode(sheetsOf(b))).toBe(false);

  dom.document.body.removeChild(a);
  expect(sheetsOf(a).adoptedStyleSheets, 'A disconnect withdraws A adoption').toEqual([]);
  expect(sheetsOf(b).adoptedStyleSheets, 'B keeps the shared sheet').toEqual([foreign, sheet]);

  dom.document.body.appendChild(a);
  expect(sheetsOf(a).adoptedStyleSheets, 'reconnect re-adopts').toEqual([sheet]);
  expect(hasMarkedStyleNode(sheetsOf(a)), 'reconnect never resurrects the DSD node').toBe(false);

  dom.document.body.removeChild(b);
  expect(
    sheetsOf(b).adoptedStyleSheets,
    'B disconnect removes only the scope-applied sheet',
  ).toEqual([foreign]);
});

// ─── Kernel/wire form: scan/binding timing against parsed serializer output ──

function wireSpec(withRef: boolean): TestProgramSpec {
  return {
    tag: 'oe-handoff-wire',
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      { k: 'text', index: 0, signal: 'title' },
      // The server serializer rejects client-only fixed Parts (`ref`); the
      // ref emits no markup, so the serialized shape is identical either way.
      ...(withRef ? [{ k: 'ref', index: 1, ref: 'hero', path: [0] }] : []),
    ],
  };
}

const WIRE_SERIALIZE_PROGRAM = testProgram(wireSpec(false));
const WIRE_CLAIM_PROGRAM = testProgram(wireSpec(true));

const WIRE_CSS = 'oe-handoff-wire p { color: red; }';

/** Browser-faithful DSD upgrade: the serialized template becomes a shadow root. */
function dsdShadowRoot(html: string): { element: TestElement; root: TestShadowRoot } {
  expect(html).toContain(`<style ${DSD_STYLE_MARKER}>`);
  const parsed = parseHtml(new TestDocument(), html);
  const host = parsed.childNodes[0] as TestElement;
  const template = host.childNodes[0] as TestElement;
  if (template.tagName.toLowerCase() !== 'template') {
    throw new Error('expected a DSD template as the first serialized child');
  }
  const root = host.attachShadow({ mode: 'open' });
  for (const child of [...template.childNodes]) root.appendChild(child);
  // The test-dom parser's attribute grammar covers attributed forms only; the
  // serializer emits the marker bare, so re-attach it to keep the upgraded
  // root byte-faithful to what a browser would build.
  const style = root.childNodes[0] as TestElement;
  if (style.tagName.toLowerCase() === 'style') style.setAttribute(DSD_STYLE_MARKER, '');
  return { element: host, root };
}

function serializeWireDsd(value: Sig<string>): string {
  return serializeCompiledProgram(
    WIRE_SERIALIZE_PROGRAM,
    { signals: { title: value }, handlers: {} },
    { styleCss: WIRE_CSS },
  );
}

test('claim in progress: the marked node anchors scan and Part binding while the shared sheet is already adopted', () => {
  const value = new Sig('served');
  const { element, root } = dsdShadowRoot(serializeWireDsd(value));
  const sheet = {
    replaceSync(_text: string): void {},
    cssRules: [{ cssText: WIRE_CSS }],
  };
  const adopted = root as unknown as StyleRootView;
  // The claim reads the signal during the scan phase (expected text) and
  // during fixed-Part validation: every read must still find the node.
  const scanReads: boolean[] = [];
  const title = {
    get value(): string {
      scanReads.push(hasMarkedStyleNode(root));
      return value.value;
    },
    subscribe(listener: (next: string) => void): () => void {
      return value.subscribe(listener);
    },
  };
  let refObservation: { marked: boolean; sheetAdopted: boolean } | undefined;
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, WIRE_CLAIM_PROGRAM, {
    signals: { title },
    handlers: {},
    refs: {
      hero: () => {
        // Part binding: Part paths assume the node; the kernel's sheet is
        // already adopted (styleScope.connect precedes the claim).
        refObservation = {
          marked: hasMarkedStyleNode(root),
          sheetAdopted: adopted.adoptedStyleSheets.includes(sheet),
        };
      },
    },
    rootMode: 'open',
    styles: sheet,
  });

  const activation = kernel.connect() as unknown as { mode: string };
  expect(activation.mode).toEqual('claim');
  expect(scanReads.length).toBeGreaterThan(0);
  expect(
    scanReads.every((present) => present),
    'scan phase: node present at every signal read',
  ).toBe(true);
  expect(refObservation, 'Part binding: node present, shared sheet adopted').toEqual({
    marked: true,
    sheetAdopted: true,
  });
  expect(hasMarkedStyleNode(root), 'after the claim attaches: node retired').toBe(false);
  expect(adopted.adoptedStyleSheets).toEqual([sheet]);
  kernel.dispose();
});

test('failed claim keeps the DSD style node (recovery-pending and never-upgrade state)', () => {
  const value = new Sig('served');
  const { root } = dsdShadowRoot(serializeWireDsd(value));
  const p = root.childNodes[1] as TestElement;
  const text = p.childNodes[1] as { data: string };
  text.data = 'drifted';
  let mismatchPresence: boolean | undefined;
  assertThrowsIncludes(
    () =>
      claimExistingDom(
        WIRE_CLAIM_PROGRAM,
        { signals: { title: value }, handlers: {}, refs: { hero: () => {} } },
        root,
        {
          expectStaticStyle: true,
          onMismatch: () => {
            mismatchPresence = hasMarkedStyleNode(root);
          },
        },
      ),
    PartProgramClaimError,
  );
  expect(mismatchPresence, 'at the mismatch the node is still in place').toBe(true);
  expect(hasMarkedStyleNode(root), 'a failed claim keeps first-paint styling').toBe(true);
});

test('owning recovery: the node survives the rebuild and retires when the recovered claim attaches', () => {
  const value = new Sig('served');
  const { root } = dsdShadowRoot(serializeWireDsd(value));
  const p = root.childNodes[1] as TestElement;
  (p.childNodes[1] as { data: string }).data = 'drifted';
  const mismatchPresences: boolean[] = [];
  const claimed = claimExistingDom(
    WIRE_CLAIM_PROGRAM,
    { signals: { title: value }, handlers: {}, refs: { hero: () => {} } },
    root,
    {
      expectStaticStyle: true,
      recovery: 'owning',
      onMismatch: () => {
        mismatchPresences.push(hasMarkedStyleNode(root));
      },
    },
  );
  expect(mismatchPresences, 'recovery pending: node kept through the rebuild').toEqual([true]);
  expect(hasMarkedStyleNode(root), 'recovery completed: node retired').toBe(false);
  const rebuilt = root.childNodes[0] as TestElement;
  expect(rebuilt.tagName.toLowerCase()).toEqual('p');
  expect(rebuilt.innerHTML).toContain('served');
  claimed.dispose();
});
