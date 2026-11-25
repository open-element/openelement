/**
 * Generated Custom Element shell contract. Vite bundles real compiler output
 * against the element package's runtime. One Chromium fixture serves the
 * upgrade, claim, retained-instance and teardown cases.
 *
 * Descriptor fixtures exercise the shell lifecycle directly.
 * `generated-element.root-instance.*` covers the compiler-emitted setup path.
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
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';
import { LEAF_RUNTIME_ENTRY } from './testlib/generated-claim-bundle.ts';
import { describeClaim } from './testlib/generated-element-shell-claim.ts';
import { describeDispose } from './testlib/generated-element-shell-dispose.ts';
import { DEFINE_PROFILE, PROFILE_PROPERTIES } from './testlib/generated-element-shell-fixture.ts';
import { describeLifetime } from './testlib/generated-element-shell-lifetime.ts';

const FILE = '/proj/src/generated-element.tsx';

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
  // `runtime/props.ts` is deliberately NOT listed: ADR-0183 D-5 makes it the
  // ONE props record, and the shell (props owner) consults it. It is a neutral
  // primitive (its only import is the signal framework), not part of the old
  // Part Program backend this list exists to keep out.
  '/internal/compiled/runtime/blocks.ts',
  '/internal/compiled/runtime/revive.ts',
  '/internal/compiled/runtime/error-boundary.ts',
  '/internal/compiled/runtime/pre-upgrade-events.ts',
  '/internal/compiled/runtime/hydrate-recovery.ts',
  '/internal/compiled/runtime/blocks-seam.ts',
  '/internal/compiled/runtime/hydrate-seam.ts',
] as const;

/**
 * `Profile` is a claimable static-shape leaf with three primitive props: string,
 * number, boolean. `Conditional` is the claimable condition shape: its branches
 * are static elements, so the M08-2 slice emits both `__claim` and `__ssr` for
 * it. `Toggle` carries a `property` channel (`el.value = ...`); the fail-closed
 * row below used to rely on that channel forcing the component mount-only, but
 * F16 admitted it (`attributesClaimable`, generated-leaf/generate.ts:4354), so
 * the leaf now emits both `__claim` and `__ssr` for `Toggle` (pinned below) and
 * it can no longer stand for "a generated module without a claim".
 *
 * `NoClaim` is that boundary today, and it is a REAL generated artifact, not a
 * hand-written fake recipe: a condition nested inside a condition branch stays
 * mount-only by the leaf's own claimability rule (the condition arm refuses
 * `insideTemplate`, generated-leaf/generate.ts:4409), so the generated module
 * carries no `__claim`, no `__ssr`, and a `createNoClaimRecipe` whose recipe has
 * only `mount`. The shell's fail-closed row uses exactly that boundary.
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
function NoClaim(props) {
  return <div>{props.ok ? <section>{props.inner ? <b>x</b> : <i>y</i>}</section> : null}</div>;
}
`;

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
  // The property channel is admitted (F16): this component claims and produces,
  // and the boundary that used to separate it from `Profile` is gone.
  expect(module).toContain('function Toggle__claim');
  expect(module).toContain('function Toggle__ssr');
  // The fail-closed row needs a real module with NO claim; a nested condition
  // inside a branch is not claimable, so the leaf emits only mount. Pinned here
  // so the row can never silently become vacuous again if the compiler later
  // admits that shape.
  expect(module).toContain('function NoClaim__mount');
  expect(module).not.toContain('function NoClaim__claim');
  expect(module).not.toContain('function NoClaim__ssr');
  return module;
}

async function buildBundle(module: string, dir: string): Promise<BundleResult> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leaf = join(dir, 'leaf.js');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leaf, module);
  writeFileSync(
    entry,
    [
      `export { createProfileRecipe, createConditionalRecipe, createNoClaimRecipe, Profile__ssr, Conditional__ssr } from './leaf.js';`,
      `export { createGeneratedElementClass, defineGeneratedElement } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      // 16b-LC retained-child owner-teardown row: the same private runtime surface the
      // generated root body consumes, re-exported for the page-side fixture.
      `export { createRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { abortInstancePass, beginInstancePass, endInstancePass, joinInstancePass, releaseChildInstance, releaseRetainedChildren, releaseUnderStructuralScope, retainChildInstance } from ${JSON.stringify(join(runtime, 'instance-ledger.ts'))};`,
      '',
    ].join('\n'),
  );
  const parsedModuleIds = new Set<string>();
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: LEAF_RUNTIME_ENTRY } },
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
    expect(parsedHas('/internal/compiled/leaf-runtime.ts')).toBe(true);
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
            properties: ${PROFILE_PROPERTIES},
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
          properties: ${PROFILE_PROPERTIES},
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
          properties: ${PROFILE_PROPERTIES},
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
          properties: ${PROFILE_PROPERTIES},
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
          properties: ${PROFILE_PROPERTIES},
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

  describeLifetime(openPage);
  describeClaim(openPage);
  describeDispose(openPage);
});
