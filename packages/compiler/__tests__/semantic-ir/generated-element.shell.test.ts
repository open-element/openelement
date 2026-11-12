/**
 * M09-0 — generated-element shell evidence (LOCAL, Chromium).
 *
 * A real `compileFunctionModule` + `generateLeafModule` artifact is bundled
 * with the real recipe/LifetimeScope runtime and the new shell, registered as a
 * Custom Element in Chromium, then exercised through the platform lifecycle:
 *
 * - explicit `customElements.define`;
 * - parser-created markup → define → upgrade: the constructor reads no
 *   attributes, the platform's observed-attribute replay seeds the state before
 *   connect, and the recipe sees those values;
 * - pre-upgrade own data properties (parser upgrade + a JS set before define):
 *   reconciled before the recipe, deleted from the instance, a real write wins
 *   over the attribute, a value restating the declared default is ignored, and
 *   a non-configurable own property fails loudly;
 * - mount with no server DOM;
 * - attribute/property → typed props refresh and property → attribute
 *   reflection through the import-free canonical conversion leaf (not a copied
 *   table); the leaf's number/boolean/JSON semantics and the `facade-host.ts`
 *   re-export identity are pinned directly; removing a reflected attribute
 *   restores its declared default in the attribute mirror too, including the
 *   value-equal short-circuit case;
 * - the REAL Vite build module IDs (emitted chunk plus the pre-tree-shake
 *   parsed graph) prove the shell bundle reaches the new leaf and never reaches
 *   `facade-host.ts`, `runtime-program.ts`, the compiled kernel, or the Part
 *   Program executor modules; the parsed graph is what catches a re-export-only
 *   source edge that tree-shaking removes from the emitted chunk;
 * - server HTML → browser parser → in-place claim with zero claim mutations;
 * - disconnect `dispose(false)` keeps the DOM and releases the owner; reconnect
 *   adopts the retained DOM with a fresh owner, same node identity, no
 *   duplicate subscriptions, and updates still work;
 * - the optional `createBindings()` record and the shell-owned `propsChanged`
 *   signal are created once and retained across disconnect/reconnect, while
 *   the projection's subscriptions and the per-connection root scope are
 *   disposed (the next connect starts from a fresh root);
 * - a generated module without a claim fails closed on retained DOM/reconnect
 *   instead of silently becoming inert;
 * - a structural claim mismatch fails closed and leaves the DOM/subscriptions
 *   untouched;
 * - explicit `dispose(true)` removes only the node range the shell mounted or
 *   claimed: host-appended children, borrowed DOM from a failed claim, and DOM
 *   that was never mounted stay; `dispose(false)` releases ownership so a later
 *   `dispose(true)` cannot detach the retained region; a teardown cleanup error
 *   never replaces the first error.
 *
 * This is one engine and LOCAL evidence. It is not M09 exit, not M13, and not
 * the §4.1d full reconnect-resource contract. No author `onConnect`/`onDispose`
 * hook, focus/selection persistence, shadow/DSD, events, slots, forms, styles
 * or third-party WC behaviour is claimed here.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import {
  coercePropertyValue,
  convertFromAttribute,
  convertToAttribute,
  type PropertyConversionRecord,
} from '../../../element/src/internal/core/property-conversion.ts';

const FILE = '/proj/src/generated-element.tsx';
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

/**
 * The old Part Program execution backend. The shell may share the neutral
 * recipe/value primitives, but the emitted bundle must not acquire any of these
 * modules. The list is asserted against the REAL Vite output module IDs below,
 * not against a source-text scan.
 */
const OLD_BACKEND_MODULE_SUFFIXES = [
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
] as const;

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

/**
 * `Profile` is a claimable static-shape leaf with three primitive props: string,
 * number, boolean. `Conditional` is the claimable condition shape: its branches
 * are static elements, so the M08-2 slice emits both `__claim` and `__ssr` for
 * it. `Toggle` carries a `property` channel (`el.value = ...`); the
 * generated-leaf slice still treats that channel as mount-only, so it emits no
 * claim and no SSR. The shell's fail-closed path uses that real boundary
 * instead of a hand-written fake recipe.
 */
const SOURCE = `
function Profile(props) {
  return <p id="profile" title={props.label} data-count={props.count} hidden={props.enabled}>{props.label}</p>;
}
function Conditional(props) {
  return <div>{props.ok ? <p>on</p> : <em>off</em>}</div>;
}
function Toggle(props) {
  return <div><input value={props.ok} />on</div>;
}
`;

interface ProbeSnapshot {
  owners: number;
  projections: number;
  disposed: number;
  subscriptions: number;
  unsubscribed: number;
}

interface PageRuntime {
  defineGeneratedElement: (descriptor: unknown) => CustomElementConstructor;
  runtimeProbe: { snapshot(): ProbeSnapshot };
  createProfileRecipe: (owner: unknown, host: unknown) => unknown;
  createConditionalRecipe: (owner: unknown, host: unknown) => unknown;
  createToggleRecipe: (owner: unknown, host: unknown) => unknown;
  Profile__ssr: (props: unknown, host: unknown) => string;
  Conditional__ssr: (props: unknown, host: unknown) => string;
}

declare global {
  interface Window {
    __oeM09: PageRuntime;
  }
}

let browser: Browser;
let bundleDir = '';
let bundleFile = '';
let bundleModuleIds: string[] = [];
let bundleParsedModuleIds: string[] = [];

interface BundleResult {
  readonly file: string;
  /** Module IDs reported by Vite's emitted chunk for this build. */
  readonly moduleIds: readonly string[];
  /** Every module Vite parsed, including modules tree-shaken out of the chunk. */
  readonly parsedModuleIds: readonly string[];
}

function generatedModule(): string {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, front.diagnostics.map((item) => item.code).join(', ')).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(
    generated.diagnostics,
    generated.diagnostics.map((item) => item.message).join('\n'),
  ).toEqual([]);
  const module = generated.module!;
  expect(module).toContain('function Profile__claim');
  expect(module).toContain('function Profile__ssr');
  expect(module).toContain('function Conditional__claim');
  expect(module).toContain('function Conditional__ssr');
  expect(module).toContain('function Toggle__mount');
  expect(module).not.toContain('function Toggle__claim');
  // The property channel is mount-only in this slice; pin the exact boundary so
  // a future partial SSR producer cannot be mistaken for the claim boundary.
  expect(module).not.toContain('function Toggle__ssr');
  return module;
}

async function buildBundle(module: string, dir: string): Promise<BundleResult> {
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
      // Namespace imports keep this shim buildable on both sides of the
      // text-slot landing: at the M08-1b baseline those two exports do not
      // exist, and a static `export { … } from` makes the whole Vite build
      // fail even though the generated module does not reference them.
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
  writeFileSync(
    entry,
    [
      `export { createProfileRecipe, createConditionalRecipe, createToggleRecipe, Profile__ssr, Conditional__ssr } from './leaf.js';`,
      `export { createGeneratedElementClass, defineGeneratedElement } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      '',
    ].join('\n'),
  );
  const parsedModuleIds = new Set<string>();
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim } },
    plugins: [
      {
        name: 'oe-m09-module-graph',
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
    output as Array<{
      type: string;
      code?: string;
      moduleIds?: readonly string[];
    }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('generated-element bundle produced no chunk');
  if (chunk.moduleIds === undefined || chunk.moduleIds.length === 0) {
    throw new Error('generated-element bundle carried no Vite output module IDs');
  }
  const out = join(dir, 'generated-element.js');
  writeFileSync(out, chunk.code);
  return {
    file: out,
    moduleIds: chunk.moduleIds.map((id) => id.replaceAll('\\', '/')),
    parsedModuleIds: [...parsedModuleIds].map((id) => id.replaceAll('\\', '/')),
  };
}

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ path: bundleFile });
  return page;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m09-0-'));
  bundleDir = dir;
  const built = await buildBundle(generatedModule(), dir);
  bundleFile = built.file;
  bundleModuleIds = [...built.moduleIds];
  bundleParsedModuleIds = [...built.parsedModuleIds];
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

/**
 * Shared page-side descriptor. Kept in the test on purpose: M09-0 has no author
 * syntax and no generator emitter; the descriptor is the internal compiler
 * contract the M09-1 emitter will build.
 */
const DEFINE_PROFILE = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-profile',
    properties: [
      { name: 'label', attribute: 'label', type: 'string', reflect: true },
      { name: 'count', attribute: 'count', type: 'number', reflect: true },
      { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
    ],
    createRecipe: mod.createProfileRecipe,
  });
`;

const DEFINE_CONDITIONAL = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-conditional',
    properties: [{ name: 'ok', attribute: 'ok', type: 'boolean' }],
    createRecipe: mod.createConditionalRecipe,
  });
`;

const DEFINE_TOGGLE = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-toggle',
    properties: [{ name: 'ok', attribute: 'ok', type: 'boolean' }],
    createRecipe: mod.createToggleRecipe,
  });
`;

interface ShellSnapshot {
  tag: string | null;
  title: string | null;
  dataCount: string | null;
  hidden: boolean;
  text: string;
  countAttr: string | null;
  labelAttr: string | null;
  enabledAttr: string | null;
  sameNode: boolean;
  childCount: number;
}

type ShellReadSnapshot = ShellSnapshot & { read: number | boolean };

interface MountResult {
  registered: boolean;
  upgraded: boolean;
  observed: string[];
  mounted: ShellSnapshot;
  afterCountProperty: ShellReadSnapshot;
  afterCountAttribute: ShellReadSnapshot;
  afterLabelProperty: ShellSnapshot;
  afterEnabledFalse: ShellReadSnapshot;
  afterEnabledTrue: ShellReadSnapshot;
}

interface ReconnectResult {
  before: ProbeSnapshot;
  afterDisconnect: ProbeSnapshot;
  retained: { attached: boolean; sameNode: boolean; childCount: number; text: string };
  afterReconnect: ProbeSnapshot;
  reconnected: { attached: boolean; sameNode: boolean; childCount: number; text: string };
  afterUpdate: { text: string; dataCount: string | null; countAttr: string | null };
}

interface RetentionResult {
  bindingCalls: number;
  hosts: number;
  sameBindings: boolean;
  samePropsChanged: boolean;
  propsChangedDuringDisconnect: boolean;
  mountedText: string | null;
  reconnectedText: string | null;
  sameNode: boolean;
  childCount: number;
  rootCleanupsAfterFirstDisconnect: number;
  rootCleanupsAfterFinalDisconnect: number;
  freshRoots: boolean;
}

interface ClaimResult {
  html: string;
  errors: Array<{ message: string; code: string | null }>;
  claimed: {
    sameNode: boolean;
    childCount: number;
    text: string;
    title: string | null;
    dataCount: string | null;
    hidden: boolean;
  };
  claimMutations: number;
  before: ProbeSnapshot;
  after: ProbeSnapshot;
  afterUpdate: {
    text: string;
    title: string | null;
    dataCount: string | null;
    countAttr: string | null;
  };
  retained: { sameNode: boolean; text: string; attached: boolean };
  afterDisconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
  reconnected: { sameNode: boolean; text: string; attached: boolean };
  afterReconnectUpdate: { text: string; dataCount: string | null };
}

interface MismatchResult {
  errors: Array<{ message: string; code: string | null; name: string | null }>;
  before: ProbeSnapshot;
  after: ProbeSnapshot;
  retained: {
    sameNode: boolean;
    childCount: number;
    text: string;
    id: string | null;
    attached: boolean;
  };
}

interface ConditionalReconnectResult {
  html: string;
  errors: Array<{ message: string; code: string | null }>;
  before: ProbeSnapshot;
  afterClaim: ProbeSnapshot;
  claimed: {
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    sameBranch: boolean;
    text: string;
    childCount: number;
  };
  afterToggle: { branchTag: string | null; sameAnchor: boolean; sameEnd: boolean; text: string };
  beforeDisconnect: ProbeSnapshot;
  retained: {
    attached: boolean;
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    branchTag: string | null;
    text: string;
  };
  afterDisconnect: ProbeSnapshot;
  beforeReconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
  reconnected: {
    attached: boolean;
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    branchTag: string | null;
    text: string;
    childCount: number;
  };
  afterUpdate: { branchTag: string | null; sameAnchor: boolean; sameEnd: boolean; text: string };
}

interface NoClaimResult {
  errors: Array<{ message: string; code: string | null }>;
  seededResult: { sameNode: boolean; text: string; childCount: number };
  mounted: { text: string; childCount: number };
  retainedAfterReconnect: { sameNode: boolean; text: string; childCount: number };
  beforeReconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
}

interface DisposeResult {
  before: ProbeSnapshot;
  afterDispose: ProbeSnapshot;
  disposed: { childCount: number; disconnected: boolean };
  afterWrite: { childCount: number; text: string };
  remounted: { childCount: number; text: string; sameNode: boolean };
  afterRemount: ProbeSnapshot;
}

interface ParserUpgradeResult {
  preUpgrade: { hasOwnLabel: boolean; childCount: number };
  attributeReads: string[];
  seen: Array<{ label: unknown; count: unknown; enabled: unknown }>;
  upgraded: boolean;
  ownLabel: boolean;
  label: unknown;
  count: unknown;
  enabled: unknown;
  title: string | null;
  dataCount: string | null;
  hidden: boolean;
  text: string;
  labelAttr: string | null;
  countAttr: string | null;
  enabledAttr: string | null;
  childCount: number;
}

interface PreUpgradeWriteResult {
  seen: Array<{ label: unknown; count: unknown }>;
  ownLabel: boolean;
  ownCount: boolean;
  label: unknown;
  count: unknown;
  title: string | null;
  dataCount: string | null;
  text: string;
  labelAttr: string | null;
  countAttr: string | null;
  afterUpdate: {
    label: unknown;
    title: string | null;
    text: string;
    labelAttr: string | null;
  };
}

interface PreUpgradeDefaultRestatementResult {
  seenLabel: unknown;
  ownLabel: boolean;
  label: unknown;
  title: string | null;
  text: string;
  labelAttr: string | null;
}

interface NonConfigurableResult {
  errors: Array<{ code: string | null; message: string; name: string | null }>;
  ownLabel: boolean;
  label: unknown;
  childCount: number;
}

interface LockedReentrySnapshot {
  errors: Array<{ code: string | null; message: string; name: string | null }>;
  ownLabel: boolean;
  ownLabelValue: unknown;
  ownCount: boolean;
  label: unknown;
  count: unknown;
  labelAttr: string | null;
  childCount: number;
  recipeCalls: number;
}

interface LockedReentryFinal {
  errorCount: number;
  ownLabel: boolean;
  ownLabelValue: unknown;
  ownCount: boolean;
  labelAttr: string | null;
  childCount: number;
  recipeCalls: number;
}

interface LockedReentryResult {
  first: LockedReentrySnapshot;
  second: LockedReentrySnapshot;
  manual: { code: string | null; message: string } | null;
  final: LockedReentryFinal;
}

interface OwnershipDisposeResult {
  generatedRemoved: boolean;
  externalKept: boolean;
  mountedChildCount: number;
  neverMountedKept: boolean;
  failedClaimKept: boolean;
  disconnectedOwnedRemoved: boolean;
  disconnectedExternalKept: boolean;
  disconnectedChildCount: number;
  plainDisposeKept: boolean;
  defaultOwnedRemoved: boolean;
  defaultExternalKept: boolean;
  defaultChildCount: number;
  errors: number;
}

interface CleanupErrorResult {
  cleanupOrder: string[];
  errors: string[];
}

interface RemovalDefaultsResult {
  mounted: { label: unknown; countAttr: string | null };
  afterLabel: { read: unknown; attr: string | null; title: string | null; text: string };
  afterCount: { read: unknown; attr: string | null; dataCount: string | null };
  afterEnabled: { read: unknown; attr: string | null; hidden: boolean };
}

function conversionRecord(
  type: PropertyConversionRecord['type'],
  fallback: unknown = '',
): PropertyConversionRecord {
  return { type, converter: type, default: fallback };
}

describe('canonical property conversion leaf (semantics pin)', () => {
  test('attribute -> value keeps boolean presence and number NaN -> 0', () => {
    expect(convertFromAttribute(conversionRecord('boolean', false), '')).toBe(true);
    // Presence, not the string's truthiness: the string "false" is still true.
    expect(convertFromAttribute(conversionRecord('boolean', false), 'false')).toBe(true);
    expect(convertFromAttribute(conversionRecord('number', 0), '42')).toBe(42);
    expect(convertFromAttribute(conversionRecord('number', 0), 'not-a-number')).toBe(0);
    expect(convertFromAttribute(conversionRecord('string'), 'raw')).toBe('raw');
    expect(convertFromAttribute(conversionRecord('array', ['fallback']), '[1,2]')).toEqual([1, 2]);
    expect(convertFromAttribute(conversionRecord('array', ['fallback']), 'not-json')).toEqual([
      'fallback',
    ]);
  });

  test('value -> attribute keeps boolean empty/removal and JSON reflection', () => {
    expect(convertToAttribute(conversionRecord('boolean'), true)).toBe('');
    expect(convertToAttribute(conversionRecord('boolean'), false)).toBe(null);
    expect(convertToAttribute(conversionRecord('number'), 0)).toBe('0');
    expect(convertToAttribute(conversionRecord('string'), 'x')).toBe('x');
    expect(convertToAttribute(conversionRecord('string'), null)).toBe(null);
    expect(convertToAttribute(conversionRecord('array'), [1, 2])).toBe('[1,2]');
    expect(convertToAttribute(conversionRecord('object'), { a: 1 })).toBe('{"a":1}');
  });

  test('JS property coercion reuses the same table', () => {
    expect(coercePropertyValue(conversionRecord('boolean', false), 'false')).toBe(true);
    expect(coercePropertyValue(conversionRecord('number', 0), '12')).toBe(12);
    expect(coercePropertyValue(conversionRecord('number', 0), 'nope')).toBe(0);
    expect(coercePropertyValue(conversionRecord('string'), 7)).toBe('7');
    expect(coercePropertyValue(conversionRecord('string', 'fallback'), undefined)).toBe('fallback');
  });

  test('facade-host re-exports the same functions (compatibility edge)', async () => {
    const facade = await import('../../../element/src/internal/compiled/facade-host.ts');
    expect(facade.convertFromAttribute).toBe(convertFromAttribute);
    expect(facade.convertToAttribute).toBe(convertToAttribute);
  });
});

describe('M09-0 generated-element shell — Chromium (LOCAL)', () => {
  test('Vite build module graph closes over the new leaf and never reaches the old backend', () => {
    expect(bundleModuleIds.length).toBeGreaterThan(0);
    expect(bundleParsedModuleIds.length).toBeGreaterThan(0);
    const has = (suffix: string) => bundleModuleIds.some((id) => id.endsWith(suffix));
    const parsedHas = (suffix: string) => bundleParsedModuleIds.some((id) => id.endsWith(suffix));
    expect(has('/internal/compiled/generated-element/shell.ts'), bundleModuleIds.join('\n')).toBe(
      true,
    );
    expect(has('/internal/core/property-conversion.ts'), bundleModuleIds.join('\n')).toBe(true);
    expect(parsedHas('/internal/compiled/generated-element/shell.ts')).toBe(true);
    expect(parsedHas('/internal/core/property-conversion.ts')).toBe(true);
    expect(has('/internal/compiled/facade-host.ts')).toBe(false);
    expect(has('/internal/compiled/runtime-program.ts')).toBe(false);
    expect(has('/internal/compiled/runtime/kernel.ts')).toBe(false);
    const leaked = bundleModuleIds.filter((id) =>
      OLD_BACKEND_MODULE_SUFFIXES.some((suffix) => id.endsWith(suffix)),
    );
    expect(
      leaked,
      `old backend modules reached from the shell bundle:\n${leaked.join('\n')}`,
    ).toEqual([]);
    const parsedLeaked = bundleParsedModuleIds.filter((id) =>
      OLD_BACKEND_MODULE_SUFFIXES.some((suffix) => id.endsWith(suffix)),
    );
    expect(
      parsedLeaked,
      `old backend modules parsed for the shell bundle (before tree-shaking):\n${parsedLeaked.join('\n')}`,
    ).toEqual([]);
  });

  test('explicit registration, mount, typed attribute/property refresh and reflection', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const el = document.createElement('oe-m09-profile');
        el.setAttribute('label', 'hello');
        el.setAttribute('count', '2');
        el.setAttribute('enabled', '');
        document.body.append(el);
        const p = el.firstElementChild;
        const snap = () => ({
          tag: p?.tagName ?? null,
          title: p?.getAttribute('title') ?? null,
          dataCount: p?.getAttribute('data-count') ?? null,
          hidden: p?.hasAttribute('hidden') ?? false,
          text: el.textContent,
          countAttr: el.getAttribute('count'),
          labelAttr: el.getAttribute('label'),
          enabledAttr: el.getAttribute('enabled'),
          sameNode: el.firstElementChild === p,
          childCount: el.childNodes.length,
        });
        const mounted = snap();
        el.count = 7;
        const afterCountProperty = { ...snap(), read: el.count };
        el.setAttribute('count', '9');
        const afterCountAttribute = { ...snap(), read: el.count };
        el.label = 'next';
        const afterLabelProperty = snap();
        el.enabled = false;
        const afterEnabledFalse = { ...snap(), read: el.enabled };
        el.enabled = true;
        const afterEnabledTrue = { ...snap(), read: el.enabled };
        return {
          registered: customElements.get('oe-m09-profile') === ctor,
          upgraded: el instanceof ctor && el instanceof HTMLElement,
          observed: [...ctor.observedAttributes],
          mounted,
          afterCountProperty,
          afterCountAttribute,
          afterLabelProperty,
          afterEnabledFalse,
          afterEnabledTrue,
        };
      })()`)) as MountResult;
      expect(result.registered).toBe(true);
      expect(result.upgraded).toBe(true);
      expect(result.observed).toEqual(['label', 'count', 'enabled']);

      expect(result.mounted).toMatchObject({
        tag: 'P',
        title: 'hello',
        dataCount: '2',
        hidden: true,
        text: 'hello',
        countAttr: '2',
        labelAttr: 'hello',
        enabledAttr: '',
        sameNode: true,
        childCount: 1,
      });

      expect(result.afterCountProperty).toMatchObject({
        dataCount: '7',
        hidden: true,
        text: 'hello',
        countAttr: '7',
        read: 7,
        sameNode: true,
      });
      expect(result.afterCountAttribute).toMatchObject({
        dataCount: '9',
        hidden: true,
        text: 'hello',
        countAttr: '9',
        read: 9,
        sameNode: true,
      });
      expect(result.afterLabelProperty).toMatchObject({
        title: 'next',
        labelAttr: 'next',
        text: 'next',
        hidden: true,
        sameNode: true,
      });
      expect(result.afterEnabledFalse).toMatchObject({
        text: 'next',
        hidden: false,
        enabledAttr: null,
        read: false,
        sameNode: true,
      });
      expect(result.afterEnabledTrue).toMatchObject({
        text: 'next',
        hidden: true,
        enabledAttr: '',
        read: true,
        sameNode: true,
      });
    } finally {
      await page.close();
    }
  });

  test('parser-created markup upgrades with attributes visible before the recipe (constructor reads none)', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        const mod = window.__oeM09;
        document.body.innerHTML =
          '<oe-m09-profile label="server" count="2" enabled></oe-m09-profile>';
        const el = document.body.firstElementChild;
        const preUpgrade = {
          hasOwnLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          childCount: el.childNodes.length,
        };
        const attributeReads = [];
        const nativeGetAttribute = Element.prototype.getAttribute;
        Element.prototype.getAttribute = function (name) {
          if (this === el) attributeReads.push(name);
          return nativeGetAttribute.call(this, name);
        };
        const seen = [];
        let ctor;
        try {
          ctor = mod.defineGeneratedElement({
            tag: 'oe-m09-profile',
            properties: [
              { name: 'label', attribute: 'label', type: 'string', reflect: true },
              { name: 'count', attribute: 'count', type: 'number', reflect: true },
              { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
            ],
            createRecipe: (owner, host) => {
              seen.push({
                label: host.props.label,
                count: host.props.count,
                enabled: host.props.enabled,
              });
              return mod.createProfileRecipe(owner, host);
            },
          });
        } finally {
          Element.prototype.getAttribute = nativeGetAttribute;
        }
        const p = el.firstElementChild;
        return {
          preUpgrade,
          attributeReads,
          seen,
          upgraded: el instanceof ctor,
          ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          label: el.label,
          count: el.count,
          enabled: el.enabled,
          title: p?.getAttribute('title') ?? null,
          dataCount: p?.getAttribute('data-count') ?? null,
          hidden: p?.hasAttribute('hidden') ?? false,
          text: el.textContent,
          labelAttr: el.getAttribute('label'),
          countAttr: el.getAttribute('count'),
          enabledAttr: el.getAttribute('enabled'),
          childCount: el.childNodes.length,
        };
      })()`)) as ParserUpgradeResult;

      // The parser created the element before the definition: no constructor
      // ever saw its attributes. The platform replays them before connect.
      expect(result.preUpgrade).toEqual({ hasOwnLabel: false, childCount: 0 });
      expect(result.attributeReads, 'the constructor must not inspect attributes').toEqual([]);
      expect(result.seen).toEqual([{ label: 'server', count: 2, enabled: true }]);
      expect(result.upgraded).toBe(true);
      expect(result.ownLabel).toBe(false);
      expect(result).toMatchObject({
        label: 'server',
        count: 2,
        enabled: true,
        title: 'server',
        dataCount: '2',
        hidden: true,
        text: 'server',
        labelAttr: 'server',
        countAttr: '2',
        enabledAttr: '',
        childCount: 1,
      });
    } finally {
      await page.close();
    }
  });

  test('pre-upgrade own data property is reconciled and wins over the attribute', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        const mod = window.__oeM09;
        document.body.innerHTML =
          '<oe-m09-profile label="server" count="2" enabled></oe-m09-profile>';
        const el = document.body.firstElementChild;
        // Classic upgrade shadowing: both writes are own data properties until
        // customElements.define upgrades the parser-created element.
        el.label = 'pre';
        el.count = 5;
        const seen = [];
        mod.defineGeneratedElement({
          tag: 'oe-m09-profile',
          properties: [
            { name: 'label', attribute: 'label', type: 'string', reflect: true },
            { name: 'count', attribute: 'count', type: 'number', reflect: true },
            { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
          ],
          createRecipe: (owner, host) => {
            seen.push({ label: host.props.label, count: host.props.count });
            return mod.createProfileRecipe(owner, host);
          },
        });
        const p = el.firstElementChild;
        const mounted = {
          ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          ownCount: Object.prototype.hasOwnProperty.call(el, 'count'),
          label: el.label,
          count: el.count,
          title: p?.getAttribute('title') ?? null,
          dataCount: p?.getAttribute('data-count') ?? null,
          text: el.textContent,
          labelAttr: el.getAttribute('label'),
          countAttr: el.getAttribute('count'),
        };
        el.label = 'next';
        const afterUpdate = {
          label: el.label,
          title: p?.getAttribute('title') ?? null,
          text: el.textContent,
          labelAttr: el.getAttribute('label'),
        };
        return { seen, ...mounted, afterUpdate };
      })()`)) as PreUpgradeWriteResult;

      // The recipe sees the pre-upgrade JS value (which wins over the
      // attribute), and the own property is gone so later sets hit the setter.
      expect(result.seen).toEqual([{ label: 'pre', count: 5 }]);
      expect(result.ownLabel).toBe(false);
      expect(result.ownCount).toBe(false);
      expect(result).toMatchObject({
        label: 'pre',
        count: 5,
        title: 'pre',
        dataCount: '5',
        text: 'pre',
        labelAttr: 'pre',
        countAttr: '5',
      });
      expect(result.afterUpdate).toEqual({
        label: 'next',
        title: 'next',
        text: 'next',
        labelAttr: 'next',
      });
    } finally {
      await page.close();
    }
  });

  test('a pre-upgrade own property that restates the default does not overwrite the attribute', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        const mod = window.__oeM09;
        document.body.innerHTML = '<oe-m09-profile label="server"></oe-m09-profile>';
        const el = document.body.firstElementChild;
        // The generated-field restatement is not a pre-upgrade assignment.
        el.label = '';
        const seen = [];
        mod.defineGeneratedElement({
          tag: 'oe-m09-profile',
          properties: [
            { name: 'label', attribute: 'label', type: 'string', reflect: true },
            { name: 'count', attribute: 'count', type: 'number', reflect: true },
            { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
          ],
          createRecipe: (owner, host) => {
            seen.push(host.props.label);
            return mod.createProfileRecipe(owner, host);
          },
        });
        const p = el.firstElementChild;
        return {
          seenLabel: seen[0],
          ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          label: el.label,
          title: p?.getAttribute('title') ?? null,
          text: el.textContent,
          labelAttr: el.getAttribute('label'),
        };
      })()`)) as PreUpgradeDefaultRestatementResult;

      expect(result.seenLabel).toBe('server');
      expect(result.ownLabel).toBe(false);
      expect(result).toMatchObject({
        label: 'server',
        title: 'server',
        text: 'server',
        labelAttr: 'server',
      });
    } finally {
      await page.close();
    }
  });

  test('a non-configurable pre-upgrade own property fails loudly instead of being swallowed', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        const mod = window.__oeM09;
        document.body.innerHTML = '<oe-m09-profile label="server"></oe-m09-profile>';
        const el = document.body.firstElementChild;
        Object.defineProperty(el, 'label', {
          configurable: false,
          enumerable: true,
          writable: true,
          value: 'locked',
        });
        const errors = [];
        const onError = (event) => errors.push({
          code: event.error?.code ?? null,
          message: event.error?.message ?? event.message,
          name: event.error?.name ?? null,
        });
        window.addEventListener('error', onError);
        mod.defineGeneratedElement({
          tag: 'oe-m09-profile',
          properties: [
            { name: 'label', attribute: 'label', type: 'string', reflect: true },
            { name: 'count', attribute: 'count', type: 'number', reflect: true },
            { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
          ],
          createRecipe: mod.createProfileRecipe,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);
        return {
          errors,
          ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          label: el.label,
          childCount: el.childNodes.length,
        };
      })()`)) as NonConfigurableResult;

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toContain('non-configurable');
      expect(result.errors[0]!.message).toContain('label');
      expect(result.ownLabel).toBe(true);
      expect(result.label).toBe('locked');
    } finally {
      await page.close();
    }
  });

  test('a locked descriptor rejects every re-entry and never partially reconciles', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        const mod = window.__oeM09;
        document.body.innerHTML = '<oe-m09-profile label="server"></oe-m09-profile>';
        const el = document.body.firstElementChild;
        // The first declared property is reconcilable; the second is locked.
        // A one-pass reconciler deletes/writes the first before discovering the
        // second and leaves a half-applied element behind.
        Object.defineProperty(el, 'label', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: 'pre',
        });
        Object.defineProperty(el, 'count', {
          configurable: false,
          enumerable: true,
          writable: true,
          value: 7,
        });
        const seen = [];
        const errors = [];
        const onError = (event) => errors.push({
          code: event.error?.code ?? null,
          message: event.error?.message ?? event.message,
          name: event.error?.name ?? null,
        });
        window.addEventListener('error', onError);
        mod.defineGeneratedElement({
          tag: 'oe-m09-profile',
          properties: [
            { name: 'label', attribute: 'label', type: 'string', reflect: true },
            { name: 'count', attribute: 'count', type: 'number', reflect: true },
            { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
          ],
          createRecipe: (owner, host) => {
            seen.push({ label: host.props.label, count: host.props.count });
            return mod.createProfileRecipe(owner, host);
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const snapshot = (from) => ({
          errors: errors.slice(from),
          ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
          ownLabelValue: Object.getOwnPropertyDescriptor(el, 'label')?.value ?? null,
          ownCount: Object.prototype.hasOwnProperty.call(el, 'count'),
          label: el.label,
          count: el.count,
          labelAttr: el.getAttribute('label'),
          childCount: el.childNodes.length,
          recipeCalls: seen.length,
        });
        const first = snapshot(0);
        // Real platform re-entry: disconnect and reconnect the same element.
        el.remove();
        document.body.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const second = snapshot(first.errors.length);
        // Direct callback re-entry after the failed lifecycle must reject too
        // instead of mounting the still-shadowed element.
        let manual = null;
        try {
          el.connectedCallback();
        } catch (error) {
          manual = {
            code: error?.code ?? null,
            message: error?.message ?? String(error),
          };
        }
        window.removeEventListener('error', onError);
        return {
          first,
          second,
          manual,
          final: {
            errorCount: errors.length,
            ownLabel: Object.prototype.hasOwnProperty.call(el, 'label'),
            ownLabelValue: Object.getOwnPropertyDescriptor(el, 'label')?.value ?? null,
            ownCount: Object.prototype.hasOwnProperty.call(el, 'count'),
            labelAttr: el.getAttribute('label'),
            childCount: el.childNodes.length,
            recipeCalls: seen.length,
          },
        };
      })()`)) as LockedReentryResult;

      // Red gate for the re-entry blocker: the second connection and a direct
      // callback call must both reject the locked descriptor. A flag set before
      // validation makes both silently return and mount the shadowed element.
      expect({
        reconnectErrors: result.second.errors.map((error) => error.code),
        manualCode: result.manual?.code ?? null,
      }).toEqual({
        reconnectErrors: ['OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED'],
        manualCode: 'OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED',
      });

      const expectLockedRejection = (snapshot: LockedReentrySnapshot): void => {
        expect(snapshot.errors).toHaveLength(1);
        expect(snapshot.errors[0]).toMatchObject({
          code: 'OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED',
          name: 'OpenElementError',
        });
        expect(snapshot.errors[0]!.message).toContain('non-configurable');
        expect(snapshot.errors[0]!.message).toContain('"count"');
        // Validation ran before any application: the earlier configurable
        // property is untouched, the attribute replay is untouched, and no
        // recipe/mount was attempted.
        expect(snapshot.ownLabel).toBe(true);
        expect(snapshot.ownLabelValue).toBe('pre');
        expect(snapshot.ownCount).toBe(true);
        expect(snapshot.label).toBe('pre');
        expect(snapshot.count).toBe(7);
        expect(snapshot.labelAttr).toBe('server');
        expect(snapshot.childCount).toBe(0);
        expect(snapshot.recipeCalls).toBe(0);
      };
      expectLockedRejection(result.first);
      expectLockedRejection(result.second);
      expect(result.manual).toMatchObject({
        code: 'OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED',
      });
      expect(result.manual!.message).toContain('non-configurable');
      expect(result.manual!.message).toContain('"count"');
      expect(result.final).toEqual({
        errorCount: 2,
        ownLabel: true,
        ownLabelValue: 'pre',
        ownCount: true,
        labelAttr: 'server',
        childCount: 0,
        recipeCalls: 0,
      });
    } finally {
      await page.close();
    }
  });

  test('attribute removal restores reflected defaults without short-circuiting', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        const mod = window.__oeM09;
        document.body.innerHTML = '';
        mod.defineGeneratedElement({
          tag: 'oe-m09-defaults',
          properties: [
            { name: 'label', attribute: 'label', type: 'string', reflect: true, default: '' },
            { name: 'count', attribute: 'count', type: 'number', reflect: true, default: 0 },
            { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true, default: true },
          ],
          createRecipe: mod.createProfileRecipe,
        });
        const el = document.createElement('oe-m09-defaults');
        el.setAttribute('label', 'hello');
        el.setAttribute('count', '2');
        el.setAttribute('enabled', '');
        document.body.append(el);
        const p = el.firstElementChild;
        const mounted = { label: el.label, countAttr: el.getAttribute('count') };
        el.removeAttribute('label');
        const afterLabel = {
          read: el.label,
          attr: el.getAttribute('label'),
          title: p?.getAttribute('title') ?? null,
          text: el.textContent,
        };
        el.removeAttribute('count');
        const afterCount = {
          read: el.count,
          attr: el.getAttribute('count'),
          dataCount: p?.getAttribute('data-count') ?? null,
        };
        // The value already equals the boolean default, so the signal write
        // short-circuits; the removal still has to restore the mirrored attribute.
        el.removeAttribute('enabled');
        const afterEnabled = {
          read: el.enabled,
          attr: el.getAttribute('enabled'),
          hidden: p?.hasAttribute('hidden') ?? false,
        };
        return { mounted, afterLabel, afterCount, afterEnabled };
      })()`)) as RemovalDefaultsResult;

      expect(result.mounted).toEqual({ label: 'hello', countAttr: '2' });
      expect(result.afterLabel).toEqual({ read: '', attr: '', title: '', text: '' });
      expect(result.afterCount).toEqual({ read: 0, attr: '0', dataCount: '0' });
      expect(result.afterEnabled).toEqual({ read: true, attr: '', hidden: true });
    } finally {
      await page.close();
    }
  });

  test('disconnect dispose(false) keeps DOM; reconnect claim uses a fresh owner without duplicate subscriptions', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const el = document.createElement('oe-m09-profile');
        el.setAttribute('label', 'hello');
        el.setAttribute('count', '4');
        el.setAttribute('enabled', '');
        document.body.append(el);
        const p = el.firstElementChild;
        const before = mod.runtimeProbe.snapshot();
        el.remove();
        const afterDisconnect = mod.runtimeProbe.snapshot();
        const retained = {
          attached: el.isConnected,
          sameNode: el.firstElementChild === p,
          childCount: el.childNodes.length,
          text: el.textContent,
        };
        document.body.append(el);
        const afterReconnect = mod.runtimeProbe.snapshot();
        const reconnected = {
          attached: el.isConnected,
          sameNode: el.firstElementChild === p,
          childCount: el.childNodes.length,
          text: el.textContent,
        };
        el.count = 6;
        const afterUpdate = {
          text: el.textContent,
          dataCount: p?.getAttribute('data-count') ?? null,
          countAttr: el.getAttribute('count'),
        };
        return { before, afterDisconnect, retained, afterReconnect, reconnected, afterUpdate };
      })()`)) as ReconnectResult;

      expect(result.retained).toMatchObject({
        attached: false,
        sameNode: true,
        childCount: 1,
        text: 'hello',
      });
      expect(result.afterDisconnect.disposed - result.before.disposed).toBe(1);
      expect(result.afterDisconnect.unsubscribed).toBeGreaterThan(result.before.unsubscribed);
      expect(result.afterDisconnect.subscriptions - result.afterDisconnect.unsubscribed).toBe(0);

      expect(result.reconnected).toMatchObject({
        attached: true,
        sameNode: true,
        childCount: 1,
        text: 'hello',
      });
      // A fresh projection owner per reconnect (the physical root owner is not
      // asserted; the model makes scope identity explicitly non-contractual).
      expect(result.afterReconnect.owners - result.before.owners).toBe(1);
      expect(result.afterReconnect.projections - result.before.projections).toBe(1);
      // No duplicate and no loss: the live subscription count returns to its
      // pre-disconnect value exactly once.
      expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
        result.before.subscriptions - result.before.unsubscribed,
      );

      expect(result.afterUpdate).toMatchObject({
        text: 'hello',
        dataCount: '6',
        countAttr: '6',
      });
    } finally {
      await page.close();
    }
  });

  test('createBindings and propsChanged are retained across disconnect/reconnect', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        const mod = window.__oeM09;
        document.body.innerHTML = '';
        const hosts = [];
        const roots = [];
        let rootCleanups = 0;
        let bindingCalls = 0;
        const bindings = { marker: { value: 'kept' } };
        mod.defineGeneratedElement({
          tag: 'oe-m09-retained',
          properties: [{ name: 'label', attribute: 'label', type: 'string' }],
          createBindings: () => {
            bindingCalls += 1;
            return bindings;
          },
          createRecipe: (owner, host) => {
            roots.push(owner);
            owner.add(() => {
              rootCleanups += 1;
            });
            hosts.push(host);
            return mod.createProfileRecipe(owner, host);
          },
        });
        const el = document.createElement('oe-m09-retained');
        el.setAttribute('label', 'first');
        document.body.append(el);
        const p = el.firstElementChild;
        const mountedText = el.textContent;
        const propsChanged = hosts[0].propsChanged;
        el.remove();
        const rootCleanupsAfterFirstDisconnect = rootCleanups;
        el.label = 'disconnected';
        const propsChangedDuringDisconnect = propsChanged.value > 0;
        document.body.append(el);
        const reconnectedText = el.textContent;
        const freshRoots = roots.length === 2 && roots[0] !== roots[1];
        el.remove();
        const rootCleanupsAfterFinalDisconnect = rootCleanups;
        return {
          bindingCalls,
          hosts: hosts.length,
          sameBindings:
            hosts.length === 2 &&
            hosts[0].bindings === hosts[1].bindings &&
            hosts[0].bindings === bindings,
          samePropsChanged:
            hosts.length === 2 &&
            hosts[0].propsChanged === hosts[1].propsChanged &&
            hosts[0].propsChanged === propsChanged,
          propsChangedDuringDisconnect,
          mountedText,
          reconnectedText,
          sameNode: el.firstElementChild === p,
          childCount: el.childNodes.length,
          rootCleanupsAfterFirstDisconnect,
          rootCleanupsAfterFinalDisconnect,
          freshRoots,
        };
      })()`)) as RetentionResult;

      expect(result).toMatchObject({
        bindingCalls: 1,
        hosts: 2,
        sameBindings: true,
        samePropsChanged: true,
        propsChangedDuringDisconnect: true,
        mountedText: 'first',
        reconnectedText: 'disconnected',
        sameNode: true,
        childCount: 1,
        rootCleanupsAfterFirstDisconnect: 1,
        rootCleanupsAfterFinalDisconnect: 2,
        freshRoots: true,
      });
      // The shell supports the retained bindings record, the shell-owned
      // invalidation signal, and a prop written during the disconnect window:
      // this generated claim re-reads the current props on reconnect. There is
      // no author onDispose callback to invoke.
    } finally {
      await page.close();
    }
  });

  test('server __ssr bytes are claimed in place with zero claim mutations, then stay live', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const html = mod.Profile__ssr(
          { label: 'server', count: 2, enabled: true },
          { bindings: {}, props: {}, propsChanged: { value: 0 } },
        );
        const el = document.createElement('oe-m09-profile');
        el.setAttribute('label', 'server');
        el.setAttribute('count', '2');
        el.setAttribute('enabled', '');
        el.innerHTML = html;
        const p = el.firstElementChild;
        const before = mod.runtimeProbe.snapshot();
        const errors = [];
        const onError = (event) => errors.push({
          message: event.error?.message ?? event.message,
          code: event.error?.code ?? null,
        });
        window.addEventListener('error', onError);
        const mutations = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) mutations.push(record.type);
        });
        observer.observe(el, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        document.body.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);
        for (const record of observer.takeRecords()) mutations.push(record.type);
        observer.disconnect();
        const after = mod.runtimeProbe.snapshot();
        const claimed = {
          sameNode: el.firstElementChild === p,
          childCount: el.childNodes.length,
          text: el.textContent,
          title: p?.getAttribute('title') ?? null,
          dataCount: p?.getAttribute('data-count') ?? null,
          hidden: p?.hasAttribute('hidden') ?? false,
        };
        el.count = 5;
        el.label = 'next';
        const afterUpdate = {
          text: el.textContent,
          title: p?.getAttribute('title') ?? null,
          dataCount: p?.getAttribute('data-count') ?? null,
          countAttr: el.getAttribute('count'),
        };
        el.remove();
        const afterDisconnect = mod.runtimeProbe.snapshot();
        const retained = {
          sameNode: el.firstElementChild === p,
          text: el.textContent,
          attached: el.isConnected,
        };
        document.body.append(el);
        const afterReconnect = mod.runtimeProbe.snapshot();
        const reconnected = {
          sameNode: el.firstElementChild === p,
          text: el.textContent,
          attached: el.isConnected,
        };
        el.count = 6;
        const afterReconnectUpdate = {
          text: el.textContent,
          dataCount: p?.getAttribute('data-count') ?? null,
        };
        return {
          html,
          errors,
          claimed,
          claimMutations: mutations.length,
          before,
          after,
          afterUpdate,
          retained,
          afterDisconnect,
          afterReconnect,
          reconnected,
          afterReconnectUpdate,
        };
      })()`)) as ClaimResult;

      expect(result.html).toContain('<p id="profile"');
      expect(result.errors, result.html).toEqual([]);
      expect(result.claimMutations).toBe(0);
      expect(result.claimed).toMatchObject({
        sameNode: true,
        childCount: 1,
        text: 'server',
        title: 'server',
        dataCount: '2',
        hidden: true,
      });
      expect(result.after.projections - result.before.projections).toBe(1);
      expect(result.after.subscriptions).toBeGreaterThan(result.before.subscriptions);
      expect(result.afterUpdate).toMatchObject({
        text: 'next',
        title: 'next',
        dataCount: '5',
        countAttr: '5',
      });

      // The claimed DOM goes through the same retained-DOM path as a mount
      // disconnect: release the owner, keep the nodes, re-adopt with a fresh
      // owner and no duplicate/lost subscriptions.
      expect(result.retained).toMatchObject({ sameNode: true, text: 'next', attached: false });
      expect(result.afterDisconnect.disposed - result.after.disposed).toBe(1);
      expect(result.reconnected).toMatchObject({ sameNode: true, text: 'next', attached: true });
      expect(result.afterReconnect.owners - result.after.owners).toBe(1);
      expect(result.afterReconnect.projections - result.after.projections).toBe(1);
      expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
        result.after.subscriptions - result.after.unsubscribed,
      );
      expect(result.afterReconnectUpdate).toMatchObject({ text: 'next', dataCount: '6' });
    } finally {
      await page.close();
    }
  });

  test('claim mismatch fails closed: DOM retained, no projection, no subscription', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const el = document.createElement('oe-m09-profile');
        el.setAttribute('label', 'server');
        el.setAttribute('count', '2');
        el.setAttribute('enabled', '');
        el.innerHTML = '<p id="wrong">server</p>';
        const p = el.firstElementChild;
        const before = mod.runtimeProbe.snapshot();
        const errors = [];
        const onError = (event) => errors.push({
          message: event.error?.message ?? event.message,
          code: event.error?.code ?? null,
          name: event.error?.name ?? null,
        });
        window.addEventListener('error', onError);
        try {
          document.body.append(el);
        } catch (error) {
          errors.push({ message: String(error?.message ?? error), code: error?.code ?? null, name: error?.name ?? null });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);
        const after = mod.runtimeProbe.snapshot();
        return {
          errors,
          before,
          after,
          retained: {
            sameNode: el.firstElementChild === p,
            childCount: el.childNodes.length,
            text: el.textContent,
            id: p?.getAttribute('id') ?? null,
            attached: el.isConnected,
          },
        };
      })()`)) as MismatchResult;

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.errors[0]!.name).toBe('OpenElementError');
      expect(result.after.projections - result.before.projections).toBe(0);
      expect(result.after.subscriptions - result.before.subscriptions).toBe(0);
      expect(result.retained).toMatchObject({
        sameNode: true,
        childCount: 1,
        text: 'server',
        id: 'wrong',
      });
    } finally {
      await page.close();
    }
  });

  test('condition claim survives branch toggle and disconnect/reconnect with live updates', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        ${DEFINE_CONDITIONAL}
        document.body.innerHTML = '';
        const errors = [];
        const onError = (event) => errors.push({
          message: event.error?.message ?? event.message,
          code: event.error?.code ?? null,
        });
        window.addEventListener('error', onError);

        // Node-produced condition bytes, parsed by the real browser parser. The
        // claim must adopt the parsed anchor/branch/end instead of re-creating
        // the branch; this is SSR -> claim, not a mount tree.
        const html = mod.Conditional__ssr({ ok: true }, { bindings: {} });
        const el = document.createElement('oe-m09-conditional');
        el.setAttribute('ok', '');
        el.innerHTML = html;
        const div = el.firstElementChild;
        const anchor = div.firstChild;
        const end = div.lastChild;
        const branch = div.firstElementChild;
        const before = mod.runtimeProbe.snapshot();
        document.body.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterClaim = mod.runtimeProbe.snapshot();
        const claimed = {
          sameDiv: el.firstElementChild === div,
          sameAnchor: div.firstChild === anchor,
          sameEnd: div.lastChild === end,
          sameBranch: div.firstElementChild === branch,
          text: el.textContent,
          childCount: el.childNodes.length,
        };

        el.ok = false;
        const afterToggle = {
          branchTag: div.firstElementChild?.tagName ?? null,
          sameAnchor: div.firstChild === anchor,
          sameEnd: div.lastChild === end,
          text: el.textContent,
        };

        const beforeDisconnect = mod.runtimeProbe.snapshot();
        el.remove();
        const afterDisconnect = mod.runtimeProbe.snapshot();
        const retained = {
          attached: el.isConnected,
          sameDiv: el.firstElementChild === div,
          sameAnchor: div.firstChild === anchor,
          sameEnd: div.lastChild === end,
          branchTag: div.firstElementChild?.tagName ?? null,
          text: el.textContent,
        };

        const beforeReconnect = mod.runtimeProbe.snapshot();
        document.body.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterReconnect = mod.runtimeProbe.snapshot();
        const reconnected = {
          attached: el.isConnected,
          sameDiv: el.firstElementChild === div,
          sameAnchor: div.firstChild === anchor,
          sameEnd: div.lastChild === end,
          branchTag: div.firstElementChild?.tagName ?? null,
          text: el.textContent,
          childCount: el.childNodes.length,
        };

        el.ok = true;
        const afterUpdate = {
          branchTag: div.firstElementChild?.tagName ?? null,
          sameAnchor: div.firstChild === anchor,
          sameEnd: div.lastChild === end,
          text: el.textContent,
        };
        window.removeEventListener('error', onError);
        return {
          html,
          errors,
          before,
          afterClaim,
          claimed,
          afterToggle,
          beforeDisconnect,
          retained,
          afterDisconnect,
          beforeReconnect,
          afterReconnect,
          reconnected,
          afterUpdate,
        };
      })()`)) as ConditionalReconnectResult;

      expect(result.errors).toEqual([]);
      expect(result.claimed).toMatchObject({
        sameDiv: true,
        sameAnchor: true,
        sameEnd: true,
        sameBranch: true,
        text: 'on',
        childCount: 1,
      });
      expect(result.afterClaim.owners - result.before.owners).toBe(1);
      expect(result.afterClaim.projections - result.before.projections).toBe(1);

      expect(result.afterToggle).toMatchObject({
        branchTag: 'EM',
        sameAnchor: true,
        sameEnd: true,
        text: 'off',
      });

      expect(result.retained).toMatchObject({
        attached: false,
        sameDiv: true,
        sameAnchor: true,
        sameEnd: true,
        branchTag: 'EM',
        text: 'off',
      });
      expect(result.afterDisconnect.disposed - result.before.disposed).toBe(1);
      expect(result.afterDisconnect.subscriptions - result.afterDisconnect.unsubscribed).toBe(0);

      expect(result.reconnected).toMatchObject({
        attached: true,
        sameDiv: true,
        sameAnchor: true,
        sameEnd: true,
        branchTag: 'EM',
        text: 'off',
        childCount: 1,
      });
      // The reconnect claim gets a fresh projection owner; the retained DOM
      // (anchor, branch and end) is adopted in place, never re-mounted.
      expect(result.afterReconnect.owners - result.beforeReconnect.owners).toBe(1);
      expect(result.afterReconnect.projections - result.beforeReconnect.projections).toBe(1);
      // No duplicate and no loss: the live subscription count returns exactly
      // to its pre-disconnect value.
      expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
        result.beforeDisconnect.subscriptions - result.beforeDisconnect.unsubscribed,
      );

      // Updates still work after the reconnect claim, and replacing the branch
      // does not move the anchor/end markers.
      expect(result.afterUpdate).toMatchObject({
        branchTag: 'P',
        sameAnchor: true,
        sameEnd: true,
        text: 'on',
      });
    } finally {
      await page.close();
    }
  });

  test('a generated module without a claim fails closed on existing DOM and on reconnect', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        ${DEFINE_TOGGLE}
        document.body.innerHTML = '';
        const errors = [];
        const onError = (event) => errors.push({
          message: event.error?.message ?? event.message,
          code: event.error?.code ?? null,
        });
        window.addEventListener('error', onError);

        // 1. Existing DOM this mount-only module cannot claim. The property
        //    channel emits no server string, so this seeded shape is an ordinary
        //    pre-upgrade tree, not a server-rendered artifact.
        const seeded = document.createElement('oe-m09-toggle');
        seeded.setAttribute('ok', '');
        seeded.innerHTML = '<div><p>on</p></div>';
        const seededChild = seeded.firstElementChild;
        document.body.append(seeded);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const seededResult = {
          sameNode: seeded.firstElementChild === seededChild,
          text: seeded.textContent,
          childCount: seeded.childNodes.length,
        };

        // 2. Mount succeeds, disconnect retains DOM, reconnect must not silently
        //    leave the element inert.
        const el = document.createElement('oe-m09-toggle');
        el.setAttribute('ok', '');
        document.body.append(el);
        const mounted = { text: el.textContent, childCount: el.childNodes.length };
        const child = el.firstElementChild;
        el.remove();
        const beforeReconnect = mod.runtimeProbe.snapshot();
        document.body.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        window.removeEventListener('error', onError);
        const afterReconnect = mod.runtimeProbe.snapshot();
        return {
          errors,
          seededResult,
          mounted,
          retainedAfterReconnect: {
            sameNode: el.firstElementChild === child,
            text: el.textContent,
            childCount: el.childNodes.length,
          },
          beforeReconnect,
          afterReconnect,
        };
      })()`)) as NoClaimResult;

      expect(result.seededResult).toMatchObject({
        sameNode: true,
        text: 'on',
        childCount: 1,
      });
      expect(result.mounted).toMatchObject({ text: 'on', childCount: 1 });
      expect(result.retainedAfterReconnect).toMatchObject({
        sameNode: true,
        text: 'on',
        childCount: 1,
      });
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      for (const error of result.errors.slice(0, 2)) {
        expect(error.code).toBe('OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE');
        expect(error.message).toContain('no generated claim');
      }
      // Failed claims register no projection and no subscription.
      expect(result.afterReconnect.projections).toBe(result.beforeReconnect.projections);
      expect(result.afterReconnect.subscriptions).toBe(result.beforeReconnect.subscriptions);
    } finally {
      await page.close();
    }
  });

  test('explicit dispose(true) removes the region; a later connect mounts a fresh one', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(() => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const el = document.createElement('oe-m09-profile');
        el.setAttribute('label', 'hello');
        el.setAttribute('count', '2');
        el.setAttribute('enabled', '');
        document.body.append(el);
        const first = el.firstElementChild;
        const before = mod.runtimeProbe.snapshot();
        el.dispose(true);
        const afterDispose = mod.runtimeProbe.snapshot();
        const disposed = {
          childCount: el.childNodes.length,
          disconnected: el.isConnected,
        };
        el.count = 8;
        const afterWrite = { childCount: el.childNodes.length, text: el.textContent };
        document.body.append(el);
        const remounted = {
          childCount: el.childNodes.length,
          text: el.textContent,
          sameNode: el.firstElementChild === first,
        };
        const afterRemount = mod.runtimeProbe.snapshot();
        return { before, afterDispose, disposed, afterWrite, remounted, afterRemount };
      })()`)) as DisposeResult;

      expect(result.disposed).toMatchObject({ childCount: 0, disconnected: true });
      expect(result.afterDispose.disposed - result.before.disposed).toBe(1);
      expect(result.afterDispose.unsubscribed).toBeGreaterThan(result.before.unsubscribed);
      expect(result.afterWrite).toMatchObject({ childCount: 0, text: '' });
      expect(result.remounted).toMatchObject({
        childCount: 1,
        text: 'hello',
        sameNode: false,
      });
      expect(result.afterRemount.owners).toBeGreaterThan(result.afterDispose.owners);
      expect(result.afterRemount.projections).toBeGreaterThan(result.afterDispose.projections);
    } finally {
      await page.close();
    }
  });

  test('dispose(true) removes only the projection-owned region, never external or borrowed DOM', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        ${DEFINE_PROFILE}
        document.body.innerHTML = '';
        const errors = [];
        window.addEventListener('error', (event) => {
          errors.push(event.error?.message ?? event.message);
        });
        const mountedProfile = () => {
          const el = document.createElement('oe-m09-profile');
          el.setAttribute('label', 'hello');
          el.setAttribute('count', '2');
          el.setAttribute('enabled', '');
          document.body.append(el);
          return el;
        };

        // 1. External sibling appended by the host: not projection-owned.
        const mounted = mountedProfile();
        const owned = mounted.firstElementChild;
        const external = document.createElement('span');
        external.id = 'external';
        external.textContent = 'external';
        mounted.append(external);
        mounted.dispose(true);

        // 2. Never connected: nothing was ever mounted or claimed.
        const neverMounted = document.createElement('oe-m09-profile');
        neverMounted.innerHTML = '<b id="borrowed">borrowed</b>';
        const borrowed = neverMounted.firstElementChild;
        neverMounted.dispose(true);

        // 3. Failed claim: the borrowed server DOM was never adopted.
        const failedClaim = document.createElement('oe-m09-profile');
        failedClaim.setAttribute('label', 'server');
        failedClaim.innerHTML = '<p id="wrong">server</p>';
        const wrong = failedClaim.firstElementChild;
        document.body.append(failedClaim);
        await new Promise((resolve) => setTimeout(resolve, 0));
        failedClaim.dispose(true);

        // 4. Disconnect retained the generated region: teardown still knows
        //    exactly which nodes it owns (not every current child).
        const disconnected = mountedProfile();
        const disconnectedOwned = disconnected.firstElementChild;
        const disconnectedExternal = document.createElement('i');
        disconnectedExternal.id = 'kept';
        disconnected.append(disconnectedExternal);
        disconnected.remove();
        disconnected.dispose(true);

        // 5. A plain dispose released ownership: a later dispose(true) must
        //    not upgrade that released handle into a detach of retained DOM.
        const plain = mountedProfile();
        const plainOwned = plain.firstElementChild;
        plain.dispose(false);
        plain.dispose(true);

        // 6. The default argument is detach mode, still projection-scoped.
        const defaulted = mountedProfile();
        const defaultedOwned = defaulted.firstElementChild;
        const defaultExternal = document.createElement('u');
        defaultExternal.id = 'default-external';
        defaulted.append(defaultExternal);
        defaulted.dispose();

        return {
          generatedRemoved: !mounted.contains(owned),
          externalKept: mounted.contains(external),
          mountedChildCount: mounted.childNodes.length,
          neverMountedKept: neverMounted.contains(borrowed) && neverMounted.childNodes.length === 1,
          failedClaimKept: failedClaim.contains(wrong) && failedClaim.childNodes.length === 1,
          disconnectedOwnedRemoved: !disconnected.contains(disconnectedOwned),
          disconnectedExternalKept: disconnected.contains(disconnectedExternal),
          disconnectedChildCount: disconnected.childNodes.length,
          plainDisposeKept: plain.contains(plainOwned) && plain.childNodes.length === 1,
          defaultOwnedRemoved: !defaulted.contains(defaultedOwned),
          defaultExternalKept: defaulted.contains(defaultExternal),
          defaultChildCount: defaulted.childNodes.length,
          errors: errors.length,
        };
      })()`)) as OwnershipDisposeResult;

      expect(result.generatedRemoved).toBe(true);
      expect(result.externalKept).toBe(true);
      expect(result.mountedChildCount).toBe(1);
      expect(result.neverMountedKept).toBe(true);
      expect(result.failedClaimKept).toBe(true);
      expect(result.disconnectedOwnedRemoved).toBe(true);
      expect(result.disconnectedExternalKept).toBe(true);
      expect(result.disconnectedChildCount).toBe(1);
      expect(result.plainDisposeKept).toBe(true);
      expect(result.defaultOwnedRemoved).toBe(true);
      expect(result.defaultExternalKept).toBe(true);
      expect(result.defaultChildCount).toBe(1);
      // Only the failed claim reports; the dispose paths stay quiet.
      expect(result.errors).toBe(1);
    } finally {
      await page.close();
    }
  });

  test('cleanup exceptions never replace the original teardown/setup error', async () => {
    const page = await openPage();
    try {
      const result = (await page.evaluate(`(async () => {
        const mod = window.__oeM09;
        document.body.innerHTML = '';
        const cleanupOrder = [];
        const errors = [];
        const onError = (event) => errors.push(event.error?.message ?? event.message);
        window.addEventListener('error', onError);

        mod.defineGeneratedElement({
          tag: 'oe-m09-cleanup-throw',
          properties: [{ name: 'label', attribute: 'label', type: 'string' }],
          createRecipe: (owner, host) => {
            owner.add(() => {
              cleanupOrder.push('root');
              throw new Error('root-cleanup');
            });
            const base = mod.createProfileRecipe(owner, host);
            return {
              ...base,
              mount: (scope, props) => {
                scope.add(() => {
                  cleanupOrder.push('projection');
                  throw new Error('projection-cleanup');
                });
                return base.mount(scope, props);
              },
            };
          },
        });
        const el = document.createElement('oe-m09-cleanup-throw');
        el.setAttribute('label', 'x');
        document.body.append(el);
        el.remove();
        await new Promise((resolve) => setTimeout(resolve, 0));

        mod.defineGeneratedElement({
          tag: 'oe-m09-connect-throw',
          properties: [],
          createRecipe: (owner) => {
            owner.add(() => {
              cleanupOrder.push('connect-root');
              throw new Error('cleanup-after-origin');
            });
            throw new Error('origin-error');
          },
        });
        const failing = document.createElement('oe-m09-connect-throw');
        document.body.append(failing);
        await new Promise((resolve) => setTimeout(resolve, 0));

        window.removeEventListener('error', onError);
        return { cleanupOrder, errors };
      })()`)) as CleanupErrorResult;

      // Both cleanup chains were attempted, in teardown order.
      expect(result.cleanupOrder).toEqual(['projection', 'root', 'connect-root']);
      // The first teardown error survives; the later root cleanup error does
      // not replace it. Setup rollback still rethrows the setup error.
      expect(result.errors[0]).toBe('projection-cleanup');
      expect(result.errors[1]).toBe('origin-error');
    } finally {
      await page.close();
    }
  });
});
