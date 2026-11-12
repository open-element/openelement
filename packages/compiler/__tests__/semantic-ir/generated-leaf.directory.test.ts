/**
 * M07b generator extension — generated mount emits paired markers and the
 * generated claim calls the M07b directory consumer.
 *
 * Node DOM shim. Not a browser, not SSR, not a packed consumer. Static zero
 * subscriptions are not a dynamic subscription account. The generated
 * `activate` is the empty function because this directory has no binding. A
 * dynamic slot on a directory path has to wire `activate`; this file does
 * not treat the empty function as that claim. The mid-directory failure test
 * only checks that the generated consumer follows the directory runtime:
 * a later-range failure does not stick on `consumed:`. The recovery contract
 * is the element suite, not this file.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { build } from 'vite';
import { RuntimeErrorCode } from '@openelement/protocol/errors';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/directory.tsx';
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const CLASSIFIER = {
  classifySymbol: () => 'value' as const,
  classifyValue: () => undefined,
  classifyCall: () => undefined,
};

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

test('a pure static element directory emits markers and calls the consumer with literal ordinals', () => {
  const module = generate('function Pair(props) { return <div><p>same</p><p>same</p></div>; }\n');
  expect(module).toContain('emitComment(rangeMarker(0))');
  expect(module).toContain('emitComment(rangeMarker(0, true))');
  expect(module).toContain('emitComment(rangeMarker(1))');
  expect(module).toContain('emitComment(rangeMarker(1, true))');
  expect(module).toContain('openStaticSiblingDirectory(');
  expect(module).toContain('claimStaticSiblingRange(');
  expect(module).toMatch(/claimStaticSiblingRange\([^,]+, 0,/);
  expect(module).toMatch(/claimStaticSiblingRange\([^,]+, 1,/);
  const claimAt = module.indexOf('function Pair__claim');
  const claim = module.slice(claimAt);
  expect(claim.indexOf('claimStaticSiblingRange(')).toBeGreaterThanOrEqual(0);
  expect(claim.indexOf('emitComment(rangeMarker(')).toBe(-1);
});

test('fragment roots are a directory on the claim parent, still calling the consumer', () => {
  const module = generate('function Roots(props) { return <><p>same</p><p>same</p></>; }\n');
  expect(module).toContain('openStaticSiblingDirectory(__oe_parent,');
  expect(module).toMatch(/claimStaticSiblingRange\([^,]+, 0,/);
  expect(module).toMatch(/claimStaticSiblingRange\([^,]+, 1,/);
  expect(module).toContain('emitComment(rangeMarker(0))');
});

test('an outer directory does not nest markers inside a static child', () => {
  const module = generate(
    'function Outer(props) { return <div><p>a</p><section><b>x</b><i>y</i></section></div>; }\n',
  );
  expect([...module.matchAll(/emitComment\(rangeMarker\((\d+)\)\)/g)].map((m) => m[1])).toEqual([
    '0',
    '1',
  ]);
  expect(
    [...module.matchAll(/emitComment\(rangeMarker\((\d+), true\)\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(module).not.toContain('emitComment(rangeMarker(2');
  expect(module).toContain('document.createElement("section")');
  expect(module).toContain('document.createElement("b")');
});

test('a fragment inside a directory range does not emit an inner directory', () => {
  const module = generate(
    'function Nested(props) { return <div><section><><p><span>a</span><em>b</em></p><div><span>c</span><em>d</em></div></></section><article><><p><span>e</span><em>f</em></p><div><span>g</span><em>h</em></div></></article></div>; }\n',
  );
  expect([...module.matchAll(/emitComment\(rangeMarker\((\d+)\)\)/g)].map((m) => m[1])).toEqual([
    '0',
    '1',
  ]);
  expect(
    [...module.matchAll(/emitComment\(rangeMarker\((\d+), true\)\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(module).not.toContain('emitComment(rangeMarker(2');
  expect(module).toContain('document.createElement("section")');
  expect(module).toContain('document.createElement("article")');
  expect(module).toContain('document.createElement("span")');
  expect(module).toContain('openStaticSiblingDirectory(');
});

// Generated mount source only. Quality's adversarial shape; not a DOM claim.
test('quality adversarial fragment shape keeps only the outer directory markers', () => {
  const module = generate(
    'function Adversarial(props) { return <div><p>a</p><section><><div><b>x</b><i>y</i></div></></section></div>; }\n',
  );
  expect([...module.matchAll(/emitComment\(rangeMarker\((\d+)\)\)/g)].map((m) => m[1])).toEqual([
    '0',
    '1',
  ]);
  expect(
    [...module.matchAll(/emitComment\(rangeMarker\((\d+), true\)\)/g)].map((m) => m[1]),
  ).toEqual(['0', '1']);
  expect(module).not.toContain('emitComment(rangeMarker(2');
  expect(module).toContain('document.createElement("section")');
  expect(module).toContain('document.createElement("b")');
  expect(module).toContain('document.createElement("i")');
});

test('mixed text, one child, insertion sites, and excluded parents do not become a directory', () => {
  const mixed = generate('function Mixed(props) { return <div>hello<p>a</p></div>; }\n');
  expect(mixed).not.toContain('emitComment(rangeMarker(');
  expect(mixed).toContain('document.createTextNode("hello")');
  expect(mixed).toContain('document.createElement("p")');

  const single = generate('function One(props) { return <div><p>only</p></div>; }\n');
  expect(single).not.toContain('emitComment(rangeMarker(');
  expect(single).toContain('leafClaimMismatch(');

  const table = generate(
    'function Grid(props) { return <table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>; }\n',
  );
  expect(table).not.toContain('emitComment(rangeMarker(');

  const slotted = generate(
    'function Slot(props) { const item = <span>x</span>; return <div>{item}<p>a</p></div>; }\n',
  );
  expect(slotted).not.toContain('emitComment(rangeMarker(');
  expect(slotted).toContain('insertRecipe(');
  expect(slotted).toContain('document.createElement("p")');
});

test('a pure-mount tree does not emit unconsumed range markers', () => {
  const conditional = generate(
    'function C(props) { return <div>{true ? <section><p>a</p><p>b</p></section> : <section><b>x</b><i>y</i></section>}</div>; }\n',
  );
  expect(conditional).not.toContain('function C__claim');
  expect(conditional).not.toContain('emitComment(rangeMarker(');
  expect(conditional).not.toContain('oe:/r:');
  expect(conditional).toContain('document.createElement("p")');
  expect(conditional).toContain('document.createElement("b")');

  const recipe = generate(
    'function C(props) { const item = <span><b>x</b><i>y</i></span>; return <div><input value={props.text} />{item}</div>; }\n',
  );
  expect(recipe).not.toContain('function C__claim');
  expect(recipe).not.toContain('emitComment(rangeMarker(');
  expect(recipe).not.toContain('oe:/r:');
  expect(recipe).toContain('document.createElement("b")');
});

const EXECUTION = `function Pair(props) { return <div><p>same</p><p>same</p></div>; }
function Roots(props) { return <><p>same</p><p>same</p></>; }
function Mixed(props) { return <div>hello<p>a</p></div>; }
function MountOnly(props) { return <div>{true ? <section><p>a</p><p>b</p></section> : <section><b>x</b><i>y</i></section>}</div>; }
`;

class Log {
  readonly events: string[] = [];
  write(kind: string): void {
    this.events.push(`write:${kind}`);
  }
  writesSince(mark: number): string[] {
    return this.events.slice(mark).filter((event) => event.startsWith('write:'));
  }
}

class DomNode {
  parentNode: DomElement | null = null;
  constructor(
    readonly log: Log,
    readonly nodeType: number,
  ) {}
}

class DomText extends DomNode {
  constructor(
    log: Log,
    private value: string,
  ) {
    super(log, 3);
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(value: string) {
    this.log.write('nodeValue');
    this.value = value;
  }
}

class DomComment extends DomNode {
  constructor(
    log: Log,
    private value: string,
  ) {
    super(log, 8);
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(value: string) {
    this.log.write('nodeValue');
    this.value = value;
  }
}

class DomAttributes {
  readonly entries: { name: string; value: string }[] = [];
  constructor(private readonly log: Log) {}
  get length(): number {
    return this.entries.length;
  }
  item(index: number): { name: string; value: string } | null {
    return this.entries[index] ?? null;
  }
  set(name: string, value: string): void {
    this.log.write('attribute');
    const found = this.entries.find((entry) => entry.name === name);
    if (found) found.value = value;
    else this.entries.push({ name, value });
  }
}

class DomElement extends DomNode {
  readonly childNodes: DomNode[] = [];
  readonly attributes: DomAttributes;
  constructor(
    log: Log,
    readonly localName: string,
    readonly namespaceURI: string | null = HTML_NAMESPACE,
  ) {
    super(log, 1);
    this.attributes = new DomAttributes(log);
  }
  appendChild(node: DomNode): DomNode {
    this.log.write('insert');
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: DomNode, before: DomNode | null): DomNode {
    this.log.write('insert');
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
    this.log.write('remove');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class DomDocument {
  readonly log = new Log();
  createElement(tag: string): DomElement {
    return new DomElement(this.log, tag, HTML_NAMESPACE);
  }
  createTextNode(value: string): DomText {
    return new DomText(this.log, value);
  }
  createComment(value: string): DomComment {
    return new DomComment(this.log, value);
  }
  element(tag: string): DomElement {
    return this.createElement(tag);
  }
}

interface Scope {
  disposed: boolean;
  child(): Scope;
  dispose(detach?: boolean): void;
}

interface Projection {
  nodes: DomNode[];
  owner: Scope;
  dispose(detach?: boolean): void;
}

interface Loaded {
  createPairRecipe: (owner: unknown, host: unknown) => unknown;
  createRootsRecipe: (owner: unknown, host: unknown) => unknown;
  createMixedRecipe: (owner: unknown, host: unknown) => unknown;
  createMountOnlyRecipe: (owner: unknown, host: unknown) => unknown;
  claimRecipe: (owner: unknown, recipe: unknown, parent: unknown) => Projection;
  insertRecipe: (owner: unknown, recipe: unknown, parent: unknown) => Projection;
  runtimeProbe: {
    snapshot: () => {
      owners: number;
      regions: number;
      subscriptions: number;
      unsubscribed: number;
      rangeCleanups: number;
      projections: number;
    };
    reset: () => void;
  };
  LifetimeScope: { new (): Scope; prototype: { child(): Scope } };
}

let loaded: Loaded;
let bundleDir = '';

beforeAll(async () => {
  const module = generate(EXECUTION);
  const dir = mkdtempSync(join(tmpdir(), 'oe-m07b-gen-'));
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
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, rangeMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { OpenElementError } from ${JSON.stringify(join(REPO_ROOT, 'packages/protocol/src/errors.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(leaf, module);
  writeFileSync(
    entry,
    [
      `export { createPairRecipe, createRootsRecipe, createMixedRecipe, createMountOnlyRecipe } from './leaf.js';`,
      `export { claimRecipe, insertRecipe, runtimeProbe, LifetimeScope } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
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
  if (chunk?.code === undefined) throw new Error('directory bundle produced no chunk');
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

function host() {
  return { bindings: {}, props: {} };
}

function useDocument(doc: DomDocument): void {
  (globalThis as { document?: DomDocument }).document = doc;
}

/** Stable label for a DOM shim node: comment value, element tag, or nodeType. */
function nodeLabel(node: DomNode): string | number {
  if (node.nodeType === 8) return (node as DomComment).nodeValue;
  if (node.nodeType === 1) return (node as DomElement).localName;
  return node.nodeType;
}

test('mount produces the markers, dispose(false) keeps them, and claim uses those nodes', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createRootsRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const refs = [...parent.childNodes];
  expect(refs.map(nodeLabel)).toEqual(['oe:r:0', 'p', 'oe:/r:0', 'oe:r:1', 'p', 'oe:/r:1']);
  // Internal contract (m07b doc): mount projection nodes include the `oe:r:`
  // marker comments; claim projection nodes are the range interiors only.
  expect(mounted.nodes.map(nodeLabel)).toEqual([
    'oe:r:0',
    'p',
    'oe:/r:0',
    'oe:r:1',
    'p',
    'oe:/r:1',
  ]);
  const ref0 = refs[1] as DomElement;
  const ref1 = refs[4] as DomElement;
  expect(ref0.childNodes[0]?.nodeValue).toBe('same');
  expect(ref1.childNodes[0]?.nodeValue).toBe('same');
  expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);

  mounted.dispose(false);
  expect(mounted.owner.disposed).toBe(true);
  expect(parent.childNodes).toEqual(refs);
  expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);

  const before = loaded.runtimeProbe.snapshot();
  const created: Scope[] = [];
  const original = loaded.LifetimeScope.prototype.child;
  loaded.LifetimeScope.prototype.child = function (this: Scope) {
    const child = original.call(this);
    created.push(child);
    return child;
  };
  let claimed: Projection;
  try {
    claimed = loaded.claimRecipe(owner, recipe, parent);
  } finally {
    loaded.LifetimeScope.prototype.child = original;
  }
  // The claim projection node set is the interiors only: no marker comments.
  expect(claimed.nodes).toEqual([ref0, ref1]);
  expect(claimed.nodes.some((node) => node.nodeType === 8)).toBe(false);
  expect(claimed.owner).not.toBe(mounted.owner);
  expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);
  expect(loaded.runtimeProbe.snapshot().owners - before.owners).toBe(3);
  expect(created).toHaveLength(3);
  const range0 = created[1]!;
  const range1 = created[2]!;
  expect(range0).not.toBe(range1);

  const again = () => loaded.claimRecipe(owner.child(), recipe, parent);
  const consumed = capture(again);
  expect(consumed.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(String(consumed.message)).toContain('consumed:');
  expect(parent.childNodes).toEqual(refs);

  range0.dispose(true);
  expect(range0.disposed).toBe(true);
  expect(range1.disposed).toBe(false);
  expect(ref0.parentNode).toBeNull();
  expect(ref1.parentNode).toBe(parent);
  expect(refs[3]?.parentNode).toBe(parent);

  claimed.dispose(false);
  expect(claimed.owner.disposed).toBe(true);
  expect(ref1.parentNode).toBe(parent);
  const afterDispose = capture(again);
  expect(String(afterDispose.message)).toContain('consumed:');
});

test('element children are a directory, and a validation failure writes nothing', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createPairRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  const div = mounted.nodes[0] as DomElement;
  expect(div.localName).toBe('div');
  expect(
    div.childNodes.map((node) => (node.nodeType === 8 ? node.nodeValue : node.localName)),
  ).toEqual(['oe:r:0', 'p', 'oe:/r:0', 'oe:r:1', 'p', 'oe:/r:1']);
  const paragraph = div.childNodes[1] as DomElement;
  const text = paragraph.childNodes[0] as DomText;
  mounted.dispose(false);
  expect(div.parentNode).toBe(parent);

  text.nodeValue = 'different';
  const mark = doc.log.events.length;
  const owners = loaded.runtimeProbe.snapshot();
  const error = capture(() => loaded.claimRecipe(owner, recipe, parent));
  expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(String(error.message)).toContain('static-seed');
  expect(doc.log.writesSince(mark)).toEqual([]);
  const after = loaded.runtimeProbe.snapshot();
  // claimRecipe records one owner and one region before the generated claim,
  // then dispose(false)s that owner. runtimeProbe owners and regions only
  // increment, so +1 is an observation of that allocation, not a live owner
  // or a live region. This is a first-range failure: the consumer creates no
  // range owner and registers no cleanup. A later-range failure is different;
  // see the test below.
  expect(after.subscriptions).toBe(owners.subscriptions);
  expect(after.rangeCleanups).toBe(owners.rangeCleanups);
  expect(after.projections).toBe(owners.projections);
  expect(after.owners - owners.owners).toBe(1);
  expect(after.regions - owners.regions).toBe(1);
  expect(div.childNodes[1]).toBe(paragraph);
  expect(text.nodeValue).toBe('different');

  text.nodeValue = 'same';
  const claimed = loaded.claimRecipe(owner, recipe, parent);
  expect(claimed.nodes[0]).toBe(div);
  expect(div.childNodes[1]).toBe(paragraph);
  expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);
  const duplicate = capture(() => loaded.claimRecipe(owner.child(), recipe, parent));
  expect(String(duplicate.message)).toContain('consumed:');
});

test('a mid-directory validation failure does not stick on consumed:', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createRootsRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  mounted.dispose(false);

  // Range 0 is valid; range 1's interior seed no longer matches its declaration.
  const range0 = parent.childNodes[1] as DomElement;
  const range1 = parent.childNodes[4] as DomElement;
  (range1.childNodes[0] as DomText).nodeValue = 'different';
  const before = loaded.runtimeProbe.snapshot();

  const error = capture(() => loaded.claimRecipe(owner, recipe, parent));
  expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(String(error.message)).toContain('static-seed');
  // Range 0 committed before range 1 was validated: its success cleanup was
  // registered (the probe only increments), so this is not the first-range
  // failure path. The directory runtime then rolls that commit back.
  const after = loaded.runtimeProbe.snapshot();
  expect(after.rangeCleanups - before.rangeCleanups).toBe(1);
  expect(after.projections - before.projections).toBe(1);

  const retry = capture(() => loaded.claimRecipe(owner.child(), recipe, parent));
  expect(retry.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(String(retry.message)).toContain('static-seed');
  expect(String(retry.message)).not.toContain('consumed:');
  const afterRetry = loaded.runtimeProbe.snapshot();
  expect(afterRetry.rangeCleanups - after.rangeCleanups).toBe(1);
  // The borrowed DOM stays in place: recovery is not a byte rollback.
  expect(parent.childNodes).toHaveLength(6);
  expect(range0.parentNode).toBe(parent);

  (range1.childNodes[0] as DomText).nodeValue = 'same';
  const claimed = loaded.claimRecipe(owner.child(), recipe, parent);
  expect(claimed.nodes).toContain(range0);
  expect(claimed.nodes).toContain(range1);
  const duplicate = capture(() => loaded.claimRecipe(owner.child(), recipe, parent));
  expect(String(duplicate.message)).toContain('consumed:');
});

test('a reentered claim through the generated consumer is busy and does not keep the reservation', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createRootsRecipe(owner, host());
  const mounted = loaded.insertRecipe(owner, recipe, parent);
  mounted.dispose(false);
  const text = (parent.childNodes[1] as DomElement).childNodes[0] as DomText;
  let tripped = false;
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(text), 'nodeValue');
  Object.defineProperty(text, 'nodeValue', {
    configurable: true,
    get() {
      if (!tripped) {
        tripped = true;
        loaded.claimRecipe(owner.child(), recipe, parent);
      }
      return 'same';
    },
  });
  const error = capture(() => loaded.claimRecipe(owner, recipe, parent));
  expect(String(error.message)).toContain('busy:');
  expect(parent.childNodes).toHaveLength(6);
  if (original) Object.defineProperty(text, 'nodeValue', original);
  const claimed = loaded.claimRecipe(owner, recipe, parent);
  expect(claimed.nodes).toHaveLength(2);
  expect(loaded.runtimeProbe.snapshot().subscriptions).toBe(0);
});

test('a mixed text parent keeps the text and does not emit a directory', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const mounted = loaded.insertRecipe(owner, loaded.createMixedRecipe(owner, host()), parent);
  const div = mounted.nodes[0] as DomElement;
  expect(
    div.childNodes.map((node) => (node.nodeType === 3 ? node.nodeValue : node.localName)),
  ).toEqual(['hello', 'p']);
  expect(div.childNodes.some((node) => node.nodeType === 8)).toBe(false);
});

test('a pure-mount directory does not leave marker comments in the DOM', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = doc.element('div');
  const owner = new loaded.LifetimeScope();
  const mounted = loaded.insertRecipe(owner, loaded.createMountOnlyRecipe(owner, host()), parent);
  const div = mounted.nodes[0] as DomElement;
  const section = div.childNodes.find(
    (node) => node.nodeType === 1 && (node as DomElement).localName === 'section',
  ) as DomElement;
  expect(section).toBeDefined();
  const labels = section.childNodes.map(nodeLabel);
  expect(labels).toEqual(['p', 'p']);
  expect(section.childNodes.some((node) => node.nodeType === 8)).toBe(false);
  expect(section.childNodes.filter((node) => node.nodeType === 1).map(nodeLabel)).toEqual([
    'p',
    'p',
  ]);
  expect(
    section.childNodes
      .filter((node) => node.nodeType === 1)
      .map((node) => (node.childNodes[0] as DomText).nodeValue)
      .join(''),
  ).toBe('ab');
  const generated = String(generate(EXECUTION));
  const mountOnly = generated.slice(generated.indexOf('function MountOnly__mount'));
  expect(mountOnly).not.toContain('function MountOnly__claim');
  expect(mountOnly).not.toContain('emitComment(rangeMarker(');
  expect(mountOnly).not.toContain('oe:/r:');
});

test('a non-HTML directory parent still fails with the directory code and writes nothing', () => {
  const doc = new DomDocument();
  useDocument(doc);
  const parent = new DomElement(doc.log, 'div', null);
  const owner = new loaded.LifetimeScope();
  const recipe = loaded.createRootsRecipe(owner, host());
  const mark = doc.log.events.length;
  const error = capture(() => loaded.claimRecipe(owner, recipe, parent));
  expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(error.code).not.toBe('OEIR_LEAF_CLAIM_MISMATCH');
  expect(String(error.message)).toContain('parent:');
  expect(doc.log.writesSince(mark)).toEqual([]);
  expect(parent.childNodes).toEqual([]);
});

function capture(run: () => unknown): { code?: string; message?: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('expected a failure');
}
