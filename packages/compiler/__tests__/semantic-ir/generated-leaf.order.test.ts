/**
 * M07-1 — composition / repeated-insertion claim order.
 *
 * The claim input is the generated mount tree (or the same nodes after
 * dispose(false)). This is not SSR→claim. Node DOM shim, not a browser.
 * A directory `activate` of `() => {}` is not a dynamic claim. A failed
 * claimRecipe's monotonic owner/region counters are not a pass.
 *
 * The adversarial shape is claimed here. The clearance source test in
 * `generated-leaf.directory.test.ts` is not this slice.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/order.tsx';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const SOURCE = `import { signal } from '@openelement/element';
function Twice(props) {
  const item = <span><b>x</b><i>y</i></span>;
  return <div>{item}{item}</div>;
}
function Flat(props) {
  const item = <span>x<i>y</i></span>;
  return <div>{item}{item}</div>;
}
function Frame(props) {
  return <div><section>{props.children}</section><aside>{props.children}</aside></div>;
}
function Repeat(props) {
  const label = signal('a');
  return <Frame><b>{label.value}</b><i>y</i></Frame>;
}
function Adversarial(props) {
  return <div><p>a</p><section><><div><b>x</b><i>y</i></div></></section></div>;
}
function Wrapped(props) {
  return <div><Adversarial /></div>;
}
function Child(props) {
  return <em>{props.text}</em>;
}
function Mixed(props) {
  const chip = <i>c</i>;
  return <div><b>b</b>{chip}<Child text="k" /><u>u</u></div>;
}
`;

function generate(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(
    generated.diagnostics,
    generated.diagnostics.map((item) => item.message).join('\n'),
  ).toEqual([]);
  return generated.module!;
}

function functionBody(module: string, name: string): string {
  const start = module.indexOf(`function ${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const next = module.indexOf('\nfunction ', start + 1);
  return module.slice(start, next === -1 ? module.length : next);
}

test('claim source follows authored insertion order and keeps one directory layer', () => {
  const module = generate(SOURCE);
  expect(module).toContain('let __oe_claimCursor = null;');
  expect(module).toContain('claimRecipe(');

  const twiceMount = functionBody(module, 'Twice__mount');
  const twiceClaim = functionBody(module, 'Twice__claim');
  expect(twiceMount.match(/insertRecipe\(/g)?.length).toBe(2);
  expect([...twiceMount.matchAll(/emitComment\(rangeMarker\((\d+)\)/g)].map((m) => m[1])).toEqual([
    '0',
    '1',
  ]);
  expect(
    [...twiceMount.matchAll(/emitComment\(rangeMarker\((\d+), true\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(twiceClaim.match(/claimRecipe\(/g)?.length).toBe(2);
  expect(twiceClaim).toMatch(/claimStaticSiblingRange\([^,]+, 0,/);
  expect(twiceClaim).toMatch(/claimStaticSiblingRange\([^,]+, 1,/);
  expect(twiceClaim).not.toContain('rangeMarkerText(2');

  const flatClaim = functionBody(module, 'Flat__claim');
  expect(flatClaim.match(/claimRecipe\(/g)?.length).toBe(2);
  expect(flatClaim).not.toContain('rangeMarkerText(');

  const frameClaim = functionBody(module, 'Frame__claim');
  expect(frameClaim.match(/claimRecipe\(/g)?.length).toBe(2);
  expect(frameClaim).toContain('__oe_props.children');

  const adversarialMount = functionBody(module, 'Adversarial__mount');
  const adversarialClaim = functionBody(module, 'Adversarial__claim');
  expect(
    [...adversarialMount.matchAll(/emitComment\(rangeMarker\((\d+)\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(
    [...adversarialMount.matchAll(/emitComment\(rangeMarker\((\d+), true\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(adversarialMount).not.toContain('rangeMarkerText(2');
  expect(adversarialClaim).toMatch(/claimStaticSiblingRange\([^,]+, 0,/);
  expect(adversarialClaim).toMatch(/claimStaticSiblingRange\([^,]+, 1,/);
  expect(adversarialClaim).not.toContain('rangeMarkerText(2');
  expect(adversarialClaim).not.toContain('openStaticSiblingDirectory(__oe_parent');

  const mixedMount = functionBody(module, 'Mixed__mount');
  const mixedClaim = functionBody(module, 'Mixed__claim');
  const mountB = mixedMount.indexOf('document.createElement("b")');
  const mountInsert = mixedMount.indexOf('insertRecipe(');
  const mountChild = mixedMount.indexOf('Child__mount(');
  const mountU = mixedMount.indexOf('document.createElement("u")');
  expect(mountB).toBeGreaterThanOrEqual(0);
  expect(mountInsert).toBeGreaterThan(mountB);
  expect(mountChild).toBeGreaterThan(mountInsert);
  expect(mountU).toBeGreaterThan(mountChild);
  const claimB = mixedClaim.indexOf("expected element 'b'");
  const claimInsert = mixedClaim.indexOf('claimRecipe(');
  const claimChild = mixedClaim.indexOf('Child__claim(');
  const claimU = mixedClaim.indexOf("expected element 'u'");
  expect(claimB).toBeGreaterThanOrEqual(0);
  expect(claimInsert).toBeGreaterThan(claimB);
  expect(claimChild).toBeGreaterThan(claimInsert);
  expect(claimU).toBeGreaterThan(claimChild);
  expect(mixedMount).not.toContain('rangeMarkerText(');
  expect(mixedClaim).not.toContain('rangeMarkerText(');
});

class DomNode {
  parentNode: DomParent | null = null;
  constructor(readonly nodeType: number) {}
  get nextSibling(): DomNode | null {
    const parent = this.parentNode;
    if (parent === null) return null;
    const index = parent.childNodes.indexOf(this);
    return index < 0 ? null : (parent.childNodes[index + 1] ?? null);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

interface DomParent {
  childNodes: DomNode[];
  removeChild(node: DomNode): DomNode;
}

class DomText extends DomNode {
  constructor(private value: string) {
    super(3);
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(value: string) {
    this.value = value;
  }
}

class DomComment extends DomNode {
  constructor(private value: string) {
    super(8);
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(value: string) {
    this.value = value;
  }
}

class DomAttributes {
  readonly entries: { name: string; value: string }[] = [];
  get length(): number {
    return this.entries.length;
  }
  item(index: number): { name: string; value: string } | null {
    return this.entries[index] ?? null;
  }
  set(name: string, value: string): void {
    const found = this.entries.find((entry) => entry.name === name);
    if (found) found.value = value;
    else this.entries.push({ name, value });
  }
  delete(name: string): void {
    const index = this.entries.findIndex((entry) => entry.name === name);
    if (index >= 0) this.entries.splice(index, 1);
  }
}

class DomElement extends DomNode implements DomParent {
  readonly childNodes: DomNode[] = [];
  readonly attributes = new DomAttributes();
  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null;
  }
  constructor(
    readonly localName: string,
    readonly namespaceURI: string | null = HTML_NAMESPACE,
  ) {
    super(1);
  }
  get tagName(): string {
    return this.localName.toUpperCase();
  }
  getAttribute(name: string): string | null {
    const found = this.attributes.entries.find((entry) => entry.name === name);
    return found ? found.value : null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force === undefined ? this.getAttribute(name) === null : force;
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return on;
  }
  appendChild(node: DomNode): DomNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: DomNode, before: DomNode | null): DomNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = before === null ? -1 : this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  removeChild(node: DomNode): DomNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild node is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class DomFragment extends DomNode implements DomParent {
  readonly childNodes: DomNode[] = [];
  constructor() {
    super(11);
  }
  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null;
  }
  appendChild(node: DomNode): DomNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: DomNode, before: DomNode | null): DomNode {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = before === null ? -1 : this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  removeChild(node: DomNode): DomNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild node is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class DomDocument {
  createElement(tag: string): DomElement {
    return new DomElement(tag, HTML_NAMESPACE);
  }
  createTextNode(value: string): DomText {
    return new DomText(value);
  }
  createComment(value: string): DomComment {
    return new DomComment(value);
  }
  createDocumentFragment(): DomFragment {
    return new DomFragment();
  }
}

interface Scope {
  disposed: boolean;
  child(): Scope;
  dispose(detach?: boolean): void;
}

interface Projection {
  region: number;
  nodes: DomNode[];
  owner: Scope;
  props: unknown;
  dispose(detach?: boolean): void;
}

interface ClaimRecord {
  parent: DomNode;
  projection: Projection;
}

interface Loaded {
  createTwiceRecipe: (owner: unknown, host: unknown) => unknown;
  createFlatRecipe: (owner: unknown, host: unknown) => unknown;
  createRepeatRecipe: (owner: unknown, host: unknown) => unknown;
  createAdversarialRecipe: (owner: unknown, host: unknown) => unknown;
  createWrappedRecipe: (owner: unknown, host: unknown) => unknown;
  createMixedRecipe: (owner: unknown, host: unknown) => unknown;
  claimRecipe: (owner: unknown, recipe: unknown, parent: unknown) => Projection;
  insertRecipe: (owner: unknown, recipe: unknown, parent: unknown) => Projection;
  claimLog: ClaimRecord[];
  signal: <T>(value: T) => { value: T };
  LifetimeScope: new () => Scope;
}

let loaded: Loaded;
let bundleDir = '';

beforeAll(async () => {
  const module = generate(SOURCE);
  const dir = mkdtempSync(join(tmpdir(), 'oe-m07-1-order-'));
  bundleDir = dir;
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  const leaf = join(dir, 'leaf.js');
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    shim,
    [
      `import { claimRecipe as claimRecipeImpl, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { createRecipe, insertRecipe };`,
      `export const claimLog: { parent: unknown; projection: unknown }[] = [];`,
      `export function claimRecipe(owner: unknown, recipe: unknown, parent: unknown) {`,
      `  const projection = claimRecipeImpl(owner as never, recipe as never, parent as never);`,
      `  claimLog.push({ parent, projection });`,
      `  return projection;`,
      `}`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
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
  writeFileSync(leaf, module);
  writeFileSync(
    entry,
    [
      `export { createTwiceRecipe, createFlatRecipe, createRepeatRecipe, createAdversarialRecipe, createWrappedRecipe, createMixedRecipe } from './leaf.js';`,
      `export { claimLog, claimRecipe, insertRecipe, LifetimeScope, signal } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
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
  if (chunk?.code === undefined) throw new Error('order bundle produced no chunk');
  const out = join(dir, 'mod.js');
  writeFileSync(out, chunk.code);
  loaded = (await import(pathToFileURL(out).href)) as Loaded;
}, 60_000);

afterAll(() => {
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  loaded.claimLog.length = 0;
});

function useDocument(doc: DomDocument): void {
  (globalThis as { document?: DomDocument }).document = doc;
}

function host(bindings: Record<string, unknown> = {}): {
  bindings: Record<string, unknown>;
  props: Record<string, unknown>;
} {
  return { bindings, props: {} };
}

function nodeLabel(node: DomNode): string {
  if (node.nodeType === 8) return (node as DomComment).nodeValue;
  if (node.nodeType === 3) return JSON.stringify((node as DomText).nodeValue);
  if (node.nodeType === 1) return (node as DomElement).localName;
  return String(node.nodeType);
}

function childLabels(node: DomElement): string[] {
  return node.childNodes.map(nodeLabel);
}

/** Comment markers anywhere under `node`, not including `node` itself. */
function nestedMarkers(node: DomNode): string[] {
  if (node.nodeType !== 1) return [];
  const found: string[] = [];
  const walk = (current: DomElement, top: boolean) => {
    for (const child of current.childNodes) {
      if (!top && child.nodeType === 8) {
        const value = (child as DomComment).nodeValue;
        if (value.startsWith('oe:r:') || value.startsWith('oe:/r:')) found.push(value);
      }
      if (child.nodeType === 1) walk(child as DomElement, false);
    }
  };
  walk(node, true);
  return found;
}

function mountAndClaim(
  create: (owner: Scope) => unknown,
  parent: DomElement,
): { claimed: Projection; inner: Projection[] } {
  const owner = new loaded.LifetimeScope();
  const recipe = create(owner);
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  mounted.dispose(false);
  expect(mounted.owner.disposed).toBe(true);
  loaded.claimLog.length = 0;
  const claimed = loaded.claimRecipe(owner, recipe, parent);
  const inner = loaded.claimLog
    .filter((record) => record.projection !== claimed)
    .map((record) => record.projection);
  return { claimed, inner };
}

test('the same recipe inserted twice claims two projections in authored order', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createTwiceRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const div = mounted.nodes[0] as DomElement;
  expect(div.localName).toBe('div');
  const spans = div.childNodes.filter((node) => node.nodeType === 1) as DomElement[];
  expect(spans).toHaveLength(2);
  expect(spans[0]).not.toBe(spans[1]);
  for (const span of spans) {
    expect(childLabels(span)).toEqual(['oe:r:0', 'b', 'oe:/r:0', 'oe:r:1', 'i', 'oe:/r:1']);
    expect(nestedMarkers(span)).toEqual([]);
    expect((span.childNodes[1] as DomElement).childNodes.map(nodeLabel)).toEqual(['"x"']);
    expect((span.childNodes[4] as DomElement).childNodes.map(nodeLabel)).toEqual(['"y"']);
  }
  const spanOrder = [...spans];
  mounted.dispose(false);

  loaded.claimLog.length = 0;
  const claimed = loaded.claimRecipe(owner, recipe, parent);
  const inner = loaded.claimLog
    .filter((record) => record.projection !== claimed)
    .map((record) => record.projection);
  expect(inner).toHaveLength(2);
  expect(inner[0]).not.toBe(inner[1]);
  expect(inner[0]!.region).not.toBe(inner[1]!.region);
  expect(inner[0]!.owner).not.toBe(inner[1]!.owner);
  expect(inner[0]!.owner).not.toBe(claimed.owner);
  expect(inner[0]!.nodes).toEqual([spanOrder[0]]);
  expect(inner[1]!.nodes).toEqual([spanOrder[1]]);
  expect(div.childNodes[0]).toBe(spanOrder[0]);
  expect(div.childNodes[1]).toBe(spanOrder[1]);
  expect(claimed.nodes).toEqual([div]);

  inner[0]!.dispose(true);
  expect(spanOrder[0]!.parentNode).toBeNull();
  expect(spanOrder[1]!.parentNode).toBe(div);
  expect(childLabels(spanOrder[1]!)).toEqual(['oe:r:0', 'b', 'oe:/r:0', 'oe:r:1', 'i', 'oe:/r:1']);
  expect(inner[1]!.owner.disposed).toBe(false);
});

test('each repeated insertion claims its own interior in authored order', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const { claimed, inner } = mountAndClaim(
    (owner) => loaded.createFlatRecipe(owner, host()),
    parent,
  );
  const div = claimed.nodes[0] as DomElement;
  expect(inner).toHaveLength(2);
  expect(inner[0]!.nodes).toHaveLength(1);
  expect(inner[1]!.nodes).toHaveLength(1);
  expect(inner[0]!.nodes[0]).not.toBe(inner[1]!.nodes[0]);
  expect(div.childNodes).toEqual([inner[0]!.nodes[0], inner[1]!.nodes[0]]);
  for (const span of inner.map((projection) => projection.nodes[0] as DomElement)) {
    expect(childLabels(span)).toEqual(['"x"', 'i']);
    expect((span.childNodes[1] as DomElement).childNodes.map(nodeLabel)).toEqual(['"y"']);
  }
  expect(div.childNodes.some((node) => node.nodeType === 8)).toBe(false);
  const second = inner[1]!.nodes[0] as DomElement;
  const secondChildren = [...second.childNodes];
  inner[0]!.dispose(true);
  expect(div.childNodes).toEqual([second]);
  expect(second.childNodes).toEqual(secondChildren);
  expect(childLabels(second)).toEqual(['"x"', 'i']);
});

test('swapped nodes at the first insertion are rejected and the other site stays put', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createFlatRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const div = mounted.nodes[0] as DomElement;
  mounted.dispose(false);
  const first = div.childNodes[0] as DomElement;
  const other = div.childNodes[1] as DomElement;
  const otherChildren = [...other.childNodes];
  const text = first.childNodes[0]!;
  const italic = first.childNodes[1]!;
  first.insertBefore(italic, text);
  expect(childLabels(first)).toEqual(['i', '"x"']);
  expect(() => loaded.claimRecipe(owner, recipe, parent)).toThrow(/OEIR_LEAF_CLAIM_MISMATCH/);
  expect(other.childNodes).toEqual(otherChildren);
  expect(childLabels(other)).toEqual(['"x"', 'i']);
});

test('repeatable children keep author order and one site’s release or update leaves the other', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const label = loaded.signal('a');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createRepeatRecipe(owner, host({ label }));
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const root = mounted.nodes[0] as DomElement;
  const section = root.childNodes[0] as DomElement;
  const aside = root.childNodes[1] as DomElement;
  expect(section.localName).toBe('section');
  expect(aside.localName).toBe('aside');
  expect(childLabels(section)).toEqual(['b', 'i']);
  expect(childLabels(aside)).toEqual(['b', 'i']);
  expect((section.childNodes[0] as DomElement).childNodes.map(nodeLabel)).toEqual([
    'oe:t:0',
    '"a"',
    'oe:/t:0',
  ]);
  const sectionNodes = [...section.childNodes];
  const asideNodes = [...aside.childNodes];
  expect(sectionNodes[0]).not.toBe(asideNodes[0]);
  mounted.dispose(false);

  loaded.claimLog.length = 0;
  loaded.claimRecipe(owner, recipe, parent);
  const inner = loaded.claimLog
    .map((record) => record.projection)
    .filter(
      (projection) =>
        projection.nodes[0] === sectionNodes[0] || projection.nodes[0] === asideNodes[0],
    );
  expect(inner.map((projection) => projection.nodes)).toEqual([sectionNodes, asideNodes]);
  expect(inner[0]!.region).not.toBe(inner[1]!.region);
  expect(inner[0]!.owner).not.toBe(inner[1]!.owner);
  expect(section.childNodes).toEqual(sectionNodes);
  expect(aside.childNodes).toEqual(asideNodes);

  label.value = 'z';
  expect((sectionNodes[0] as DomElement).childNodes.map(nodeLabel)).toEqual([
    'oe:t:0',
    '"z"',
    'oe:/t:0',
  ]);
  expect((asideNodes[0] as DomElement).childNodes.map(nodeLabel)).toEqual([
    'oe:t:0',
    '"z"',
    'oe:/t:0',
  ]);
  expect(section.childNodes).toEqual(sectionNodes);
  expect(aside.childNodes).toEqual(asideNodes);

  inner[0]!.dispose(true);
  expect(section.childNodes).toEqual([]);
  expect(aside.childNodes).toEqual(asideNodes);
  expect(inner[1]!.owner.disposed).toBe(false);
  label.value = 'q';
  expect((asideNodes[0] as DomElement).childNodes.map(nodeLabel)).toEqual([
    'oe:t:0',
    '"q"',
    'oe:/t:0',
  ]);
  expect(aside.childNodes).toEqual(asideNodes);
  expect(childLabels(aside)).toEqual(['b', 'i']);
});

test('fragment directory composition claims one ordinal layer and no nested directory', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const { claimed } = mountAndClaim(
    (owner) => loaded.createAdversarialRecipe(owner, host()),
    parent,
  );
  const div = claimed.nodes[0] as DomElement;
  expect(childLabels(div)).toEqual(['oe:r:0', 'p', 'oe:/r:0', 'oe:r:1', 'section', 'oe:/r:1']);
  const paragraph = div.childNodes[1] as DomElement;
  const section = div.childNodes[4] as DomElement;
  expect(paragraph.childNodes.map(nodeLabel)).toEqual(['"a"']);
  expect(section.localName).toBe('section');
  expect(section.childNodes).toHaveLength(1);
  const inner = section.childNodes[0] as DomElement;
  expect(inner.localName).toBe('div');
  expect(childLabels(inner)).toEqual(['b', 'i']);
  expect(nestedMarkers(div)).toEqual([]);
  expect(childLabels(div).filter((label) => label.startsWith('oe:r:'))).toEqual([
    'oe:r:0',
    'oe:r:1',
  ]);

  const wrappedParent = doc.createElement('div');
  const wrapped = mountAndClaim(
    (owner) => loaded.createWrappedRecipe(owner, host()),
    wrappedParent,
  );
  const outer = wrapped.claimed.nodes[0] as DomElement;
  expect(outer.localName).toBe('div');
  expect(outer.childNodes).toHaveLength(1);
  const wrappedDiv = outer.childNodes[0] as DomElement;
  expect(childLabels(wrappedDiv)).toEqual([
    'oe:r:0',
    'p',
    'oe:/r:0',
    'oe:r:1',
    'section',
    'oe:/r:1',
  ]);
  expect(nestedMarkers(wrappedDiv)).toEqual([]);
  const wrappedSection = wrappedDiv.childNodes[4] as DomElement;
  expect(childLabels(wrappedSection.childNodes[0] as DomElement)).toEqual(['b', 'i']);
});

test('static siblings, an insertion and a component ref claim in JSX author order', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.createElement('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createMixedRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const div = mounted.nodes[0] as DomElement;
  expect(childLabels(div)).toEqual(['b', 'i', 'em', 'u']);
  expect(
    div.childNodes.map((node) => {
      const element = node as DomElement;
      return (element.childNodes.find((child) => child.nodeType === 3) as DomText).nodeValue;
    }),
  ).toEqual(['b', 'c', 'k', 'u']);
  const order = [...div.childNodes];
  mounted.dispose(false);

  loaded.claimLog.length = 0;
  const claimed = loaded.claimRecipe(owner, recipe, parent);
  expect(claimed.nodes).toEqual([div]);
  expect(div.childNodes).toEqual(order);
  const chip = loaded.claimLog
    .map((record) => record.projection)
    .find((projection) => projection.nodes.length === 1 && projection.nodes[0] === order[1]);
  expect(chip).toBeDefined();
  expect(chip!.nodes).toEqual([order[1]]);
  expect(chip!.owner).not.toBe(claimed.owner);
  expect(chip!.region).not.toBe(claimed.region);
  expect(childLabels(div)).toEqual(['b', 'i', 'em', 'u']);
});
