/**
 * M08-1b — the dynamic SSR producer (dynamic text / attribute / boolean).
 *
 * This is the new-file evidence for the slice: the generated
 * `<Name>__ssr(props, host)` runs the SAME lowered-expression registry records
 * the mount and claim consume, at request time, through the one runtime
 * coercion/escape/security contract. The static `__ssr()` shape is asserted
 * separately so the M08-1a interface does not move.
 *
 * Two levels of evidence live here:
 *
 * 1. Node (LOCAL): real generated module, real runtime helpers, no text
 *    re-implementation. Positive/negative cases for props, signal, computed,
 *    attribute/boolean coercion, escaping, missing bindings and unsafe URLs.
 * 2. Chromium (LOCAL): the Node-produced SSR string is parsed by the real
 *    browser parser, the generated claim adopts those parsed nodes, no claim
 *    mutation happens for equal values, and a signal update refreshes the
 *    claimed text/attribute/boolean slots. One engine only; this is not M13,
 *    not M08-2 per-phase equivalence and not M08-4 claim negatives.
 *
 * The claim/wire half lives in `generated-leaf.text-boundary.test.ts` and
 * `generated-leaf.text-boundary.browser.test.ts`; this file keeps the producer's
 * Node contract and its two original Chromium verticals.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { chromium } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { computed, signal } from '../../../element/src/internal/signal/framework.ts';

const FILE = '/proj/src/dynamic-ssr.tsx';
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

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

const SOURCE = `import { signal, computed } from '@openelement/element';
function Plain(props) {
  return <p id="a" class="b">x & y</p>;
}
function Dynamic(props) {
  const count = signal(1);
  const doubled = computed(() => count.value * 2);
  const shown = signal(false);
  return (
    <section id="s" title={props.title} data-n={count.value} hidden={shown.value}>
      <p>{props.label}</p>
      <span>{doubled.value}</span>
    </section>
  );
}
function Localized(props) {
  const label = props.label + '!';
  return <p>{label}</p>;
}
function MixedText(props) {
  return <p>{props.a}: {props.b}</p>;
}
function EmptyText(props) {
  return <p>{props.value}</p>;
}
function Link(props) {
  return <a href={props.url}>go</a>;
}
function Conditional(props) {
  return <section>{props.ok ? <p>on</p> : <em>off</em>}</section>;
}
function Listed(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
function Propertied(props) {
  return <div value={props.value}>x</div>;
}
function Voided(props) {
  return <div><br /></div>;
}
function Reused(props) {
  const item = <i>a</i>;
  return <div>{item}</div>;
}
function Mixed(props) {
  const label = signal('a');
  return <div><section><i>a</i><i>b</i></section><span>{label.value}</span></div>;
}
function Leaf(props) {
  return <p>x</p>;
}
function Composed(props) {
  return <div><Leaf /></div>;
}
`;

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

interface GeneratedFixture {
  readonly module: string;
  readonly loaded: Record<string, unknown>;
}

const RUNTIME = { ...compiledRuntime };
const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

/**
 * Instantiate the emitted module without a bundler: the single runtime import
 * is replaced by a destructure of the same real runtime module the browser
 * harness bundles. This is the same contract the Vite shim in the M08-1a
 * suite provides, without a second copy of the escape/coercion table.
 */
function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

function fixture(): GeneratedFixture {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return { module: generated.module!, loaded: instantiate(generated.module!) };
}

function ssr(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

function dynamicHost(): {
  readonly host: { readonly bindings: Record<string, unknown> };
  readonly count: { value: number };
  readonly doubled: { readonly value: number };
  readonly shown: { value: boolean };
} {
  const count = signal(12);
  const doubled = computed(() => count.value * 2);
  const shown = signal(false);
  return { host: { bindings: { count, doubled, shown } }, count, doubled, shown };
}

describe('M08-1b dynamic SSR producer — Node contract', () => {
  let generated: GeneratedFixture;

  beforeAll(() => {
    generated = fixture();
  });

  test('the static interface is unchanged: `Plain__ssr()` takes no arguments', () => {
    expect(generated.module).toContain('export function Plain__ssr() {');
    expect(ssr(generated.loaded, 'Plain')()).toBe('<p id="a" class="b">x &amp; y</p>');
  });

  test('dynamic text/attribute/boolean evaluate from props and host bindings', () => {
    const { host, count, shown } = dynamicHost();
    const render = ssr(generated.loaded, 'Dynamic');
    const html = render({ title: 'a&b"c', label: 'x<y' }, host);
    expect(html).toBe(
      '<section id="s" title="a&amp;b&quot;c" data-n="12"><p><!--oe:t:0-->x&lt;y<!--oe:/t:0--></p><span><!--oe:t:1-->24<!--oe:/t:1--></span></section>',
    );

    // Request-time, not a compile-time snapshot: mutating the signal and the
    // computed input changes the next call's bytes.
    count.value = 3;
    shown.value = true;
    expect(render({ title: 'a&b"c', label: 'x<y' }, host)).toBe(
      '<section id="s" title="a&amp;b&quot;c" data-n="3" hidden=""><p><!--oe:t:0-->x&lt;y<!--oe:/t:0--></p><span><!--oe:t:1-->6<!--oe:/t:1--></span></section>',
    );
  });

  test('null/undefined omits an attribute; empty string and 0 stay present', () => {
    const { host, count } = dynamicHost();
    const render = ssr(generated.loaded, 'Dynamic');
    expect(render({ title: null, label: 'a' }, host)).not.toContain(' title=');
    expect(render({ title: '', label: 'a' }, host)).toContain(' title=""');
    count.value = 0;
    expect(render({ title: 't', label: 'a' }, host)).toContain(' data-n="0"');
  });

  test('props getters are evaluated per read, and local snapshots evaluate once', () => {
    const { host } = dynamicHost();
    const render = ssr(generated.loaded, 'Dynamic');
    let reads = 0;
    const props = {
      title: 't',
      get label() {
        reads += 1;
        return 'A';
      },
    };
    render(props, host);
    expect(reads).toBe(1);

    const localized = ssr(generated.loaded, 'Localized');
    expect(localized({ label: 'x' }, { bindings: {} })).toBe(
      '<p><!--oe:t:0-->x!<!--oe:/t:0--></p>',
    );
  });

  test('a missing host binding keeps the mount identity', () => {
    const { host } = dynamicHost();
    const render = ssr(generated.loaded, 'Dynamic');
    expect(() =>
      render({ title: 't', label: 'a' }, { bindings: { ...host.bindings, shown: undefined } }),
    ).toThrow('OEIR_LEAF_MISSING_VALUE: shown');
  });

  test('unsafe URL values are refused before a byte is produced; safe URLs escape', () => {
    const link = ssr(generated.loaded, 'Link');
    expect(link({ url: 'https://example.com/?a=1&b=2' }, { bindings: {} })).toBe(
      '<a href="https://example.com/?a=1&amp;b=2">go</a>',
    );
    let caught: unknown = null;
    try {
      link({ url: 'javascript:alert(1)' }, { bindings: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('OE_UNSAFE_URL_SINK');
  });

  test('conditions enter the producer; the remaining slice boundaries stay absent', () => {
    // M08-2 admits a condition: its branch selection is a request-time fact, so
    // the producer is present even when both branches are static. The other
    // shapes still emit no partial SSR.
    expect(generated.module).toContain('function Conditional__ssr');
    const render = ssr(generated.loaded, 'Conditional');
    expect(render({ ok: true }, { bindings: {} })).toBe(
      '<section><!--oe:when--><p>on</p><!--oe:/when--></section>',
    );
    expect(render({ ok: false }, { bindings: {} })).toBe(
      '<section><!--oe:when--><em>off</em><!--oe:/when--></section>',
    );
    for (const name of ['Listed', 'Propertied', 'Voided', 'Reused', 'Composed']) {
      expect(generated.module, name).not.toContain(`function ${name}__ssr`);
    }
  });

  test('SSR expression placements decode back to the authored slots', () => {
    const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
    const generated = generateLeafModule(front.module!, { authoredSource: SOURCE });
    expect(generated.sourceMap).not.toBeNull();
    const map = new TraceMap(
      generated.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    const ssrLine =
      generated
        .module!.split('\n')
        .findIndex((line) => line.includes('export function Dynamic__ssr')) + 1;
    const ssrPlacements = generated.placements.filter(
      (placement) => placement.generatedLine > ssrLine,
    );
    expect(ssrPlacements.length).toBeGreaterThanOrEqual(5);
    for (const placement of ssrPlacements) {
      const original = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(original.line, placement.exprId).toBe(placement.authoredLine);
      expect(original.column, placement.exprId).toBe(placement.authoredColumn);
    }
  });

  test('adjacent and empty text slots carry per-slot pairs', () => {
    const render = ssr(generated.loaded, 'MixedText');
    // Each dynamic slot has its own pair, so the parser cannot coalesce the
    // two values or the static text between them. The text-boundary browser
    // suite proves the parse -> claim -> update half.
    expect(render({ a: '1', b: '2' }, { bindings: {} })).toBe(
      '<p><!--oe:t:0-->1<!--oe:/t:0-->: <!--oe:t:1-->2<!--oe:/t:1--></p>',
    );
    // A nullish text slot is two adjacent comments and no Text bytes; the
    // claim binds the slot to null and inserts lazily only on a later update.
    expect(ssr(generated.loaded, 'EmptyText')({ value: null }, { bindings: {} })).toBe(
      '<p><!--oe:t:0--><!--oe:/t:0--></p>',
    );
  });

  test('a static directory and a dynamic slot share one producer', () => {
    // The risky interaction for the dynamic producer is the marker layer: a
    // component with a dynamic slot must still emit the same `oe:r:` pairs the
    // mount writes for a static sibling directory, or the claim would look for
    // ranges that are not in the server bytes. The bytes are asserted here;
    // the real parser + claim form is the Chromium test below.
    const label = signal('a');
    const html = ssr(generated.loaded, 'Mixed')({}, { bindings: { label } });
    expect(html).toBe(
      '<div><section>' +
        '<!--oe:r:0--><i>a</i><!--oe:/r:0-->' +
        '<!--oe:r:1--><i>b</i><!--oe:/r:1-->' +
        '</section><span><!--oe:t:0-->a<!--oe:/t:0--></span></div>',
    );
    label.value = 'z';
    expect(ssr(generated.loaded, 'Mixed')({}, { bindings: { label } })).toContain(
      '<span><!--oe:t:0-->z<!--oe:/t:0--></span>',
    );
  });

  test('the emitted module parses and is deterministic', () => {
    const second = fixture();
    expect(second.module).toBe(generated.module);
    expect(generated.module).toContain('export function Dynamic__ssr(__oe_props, __oe_host)');
    expect(generated.module).toContain('escapeText(displayValue((');
    expect(generated.module).toContain('attributeValueOf((');
    expect(generated.module).toContain('assertSafeUrlAttribute("href"');
    expect(generated.module).toContain('Boolean((');
  });
});

let runtimeBundle = '';
let runtimeBundleDir = '';

function harnessModule(module: string): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const factories = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  return `(function () {\n${body}\nwindow.__oeModule = { ${factories.join(', ')} };\n})();\n`;
}

async function buildRuntimeBundle(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m08-1b-runtime-'));
  runtimeBundleDir = dir;
  const entry = join(dir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { computed, signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeRuntime', fileName: () => 'runtime.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('runtime bundle produced no chunk');
  return chunk.code;
}

interface BrowserResult {
  readonly claimError: string | null;
  readonly claimMutations: number;
  readonly sameNode: boolean;
  readonly adopted: boolean;
  readonly title: string | null;
  readonly dataN: string | null;
  readonly hidden: boolean;
  readonly pText: string;
  readonly spanText: string;
  readonly afterPText: string;
  readonly afterSpanText: string;
  readonly afterDataN: string | null;
  readonly afterHidden: boolean;
  readonly updateMutations: number;
}

describe('M08-1b dynamic SSR producer — Chromium parse + claim', () => {
  beforeAll(async () => {
    runtimeBundle = await buildRuntimeBundle();
  }, 60_000);

  afterAll(() => {
    if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
  });

  test('the parsed dynamic SSR bytes are claimed, stay unmutated, then refresh', async () => {
    const generated = fixture();
    const { host } = dynamicHost();
    const html = ssr(generated.loaded, 'Dynamic')({ title: 'a&b"c', label: 'x<y' }, host);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: runtimeBundle });
      await page.addScriptTag({ content: harnessModule(generated.module) });
      const result = (await page.evaluate(
        async ({ html, initial }) => {
          interface SignalLike<T> {
            value: T;
          }
          interface Scope {
            dispose(detach?: boolean): void;
          }
          interface Projection {
            readonly nodes: readonly Node[];
            dispose(detach?: boolean): void;
          }
          interface Runtime {
            claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
            LifetimeScope: new () => Scope;
            signal<T>(value: T): SignalLike<T>;
            computed<T>(fn: () => T): { readonly value: T };
          }
          const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
          const factories = (
            window as unknown as {
              __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
            }
          ).__oeModule;
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          // The real browser parser consumes the Node-generated string.
          host.innerHTML = html;
          const parsed = host.firstChild as Element;

          const props = { title: initial.title, label: initial.label };
          const propsChanged = runtime.signal(0);
          const count = runtime.signal(initial.count);
          const doubled = runtime.computed(() => count.value * 2);
          const shown = runtime.signal(initial.shown);
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createDynamicRecipe!(scope, {
            props,
            bindings: { count, doubled, shown },
            propsChanged,
          });

          const mutations: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });

          let claimError: string | null = null;
          let projection: Projection | undefined;
          try {
            projection = runtime.claimRecipe(scope, recipe, host);
          } catch (error) {
            claimError = error instanceof Error ? error.message : String(error);
          }
          for (const record of observer.takeRecords()) mutations.push(record.type);
          const claimMutations = mutations.length;
          const section = host.firstChild as Element;
          const before = {
            sameNode: section === parsed,
            adopted:
              projection !== undefined &&
              projection.nodes.length > 0 &&
              projection.nodes[0] === parsed,
            title: section?.getAttribute('title') ?? null,
            dataN: section?.getAttribute('data-n') ?? null,
            hidden: section?.hasAttribute('hidden') ?? false,
            pText: section?.querySelector('p')?.textContent ?? '',
            spanText: section?.querySelector('span')?.textContent ?? '',
          };

          props.label = 'z';
          propsChanged.value += 1;
          count.value = 5;
          shown.value = true;
          await Promise.resolve();
          await Promise.resolve();
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          projection?.dispose(false);
          const afterSection = host.firstChild as Element;
          return {
            claimError,
            claimMutations,
            sameNode: before.sameNode,
            adopted: before.adopted,
            title: before.title,
            dataN: before.dataN,
            hidden: before.hidden,
            pText: before.pText,
            spanText: before.spanText,
            afterPText: afterSection?.querySelector('p')?.textContent ?? '',
            afterSpanText: afterSection?.querySelector('span')?.textContent ?? '',
            afterDataN: afterSection?.getAttribute('data-n') ?? null,
            afterHidden: afterSection?.hasAttribute('hidden') ?? false,
            updateMutations: mutations.length - claimMutations,
          };
        },
        {
          html,
          initial: { label: 'x<y', count: 12, shown: false, title: 'a&b"c' },
        },
      )) as BrowserResult;

      expect(result.claimError).toBeNull();
      expect(result.claimMutations).toBe(0);
      expect(result.sameNode).toBe(true);
      expect(result.title).toBe('a&b"c');
      expect(result.dataN).toBe('12');
      expect(result.hidden).toBe(false);
      expect(result.pText).toBe('x<y');
      expect(result.spanText).toBe('24');
      expect(result.afterPText).toBe('z');
      expect(result.afterSpanText).toBe('10');
      expect(result.afterDataN).toBe('5');
      expect(result.afterHidden).toBe(true);
      expect(result.updateMutations).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 60_000);

  test('a static directory and a dynamic slot claim together from the server bytes', async () => {
    // The seam form: the bytes are the generated `__ssr()` output, the browser
    // parser owns the nodes, and the generated claim adopts them. The static
    // sibling directory inside the dynamic component is the interaction the
    // Node test can only check as text; here the range markers must survive
    // the real parser and the claim must consume them without a mutation.
    const generated = fixture();
    const label = signal('a');
    const html = ssr(generated.loaded, 'Mixed')({}, { bindings: { label } });

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: runtimeBundle });
      await page.addScriptTag({ content: harnessModule(generated.module) });
      const result = (await page.evaluate(
        async ({ html }) => {
          interface SignalLike<T> {
            value: T;
          }
          interface Scope {
            dispose(detach?: boolean): void;
          }
          interface Projection {
            readonly nodes: readonly Node[];
            readonly owner: Scope;
            dispose(detach?: boolean): void;
          }
          interface Runtime {
            claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
            LifetimeScope: new () => Scope;
            signal<T>(value: T): SignalLike<T>;
          }
          const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
          const factories = (
            window as unknown as {
              __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
            }
          ).__oeModule;
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          host.innerHTML = html;
          const parsed = host.firstChild as Element;
          const section = parsed.querySelector('section') as Element;

          const label = runtime.signal('a');
          const scope = new runtime.LifetimeScope();
          const recipe = factories.createMixedRecipe!(scope, {
            props: {},
            bindings: { label },
            propsChanged: runtime.signal(0),
          });
          const mutations: string[] = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          let claimError: string | null = null;
          let projection: Projection | undefined;
          try {
            projection = runtime.claimRecipe(scope, recipe, host);
          } catch (error) {
            claimError = error instanceof Error ? error.message : String(error);
          }
          for (const record of observer.takeRecords()) mutations.push(record.type);
          const claimMutations = mutations.length;
          const rangeComments = [...section.childNodes]
            .filter((node) => node.nodeType === 8)
            .map((node) => node.nodeValue ?? '');
          const spanText = parsed.querySelector('span')?.textContent ?? '';

          label.value = 'z';
          await Promise.resolve();
          await Promise.resolve();
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          projection?.dispose(false);
          return {
            claimError,
            claimMutations,
            sameNode: projection !== undefined && projection.nodes[0] === parsed,
            rangeComments,
            sectionInterior: [...section.children].map((node) => node.textContent ?? ''),
            spanText,
            afterSpanText: parsed.querySelector('span')?.textContent ?? '',
          };
        },
        { html },
      )) as {
        claimError: string | null;
        claimMutations: number;
        sameNode: boolean;
        rangeComments: string[];
        sectionInterior: string[];
        spanText: string;
        afterSpanText: string;
      };

      expect(result.claimError).toBeNull();
      expect(result.claimMutations).toBe(0);
      expect(result.sameNode).toBe(true);
      // The server bytes carry the same paired markers the mount writes; the
      // claim consumed them rather than treating them as page content.
      expect(result.rangeComments).toEqual(['oe:r:0', 'oe:/r:0', 'oe:r:1', 'oe:/r:1']);
      expect(result.sectionInterior).toEqual(['a', 'b']);
      expect(result.spanText).toBe('a');
      expect(result.afterSpanText).toBe('z');
    } finally {
      await browser.close();
    }
  }, 60_000);
});
