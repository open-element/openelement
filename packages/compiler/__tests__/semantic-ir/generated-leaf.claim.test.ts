/**
 * M07a — execute a generated leaf claim.
 *
 * The bundle contains the generator output and the real M04 runtime as one
 * module graph. Node DOM shim, not a browser, not SSR, not a packed consumer.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/claim.tsx';
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

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
function Leaf(props) {
  const count = signal(1);
  return <p id="t" hidden={props.on} data-n={count.value}>{count.value}</p>;
}
function Empty(props) {
  return <></>;
}
function Plain(props) {
  return <p id="a" class="b">x</p>;
}
function Cased(props) {
  return <p id="a" data-Mixed="V">x</p>;
}
`;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

interface ClaimAttribute {
  name: string;
  value: string;
}

interface ClaimNode {
  nodeType: number;
  parentNode: ClaimNode | null;
  nodeValue?: string;
  localName?: string;
  tagName?: string;
  namespaceURI?: string | null;
  childNodes?: ClaimNode[];
  readonly firstChild?: ClaimNode | null;
  readonly nextSibling?: ClaimNode | null;
  attributes?: { readonly length: number; item(index: number): ClaimAttribute | null };
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  toggleAttribute?(name: string, force?: boolean): boolean;
  appendChild?(node: ClaimNode): ClaimNode;
  insertBefore?(node: ClaimNode, reference: ClaimNode | null): ClaimNode;
  removeChild?(node: ClaimNode): ClaimNode;
  remove?(): void;
}

function element(tag: string, namespaceURI: string | null = HTML_NAMESPACE): ClaimNode {
  const attrs: ClaimAttribute[] = [];
  const attributes = {
    get length() {
      return attrs.length;
    },
    item(index: number) {
      return attrs[index] ?? null;
    },
  };
  const node: ClaimNode = {
    nodeType: 1,
    parentNode: null,
    localName: tag,
    tagName: tag.toUpperCase(),
    namespaceURI,
    childNodes: [],
    attributes,
    get firstChild() {
      return node.childNodes![0] ?? null;
    },
    get nextSibling() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
    getAttribute: (name) => attrs.find((entry) => entry.name === name)?.value ?? null,
    hasAttribute: (name) => attrs.some((entry) => entry.name === name),
    setAttribute: (name, value) => {
      const found = attrs.find((entry) => entry.name === name);
      if (found) found.value = value;
      else attrs.push({ name, value });
    },
    removeAttribute: (name) => {
      const index = attrs.findIndex((entry) => entry.name === name);
      if (index >= 0) attrs.splice(index, 1);
    },
    toggleAttribute: (name, force) => {
      const has = attrs.some((entry) => entry.name === name);
      const on = force === undefined ? !has : force;
      if (on) node.setAttribute!(name, '');
      else node.removeAttribute!(name);
      return on;
    },
    appendChild: (child) => {
      child.parentNode?.removeChild?.(child);
      child.parentNode = node;
      node.childNodes!.push(child);
      return child;
    },
    insertBefore: (child, reference) => {
      child.parentNode?.removeChild?.(child);
      if (reference === null) return node.appendChild!(child);
      const index = node.childNodes!.indexOf(reference);
      if (index < 0) throw new Error('insertBefore reference is not a child');
      child.parentNode = node;
      node.childNodes!.splice(index, 0, child);
      return child;
    },
    removeChild: (child) => {
      const index = node.childNodes!.indexOf(child);
      if (index < 0) throw new Error('removeChild node is not a child');
      node.childNodes!.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove: () => {
      node.parentNode?.removeChild?.(node);
    },
  };
  return node;
}

function text(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 3, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}

function comment(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 8, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}

function leafDom(
  textValue: string,
  options: { hidden?: boolean; id?: string } = {},
): {
  parent: ClaimNode;
  paragraph: ClaimNode;
  text: ClaimNode;
} {
  const parent = element('div');
  const paragraph = element('p');
  paragraph.setAttribute!('id', options.id ?? 't');
  if (options.hidden === true) paragraph.setAttribute!('hidden', '');
  paragraph.appendChild!(comment('oe:t:0'));
  const slot = text(textValue);
  paragraph.appendChild!(slot);
  paragraph.appendChild!(comment('oe:/t:0'));
  parent.appendChild!(paragraph);
  return { parent, paragraph, text: slot };
}

interface Probe {
  subscriptions: number;
  unsubscribed: number;
  projections: number;
}

interface Loaded {
  createLeafRecipe: (owner: unknown, host: unknown) => { claim?: unknown };
  createEmptyRecipe: (owner: unknown, host: unknown) => unknown;
  createPlainRecipe: (owner: unknown, host: unknown) => unknown;
  createCasedRecipe: (owner: unknown, host: unknown) => unknown;
  OpenElementError: new (...args: unknown[]) => Error & { code?: string };
  claimRecipe: (
    owner: unknown,
    recipe: unknown,
    parent: unknown,
  ) => {
    nodes: unknown[];
    dispose: (detach?: boolean) => void;
  };
  runtimeProbe: { snapshot: () => Probe; reset: () => void };
  LifetimeScope: new () => unknown;
  signal: <T>(value: T) => { value: T };
}

let loaded: Loaded;
let bundleDir = '';

beforeAll(async () => {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics, generated.diagnostics.map((d) => d.message).join('\n')).toEqual([]);
  expect(generated.module).toContain('function Leaf__claim');
  expect(generated.module).toContain('function Empty__claim');
  const dir = mkdtempSync(join(tmpdir(), 'oe-m07a-'));
  bundleDir = dir;
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  const leaf = join(dir, 'leaf.js');
  const entry = join(dir, 'entry.ts');
  // Same narrow modules the browser harness bundles. The full runtime barrel
  // is the Part Program facade; this slice does not execute through it.
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { OpenElementError } from ${JSON.stringify(join(REPO_ROOT, 'packages/protocol/src/errors.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(leaf, generated.module!);
  writeFileSync(
    entry,
    [
      `export { createLeafRecipe, createEmptyRecipe, createPlainRecipe, createCasedRecipe } from './leaf.js';`,
      `export { claimRecipe, runtimeProbe, LifetimeScope, signal, OpenElementError } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
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
  if (chunk?.code === undefined) throw new Error('claim bundle produced no chunk');
  const out = join(dir, 'mod.js');
  writeFileSync(out, chunk.code);
  loaded = (await import(pathToFileURL(out).href)) as Loaded;
}, 60_000);

afterAll(() => {
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  loaded.runtimeProbe.reset();
});

function hostFor(
  count: { value: number },
  props: { on: boolean },
  propsChanged: { value: number },
) {
  return { bindings: { count }, props, propsChanged };
}

describe('M07a generated leaf claim', () => {
  test('adopts the existing nodes, writes client state once, and keeps one subscription set', () => {
    const count = loaded.signal(1);
    const props = { on: false };
    const propsChanged = loaded.signal(0);
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createLeafRecipe(owner, hostFor(count, props, propsChanged));
    const dom = leafDom('server', { hidden: true });
    const before = loaded.runtimeProbe.snapshot();
    const projection = loaded.claimRecipe(owner, recipe, dom.parent);
    const after = loaded.runtimeProbe.snapshot();

    expect(projection.nodes).toEqual([dom.paragraph]);
    expect(dom.parent.childNodes).toEqual([dom.paragraph]);
    expect(dom.text.nodeValue).toBe('1');
    expect(dom.paragraph.getAttribute!('id')).toBe('t');
    expect(dom.paragraph.getAttribute!('data-n')).toBe('1');
    expect(dom.paragraph.getAttribute!('hidden')).toBeNull();
    expect(after.subscriptions - before.subscriptions).toBe(3);

    count.value = 5;
    expect(dom.text.nodeValue).toBe('5');
    expect(dom.paragraph.getAttribute!('data-n')).toBe('5');
    expect(loaded.runtimeProbe.snapshot().subscriptions - before.subscriptions).toBe(3);

    props.on = true;
    propsChanged.value = 1;
    expect(dom.paragraph.getAttribute!('hidden')).toBe('');

    projection.dispose(false);
    expect(dom.parent.childNodes).toEqual([dom.paragraph]);
    expect(loaded.runtimeProbe.snapshot().unsubscribed - before.unsubscribed).toBe(3);
    count.value = 8;
    expect(dom.text.nodeValue).toBe('5');
  });

  test('a structural mismatch throws before subscribe and leaves the foreign DOM', () => {
    const count = loaded.signal(1);
    const propsChanged = loaded.signal(0);
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createLeafRecipe(owner, hostFor(count, { on: false }, propsChanged));
    const dom = leafDom('server', { id: 'nope', hidden: true });
    const before = loaded.runtimeProbe.snapshot();
    expect(() => loaded.claimRecipe(owner, recipe, dom.parent)).toThrow(
      /OEIR_LEAF_CLAIM_MISMATCH: static attribute id/,
    );
    const after = loaded.runtimeProbe.snapshot();
    expect(dom.parent.childNodes).toEqual([dom.paragraph]);
    expect(dom.text.nodeValue).toBe('server');
    expect(dom.paragraph.getAttribute!('hidden')).toBe('');
    expect(dom.paragraph.getAttribute!('data-n')).toBeNull();
    expect(after.subscriptions - before.subscriptions).toBe(0);
    expect(after.unsubscribed - before.unsubscribed).toBe(0);
    expect(after.projections - before.projections).toBe(0);
  });

  test('two claimed copies subscribe independently', () => {
    const count = loaded.signal(1);
    const propsChanged = loaded.signal(0);
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createLeafRecipe(owner, hostFor(count, { on: false }, propsChanged));
    const first = leafDom('a');
    const second = leafDom('b');
    const a = loaded.claimRecipe(owner, recipe, first.parent);
    const b = loaded.claimRecipe(owner, recipe, second.parent);
    expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(6);
    count.value = 2;
    expect(first.text.nodeValue).toBe('2');
    expect(second.text.nodeValue).toBe('2');
    a.dispose(true);
    expect(first.parent.childNodes).toEqual([]);
    expect(second.parent.childNodes).toEqual([second.paragraph]);
    count.value = 3;
    expect(second.text.nodeValue).toBe('3');
    expect(loaded.runtimeProbe.snapshot().unsubscribed).toBe(3);
    b.dispose(false);
    expect(second.parent.childNodes).toEqual([second.paragraph]);
  });

  test('an empty fragment claims an empty parent and rejects an extra child', () => {
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createEmptyRecipe(owner, {
      bindings: {},
      props: {},
      propsChanged: loaded.signal(0),
    });
    const parent = element('div');
    const projection = loaded.claimRecipe(owner, recipe, parent);
    expect(projection.nodes).toEqual([]);
    expect(parent.childNodes).toEqual([]);
    const occupied = element('div');
    occupied.appendChild!(text('x'));
    expect(() => loaded.claimRecipe(owner, recipe, occupied)).toThrow(
      /OEIR_LEAF_CLAIM_MISMATCH: extra node/,
    );
    expect(occupied.childNodes).toHaveLength(1);
    expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);
  });
});

function plainDom(options: {
  attributes?: ReadonlyArray<readonly [string, string]>;
  namespaceURI?: string | null;
  parentNamespace?: string | null;
  ancestorNamespace?: string | null;
  text?: string;
}): { parent: ClaimNode; paragraph: ClaimNode; text: ClaimNode } {
  const ancestor =
    options.ancestorNamespace === undefined ? null : element('section', options.ancestorNamespace);
  const parent = element(
    'div',
    options.parentNamespace === undefined ? HTML_NAMESPACE : options.parentNamespace,
  );
  if (ancestor) ancestor.appendChild!(parent);
  const paragraph = element(
    'p',
    options.namespaceURI === undefined ? HTML_NAMESPACE : options.namespaceURI,
  );
  for (const [name, value] of options.attributes ?? [
    ['id', 'a'],
    ['class', 'b'],
  ]) {
    paragraph.setAttribute!(name, value);
  }
  const slot = text(options.text ?? 'x');
  paragraph.appendChild!(slot);
  parent.appendChild!(paragraph);
  return { parent, paragraph, text: slot };
}

function captureClaim(run: () => unknown): Error & { code?: string } {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected a failure');
}

describe('M07-5 generated-leaf protocol (非浏览器资格, Node DOM shim, LOCAL)', () => {
  function claimCased(dom: { parent: ClaimNode }): void {
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createCasedRecipe(owner, {
      bindings: {},
      props: {},
      propsChanged: loaded.signal(0),
    });
    loaded.claimRecipe(owner, recipe, dom.parent);
  }

  function claimPlain(dom: { parent: ClaimNode }): void {
    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createPlainRecipe(owner, {
      bindings: {},
      props: {},
      propsChanged: loaded.signal(0),
    });
    loaded.claimRecipe(owner, recipe, dom.parent);
  }

  test('static attribute names are HTML case-folded for the seed', () => {
    // The HTML DOM lowercases attribute names; the Node DOM shim does not.
    // Feed the lowercased form a browser exposes and assert the generated
    // claim compares the declared authored name after the same case folding.
    const dom = plainDom({
      attributes: [
        ['id', 'a'],
        ['data-mixed', 'V'],
      ],
    });
    claimCased(dom);
    expect(dom.text.nodeValue).toBe('x');
    expect(dom.paragraph.attributes!.length).toBe(2);
    expect(dom.paragraph.attributes!.item(1)?.name).toBe('data-mixed');
    expect(dom.paragraph.getAttribute!('data-mixed')).toBe('V');
  });

  test('static attributes succeed only as an exact ordered set', () => {
    const dom = plainDom({});
    claimPlain(dom);
    expect(dom.text.nodeValue).toBe('x');
    expect(dom.paragraph.getAttribute!('id')).toBe('a');
    expect(dom.paragraph.getAttribute!('class')).toBe('b');
    expect(dom.paragraph.attributes!.length).toBe(2);
  });

  test('an extra static attribute fails before any write', () => {
    const dom = plainDom({
      attributes: [
        ['id', 'a'],
        ['class', 'b'],
        ['data-x', 'extra'],
      ],
    });
    const before = loaded.runtimeProbe.snapshot();
    const error = captureClaim(() => claimPlain(dom));
    expect(error).toBeInstanceOf(loaded.OpenElementError);
    expect(error.constructor).not.toBe(Error);
    expect(error.name).toBe('OpenElementError');
    expect(error.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(error.message).toContain('static attribute seed');
    expect(dom.text.nodeValue).toBe('x');
    expect(dom.paragraph.getAttribute!('data-x')).toBe('extra');
    expect(loaded.runtimeProbe.snapshot().subscriptions - before.subscriptions).toBe(0);
  });

  test('a missing static attribute fails before any write', () => {
    const dom = plainDom({ attributes: [['id', 'a']] });
    const error = captureClaim(() => claimPlain(dom));
    expect(error.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(error.name).toBe('OpenElementError');
    expect(dom.text.nodeValue).toBe('x');
    expect(dom.paragraph.attributes!.length).toBe(1);
  });

  test('static attributes in the wrong order fail before any write', () => {
    const dom = plainDom({
      attributes: [
        ['class', 'b'],
        ['id', 'a'],
      ],
    });
    const error = captureClaim(() => claimPlain(dom));
    expect(error.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(error.message).toContain('static attribute id');
    expect(dom.paragraph.attributes!.item(0)?.name).toBe('class');
    expect(dom.text.nodeValue).toBe('x');
  });

  test('a non-HTML parent, ancestor, or node is rejected before any write', () => {
    const svg = 'http://www.w3.org/2000/svg';
    for (const dom of [
      plainDom({ parentNamespace: null }),
      plainDom({ ancestorNamespace: svg }),
      plainDom({ namespaceURI: svg }),
    ]) {
      const error = captureClaim(() => claimPlain(dom));
      expect(error).toBeInstanceOf(loaded.OpenElementError);
      expect(error.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(error.code).not.toBe('OE_RUNTIME_STATIC_RANGE_MISMATCH');
      expect(error.message).toContain('non-HTML namespace');
      expect(dom.text.nodeValue).toBe('x');
      expect(dom.paragraph.getAttribute!('id')).toBe('a');
      expect(dom.paragraph.getAttribute!('class')).toBe('b');
    }
  });
});
