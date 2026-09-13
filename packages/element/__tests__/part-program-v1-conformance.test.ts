/**
 * @openelement/element — #1160 compiled Part Program v1 (runtime vertical).
 *
 * Behavior-first coverage proving the ADR-0143 replacement path on the
 * canonical alpha.1 fixture program (packages/element/__fixtures__/
 * compiled-element-v1/expected-program.json — the same artifact the Vite
 * transform test asserts structurally):
 *   - server serialization, fresh DOM creation and existing-DOM claim consume
 *     one Part Program and produce equivalent observable structure
 *   - successful claim preserves node identity and a live input value while
 *     attaching the event and reactive sinks
 *   - a Signal write mutates only its subscribed Part/Region; unrelated sinks
 *     record no write
 *   - keyed list reconciliation preserves element identity across reorders
 *   - claim mismatch fails with a structured, source-located diagnostic
 *   - measurement evidence (allocations, subscriptions, activation ops) is
 *     recorded against a frozen 0.43-equivalent proxy (evidence, not a
 *     performance GO claim)
 *
 * The runtime module is loaded via dynamic import so a RED run proves the
 * harness works while the new vertical behavior is absent. The minimal fake
 * DOM below implements only the standard DOM surface the compiled runtime is
 * allowed to touch (Deno's runner provides no browser DOM).
 */

import { assertEquals, assertStrictEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { signal } from '../src/internal/signal/framework.ts';
import type { WritableSignal } from '../src/internal/signal/types.ts';
import { SIGNAL_BRAND } from '../src/internal/protocol/signal.ts';
import { validatePartProgram } from '../src/internal/compiled/program.ts';

// ─── Minimal instrumented DOM harness ────────────────────────────────

interface DomCounts {
  elements: number;
  texts: number;
  comments: number;
  textWrites: number;
  valueWrites: number;
  listenerAdds: number;
  removals: number;
  walkVisits: number;
}

type FNode = FElement | FText | FComment;

abstract class FNodeBase {
  readonly ownerDocument: FDocument;
  parentNode: FElement | null = null;
  childNodes: FNode[] = [];

  constructor(ownerDocument: FDocument) {
    this.ownerDocument = ownerDocument;
  }

  get nextSibling(): FNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this as unknown as FNode);
    return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
  }

  appendChild(node: FNode): FNode {
    this.detachForMove(node);
    node.parentNode = this as unknown as FElement;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node: FNode, ref: FNode): FNode {
    this.detachForMove(node);
    const index = this.childNodes.indexOf(ref);
    if (index < 0) throw new Error('insertBefore: reference node not found');
    node.parentNode = this as unknown as FElement;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  /** Re-parenting during insertBefore/appendChild is a move, not a removal. */
  private detachForMove(node: FNode): void {
    const parent = node.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(node);
    parent.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  removeChild(node: FNode): FNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild: node not found');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    this.ownerDocument.counts.removals++;
    return node;
  }
}

class FText extends FNodeBase {
  readonly nodeType = 3;
  #data: string;
  constructor(ownerDocument: FDocument, data: string) {
    super(ownerDocument);
    this.#data = data;
  }
  get data(): string {
    return this.#data;
  }
  set data(value: string) {
    this.#data = value;
    this.ownerDocument.counts.textWrites++;
  }
}

class FComment extends FNodeBase {
  readonly nodeType = 8;
  constructor(ownerDocument: FDocument, readonly data: string) {
    super(ownerDocument);
  }
}

type FListener = (event: { type: string }) => void;

class FElement extends FNodeBase {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<FListener>>();
  #value = '';

  constructor(ownerDocument: FDocument, tagName: string) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  get value(): string {
    return this.#value;
  }
  set value(next: string) {
    this.#value = next;
    this.ownerDocument.counts.valueWrites++;
  }

  /** Test-only live-value mutation that bypasses the instrumentation. */
  simulateUserInput(next: string): void {
    this.#value = next;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  addEventListener(type: string, listener: FListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    this.ownerDocument.counts.listenerAdds++;
  }
  removeEventListener(type: string, listener: FListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
}

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

class FDocument {
  readonly counts: DomCounts = {
    elements: 0,
    texts: 0,
    comments: 0,
    textWrites: 0,
    valueWrites: 0,
    listenerAdds: 0,
    removals: 0,
    walkVisits: 0,
  };
  createElement(tagName: string): FElement {
    this.counts.elements++;
    return new FElement(this, tagName);
  }
  createTextNode(data: string): FText {
    this.counts.texts++;
    return new FText(this, data);
  }
  createComment(data: string): FComment {
    this.counts.comments++;
    return new FComment(this, data);
  }
  resetCounts(): void {
    for (const key of Object.keys(this.counts) as Array<keyof DomCounts>) this.counts[key] = 0;
  }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function unescapeText(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll(
    '&amp;',
    '&',
  );
}

/** Serialize the fake tree with the same observable shape as SSR output. */
function toHtml(node: FNode): string {
  if (node instanceof FText) return escapeText(node.data);
  if (node instanceof FComment) return `<!--${node.data}-->`;
  const el = node as FElement;
  const tag = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes.entries())
    .map(([name, value]) =>
      ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`
    )
    .join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${el.childNodes.map(toHtml).join('')}</${tag}>`;
}

/** Parse the serializer output into an existing-DOM tree for claim tests. */
function parseHtml(doc: FDocument, html: string): FElement {
  const host = doc.createElement('host');
  const stack: FElement[] = [host];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
    const token = match[0];
    const parent = stack[stack.length - 1];
    if (token.startsWith('<!--')) {
      parent.appendChild(doc.createComment(token.slice(4, -3)));
    } else if (token.startsWith('</')) {
      stack.pop();
    } else if (token.startsWith('<')) {
      const inner = token.slice(1, -1);
      const space = inner.search(/\s/);
      const tag = (space === -1 ? inner : inner.slice(0, space)).toLowerCase();
      const el = doc.createElement(tag);
      const attrSource = space === -1 ? '' : inner.slice(space);
      for (const attr of attrSource.matchAll(/([\w-]+)="([^"]*)"/g)) {
        el.setAttribute(attr[1], unescapeText(attr[2]));
      }
      parent.appendChild(el);
      if (!VOID_TAGS.has(tag)) stack.push(el);
    } else {
      parent.appendChild(doc.createTextNode(unescapeText(token)));
    }
  }
  return host;
}

function walk(node: FNode): void {
  node.ownerDocument.counts.walkVisits++;
  for (const child of node.childNodes) walk(child);
}

// ─── 0.43-equivalent frozen proxy (deterministic evidence, not a perf claim) ─

interface FixtureState {
  count: number;
  label: string;
  items: Array<{ id: string; text: string }>;
}

const INITIAL_STATE: FixtureState = {
  count: 0,
  label: 'ready',
  items: [
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
  ],
};

/**
 * Models the 0.43 render/update semantics on the identical observable tree
 * (including its host root, hence +1 over the compiled numbers, which mount
 * into the element-provided root): initial render allocates the whole subtree
 * and activation re-discovers dynamic locations with a full marker walk;
 * every state change re-renders (re-allocates) the entire subtree and repeats
 * the full walk.
 */
function build043Equivalent(doc: FDocument, state: FixtureState): FElement {
  const host = doc.createElement('host');
  const div = doc.createElement('div');
  div.setAttribute('class', 'proof');
  host.appendChild(div);
  const h1 = doc.createElement('h1');
  div.appendChild(h1);
  h1.appendChild(doc.createTextNode('Count: '));
  h1.appendChild(doc.createComment('oe:p0'));
  h1.appendChild(doc.createTextNode(String(state.count)));
  const input = doc.createElement('input');
  input.setAttribute('value', state.label);
  div.appendChild(input);
  const button = doc.createElement('button');
  button.setAttribute('type', 'button');
  button.appendChild(doc.createTextNode('+'));
  div.appendChild(button);
  div.appendChild(doc.createComment('oe:p3'));
  const p = doc.createElement('p');
  p.setAttribute('class', 'parity');
  p.appendChild(doc.createTextNode(state.count > 0 ? 'positive' : 'zero'));
  div.appendChild(p);
  div.appendChild(doc.createComment('oe:/p3'));
  const ul = doc.createElement('ul');
  div.appendChild(ul);
  ul.appendChild(doc.createComment('oe:p4'));
  for (const item of state.items) {
    const li = doc.createElement('li');
    li.appendChild(doc.createTextNode(item.text));
    ul.appendChild(li);
  }
  ul.appendChild(doc.createComment('oe:/p4'));
  // activation: full-tree marker walk, then listener attach
  walk(host);
  button.addEventListener('click', () => {});
  return host;
}

// ─── Test host wiring ────────────────────────────────────────────────

interface SubCounters {
  subs: number;
}

function counting<T>(sig: WritableSignal<T>, counters: SubCounters): WritableSignal<T> {
  return {
    [SIGNAL_BRAND]: true,
    get value(): T {
      return sig.value;
    },
    set value(next: T) {
      sig.value = next;
    },
    subscribe(fn: (value: T) => void) {
      counters.subs++;
      return sig.subscribe(fn);
    },
  };
}

interface ProgramInstance {
  dispose(): void;
}

interface ProgramRuntime {
  createFreshDom(program: unknown, host: unknown, root: FElement): ProgramInstance;
  serializeToHtml(program: unknown, host: unknown): string;
  claimExistingDom(program: unknown, host: unknown, root: FElement): ProgramInstance;
  PartProgramClaimError: new (path: string, message: string) => Error;
}

const PROGRAM_URL = new URL(
  '../__fixtures__/compiled-element-v1/expected-program.json',
  import.meta.url,
);

async function loadProgramRuntime(): Promise<ProgramRuntime> {
  return (await import('../src/internal/compiled/runtime.ts')) as unknown as ProgramRuntime;
}

function makeHost(counters: SubCounters) {
  const count = signal(INITIAL_STATE.count);
  const label = signal(INITIAL_STATE.label);
  const items = signal(INITIAL_STATE.items.map((item) => ({ ...item })));
  const host = {
    signals: {
      count: counting(count, counters),
      label: counting(label, counters),
      items: counting(items, counters),
    },
    handlers: {
      increment: () => {
        count.value = count.value + 1;
      },
    },
  };
  return { host, count, label, items };
}

/**
 * Protocol-only lazy-delivery WritableSignal (#1160 repair-1, R1): subscribe()
 * does NOT deliver the current value; callbacks fire only on writes after
 * subscription returned. The public Signal protocol permits this engine, so
 * the compiled runtime must apply its first real write.
 */
class LazySignal<T> implements WritableSignal<T> {
  readonly [SIGNAL_BRAND] = true as const;
  #value: T;
  readonly #listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T {
    return this.#value;
  }
  set value(next: T) {
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }
  subscribe(fn: (value: T) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
}

function makeLazyHost(counters: SubCounters) {
  const count = new LazySignal(INITIAL_STATE.count);
  const label = new LazySignal(INITIAL_STATE.label);
  const items = new LazySignal(INITIAL_STATE.items.map((item) => ({ ...item })));
  const host = {
    signals: {
      count: counting(count, counters),
      label: counting(label, counters),
      items: counting(items, counters),
    },
    handlers: {
      increment: () => {
        count.value = count.value + 1;
      },
    },
  };
  return { host, count, label, items };
}

// ─── Tests ───────────────────────────────────────────────────────────

Deno.test('compiled part program v1 - harness sanity', async () => {
  const programJson = await Deno.readTextFile(PROGRAM_URL);
  const program = JSON.parse(programJson);
  assertEquals(program.tag, 'oe-program-counter');
  const doc = new FDocument();
  const host = parseHtml(
    doc,
    '<div class="proof"><h1>Count: <!--oe:p0-->0</h1><input value="ready"></div>',
  );
  assertEquals(host.childNodes.length, 1);
  assertEquals(
    toHtml(host),
    '<host><div class="proof"><h1>Count: <!--oe:p0-->0</h1><input value="ready"></div></host>',
  );
});

Deno.test('compiled part program v1 - one program, three execution modes', async (t) => {
  const runtime = await loadProgramRuntime();
  const programJson = await Deno.readTextFile(PROGRAM_URL);
  const program = JSON.parse(programJson);
  validatePartProgram(program);

  await t.step('program evidence: bytes and instruction count', () => {
    const programBytes = new TextEncoder().encode(programJson).length;
    assertEquals(program.parts.length, 5);
    console.log(
      JSON.stringify({ proof: 'element-program', programBytes, instructionCount: 5 }),
    );
  });

  let ssrHtml = '';
  await t.step('server serialization emits the deterministic HTML', () => {
    const counters = { subs: 0 };
    const { host } = makeHost(counters);
    ssrHtml = runtime.serializeToHtml(program, host);
    assertEquals(
      ssrHtml,
      '<div class="proof">' +
        '<h1>Count: <!--oe:p0-->0</h1>' +
        '<input value="ready">' +
        '<button type="button">+</button>' +
        '<!--oe:p3--><p class="parity">zero</p><!--oe:/p3-->' +
        '<ul><!--oe:p4--><li>alpha</li><li>beta</li><!--oe:/p4--></ul>' +
        '</div>',
    );
  });

  const FRESH_ALLOCATIONS = { elements: 8, texts: 6, comments: 5 };
  const FRESH_ACTIVATION = { subs: 4, listenerAdds: 1 };

  await t.step('fresh DOM creation from the same program matches SSR structure', () => {
    const freshDoc = new FDocument();
    const counters = { subs: 0 };
    const { host } = makeHost(counters);
    const freshRoot = freshDoc.createElement('host');
    freshDoc.resetCounts();
    runtime.createFreshDom(program, host, freshRoot);
    assertEquals(toHtml(freshRoot), `<host>${ssrHtml}</host>`);
    assertEquals(freshDoc.counts.elements, FRESH_ALLOCATIONS.elements);
    assertEquals(freshDoc.counts.texts, FRESH_ALLOCATIONS.texts);
    assertEquals(freshDoc.counts.comments, FRESH_ALLOCATIONS.comments);
    assertEquals(counters.subs, FRESH_ACTIVATION.subs);
    assertEquals(freshDoc.counts.listenerAdds, FRESH_ACTIVATION.listenerAdds);
  });

  await t.step('existing-DOM claim preserves identity, live value and attaches sinks', () => {
    const claimDoc = new FDocument();
    const claimRoot = parseHtml(claimDoc, ssrHtml);
    claimDoc.resetCounts();
    const input = (claimRoot.childNodes[0] as FElement).childNodes[1] as FElement;
    const h1TextBefore = ((claimRoot.childNodes[0] as FElement).childNodes[0] as FElement)
      .childNodes[2] as FText;
    input.simulateUserInput('typed by user');
    const counters = { subs: 0 };
    const { host, count } = makeHost(counters);
    runtime.claimExistingDom(program, host, claimRoot);

    // no allocation, no live-value overwrite, structure equivalent
    assertEquals(claimDoc.counts.elements, 0);
    assertEquals(claimDoc.counts.texts, 0);
    assertEquals(claimDoc.counts.comments, 0);
    assertEquals(claimDoc.counts.valueWrites, 0);
    assertEquals(input.value, 'typed by user');
    assertEquals(toHtml(claimRoot), `<host>${ssrHtml}</host>`);
    assertEquals(counters.subs, FRESH_ACTIVATION.subs);
    assertEquals(claimDoc.counts.listenerAdds, 1);

    // the claimed event and text part are live; node identity is preserved
    const button = (claimRoot.childNodes[0] as FElement).childNodes[2] as FElement;
    button.dispatch('click');
    assertEquals(count.value, 1);
    const h1TextAfter = ((claimRoot.childNodes[0] as FElement).childNodes[0] as FElement)
      .childNodes[2] as FText;
    assertStrictEquals(h1TextBefore, h1TextAfter);
    assertEquals(h1TextAfter.data, '1');
  });

  await t.step('a Signal write touches only its subscribed Part/Region', () => {
    const doc = new FDocument();
    const root = doc.createElement('host');
    const counters = { subs: 0 };
    const { host, count, label } = makeHost(counters);
    runtime.createFreshDom(program, host, root);
    doc.resetCounts();

    label.value = 'edited';
    assertEquals(doc.counts.valueWrites, 1);
    assertEquals(doc.counts.textWrites, 0);
    assertEquals(doc.counts.elements, 0);

    doc.resetCounts();
    count.value = 1;
    // the subscribed text Part wrote once; the conditional Region swapped branches
    assertEquals(doc.counts.textWrites, 1);
    assertEquals(doc.counts.elements, 1); // replacement <p>
    assertEquals(doc.counts.texts, 1); // replacement text
    assertEquals(doc.counts.removals, 1); // old <p> (its text leaves with it)
    // the unrelated property sink recorded no write
    assertEquals(doc.counts.valueWrites, 0);
    assertEquals(doc.counts.listenerAdds, 0);
  });

  await t.step('lazy-delivery Signal: first write reaches only its subscribed Part', () => {
    const doc = new FDocument();
    const root = doc.createElement('host');
    const counters = { subs: 0 };
    const { host, count, label } = makeLazyHost(counters);
    runtime.createFreshDom(program, host, root);
    doc.resetCounts();

    // The lazy engine delivered nothing at subscription time; its FIRST write
    // must be treated as a real update on the subscribed text Part, while the
    // unrelated property sink records no write.
    count.value = 1;
    assertEquals(doc.counts.textWrites, 1);
    assertEquals(doc.counts.valueWrites, 0);
    assertEquals(doc.counts.listenerAdds, 0);

    doc.resetCounts();
    label.value = 'lazy edit';
    assertEquals(doc.counts.valueWrites, 1);
    assertEquals(doc.counts.textWrites, 0);
    assertEquals(doc.counts.elements, 0);
  });

  await t.step('keyed list Region preserves element identity across reorders', () => {
    const doc = new FDocument();
    const root = doc.createElement('host');
    const counters = { subs: 0 };
    const { host, items } = makeHost(counters);
    runtime.createFreshDom(program, host, root);
    // div children: h1(0) input(1) button(2) oe:p3(3) <p>(4) oe:/p3(5) ul(6)
    const ul = (root.childNodes[0] as FElement).childNodes[6] as FElement;
    const liA = ul.childNodes[1] as FElement;
    const liB = ul.childNodes[2] as FElement;

    doc.resetCounts();
    items.value = [
      { id: 'b', text: 'beta' },
      { id: 'a', text: 'ALPHA' },
      { id: 'c', text: 'gamma' },
    ];
    const keptB = ul.childNodes[1] as FElement;
    const keptA = ul.childNodes[2] as FElement;
    const addedC = ul.childNodes[3] as FElement;
    assertStrictEquals(keptB, liB);
    assertStrictEquals(keptA, liA);
    assertEquals((keptA.childNodes[0] as FText).data, 'ALPHA');
    assertEquals((addedC.childNodes[0] as FText).data, 'gamma');
    assertEquals(doc.counts.elements, 1); // only the new item
    assertEquals(doc.counts.texts, 1);
    assertEquals(doc.counts.removals, 0);

    doc.resetCounts();
    items.value = [{ id: 'a', text: 'ALPHA' }];
    assertEquals(ul.childNodes.length, 3); // anchors + one item
    assertStrictEquals(ul.childNodes[1], liA);
    assertEquals(doc.counts.removals, 2); // b and c elements
  });

  await t.step('claim mismatch fails with a structured located diagnostic', () => {
    const claimDoc = new FDocument();
    const claimRoot = parseHtml(claimDoc, ssrHtml);
    const staticText = ((claimRoot.childNodes[0] as FElement).childNodes[0] as FElement)
      .childNodes[0] as FText;
    staticText.data = 'Count? ';
    const counters = { subs: 0 };
    const { host } = makeHost(counters);
    const error = assertThrows(
      () => runtime.claimExistingDom(program, host, claimRoot),
      runtime.PartProgramClaimError,
    );
    assertStringIncludes(error.message, 'template[0].children[0].children[0]');
  });

  await t.step('dispose detaches every subscription', () => {
    const doc = new FDocument();
    const root = doc.createElement('host');
    const counters = { subs: 0 };
    const { host, count, label } = makeHost(counters);
    const instance = runtime.createFreshDom(program, host, root);
    instance.dispose();
    doc.resetCounts();
    count.value = 9;
    label.value = 'gone';
    assertEquals(doc.counts.textWrites, 0);
    assertEquals(doc.counts.valueWrites, 0);
    assertEquals(doc.counts.elements, 0);
  });

  await t.step('program validation still fails closed after the cast removal (repair-2)', () => {
    const broken = JSON.parse(programJson);
    broken.parts[0] = { ...broken.parts[0], index: 7 };
    assertThrows(
      () => validatePartProgram(broken),
      Error,
      'parts[0].index must equal its position',
    );
    const wrongVersion = JSON.parse(programJson);
    wrongVersion.version = 2;
    assertThrows(() => validatePartProgram(wrongVersion), Error, 'version');
  });

  await t.step('measurement evidence against the frozen 0.43-equivalent proxy', () => {
    // 0.43-equivalent: full subtree re-allocation + full marker walk per update.
    const proxyDoc = new FDocument();
    build043Equivalent(proxyDoc, INITIAL_STATE);
    const proxyBuildAllocations = proxyDoc.counts.elements + proxyDoc.counts.texts +
      proxyDoc.counts.comments;
    const proxyBuildWalk = proxyDoc.counts.walkVisits;
    proxyDoc.resetCounts();
    build043Equivalent(proxyDoc, { ...INITIAL_STATE, count: 1 });
    const proxyUpdateAllocations = proxyDoc.counts.elements + proxyDoc.counts.texts +
      proxyDoc.counts.comments;
    const proxyUpdateWalk = proxyDoc.counts.walkVisits;

    const summary = {
      proof: 'element-runtime-measurements',
      compiled: {
        instructionCount: 5,
        freshAllocations: FRESH_ALLOCATIONS.elements + FRESH_ALLOCATIONS.texts +
          FRESH_ALLOCATIONS.comments,
        claimAllocations: 0,
        activationSubscriptions: FRESH_ACTIVATION.subs,
        activationListeners: FRESH_ACTIVATION.listenerAdds,
        countUpdateAllocations: 2,
        countUpdateWalkVisits: 0,
      },
      frozen043EquivalentProxy: {
        buildAllocations: proxyBuildAllocations,
        buildWalkVisits: proxyBuildWalk,
        updateAllocations: proxyUpdateAllocations,
        updateWalkVisits: proxyUpdateWalk,
        updateListeners: 1,
      },
    };
    // Frozen evidence pins (alpha.0 fixture). The proxy counts include its own
    // host root (+1 allocation, +1 walk visit) because it must allocate the
    // container the compiled element receives from the platform.
    assertEquals(summary.compiled.freshAllocations, 19);
    assertEquals(proxyBuildAllocations, 20);
    assertEquals(proxyUpdateAllocations, 20);
    assertEquals(proxyBuildWalk, 20);
    assertEquals(proxyUpdateWalk, 20);
    console.log(JSON.stringify(summary));
  });
});
