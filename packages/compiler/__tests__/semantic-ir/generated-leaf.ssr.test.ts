/**
 * M08-1a — the static SSR producer, and its parity with the mount.
 *
 * A claimable component whose roots are fully static now also emits
 * `<Name>__ssr()`, returning the HTML the mount would build. The proof this
 * file carries is the pairing itself: **the string the SSR producer returns is
 * byte-identical to the mount's DOM serialized under the same escape
 * contract**. That is the precondition for M08's SSR→claim parity; it is not
 * that proof yet (no browser, no claim of the SSR string).
 *
 * M08-1b widens the producer to the leaf claim's dynamic slot kinds: a
 * component with a `dynamic-text`/`attribute`/`boolean` slot now emits
 * `<Name>__ssr(props, host)` and evaluates the same lowered records at request
 * time. A fully static component keeps the parameterless M08-1a shape, so that
 * interface does not move.
 *
 * Boundary recorded by the last test: conditions, lists, `property` channels,
 * component references, insertion sites and void elements still emit no
 * `__ssr` (no partial producer). Those shapes stay mount/claim-only.
 *
 * Qualification: Node DOM shim, LOCAL. Not a browser, not SSR→claim.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/ssr.tsx';
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

const SOURCE = `import { signal } from '@openelement/element';
function Plain(props) {
  return <p id="a" class="b">x</p>;
}
function Escaped(props) {
  return <div title="a&b>c">x & y</div>;
}
function Nested(props) {
  return <section><p>one</p><p>two</p></section>;
}
function Deep(props) {
  return <div><article><p>one</p><p>two</p></article><aside><i>a</i><i>b</i></aside></div>;
}
function Counter(props) {
  const count = signal(1);
  return <p>{count.value}</p>;
}
function Conditional(props) {
  return <section>{props.ok ? <p>on</p> : <em>off</em>}</section>;
}
function Listed(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
`;

/** Minimal DOM shim: enough to mount a static generated tree and serialize it. */
interface ShimNode {
  nodeType: number;
  nodeValue: string | null;
  localName?: string;
  namespaceURI?: string;
  childNodes: ShimNode[];
  parentNode: ShimNode | null;
  readonly attributes: { name: string; value: string }[];
  setAttribute(name: string, value: string): void;
  appendChild(child: ShimNode): ShimNode;
  removeChild(child: ShimNode): ShimNode;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  toggleAttribute(name: string, force?: boolean): boolean;
}

function makeDocument(): { document: unknown; root: ShimNode } {
  const element = (tag: string): ShimNode => {
    const attributes: { name: string; value: string }[] = [];
    const node: ShimNode = {
      nodeType: 1,
      nodeValue: null,
      localName: tag,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: null,
      attributes,
      setAttribute(name, value) {
        const found = attributes.find((entry) => entry.name === name);
        if (found) found.value = value;
        else attributes.push({ name, value });
      },
      appendChild(child) {
        child.parentNode = node;
        node.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child);
        if (index < 0) throw new Error('removeChild node is not a child');
        node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      getAttribute: (name) => attributes.find((entry) => entry.name === name)?.value ?? null,
      hasAttribute: (name) => attributes.some((entry) => entry.name === name),
      removeAttribute: (name) => {
        const index = attributes.findIndex((entry) => entry.name === name);
        if (index >= 0) attributes.splice(index, 1);
      },
      toggleAttribute(name, force) {
        const has = attributes.some((entry) => entry.name === name);
        const on = force === undefined ? !has : force;
        if (on) node.setAttribute(name, '');
        else node.removeAttribute(name);
        return on;
      },
    };
    return node;
  };
  const root = element('body');
  const document = {
    createElement: (tag: string) => element(tag),
    createTextNode: (value: string) => ({
      nodeType: 3,
      nodeValue: value,
      childNodes: [],
      parentNode: null,
    }),
    createComment: (value: string) => ({
      nodeType: 8,
      nodeValue: value,
      childNodes: [],
      parentNode: null,
    }),
    body: root,
  };
  return { document, root };
}

/** Serialize a shim subtree under the runtime escape contract the SSR uses. */
function serialize(node: ShimNode): string {
  if (node.nodeType === 3) return escapeText(node.nodeValue ?? '');
  if (node.nodeType === 8) return `<!--${node.nodeValue ?? ''}-->`;
  const attributes = node.attributes
    .map((entry) => ` ${entry.name}="${escapeAttrValue(entry.value)}"`)
    .join('');
  const children = node.childNodes.map(serialize).join('');
  return `<${node.localName}${attributes}>${children}</${node.localName}>`;
}

// The SSR producer calls the runtime helpers; the test serializes with the same
// two functions imported from the same modules, so the comparison is the
// contract, not a re-implementation.
let escapeText: (value: string) => string;
let escapeAttrValue: (value: unknown) => string;

interface Loaded {
  Plain__ssr?: () => string;
  Escaped__ssr?: () => string;
  Nested__ssr?: () => string;
  Deep__ssr?: () => string;
  /** M08-1b: a dynamic slot makes the producer request-time. */
  Counter__ssr?: (
    props?: Record<string, unknown>,
    host?: { readonly bindings: Record<string, unknown> },
  ) => string;
  createPlainRecipe: (owner: unknown, host: unknown) => unknown;
  createEscapedRecipe: (owner: unknown, host: unknown) => unknown;
  createNestedRecipe: (owner: unknown, host: unknown) => unknown;
  createDeepRecipe: (owner: unknown, host: unknown) => unknown;
  createCounterRecipe: (owner: unknown, host: unknown) => unknown;
  claimRecipe: (owner: unknown, recipe: unknown, parent: unknown) => { nodes: ShimNode[] };
  LifetimeScope: new () => unknown;
  signal: <T>(value: T) => { value: T };
}

let loaded: Loaded;
let bundleDir = '';
let module_ = '';

beforeAll(async () => {
  escapeText = (await import('../../../element/src/internal/compiled/escape-text.ts')).escapeText;
  escapeAttrValue = (await import('../../../element/src/internal/core/html-escape.ts'))
    .escapeAttrValue;

  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  module_ = generated.module!;
  expect(module_).toContain('export function Plain__ssr()');

  const dir = mkdtempSync(join(tmpdir(), 'oe-m08-ssr-'));
  bundleDir = dir;
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  const leaf = join(dir, 'leaf.js');
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { bindSignalWrites } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, rangeMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(leaf, generated.module!);
  writeFileSync(
    entry,
    [
      `export { Plain__ssr, Escaped__ssr, Nested__ssr, Deep__ssr, Counter__ssr } from './leaf.js';`,
      `export { createPlainRecipe, createEscapedRecipe, createNestedRecipe, createDeepRecipe, createCounterRecipe } from './leaf.js';`,
      `export { claimRecipe, LifetimeScope, signal } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim } },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'mod.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('SSR bundle produced no chunk');
  const out = join(dir, 'mod.js');
  writeFileSync(out, chunk.code);
  loaded = (await import(pathToFileURL(out).href)) as Loaded;
}, 60_000);

afterAll(() => {
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

function mountAndSerialize(
  create: (owner: unknown, host: unknown) => unknown,
  body: { props?: Record<string, unknown>; bindings?: Record<string, unknown> } = {},
): string {
  const { document } = makeDocument();
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = document;
  try {
    const owner = new loaded.LifetimeScope();
    const recipe = create(owner, {
      bindings: body.bindings ?? {},
      props: body.props ?? {},
      propsChanged: loaded.signal(0),
    });
    const mounted = (recipe as { mount: (scope: unknown) => ShimNode[] }).mount(owner);
    return mounted.map(serialize).join('');
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}

describe('M08-1a static SSR producer', () => {
  test('a static leaf produces the same bytes as its mount', () => {
    const html = loaded.Plain__ssr!();
    expect(html).toBe('<p id="a" class="b">x</p>');
    expect(html).toBe(mountAndSerialize(loaded.createPlainRecipe));
  });

  test('text and attribute values are escaped through the runtime contract', () => {
    const html = loaded.Escaped__ssr!();
    // `&` in the attribute value and `>` in text both go through the
    // runtime escape contract, so the bytes match what the mount writes.
    expect(html).toBe('<div title="a&amp;b&gt;c">x &amp; y</div>');
    expect(html).toBe(mountAndSerialize(loaded.createEscapedRecipe));
  });

  test('a static sibling directory carries the same markers as its mount', () => {
    // Two fully static element children are a directory: the mount emits the
    // range markers and the claim consumes them, so the SSR string must carry
    // the identical comments or the claim could not find its ranges.
    const html = loaded.Nested__ssr!();
    expect(html).toBe(
      '<section><!--oe:r:0--><p>one</p><!--oe:/r:0--><!--oe:r:1--><p>two</p><!--oe:/r:1--></section>',
    );
    expect(html).toBe(mountAndSerialize(loaded.createNestedRecipe));
  });

  test('a directory inside a range carries no nested markers, matching the mount', () => {
    // The mount suppresses directory markers inside a range (`allowDirectory`
    // false in emitMountedDirectory). The SSR form must apply the same
    // suppression: the range interior is a plain static subtree, not another
    // marker layer the claim would reject.
    const html = loaded.Deep__ssr!();
    const starts = [...html.matchAll(/<!--oe:r:(\d+)-->/g)].map((match) => match[1]);
    const ends = [...html.matchAll(/<!--oe:\/r:(\d+)-->/g)].map((match) => match[1]);
    expect(starts).toEqual(['0', '1']);
    expect(ends).toEqual(['0', '1']);
    expect(html).toBe(
      '<div>' +
        '<!--oe:r:0--><article><p>one</p><p>two</p></article><!--oe:/r:0-->' +
        '<!--oe:r:1--><aside><i>a</i><i>b</i></aside><!--oe:/r:1-->' +
        '</div>',
    );
    expect(html).toBe(mountAndSerialize(loaded.createDeepRecipe));
  });

  test('a dynamic leaf produces request-time bytes that match its mount (M08-1b)', () => {
    // Counter used to be the recorded boundary of M08-1a: a dynamic text slot
    // had no compile-time value, so it emitted no `__ssr`. M08-1b widens the
    // producer instead of dropping the shape, so the assertion flips from
    // absence to parity — the request-time string is the mount's serialized
    // DOM under the same escape contract, for the same host binding.
    expect(module_).toContain('export function Counter__ssr(__oe_props, __oe_host) {');
    const count = loaded.signal(1);
    const host = { bindings: { count } };
    expect(loaded.Counter__ssr!({}, host)).toBe('<p>1</p>');
    expect(loaded.Counter__ssr!({}, host)).toBe(
      mountAndSerialize(loaded.createCounterRecipe, { bindings: { count } }),
    );

    // Request-time, not a compile-time snapshot: the next call re-reads the
    // binding, and both sides move together.
    count.value = 7;
    expect(loaded.Counter__ssr!({}, host)).toBe('<p>7</p>');
    expect(loaded.Counter__ssr!({}, host)).toBe(
      mountAndSerialize(loaded.createCounterRecipe, { bindings: { count } }),
    );
  });

  test('conditions and lists stay outside the SSR producer (new recorded boundary)', () => {
    // The M08-1b slice admits the leaf claim's dynamic slot kinds only. A
    // condition and a list remain mount/claim-refused shapes, so the producer
    // stays absent rather than emitting a partial form the claim could not
    // adopt. These are the shapes M08-2/M08-5 still owe.
    expect(module_).not.toContain('function Conditional__ssr');
    expect(module_).not.toContain('function Listed__ssr');
    // The dynamic leaf itself is present, so the absence above is a boundary
    // and not a producer that failed to emit anything.
    expect(module_).toContain('function Counter__ssr');
  });
});
