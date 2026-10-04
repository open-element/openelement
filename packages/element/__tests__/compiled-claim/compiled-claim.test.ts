import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import {
  claimExistingDom as claimExistingDomCanonical,
  PartProgramClaimError,
} from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

/**
 * The canonical claim executor is typed for the production kernel (branded
 * signals, validated Part Programs). These tests deliberately exercise the
 * untyped wire boundary — raw JSON programs and minimal structural signals —
 * so the entry points are viewed through their wire-level shape here.
 */
interface WirePreUpgradeEventCapture {
  readonly events: readonly unknown[];
  stop(): void;
}

interface WireClaimOptions {
  recovery?: 'throw' | 'owning';
  onMismatch?: (error: PartProgramClaimError) => void;
  preUpgradeEvents?: readonly unknown[] | WirePreUpgradeEventCapture;
  expectStaticStyle?: boolean;
}

const claimExistingDom = claimExistingDomCanonical as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
  options?: WireClaimOptions,
) => { dispose(): void };

const { capturePreUpgradeEvents, releasePreUpgradeEvents, replayPreUpgradeEvents } =
  (await import('../../src/internal/compiled/runtime.ts')) as unknown as {
    capturePreUpgradeEvents: (
      root: EventTarget,
      eventTypes?: readonly string[],
    ) => WirePreUpgradeEventCapture;
    releasePreUpgradeEvents: (root: Node, captured: readonly unknown[]) => void;
    replayPreUpgradeEvents: (root: Node, captured: readonly unknown[]) => number;
  };

interface Counters {
  createdElements: number;
  createdTexts: number;
  createdComments: number;
  subscriptions: number;
  listenerAdds: number;
  valueWrites: number;
}

class TestSignal<T> {
  #value: T;
  readonly #listeners = new Set<(value: T) => void>();
  readonly counters: Counters;

  constructor(value: T, counters: Counters) {
    this.#value = value;
    this.counters = counters;
  }

  get value(): T {
    return this.#value;
  }

  set value(next: T) {
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.counters.subscriptions++;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

class TestEvent {
  readonly bubbles = true;
  readonly cancelable = true;
  readonly composed = true;
  target: TestElement | null = null;

  constructor(readonly type: string) {}
}

type TestListener = (event: TestEvent) => void;

abstract class TestNode {
  readonly ownerDocument: TestDocument;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];

  constructor(ownerDocument: TestDocument) {
    this.ownerDocument = ownerDocument;
  }

  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index >= 0 ? (this.parentNode.childNodes[index + 1] ?? null) : null;
  }

  appendChild(node: TestNode): TestNode {
    this.detach(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node: TestNode, reference: TestNode): TestNode {
    this.detach(node);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('insertBefore reference is not a child');
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    return node;
  }

  removeChild(node: TestNode): TestNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  private detach(node: TestNode): void {
    if (!node.parentNode) return;
    node.parentNode.removeChild(node);
  }
}

class TestText extends TestNode {
  readonly nodeType = 3;
  #data: string;

  constructor(ownerDocument: TestDocument, data: string) {
    super(ownerDocument);
    this.#data = data;
  }

  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
  }
}

class TestComment extends TestNode {
  readonly nodeType = 8;

  constructor(
    ownerDocument: TestDocument,
    readonly data: string,
  ) {
    super(ownerDocument);
  }
}

class TestElement extends TestNode {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<TestListener>>();
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  #value = '';
  #innerHtml = '';

  constructor(ownerDocument: TestDocument, tagName: string) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
  }

  get value(): string {
    return this.#value;
  }

  set value(next: string) {
    this.#value = next;
    this.ownerDocument.counters.valueWrites++;
  }

  get innerHTML(): string {
    return this.#innerHtml;
  }

  set innerHTML(next: string) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.#innerHtml = next;
  }

  simulateUserInput(next: string): void {
    this.#value = next;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    this.ownerDocument.counters.listenerAdds++;
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: TestEvent): boolean {
    if (!event.target) event.target = this;
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    if (event.bubbles && this.parentNode instanceof TestElement) {
      this.parentNode.dispatchEvent(event);
    }
    return true;
  }
}

class TestDocument {
  activeElement: TestElement | null = null;
  readonly counters: Counters = {
    createdElements: 0,
    createdTexts: 0,
    createdComments: 0,
    subscriptions: 0,
    listenerAdds: 0,
    valueWrites: 0,
  };

  createElement(tagName: string): TestElement {
    this.counters.createdElements++;
    return new TestElement(this, tagName);
  }

  createTextNode(value: string): TestText {
    this.counters.createdTexts++;
    return new TestText(this, value);
  }

  createComment(value: string): TestComment {
    this.counters.createdComments++;
    return new TestComment(this, value);
  }
}

type TestRoot = TestElement;

function element(doc: TestDocument, tag: string, attrs: Array<[string, string]> = []): TestElement {
  const node = doc.createElement(tag);
  for (const [name, value] of attrs) node.setAttribute(name, value);
  return node;
}

function makeSsrDom(doc: TestDocument): {
  root: TestRoot;
  div: TestElement;
  h1: TestElement;
  h1Value: TestText;
  input: TestElement;
  button: TestElement;
  parity: TestElement;
  ul: TestElement;
  items: TestElement[];
} {
  const root = element(doc, 'host');
  const div = element(doc, 'div', [['class', 'demo']]);
  const h1 = element(doc, 'h1');
  h1.appendChild(doc.createTextNode('Count: '));
  h1.appendChild(doc.createComment('oe:p0'));
  const h1Value = doc.createTextNode('0');
  h1.appendChild(h1Value);
  const input = element(doc, 'input');
  input.setAttribute('value', 'ready');
  const button = element(doc, 'button', [['type', 'button']]);
  button.appendChild(doc.createTextNode('+'));
  const parityStart = doc.createComment('oe:p3');
  const parity = element(doc, 'p', [['class', 'parity']]);
  parity.appendChild(doc.createTextNode('zero'));
  const parityEnd = doc.createComment('oe:/p3');
  const ul = element(doc, 'ul');
  ul.appendChild(doc.createComment('oe:p4'));
  const itemA = element(doc, 'li');
  itemA.appendChild(doc.createTextNode('alpha'));
  const itemB = element(doc, 'li');
  itemB.appendChild(doc.createTextNode('beta'));
  ul.appendChild(itemA);
  ul.appendChild(itemB);
  ul.appendChild(doc.createComment('oe:/p4'));
  div.appendChild(h1);
  div.appendChild(input);
  div.appendChild(button);
  div.appendChild(parityStart);
  div.appendChild(parity);
  div.appendChild(parityEnd);
  div.appendChild(ul);
  root.appendChild(div);
  return { root, div, h1, h1Value, input, button, parity, ul, items: [itemA, itemB] };
}

function makeHost(counters: Counters) {
  const count = new TestSignal(0, counters);
  const label = new TestSignal('ready', counters);
  const items = new TestSignal(
    [
      { id: 'a', text: 'alpha' },
      { id: 'b', text: 'beta' },
    ],
    counters,
  );
  let clicks = 0;
  const host = {
    signals: { count, label, items },
    handlers: {
      increment: () => {
        clicks++;
        count.value++;
      },
    },
  };
  return {
    host,
    count,
    label,
    items,
    get clicks() {
      return clicks;
    },
  };
}

const PROGRAM_URL = new URL('../../__fixtures__/compiled-claim/program.json', import.meta.url);
const CONTENT_URL = new URL(
  '../../__fixtures__/compiled-claim/expected-content.html.txt',
  import.meta.url,
);

async function loadProgram(): Promise<unknown> {
  return JSON.parse(await readFile(PROGRAM_URL, 'utf8'));
}

test('alpha.3 claim preserves identity, live state, and one pre-upgrade event replay', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const counters = doc.counters;
  const { host, count, label } = makeHost(counters);
  const initialElements = counters.createdElements;
  const initialTexts = counters.createdTexts;
  const initialComments = counters.createdComments;
  dom.input.simulateUserInput('typed before upgrade');
  dom.input.selectionStart = 3;
  dom.input.selectionEnd = 8;
  dom.input.focus();

  const capture = capturePreUpgradeEvents(dom.root as unknown as EventTarget, ['click']);
  dom.button.dispatchEvent(new TestEvent('click'));
  const instance = claimExistingDom(program, host, dom.root as unknown as Node, {
    preUpgradeEvents: capture,
  });

  // The claim itself allocates nothing; the one extra element/text is the
  // legitimate conditional Region update caused by replaying the click.
  expect(counters.createdElements).toEqual(initialElements + 1);
  expect(counters.createdTexts).toEqual(initialTexts + 1);
  expect(counters.createdComments).toEqual(initialComments);
  expect(counters.valueWrites).toEqual(0);
  expect(dom.input.value).toEqual('typed before upgrade');
  expect(doc.activeElement).toBe(dom.input);
  expect(dom.input.selectionStart).toEqual(3);
  expect(dom.input.selectionEnd).toEqual(8);
  expect(count.value).toEqual(1);
  expect(dom.h1Value.data).toEqual('1');
  expect(replayPreUpgradeEvents(dom.root as unknown as Node, capture.events)).toEqual(0);

  dom.button.dispatchEvent(new TestEvent('click'));
  expect(count.value).toEqual(2);
  expect(dom.h1Value.data).toEqual('2');
  label.value = 'after claim';
  expect(dom.input.value).toEqual('after claim');

  const claimedInput = dom.div.childNodes[1] as TestElement;
  const claimedH1Value = dom.h1.childNodes[2] as TestText;
  expect(claimedInput).toBe(dom.input);
  expect(claimedH1Value).toBe(dom.h1Value);
  instance.dispose();
  count.value = 9;
  expect(dom.h1Value.data).toEqual('2');
});

test('alpha.3 claim resolves fixed sinks across expanded dynamic anchors', () => {
  // The fixed sinks follow a static wrapper whose dynamic text Part expands at
  // runtime; the unified path-safety rule keeps sink paths statically indexed,
  // and the claim walk still crosses the expanded anchor before the sinks.
  const program = testProgram({
    tag: 'oe-demo-path',
    template: [
      {
        k: 'el',
        tag: 'section',
        attrs: [],
        children: [
          { k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] },
          { k: 'el', tag: 'input', attrs: [], children: [] },
        ],
      },
    ],
    parts: [
      { k: 'text', index: 0, signal: 'label' },
      { k: 'prop', index: 1, signal: 'label', name: 'value', path: [0, 1] },
      {
        k: 'event',
        index: 2,
        event: 'click',
        handler: 'increment',
        action: { kind: 'method', name: 'increment' },
        path: [0, 1],
      },
    ],
  });
  const doc = new TestDocument();
  const root = element(doc, 'host');
  const section = element(doc, 'section');
  const labelSlot = element(doc, 'div');
  labelSlot.appendChild(doc.createComment('oe:p0'));
  const labelText = doc.createTextNode('ready');
  labelSlot.appendChild(labelText);
  section.appendChild(labelSlot);
  const input = element(doc, 'input', [['value', 'ready']]);
  input.simulateUserInput('typed before claim');
  section.appendChild(input);
  root.appendChild(section);
  const controls = makeHost(doc.counters);

  const instance = claimExistingDom(program, controls.host, root as unknown as Node);
  expect(section.childNodes[1] as TestElement).toBe(input);
  expect(input.value).toEqual('typed before claim');
  controls.label.value = 'after claim';
  expect(labelText.data).toEqual('after claim');
  expect(input.value).toEqual('after claim');
  input.dispatchEvent(new TestEvent('click'));
  expect(controls.clicks).toEqual(1);
  instance.dispose();
});

test('alpha.3 claim reads the owned fixture and server content without a second renderer', async () => {
  const program = await loadProgram();
  const counters: Counters = {
    createdElements: 0,
    createdTexts: 0,
    createdComments: 0,
    subscriptions: 0,
    listenerAdds: 0,
    valueWrites: 0,
  };
  const { host } = makeHost(counters);
  const expected = (await readFile(CONTENT_URL, 'utf8')).trimEnd();
  expect(serializeProgramContent(program, host)).toEqual(expected);
});

test('alpha.3 claim stages validation before resources and reports a structured mismatch', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  dom.h1.childNodes[0] = doc.createTextNode('Count? ');
  dom.h1.childNodes[0].parentNode = dom.h1;
  const beforeElements = doc.counters.createdElements;
  const counters = doc.counters;
  const { host } = makeHost(counters);
  const error = assertThrowsIncludes(
    () => claimExistingDom(program, host, dom.root as unknown as Node),
    PartProgramClaimError,
  );
  expect(error.code).toEqual('OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH');
  expect(error.message).toContain('template[0].children[0].children[0]');
  expect(error.ownerKind).toEqual('root');
  expect(counters.subscriptions).toEqual(0);
  expect(counters.listenerAdds).toEqual(0);
  expect(doc.counters.createdElements).toEqual(beforeElements);
});

test('alpha.3 failed claim stops a live pre-upgrade capture', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  dom.h1.childNodes[0] = doc.createTextNode('Count? ');
  dom.h1.childNodes[0].parentNode = dom.h1;
  const { host } = makeHost(doc.counters);
  const capture = capturePreUpgradeEvents(dom.root as unknown as EventTarget, ['click']);

  assertThrowsIncludes(
    () =>
      claimExistingDom(program, host, dom.root as unknown as Node, {
        preUpgradeEvents: capture,
      }),
    PartProgramClaimError,
  );
  dom.button.dispatchEvent(new TestEvent('click'));
  expect(capture.events.length).toEqual(0);

  const invalidCapture = capturePreUpgradeEvents(dom.root as unknown as EventTarget, ['click']);
  assertThrowsIncludes(
    () =>
      claimExistingDom({ version: 2 }, host, dom.root as unknown as Node, {
        preUpgradeEvents: invalidCapture,
      }),
    Error,
  );
  dom.button.dispatchEvent(new TestEvent('click'));
  expect(invalidCapture.events.length).toEqual(0);
});

test('replay pins a first-activation cutoff: morph reconnect never re-handles live clicks', () => {
  const doc = new TestDocument();
  const root = doc.createElement('div');
  const button = doc.createElement('button');
  root.appendChild(button);
  let handled = 0;
  const capture = capturePreUpgradeEvents(root as unknown as EventTarget, ['click']);

  // Pre-upgrade interaction: no live listener yet, only the capture observes.
  button.dispatchEvent(new TestEvent('click'));
  expect(capture.events.length).toEqual(1);

  // Activation attaches the live listener, replays the captured click once,
  // and releases this root's records (facade connectedCallback contract).
  button.addEventListener('click', () => {
    handled++;
  });
  expect(replayPreUpgradeEvents(root as unknown as Node, capture.events)).toEqual(1);
  expect(handled).toEqual(1);
  releasePreUpgradeEvents(root as unknown as Node, capture.events);
  expect(capture.events.length).toEqual(0);

  // Live interactions run the handler directly while the page-lifetime
  // capture keeps observing (latest record per target/type).
  button.dispatchEvent(new TestEvent('click'));
  button.dispatchEvent(new TestEvent('click'));
  button.dispatchEvent(new TestEvent('click'));
  expect(handled).toEqual(4);

  // A morph reconnect reuses the cached claim activation and replays again:
  // post-activation records must not re-handle (still 4, never 5).
  expect(replayPreUpgradeEvents(root as unknown as Node, capture.events)).toEqual(0);
  expect(handled).toEqual(4);
});

test('replay cutoffs are per-root: a pending sibling still receives its pre-upgrade click', () => {
  const doc = new TestDocument();
  const scope = doc.createElement('div');
  const first = doc.createElement('div');
  const second = doc.createElement('div');
  const firstButton = doc.createElement('button');
  const secondButton = doc.createElement('button');
  scope.appendChild(first);
  scope.appendChild(second);
  first.appendChild(firstButton);
  second.appendChild(secondButton);
  let firstHandled = 0;
  let secondHandled = 0;
  firstButton.addEventListener('click', () => {
    firstHandled++;
  });
  secondButton.addEventListener('click', () => {
    secondHandled++;
  });
  const capture = capturePreUpgradeEvents(scope as unknown as EventTarget, ['click']);

  // The first island activates with nothing captured yet.
  expect(replayPreUpgradeEvents(first as unknown as Node, capture.events)).toEqual(0);

  // A live click on the active island plus a pre-upgrade click on the
  // still-pending sibling.
  firstButton.dispatchEvent(new TestEvent('click'));
  secondButton.dispatchEvent(new TestEvent('click'));
  expect(firstHandled).toEqual(1);
  expect(secondHandled).toEqual(1);

  // The pending sibling replays its own pre-upgrade click exactly once ...
  expect(replayPreUpgradeEvents(second as unknown as Node, capture.events)).toEqual(1);
  expect(secondHandled).toEqual(2);
  // ... while the already-active sibling never re-handles its live click.
  expect(replayPreUpgradeEvents(first as unknown as Node, capture.events)).toEqual(0);
  expect(firstHandled).toEqual(1);
  expect(replayPreUpgradeEvents(second as unknown as Node, capture.events)).toEqual(0);
  expect(secondHandled).toEqual(2);
});

test('replay accepts hand-built records without a capture sequence', () => {
  const doc = new TestDocument();
  const root = doc.createElement('div');
  const button = doc.createElement('button');
  root.appendChild(button);
  let handled = 0;
  button.addEventListener('click', () => {
    handled++;
  });
  // No capture sequence: hand-built records sort before every captured event.
  const records = [
    {
      target: button as unknown as EventTarget,
      type: 'click',
      event: new TestEvent('click') as unknown as Event,
    },
  ];
  expect(replayPreUpgradeEvents(root as unknown as Node, records)).toEqual(1);
  expect(handled).toEqual(1);
  expect(replayPreUpgradeEvents(root as unknown as Node, records)).toEqual(0);
  expect(handled).toEqual(1);
});

test('alpha.3 owning recovery replaces only a bounded Region range', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const surroundingInput = dom.input;
  const surroundingList = dom.ul;
  (dom.parity.childNodes[0] as TestText).data = 'drifted';
  const counters = doc.counters;
  const { host, count } = makeHost(counters);
  const mismatches: PartProgramClaimError[] = [];
  claimExistingDom(program, host, dom.root as unknown as Node, {
    recovery: 'owning',
    onMismatch: (error) => mismatches.push(error),
  });
  expect(mismatches.length).toEqual(1);
  expect(mismatches[0].ownerKind).toEqual('region');
  expect(dom.input).toBe(surroundingInput);
  expect(dom.ul).toBe(surroundingList);
  const replacementParity = dom.div.childNodes[4] as TestElement;
  expect((replacementParity.childNodes[0] as TestText).data).toEqual('zero');
  expect(counters.createdElements).toEqual(10);
  expect(counters.createdTexts).toEqual(7);
  count.value = 1;
  const replacement = dom.div.childNodes[4] as TestElement;
  expect((replacement.childNodes[0] as TestText).data).toEqual('positive');
});

test('alpha.3 detached Region anchors stop updates at the owning boundary', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const { host, count, items } = makeHost(doc.counters);
  const instance = claimExistingDom(program, host, dom.root as unknown as Node);

  const whenAnchor = dom.div.childNodes[3];
  dom.div.removeChild(whenAnchor);
  const parity = dom.parity;
  const beforeWhenElements = doc.counters.createdElements;
  count.value = 1;
  expect(dom.div.childNodes[3]).toBe(parity);
  expect((parity.childNodes[0] as TestText).data).toEqual('zero');
  expect(doc.counters.createdElements).toEqual(beforeWhenElements);

  const listAnchor = dom.ul.childNodes[0];
  dom.ul.removeChild(listAnchor);
  const initialItems = [...dom.items];
  items.value = [{ id: 'c', text: 'gamma' }];
  expect(dom.ul.childNodes.length).toEqual(3);
  expect(dom.ul.childNodes[0]).toBe(initialItems[0]);
  expect(dom.ul.childNodes[1]).toBe(initialItems[1]);
  instance.dispose();
});

test('alpha.3 owning recovery can replace only the root owner after root drift', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const oldDiv = dom.div;
  dom.div.setAttribute('class', 'drifted');
  const { host, count } = makeHost(doc.counters);
  const mismatches: PartProgramClaimError[] = [];
  const instance = claimExistingDom(program, host, dom.root as unknown as Node, {
    recovery: 'owning',
    onMismatch: (error) => mismatches.push(error),
  });

  expect(mismatches.length).toEqual(1);
  expect(mismatches[0].ownerKind).toEqual('root');
  const recoveredDiv = dom.root.childNodes[0] as TestElement;
  expect(recoveredDiv !== oldDiv).toBeTruthy();
  expect(recoveredDiv.getAttribute('class')).toEqual('demo');
  expect((recoveredDiv.childNodes[1] as TestElement).value).toEqual('ready');
  (recoveredDiv.childNodes[2] as TestElement).dispatchEvent(new TestEvent('click'));
  expect(count.value).toEqual(1);
  instance.dispose();
});

test('alpha.3 fail-closed validation rejects executable program attributes', async () => {
  const program = (await loadProgram()) as {
    template: Array<{ attrs: Array<[string, string]> }>;
  };
  program.template[0].attrs = [['onclick', 'alert(1)']];
  const error = assertThrowsIncludes(
    () => serializeProgramContent(program, { signals: {} }),
    Error,
  );
  expect(error.message).toContain('unsafe name');
});

test('alpha.3 claim rejects duplicate keyed Region data before attaching', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const counters = doc.counters;
  const { host, items } = makeHost(counters);
  items.value = [
    { id: 'a', text: 'alpha' },
    { id: 'a', text: 'again' },
  ];
  const error = assertThrowsIncludes(
    () => claimExistingDom(program, host, dom.root as unknown as Node),
    PartProgramClaimError,
  );
  expect(error.ownerKind).toEqual('region');
  expect(error.message).toContain('duplicate key');
  expect(counters.subscriptions).toEqual(0);
  expect(counters.listenerAdds).toEqual(0);
});

test('alpha.3 claim rejects inherited keyed Region fields before attaching', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const counters = doc.counters;
  const controls = makeHost(counters);
  const inherited = Object.create({ id: 'a', text: 'alpha' }) as { id: string; text: string };
  controls.items.value = [inherited];

  const error = assertThrowsIncludes(
    () => claimExistingDom(program, controls.host, dom.root as unknown as Node),
    PartProgramClaimError,
  );
  expect(error.ownerKind).toEqual('region');
  expect(error.message).toContain('item needs');
  expect(counters.subscriptions).toEqual(0);
  expect(counters.listenerAdds).toEqual(0);
});

test('alpha.3 keyed Region moves, reuses, updates, and removes only owned entries', async () => {
  const program = await loadProgram();
  const doc = new TestDocument();
  const dom = makeSsrDom(doc);
  const { host, items } = makeHost(doc.counters);
  const instance = claimExistingDom(program, host, dom.root as unknown as Node);
  const initialA = dom.items[0];
  const initialB = dom.items[1];

  items.value = [
    { id: 'b', text: 'BETA' },
    { id: 'c', text: 'gamma' },
    { id: 'a', text: 'ALPHA' },
  ];
  const firstPass = dom.ul.childNodes.filter(
    (node): node is TestElement => node instanceof TestElement,
  );
  expect(firstPass.length).toEqual(3);
  expect(firstPass[0]).toBe(initialB);
  expect(firstPass[2]).toBe(initialA);
  expect((firstPass[0].childNodes[0] as TestText).data).toEqual('BETA');
  expect((firstPass[2].childNodes[0] as TestText).data).toEqual('ALPHA');
  expect((firstPass[1].childNodes[0] as TestText).data).toEqual('gamma');

  items.value = [
    { id: 'a', text: 'alpha again' },
    { id: 'c', text: 'gamma again' },
  ];
  const secondPass = dom.ul.childNodes.filter(
    (node): node is TestElement => node instanceof TestElement,
  );
  expect(secondPass.length).toEqual(2);
  expect(secondPass[0]).toBe(initialA);
  expect(secondPass[1]).toBe(firstPass[1]);
  expect((secondPass[0].childNodes[0] as TestText).data).toEqual('alpha again');
  expect((secondPass[1].childNodes[0] as TestText).data).toEqual('gamma again');
  expect(initialB.parentNode).toEqual(null);
  instance.dispose();
});

test('alpha.3 claim preserves nested custom-element node identity without entering its internals', () => {
  const program = testProgram({
    tag: 'oe-demo-nested',
    template: [
      {
        k: 'el',
        tag: 'x-shell',
        attrs: [['data-owner', 'demo']],
        children: [
          {
            k: 'el',
            tag: 'x-third-party',
            attrs: [],
            children: [{ k: 'text', value: 'foreign' }],
          },
        ],
      },
    ],
    parts: [],
  });
  const doc = new TestDocument();
  const root = element(doc, 'host');
  const shell = element(doc, 'x-shell', [['data-owner', 'demo']]);
  const foreign = element(doc, 'x-third-party');
  foreign.appendChild(doc.createTextNode('foreign'));
  shell.appendChild(foreign);
  root.appendChild(shell);
  const claimed = claimExistingDom(program, { signals: {}, handlers: {} }, root as unknown as Node);
  expect(root.childNodes[0]).toBe(shell);
  expect(shell.childNodes[0]).toBe(foreign);
  claimed.dispose();
  expect(true).toBeTruthy();
});

test('claim leaves an independently SSG-expanded empty custom host to its own program', () => {
  const program = testProgram({
    tag: 'oe-parent',
    template: [
      {
        k: 'el',
        tag: 'x-child',
        attrs: [['model', '{"title":"Nested"}']],
        children: [],
      },
    ],
    parts: [],
  });
  const doc = new TestDocument();
  const root = element(doc, 'host');
  const child = element(doc, 'x-child', [
    ['model', '{"title":"Nested"}'],
    ['data-oe-light', ''],
  ]);
  child.appendChild(element(doc, 'style', [['data-oe-static-styles', '']]));
  const heading = element(doc, 'h1');
  heading.appendChild(doc.createTextNode('Nested'));
  child.appendChild(heading);
  root.appendChild(child);

  const claimed = claimExistingDom(program, { signals: {}, handlers: {} }, root as unknown as Node);
  expect(root.childNodes[0]).toBe(child);
  expect(child.childNodes[1]).toBe(heading);
  claimed.dispose();
});

test('claim preserves externally projected route content inside an empty slot', () => {
  const program = testProgram({
    tag: 'oe-shell',
    template: [
      {
        k: 'el',
        tag: 'main',
        attrs: [],
        children: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
      },
    ],
    parts: [],
  });
  const doc = new TestDocument();
  const root = element(doc, 'host');
  const main = element(doc, 'main');
  const slot = element(doc, 'slot');
  const route = element(doc, 'page-home', [['data-oe-light', '']]);
  route.appendChild(element(doc, 'article'));
  slot.appendChild(route);
  main.appendChild(slot);
  root.appendChild(main);

  const claimed = claimExistingDom(program, { signals: {}, handlers: {} }, root as unknown as Node);
  expect((main.childNodes[0] as TestElement).childNodes[0]).toBe(route);
  claimed.dispose();
});

test('compiled claim requires TrustedHtml before accepting an opaque html Part', () => {
  const program = testProgram({
    tag: 'oe-claim-html',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });
  const doc = new TestDocument();
  const root = element(doc, 'host');
  const div = element(doc, 'div');
  const strong = element(doc, 'strong');
  strong.appendChild(doc.createTextNode('safe'));
  div.appendChild(strong);
  root.appendChild(div);
  const body = new TestSignal<unknown>(trustedHtml('<strong>safe</strong>'), doc.counters);
  const claimed = claimExistingDom(
    program,
    { signals: { body }, handlers: {} },
    root as unknown as Node,
  );
  body.value = trustedHtml('<em>updated</em>');
  expect(div.innerHTML).toEqual('<em>updated</em>');
  assertThrowsIncludes(
    () => {
      body.value = '<img src=x onerror=alert(1)>';
    },
    Error,
    'requires a value created by trustedHtml()',
  );
  expect(div.innerHTML).toEqual('<em>updated</em>');
  claimed.dispose();

  const unsafeDoc = new TestDocument();
  const unsafeRoot = element(unsafeDoc, 'host');
  unsafeRoot.appendChild(element(unsafeDoc, 'div'));
  assertThrowsIncludes(
    () =>
      claimExistingDom(
        program,
        {
          signals: {
            body: new TestSignal<unknown>('<strong>unsafe</strong>', unsafeDoc.counters),
          },
          handlers: {},
        },
        unsafeRoot as unknown as Node,
      ),
    Error,
    'requires a value created by trustedHtml()',
  );
});
