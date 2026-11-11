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
`;

interface ClaimNode {
  nodeType: number;
  parentNode: ClaimNode | null;
  nodeValue?: string;
  localName?: string;
  tagName?: string;
  childNodes?: ClaimNode[];
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  toggleAttribute?(name: string, force?: boolean): boolean;
  appendChild?(node: ClaimNode): ClaimNode;
  removeChild?(node: ClaimNode): ClaimNode;
}

function element(tag: string): ClaimNode {
  const attrs = new Map<string, string>();
  const node: ClaimNode = {
    nodeType: 1,
    parentNode: null,
    localName: tag,
    tagName: tag.toUpperCase(),
    childNodes: [],
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name)! : null),
    hasAttribute: (name) => attrs.has(name),
    setAttribute: (name, value) => {
      attrs.set(name, value);
    },
    removeAttribute: (name) => {
      attrs.delete(name);
    },
    toggleAttribute: (name, force) => {
      const on = force === undefined ? !attrs.has(name) : force;
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    appendChild: (child) => {
      child.parentNode = node;
      node.childNodes!.push(child);
      return child;
    },
    removeChild: (child) => {
      const index = node.childNodes!.indexOf(child);
      if (index < 0) throw new Error('removeChild node is not a child');
      node.childNodes!.splice(index, 1);
      child.parentNode = null;
      return child;
    },
  };
  return node;
}

function text(value: string): ClaimNode {
  return { nodeType: 3, parentNode: null, nodeValue: value };
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
  const slot = text(textValue);
  paragraph.appendChild!(slot);
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
      `export { bindSignalWrites } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(leaf, generated.module!);
  writeFileSync(
    entry,
    [
      `export { createLeafRecipe, createEmptyRecipe } from './leaf.js';`,
      `export { claimRecipe, runtimeProbe, LifetimeScope, signal } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
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
