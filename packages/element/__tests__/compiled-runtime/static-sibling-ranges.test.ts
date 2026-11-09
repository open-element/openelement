/**
 * M07b contract fixtures for a declared directory of static sibling ranges.
 *
 * These are DOM API fixtures. They are not SSR output, not a packed-consumer
 * run, and not TSX-18/TSX-30. Mount does not emit the markers. Static ranges
 * have zero subscriptions; that is not a dynamic-subscription account.
 */

import { beforeEach, expect, test } from 'vitest';
import { OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
import { signal } from '../../src/internal/signal/framework.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { bindSignalWrites } from '../../src/internal/compiled/runtime/bindings.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import {
  claimStaticSiblingRange,
  openStaticSiblingDirectory,
  type DeclaredStaticNode,
  type StaticSiblingDirectory,
} from '../../src/internal/compiled/runtime/static-sibling-ranges.ts';

class OperationLog {
  readonly events: string[] = [];

  read(kind: string): void {
    this.events.push(`read:${kind}`);
  }

  write(kind: string): void {
    this.events.push(`write:${kind}`);
  }

  writesSince(mark: number): string[] {
    return this.events.slice(mark).filter((event) => event.startsWith('write:'));
  }
}

class LogNode {
  parentNode: LogElement | null = null;
  readonly childNodes: LogNode[] = [];

  constructor(
    readonly log: OperationLog,
    readonly nodeType: number,
  ) {}

  appendChild(node: LogNode): LogNode {
    this.log.write('insert');
    node.parentNode?.removeChild(node);
    node.parentNode = this as unknown as LogElement;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node: LogNode): LogNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild node is not a child');
    this.log.write('remove');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  item(index: number): LogNode | null {
    return this.childNodes[index] ?? null;
  }
}

class LogText extends LogNode {
  #value: string;

  constructor(log: OperationLog, value: string) {
    super(log, 3);
    this.#value = value;
  }

  get nodeValue(): string {
    this.log.read('nodeValue');
    return this.#value;
  }

  set nodeValue(value: string) {
    this.log.write('nodeValue');
    this.#value = value;
  }
}

class LogComment extends LogNode {
  #value: string;

  constructor(log: OperationLog, value: string) {
    super(log, 8);
    this.#value = value;
  }

  get nodeValue(): string {
    this.log.read('nodeValue');
    return this.#value;
  }

  set nodeValue(value: string) {
    this.log.write('nodeValue');
    this.#value = value;
  }
}

class LogAttributes {
  readonly entries: { name: string; value: string }[] = [];

  constructor(private readonly log: OperationLog) {}

  get length(): number {
    return this.entries.length;
  }

  item(index: number): { name: string; value: string } | null {
    this.log.read('attribute');
    return this.entries[index] ?? null;
  }

  set(name: string, value: string): void {
    this.log.write('attribute');
    const found = this.entries.find((entry) => entry.name === name);
    if (found) found.value = value;
    else this.entries.push({ name, value });
  }
}

class LogElement extends LogNode {
  readonly namespaceURI: string | null = null;
  readonly attributes: LogAttributes;
  #nodeValue: string | null = null;

  constructor(
    log: OperationLog,
    readonly localName: string,
  ) {
    super(log, 1);
    this.attributes = new LogAttributes(log);
  }

  get nodeValue(): string | null {
    this.log.read('nodeValue');
    return this.#nodeValue;
  }

  set nodeValue(value: string | null) {
    this.log.write('nodeValue');
    this.#nodeValue = value;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class LogDocument {
  readonly log = new OperationLog();

  element(localName: string): LogElement {
    return new LogElement(this.log, localName);
  }

  text(value: string): LogText {
    return new LogText(this.log, value);
  }

  comment(value: string): LogComment {
    return new LogComment(this.log, value);
  }
}

function asNode(node: LogNode): Node {
  return node as unknown as Node;
}

function asParent(node: LogElement): Node {
  const parent = node as unknown as Node & {
    childNodes: LogNode[] & { item(index: number): LogNode | null };
  };
  parent.childNodes.item = (index: number) => node.childNodes[index] ?? null;
  return parent;
}

function capture(run: () => unknown): OpenElementError {
  try {
    run();
  } catch (error) {
    if (error instanceof OpenElementError) return error;
    throw error;
  }
  throw new Error('expected a coded failure');
}

function paragraph(text: string): DeclaredStaticNode[] {
  return [
    {
      kind: 'element',
      localName: 'p',
      attributes: [],
      children: [{ kind: 'text', nodeValue: text }],
    },
  ];
}

function buildRange(
  doc: LogDocument,
  parent: LogElement,
  ordinal: number | string,
  text: string,
): { start: LogComment; end: LogComment; element: LogElement; text: LogText } {
  const start = doc.comment(`oe:r:${ordinal}`);
  const element = doc.element('p');
  const textNode = doc.text(text);
  element.appendChild(textNode);
  const end = doc.comment(`oe:/r:${ordinal}`);
  parent.appendChild(start);
  parent.appendChild(element);
  parent.appendChild(end);
  return { start, end, element, text: textNode };
}

function openPair(
  doc = new LogDocument(),
  texts = ['same', 'same'],
): {
  doc: LogDocument;
  parent: LogElement;
  ranges: ReturnType<typeof buildRange>[];
  directory: StaticSiblingDirectory;
} {
  const parent = doc.element('div');
  const ranges = texts.map((text, ordinal) => buildRange(doc, parent, ordinal, text));
  const directory = openStaticSiblingDirectory(
    asParent(parent),
    texts.map((text) => paragraph(text)),
    'fixtures/Ranges.tsx',
  );
  return { doc, parent, ranges, directory };
}

beforeEach(() => {
  runtimeProbe.reset();
});

test('A: identical ranges keep preheld refs, two owners, and zero static subscriptions', () => {
  const { parent, ranges, directory } = openPair();
  const host = new LifetimeScope();
  const before = runtimeProbe.snapshot();
  const first = claimStaticSiblingRange(directory, 0, host, () => undefined);
  const second = claimStaticSiblingRange(
    directory,
    { start: asNode(ranges[1].start) },
    host,
    () => undefined,
  );
  const after = runtimeProbe.snapshot();

  expect(first.start).toBe(ranges[0].start);
  expect(first.end).toBe(ranges[0].end);
  expect(first.interior).toEqual([ranges[0].element]);
  expect(second.start).toBe(ranges[1].start);
  expect(second.interior[0]).toBe(ranges[1].element);
  expect(first.owner).not.toBe(second.owner);
  expect(after.owners - before.owners).toBe(2);
  expect(after.subscriptions - before.subscriptions).toBe(0);
  expect(after.unsubscribed - before.unsubscribed).toBe(0);

  first.dispose(true);
  expect(ranges[0].element.parentNode).toBeNull();
  expect(ranges[0].start.parentNode).toBeNull();
  expect(ranges[1].element.parentNode).toBe(parent);
  expect(second.owner.disposed).toBe(false);
  second.dispose(false);
  expect(ranges[1].element.parentNode).toBe(parent);
});

test('B: marker and static mismatches write nothing and keep borrowed nodes', () => {
  const cases: {
    name: string;
    build: (doc: LogDocument, parent: LogElement) => void;
    declaration: readonly (readonly DeclaredStaticNode[])[];
  }[] = [
    {
      name: 'missing end',
      declaration: [paragraph('same')],
      build(doc, parent) {
        parent.appendChild(doc.comment('oe:r:0'));
        parent.appendChild(doc.element('p'));
      },
    },
    {
      name: 'mismatched end',
      declaration: [paragraph('same')],
      build(doc, parent) {
        parent.appendChild(doc.comment('oe:r:0'));
        parent.appendChild(doc.element('p'));
        parent.appendChild(doc.comment('oe:/r:1'));
      },
    },
    {
      name: 'crossed markers',
      declaration: [paragraph('a'), paragraph('b')],
      build(doc, parent) {
        parent.appendChild(doc.comment('oe:r:0'));
        parent.appendChild(doc.comment('oe:r:1'));
        parent.appendChild(doc.comment('oe:/r:1'));
        parent.appendChild(doc.comment('oe:/r:0'));
      },
    },
    {
      name: 'nested marker',
      declaration: [paragraph('same')],
      build(doc, parent) {
        const element = doc.element('p');
        element.appendChild(doc.comment('oe:r:4'));
        parent.appendChild(doc.comment('oe:r:0'));
        parent.appendChild(element);
        parent.appendChild(doc.comment('oe:/r:0'));
      },
    },
    {
      name: 'outside node',
      declaration: [paragraph('same')],
      build(doc, parent) {
        parent.appendChild(doc.text('nope'));
        buildRange(doc, parent, 0, 'same');
      },
    },
    {
      name: 'out of bounds marker',
      declaration: [paragraph('same')],
      build(doc, parent) {
        buildRange(doc, parent, 2, 'same');
      },
    },
  ];

  for (const entry of cases) {
    const doc = new LogDocument();
    const parent = doc.element('div');
    entry.build(doc, parent);
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const error = capture(() =>
      openStaticSiblingDirectory(asParent(parent), entry.declaration, `fixtures/${entry.name}`),
    );
    expect(error.code, entry.name).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(error.code, entry.name).not.toBe(RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE);
    expect(doc.log.writesSince(mark), entry.name).toEqual([]);
    expect(
      doc.log.events.slice(mark).some((event) => event.startsWith('read:')),
      entry.name,
    ).toBe(true);
    expect(parent.childNodes, entry.name).toHaveLength(held.length);
    for (let index = 0; index < held.length; index += 1) {
      expect(parent.childNodes[index], entry.name).toBe(held[index]);
    }
    expect(runtimeProbe.snapshot().owners, entry.name).toBe(0);
  }

  const doc = new LogDocument();
  const parent = doc.element('table');
  buildRange(doc, parent, 0, 'same');
  const tableError = capture(() =>
    openStaticSiblingDirectory(asParent(parent), [paragraph('same')]),
  );
  expect(tableError.message).toContain('parent:');

  const nested = new LogDocument();
  const host = nested.element('div');
  const start = nested.comment('oe:r:0');
  const svg = nested.element('svg');
  const end = nested.comment('oe:/r:0');
  host.appendChild(start);
  host.appendChild(svg);
  host.appendChild(end);
  expect(
    capture(() => openStaticSiblingDirectory(asParent(host), [paragraph('same')])).message,
  ).toContain('unsupported element');

  const live = new LogDocument();
  const liveParent = live.element('div');
  const first = buildRange(live, liveParent, 0, 'same');
  const second = buildRange(live, liveParent, 1, 'actual');
  const directory = openStaticSiblingDirectory(
    asParent(liveParent),
    [paragraph('same'), paragraph('expected')],
    'fixtures/static-seed',
  );
  const kept = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
  const mark = live.log.events.length;
  const seed = capture(() =>
    claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined),
  );
  expect(seed.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(seed.message).toContain('static-seed');
  expect(live.log.writesSince(mark)).toEqual([]);
  expect(live.log.events.slice(mark).some((event) => event === 'read:nodeValue')).toBe(true);
  expect(first.element.parentNode).not.toBeNull();
  expect(second.element.parentNode).toBe(liveParent);
  expect(kept.owner.disposed).toBe(false);
  expect(runtimeProbe.snapshot().subscriptions).toBe(0);
});

test('C: non-canonical ordinals are rejected without parseInt truncation', () => {
  const bad = ['-1', '01', '1a', '+1', '1.0', '1e2', '9007199254740993'];
  for (const token of bad) {
    const doc = new LogDocument();
    const parent = doc.element('div');
    buildRange(doc, parent, 0, 'same');
    parent.childNodes[0] = doc.comment(`oe:r:${token}`);
    (parent.childNodes[0] as LogComment).parentNode = parent;
    const mark = doc.log.events.length;
    const error = capture(() => openStaticSiblingDirectory(asParent(parent), [paragraph('same')]));
    expect(error.message, token).toContain(`oe:r:${token}`);
    expect(error.message, token).not.toContain('ordinal 1 is not');
    expect(doc.log.writesSince(mark), token).toEqual([]);
  }

  const doc = new LogDocument();
  const parent = doc.element('div');
  buildRange(doc, parent, 0, 'a');
  buildRange(doc, parent, '01', 'b');
  const leadingZero = capture(() =>
    openStaticSiblingDirectory(asParent(parent), [paragraph('a'), paragraph('b')]),
  );
  expect(leadingZero.message).toContain('oe:r:01');

  const duplicate = new LogDocument();
  const duplicateParent = duplicate.element('div');
  buildRange(duplicate, duplicateParent, 0, 'a');
  buildRange(duplicate, duplicateParent, 0, 'b');
  expect(
    capture(() =>
      openStaticSiblingDirectory(asParent(duplicateParent), [paragraph('a'), paragraph('b')]),
    ).message,
  ).toContain('order:');

  const gap = new LogDocument();
  const gapParent = gap.element('div');
  buildRange(gap, gapParent, 0, 'a');
  buildRange(gap, gapParent, 2, 'b');
  expect(
    capture(() =>
      openStaticSiblingDirectory(asParent(gapParent), [
        paragraph('a'),
        paragraph('b'),
        paragraph('c'),
      ]),
    ).message,
  ).toContain('order:');

  const { directory } = openPair();
  expect(
    capture(() => claimStaticSiblingRange(directory, -1, new LifetimeScope(), () => undefined))
      .message,
  ).toContain('ordinal:');
  expect(
    capture(() => claimStaticSiblingRange(directory, 1.5, new LifetimeScope(), () => undefined))
      .message,
  ).toContain('ordinal:');
  expect(
    capture(() =>
      claimStaticSiblingRange(directory, Number.NaN, new LifetimeScope(), () => undefined),
    ).message,
  ).toContain('ordinal:');
});

test('D: a released failure can be retried by the caller; a commit cannot, and does not free the other range', () => {
  const doc = new LogDocument();
  const parent = doc.element('div');
  buildRange(doc, parent, '01', 'same');
  expect(
    capture(() => openStaticSiblingDirectory(asParent(parent), [paragraph('same')])).code,
  ).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  (parent.childNodes[0] as LogComment).nodeValue = 'oe:r:0';
  (parent.childNodes[2] as LogComment).nodeValue = 'oe:/r:0';
  const directory = openStaticSiblingDirectory(
    asParent(parent),
    [paragraph('same')],
    'fixtures/Retry.tsx',
  );
  const host = new LifetimeScope();
  const claimed = claimStaticSiblingRange(directory, 0, host, () => undefined);
  expect(claimed.ordinal).toBe(0);
  expect(
    capture(() => claimStaticSiblingRange(directory, 0, host, () => undefined)).message,
  ).toContain('consumed:');

  const pairedDoc = new LogDocument();
  const pairedParent = pairedDoc.element('div');
  const keptRange = buildRange(pairedDoc, pairedParent, 0, 'keep');
  const brokenRange = buildRange(pairedDoc, pairedParent, 1, 'wrong');
  const paired = openStaticSiblingDirectory(
    asParent(pairedParent),
    [paragraph('keep'), paragraph('right')],
    'fixtures/RetrySeed.tsx',
  );
  const first = claimStaticSiblingRange(paired, 0, new LifetimeScope(), () => undefined);
  const seed = capture(() =>
    claimStaticSiblingRange(paired, 1, new LifetimeScope(), () => undefined),
  );
  expect(seed.message).toContain('static-seed');
  expect(first.owner.disposed).toBe(false);
  expect(keptRange.element.parentNode).toBe(pairedParent);
  brokenRange.text.nodeValue = 'right';
  const fixed = claimStaticSiblingRange(paired, 1, new LifetimeScope(), () => undefined);
  expect(fixed.interior[0]).toBe(brokenRange.element);
  expect(first.owner.disposed).toBe(false);

  const contender = openPair();
  const owned = claimStaticSiblingRange(
    contender.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  expect(() =>
    claimStaticSiblingRange(contender.directory, 1, new LifetimeScope(), () => {
      throw new Error('activation failed');
    }),
  ).toThrow(/activation failed/);
  expect(owned.owner.disposed).toBe(false);
  expect(contender.ranges[0].element.parentNode).toBe(contender.parent);
  const retried = claimStaticSiblingRange(
    contender.directory,
    1,
    new LifetimeScope(),
    () => undefined,
  );
  expect(retried.owner).not.toBe(owned.owner);
  expect(owned.owner.disposed).toBe(false);
});

test('E: activation and DOM getters reenter under the reservation; there is no separate dynamic-host suite', () => {
  const { directory, ranges } = openPair();
  const host = new LifetimeScope();
  let busy: OpenElementError | undefined;
  const claimed = claimStaticSiblingRange(directory, 0, host, () => {
    try {
      claimStaticSiblingRange(directory, 0, host, () => undefined);
    } catch (error) {
      if (error instanceof OpenElementError) busy = error;
      else throw error;
    }
  });
  expect(busy?.message).toContain('busy:');
  expect(claimed.owner.disposed).toBe(false);
  expect(
    capture(() => claimStaticSiblingRange(directory, 0, host, () => undefined)).message,
  ).toContain('consumed:');
  const next = claimStaticSiblingRange(
    directory,
    { start: asNode(ranges[1].start) },
    host,
    () => undefined,
  );
  expect(next.ordinal).toBe(1);

  const again = openPair();
  const text = again.ranges[0].text;
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(text), 'nodeValue');
  let tripped = false;
  Object.defineProperty(text, 'nodeValue', {
    configurable: true,
    get() {
      if (!tripped) {
        tripped = true;
        claimStaticSiblingRange(again.directory, 0, new LifetimeScope(), () => undefined);
      }
      return 'same';
    },
  });
  const reentered = capture(() =>
    claimStaticSiblingRange(again.directory, 0, new LifetimeScope(), () => undefined),
  );
  expect(reentered.message).toContain('busy:');
  if (original) Object.defineProperty(text, 'nodeValue', original);
  const recovered = claimStaticSiblingRange(
    again.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  expect(recovered.start).toBe(again.ranges[0].start);
});

test('F: dispose modes stay first-wins, and an activation write is not rolled back', () => {
  const host = new LifetimeScope();
  const { parent, ranges, directory } = openPair();
  const suspended = claimStaticSiblingRange(directory, 0, host, () => undefined);
  const live = claimStaticSiblingRange(directory, 1, host, () => undefined);
  suspended.dispose(false);
  expect(ranges[0].element.parentNode).toBe(parent);
  suspended.dispose(true);
  expect(ranges[0].element.parentNode).toBe(parent);
  expect(ranges[0].start.parentNode).toBe(parent);
  expect(
    capture(() => claimStaticSiblingRange(directory, 0, host, () => undefined)).message,
  ).toContain('consumed:');

  host.dispose(true);
  expect(ranges[0].element.parentNode).toBe(parent);
  expect(ranges[1].element.parentNode).toBeNull();
  expect(ranges[1].end.parentNode).toBeNull();
  expect(live.owner.disposed).toBe(true);

  const direct = openPair();
  const removed = claimStaticSiblingRange(
    direct.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  removed.dispose(true);
  expect(direct.ranges[0].start.parentNode).toBeNull();
  expect(direct.ranges[0].element.parentNode).toBeNull();
  expect(direct.ranges[0].end.parentNode).toBeNull();
  expect(direct.ranges[1].element.parentNode).toBe(direct.parent);
  expect(
    capture(() =>
      claimStaticSiblingRange(direct.directory, 0, new LifetimeScope(), () => undefined),
    ).message,
  ).toContain('consumed:');

  const count = signal(4);
  const activation = openPair(new LogDocument(), ['server', 'other']);
  const seen: number[] = [];
  const mark = activation.doc.log.events.length;
  expect(() =>
    claimStaticSiblingRange(activation.directory, 0, new LifetimeScope(), (scope, interior) => {
      const element = interior[0] as unknown as LogElement;
      element.setAttribute('data-n', String(count.value));
      bindSignalWrites(scope, count, 'count', (value) => {
        seen.push(Number(value));
        element.setAttribute('data-n', String(value));
      });
      throw new Error('after write');
    }),
  ).toThrow(/after write/);
  expect(activation.ranges[0].element.attributes.entries).toEqual([{ name: 'data-n', value: '4' }]);
  expect(activation.doc.log.writesSince(mark)).toContain('write:attribute');
  expect(activation.ranges[0].element.parentNode).toBe(activation.parent);
  const probe = runtimeProbe.snapshot();
  expect(probe.subscriptions).toBe(1);
  expect(probe.unsubscribed).toBe(1);
  count.value = 9;
  expect(seen).toEqual([]);
  expect(activation.ranges[0].element.attributes.entries[0]?.value).toBe('4');
  expect(
    capture(() =>
      claimStaticSiblingRange(activation.directory, 1, new LifetimeScope(), () => undefined),
    ).message,
  ).toContain('order:');
  activation.ranges[0].element.attributes.entries.length = 0;
  const afterFailure = claimStaticSiblingRange(
    activation.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  expect(afterFailure.start).toBe(activation.ranges[0].start);
});
