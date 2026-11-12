/**
 * M07b contract fixtures for a declared directory of static sibling ranges.
 *
 * These are DOM API fixtures. They are not SSR output, not a packed-consumer
 * run, and not TSX-18/TSX-30. Mount does not emit the markers. Static ranges
 * have zero subscriptions; that is not a dynamic-subscription account.
 */

import { beforeEach, describe, expect, test } from 'vitest';
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

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

class LogElement extends LogNode {
  readonly attributes: LogAttributes;
  #nodeValue: string | null = null;

  constructor(
    log: OperationLog,
    readonly localName: string,
    readonly namespaceURI: string | null = HTML_NAMESPACE,
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

  element(localName: string, namespaceURI: string | null = HTML_NAMESPACE): LogElement {
    return new LogElement(this.log, localName, namespaceURI);
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
      // A start marker is `oe:r:<n>`; `oe:/r:<n>` is the close spelling. An
      // end marker in the start slot used to be read as that range's start and
      // then matched against the next identical end marker, so the directory
      // opened on a malformed skeleton. The start slot must reject end=true.
      name: 'end marker where a start is required',
      declaration: [paragraph('same')],
      build(doc, parent) {
        parent.appendChild(doc.comment('oe:/r:0'));
        parent.appendChild(doc.comment('oe:/r:0'));
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
  // The failed range writes nothing. Recovery releases the earlier range's
  // owner; the borrowed nodes stay. Retry is covered by the M07-4 describe.
  expect(kept.owner.disposed).toBe(true);
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

test('D: a released failure can be retried by the caller, and a completed directory commit cannot', () => {
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
  expect(first.owner.disposed).toBe(true);
  expect(keptRange.element.parentNode).toBe(pairedParent);
  expect(brokenRange.element.parentNode).toBe(pairedParent);
  brokenRange.text.nodeValue = 'right';
  const restarted = claimStaticSiblingRange(paired, 0, new LifetimeScope(), () => undefined);
  const fixed = claimStaticSiblingRange(paired, 1, new LifetimeScope(), () => undefined);
  expect(restarted.owner.disposed).toBe(false);
  expect(restarted.owner).not.toBe(first.owner);
  expect(fixed.interior[0]).toBe(brokenRange.element);
  expect(first.owner.disposed).toBe(true);

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
  expect(owned.owner.disposed).toBe(true);
  expect(contender.ranges[0].element.parentNode).toBe(contender.parent);
  const retried = claimStaticSiblingRange(
    contender.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  const retriedNext = claimStaticSiblingRange(
    contender.directory,
    1,
    new LifetimeScope(),
    () => undefined,
  );
  expect(retried.owner).not.toBe(owned.owner);
  expect(retriedNext.start).toBe(contender.ranges[1].start);
  expect(owned.owner.disposed).toBe(true);
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

test('repeated opens share one pair identity across reentry, dispose, and retry', () => {
  const doc = new LogDocument();
  const parent = doc.element('div');
  const range0 = buildRange(doc, parent, 0, 'same');
  const range1 = buildRange(doc, parent, 1, 'same');
  const declaration = [paragraph('same'), paragraph('same')];
  const first = openStaticSiblingDirectory(asParent(parent), declaration, 'fixtures/Pair.tsx');
  const second = openStaticSiblingDirectory(asParent(parent), declaration, 'fixtures/Pair.tsx');
  expect(first).not.toBe(second);

  const contenderHost = new LifetimeScope();
  let contender: OpenElementError | undefined;
  const claimed = claimStaticSiblingRange(first, 0, new LifetimeScope(), () => {
    const owners = runtimeProbe.snapshot().owners;
    try {
      claimStaticSiblingRange(
        second,
        { start: asNode(range0.start) },
        contenderHost,
        () => undefined,
      );
    } catch (error) {
      if (error instanceof OpenElementError) contender = error;
      else throw error;
    }
    expect(runtimeProbe.snapshot().owners).toBe(owners);
    expect(contenderHost.disposed).toBe(false);
  });
  expect(contender?.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(contender?.message).toContain('busy:');
  expect(claimed.start).toBe(range0.start);
  expect(claimed.end).toBe(range0.end);
  expect(claimed.owner.disposed).toBe(false);
  expect(runtimeProbe.snapshot().owners).toBe(1);
  expect(range0.element.parentNode).toBe(parent);

  const overlap = runtimeProbe.snapshot();
  const mark = doc.log.events.length;
  const duplicate = capture(() =>
    claimStaticSiblingRange(second, 0, new LifetimeScope(), () => undefined),
  );
  expect(duplicate.message).toContain('consumed:');
  expect(doc.log.writesSince(mark)).toEqual([]);
  expect(runtimeProbe.snapshot().owners).toBe(overlap.owners);
  expect(runtimeProbe.snapshot().regions).toBe(overlap.regions);
  expect(claimed.owner.disposed).toBe(false);
  expect(range0.element.parentNode).toBe(parent);

  claimed.dispose(true);
  expect(range0.start.parentNode).toBeNull();
  expect(range0.element.parentNode).toBeNull();
  expect(range0.end.parentNode).toBeNull();
  expect(range1.element.parentNode).toBe(parent);
  expect(claimed.owner.disposed).toBe(true);

  const reopened = openStaticSiblingDirectory(asParent(parent), declaration, 'fixtures/Pair.tsx');
  expect(
    capture(() => claimStaticSiblingRange(reopened, 0, new LifetimeScope(), () => undefined))
      .message,
  ).toContain('consumed:');
  expect(
    capture(() =>
      claimStaticSiblingRange(
        reopened,
        { start: asNode(range0.start) },
        new LifetimeScope(),
        () => undefined,
      ),
    ).message,
  ).toContain('consumed:');
  expect(
    capture(() =>
      claimStaticSiblingRange(
        second,
        { start: asNode(range0.end) },
        new LifetimeScope(),
        () => undefined,
      ),
    ).message,
  ).toContain('consumed:');
  expect(range1.element.parentNode).toBe(parent);
  const rest = claimStaticSiblingRange(second, 1, new LifetimeScope(), () => undefined);
  expect(rest.start).toBe(range1.start);
  expect(rest.owner.disposed).toBe(false);
  expect(rest.owner).not.toBe(claimed.owner);

  const retryDoc = new LogDocument();
  const retryParent = retryDoc.element('div');
  const retryRange = buildRange(retryDoc, retryParent, 0, 'same');
  const retryDeclaration = [paragraph('same')];
  const retryFirst = openStaticSiblingDirectory(asParent(retryParent), retryDeclaration);
  const retrySecond = openStaticSiblingDirectory(asParent(retryParent), retryDeclaration);
  expect(() =>
    claimStaticSiblingRange(retryFirst, 0, new LifetimeScope(), () => {
      claimStaticSiblingRange(retrySecond, 0, new LifetimeScope(), () => undefined);
    }),
  ).toThrow(/busy:/);
  expect(retryRange.element.parentNode).toBe(retryParent);
  expect(retryRange.start.parentNode).toBe(retryParent);
  const retried = claimStaticSiblingRange(retrySecond, 0, new LifetimeScope(), () => undefined);
  expect(retried.start).toBe(retryRange.start);
  expect(retried.owner.disposed).toBe(false);

  const duringDoc = new LogDocument();
  const duringParent = duringDoc.element('div');
  const duringRange = buildRange(duringDoc, duringParent, 0, 'same');
  const duringDeclaration = [paragraph('same')];
  const duringDirectory = openStaticSiblingDirectory(asParent(duringParent), duringDeclaration);
  let reopenedDuringClaim: OpenElementError | undefined;
  const held = claimStaticSiblingRange(duringDirectory, 0, new LifetimeScope(), () => {
    try {
      openStaticSiblingDirectory(asParent(duringParent), duringDeclaration);
    } catch (error) {
      if (error instanceof OpenElementError) reopenedDuringClaim = error;
      else throw error;
    }
  });
  expect(reopenedDuringClaim?.message).toContain('busy:');
  expect(held.owner.disposed).toBe(false);
  expect(held.start).toBe(duringRange.start);

  const left = openPair();
  const right = openPair();
  const leftClaim = claimStaticSiblingRange(
    left.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  const rightClaim = claimStaticSiblingRange(
    right.directory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  expect(leftClaim.start).not.toBe(rightClaim.start);
  leftClaim.dispose(true);
  expect(left.ranges[0].element.parentNode).toBeNull();
  expect(rightClaim.owner.disposed).toBe(false);
  expect(right.ranges[0].element.parentNode).toBe(right.parent);
  expect(
    capture(() => claimStaticSiblingRange(left.directory, 0, new LifetimeScope(), () => undefined))
      .message,
  ).toContain('consumed:');
  const rightNext = claimStaticSiblingRange(
    openStaticSiblingDirectory(asParent(right.parent), [paragraph('same'), paragraph('same')]),
    1,
    new LifetimeScope(),
    () => undefined,
  );
  expect(rightNext.start).toBe(right.ranges[1].start);
  expect(rightClaim.owner.disposed).toBe(false);
});

test('restricted table, select, template, and non-HTML contexts write nothing', () => {
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const mathNamespace = 'http://www.w3.org/1998/Math/MathML';
  const restrictedParents = [
    'table',
    'TABLE',
    'caption',
    'colgroup',
    'col',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'TD',
    'select',
    'optgroup',
    'option',
    'OPTION',
    'template',
    'Template',
    'svg',
    'math',
    'Math',
  ];

  function expectQuiet(
    doc: LogDocument,
    parent: LogElement,
    mark: number,
    held: readonly LogNode[],
  ): void {
    expect(doc.log.writesSince(mark)).toEqual([]);
    const probe = runtimeProbe.snapshot();
    expect(probe.owners).toBe(0);
    expect(probe.regions).toBe(0);
    expect(probe.rangeCleanups).toBe(0);
    expect(probe.subscriptions).toBe(0);
    expect(probe.projections).toBe(0);
    expect(parent.childNodes).toHaveLength(held.length);
    for (let index = 0; index < held.length; index += 1) {
      expect(parent.childNodes[index]).toBe(held[index]);
    }
  }

  for (const localName of restrictedParents) {
    runtimeProbe.reset();
    const doc = new LogDocument();
    const parent = doc.element(localName);
    buildRange(doc, parent, 0, 'same');
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const error = capture(() =>
      openStaticSiblingDirectory(asParent(parent), [paragraph('same')], `fixtures/${localName}`),
    );
    expect(error.code, localName).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(error.message, localName).toContain('parent:');
    expect(error.message, localName).toContain(localName);
    expect(error.code, localName).not.toBe(RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE);
    expectQuiet(doc, parent, mark, held);
  }

  for (const localName of [
    'tbody',
    'tr',
    'td',
    'TD',
    'option',
    'TABLE',
    'template',
    'svg',
    'math',
  ]) {
    runtimeProbe.reset();
    const doc = new LogDocument();
    const parent = doc.element('div');
    const start = doc.comment('oe:r:0');
    const bad = doc.element(localName);
    const end = doc.comment('oe:/r:0');
    parent.appendChild(start);
    parent.appendChild(bad);
    parent.appendChild(end);
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const error = capture(() =>
      openStaticSiblingDirectory(asParent(parent), [paragraph('same')], `fixtures/in-${localName}`),
    );
    expect(error.message, localName).toContain('unsupported element');
    expect(error.message, localName).toContain(localName);
    expectQuiet(doc, parent, mark, held);
  }

  runtimeProbe.reset();
  const nested = new LogDocument();
  const nestedParent = nested.element('div');
  const nestedStart = nested.comment('oe:r:0');
  const paragraphHost = nested.element('p');
  paragraphHost.appendChild(nested.element('td'));
  paragraphHost.appendChild(nested.element('option'));
  const nestedEnd = nested.comment('oe:/r:0');
  nestedParent.appendChild(nestedStart);
  nestedParent.appendChild(paragraphHost);
  nestedParent.appendChild(nestedEnd);
  const nestedHeld = [...nestedParent.childNodes];
  const nestedMark = nested.log.events.length;
  const nestedError = capture(() =>
    openStaticSiblingDirectory(asParent(nestedParent), [paragraph('same')]),
  );
  expect(nestedError.message).toContain('unsupported element');
  expect(nestedError.message).toContain('td');
  expectQuiet(nested, nestedParent, nestedMark, nestedHeld);

  for (const ancestorName of ['TABLE', 'select', 'template']) {
    runtimeProbe.reset();
    const doc = new LogDocument();
    const ancestor = doc.element(ancestorName);
    const parent = doc.element('div');
    ancestor.appendChild(parent);
    buildRange(doc, parent, 0, 'same');
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const error = capture(() => openStaticSiblingDirectory(asParent(parent), [paragraph('same')]));
    expect(error.message, ancestorName).toContain('directory is inside');
    expect(error.message, ancestorName).toContain(ancestorName);
    expectQuiet(doc, parent, mark, held);
  }

  for (const namespace of [svgNamespace, mathNamespace]) {
    runtimeProbe.reset();
    const doc = new LogDocument();
    const parent = doc.element('div', namespace);
    buildRange(doc, parent, 0, 'same');
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const error = capture(() => openStaticSiblingDirectory(asParent(parent), [paragraph('same')]));
    expect(error.message, namespace).toContain('non-HTML namespace');
    expect(error.message, namespace).toContain(namespace);
    expectQuiet(doc, parent, mark, held);

    runtimeProbe.reset();
    const inner = new LogDocument();
    const host = inner.element('div');
    const foreign = inner.element('div', namespace);
    host.appendChild(inner.comment('oe:r:0'));
    host.appendChild(foreign);
    host.appendChild(inner.comment('oe:/r:0'));
    const innerHeld = [...host.childNodes];
    const innerMark = inner.log.events.length;
    const innerError = capture(() =>
      openStaticSiblingDirectory(asParent(host), [paragraph('same')]),
    );
    expect(innerError.message, namespace).toContain('non-HTML namespace');
    expectQuiet(inner, host, innerMark, innerHeld);
  }

  runtimeProbe.reset();
  const foreignAncestor = new LogDocument();
  const svgHost = foreignAncestor.element('g', svgNamespace);
  const htmlChild = foreignAncestor.element('div', htmlNamespace);
  svgHost.appendChild(htmlChild);
  buildRange(foreignAncestor, htmlChild, 0, 'same');
  const ancestorMark = foreignAncestor.log.events.length;
  const ancestorHeld = [...htmlChild.childNodes];
  const ancestorError = capture(() =>
    openStaticSiblingDirectory(asParent(htmlChild), [paragraph('same')]),
  );
  expect(ancestorError.message).toContain('directory is inside');
  expect(ancestorError.message).toContain(svgNamespace);
  expectQuiet(foreignAncestor, htmlChild, ancestorMark, ancestorHeld);

  runtimeProbe.reset();
  const admitted = new LogDocument();
  const admittedParent = admitted.element('div', htmlNamespace);
  buildRange(admitted, admittedParent, 0, 'same');
  const admittedDirectory = openStaticSiblingDirectory(asParent(admittedParent), [
    paragraph('same'),
  ]);
  const admittedClaim = claimStaticSiblingRange(
    admittedDirectory,
    0,
    new LifetimeScope(),
    () => undefined,
  );
  expect(admittedClaim.interior[0]).toBe(admittedParent.childNodes[1]);
  expect(runtimeProbe.snapshot().owners).toBe(1);
});

test('null namespaceURI is refused on the parent, ancestors, and in-range elements', () => {
  function expectQuiet(
    doc: LogDocument,
    parent: LogElement,
    mark: number,
    held: readonly LogNode[],
  ): void {
    expect(doc.log.writesSince(mark)).toEqual([]);
    const probe = runtimeProbe.snapshot();
    expect(probe.owners).toBe(0);
    expect(probe.regions).toBe(0);
    expect(probe.rangeCleanups).toBe(0);
    expect(probe.subscriptions).toBe(0);
    expect(probe.projections).toBe(0);
    expect(parent.childNodes).toHaveLength(held.length);
    for (let index = 0; index < held.length; index += 1) {
      expect(parent.childNodes[index]).toBe(held[index]);
    }
  }

  runtimeProbe.reset();
  const parentDoc = new LogDocument();
  const nullParent = parentDoc.element('div', null);
  buildRange(parentDoc, nullParent, 0, 'same');
  const parentHeld = [...nullParent.childNodes];
  const parentMark = parentDoc.log.events.length;
  const parentError = capture(() =>
    openStaticSiblingDirectory(asParent(nullParent), [paragraph('same')], 'fixtures/null-parent'),
  );
  expect(parentError.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(parentError.code).not.toBe(RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE);
  expect(parentError.message).toContain('non-HTML namespace');
  expect(parentError.message).toContain('null');
  expect(parentError.message).not.toContain('static-seed');
  expect(nullParent.namespaceURI).toBeNull();
  expectQuiet(parentDoc, nullParent, parentMark, parentHeld);

  runtimeProbe.reset();
  const ancestorDoc = new LogDocument();
  const nullAncestor = ancestorDoc.element('section', null);
  const htmlParent = ancestorDoc.element('div');
  nullAncestor.appendChild(htmlParent);
  buildRange(ancestorDoc, htmlParent, 0, 'same');
  const ancestorHeld = [...htmlParent.childNodes];
  const ancestorMark = ancestorDoc.log.events.length;
  const ancestorError = capture(() =>
    openStaticSiblingDirectory(asParent(htmlParent), [paragraph('same')], 'fixtures/null-ancestor'),
  );
  expect(ancestorError.message).toContain('directory is inside');
  expect(ancestorError.message).toContain('non-HTML namespace');
  expect(ancestorError.message).toContain('null');
  expect(htmlParent.namespaceURI).toBe(HTML_NAMESPACE);
  expectQuiet(ancestorDoc, htmlParent, ancestorMark, ancestorHeld);

  runtimeProbe.reset();
  const rangeDoc = new LogDocument();
  const rangeParent = rangeDoc.element('div');
  const start = rangeDoc.comment('oe:r:0');
  const nullParagraph = rangeDoc.element('p', null);
  nullParagraph.appendChild(rangeDoc.text('same'));
  const end = rangeDoc.comment('oe:/r:0');
  rangeParent.appendChild(start);
  rangeParent.appendChild(nullParagraph);
  rangeParent.appendChild(end);
  const rangeHeld = [...rangeParent.childNodes];
  const rangeMark = rangeDoc.log.events.length;
  const rangeError = capture(() =>
    openStaticSiblingDirectory(
      asParent(rangeParent),
      [paragraph('same')],
      'fixtures/null-interior',
    ),
  );
  expect(rangeError.message).toContain('unsupported element');
  expect(rangeError.message).toContain('non-HTML namespace');
  expect(rangeError.message).toContain('null');
  expect(rangeError.message).not.toContain('static-seed');
  expectQuiet(rangeDoc, rangeParent, rangeMark, rangeHeld);

  runtimeProbe.reset();
  const nestedDoc = new LogDocument();
  const nestedParent = nestedDoc.element('div');
  const nestedStart = nestedDoc.comment('oe:r:0');
  const admittedParagraph = nestedDoc.element('p');
  admittedParagraph.appendChild(nestedDoc.element('span', null));
  const nestedEnd = nestedDoc.comment('oe:/r:0');
  nestedParent.appendChild(nestedStart);
  nestedParent.appendChild(admittedParagraph);
  nestedParent.appendChild(nestedEnd);
  const nestedHeld = [...nestedParent.childNodes];
  const nestedMark = nestedDoc.log.events.length;
  const nestedError = capture(() =>
    openStaticSiblingDirectory(
      asParent(nestedParent),
      [paragraph('same')],
      'fixtures/null-descendant',
    ),
  );
  expect(nestedError.message).toContain('non-HTML namespace');
  expect(nestedError.message).toContain('null');
  expect(nestedError.message).toContain('span');
  expectQuiet(nestedDoc, nestedParent, nestedMark, nestedHeld);
});

/**
 * ADR-0175 D-1. The harness is this file's Node DOM shim: 非浏览器资格.
 * It is not the M07-2 chromium clean-path and it does not fill TSX-18 or
 * TSX-30. A passing shim is not browser qualification.
 */
describe('M07-4 bounded mismatch recovery', () => {
  function expectSameChildren(parent: LogElement, held: readonly LogNode[]): void {
    expect(parent.childNodes).toHaveLength(held.length);
    for (let index = 0; index < held.length; index += 1) {
      expect(parent.childNodes[index]).toBe(held[index]);
    }
  }

  test('a first-range validation failure creates no owner, writes nothing, and stays retryable', () => {
    const doc = new LogDocument();
    const parent = doc.element('div');
    const range0 = buildRange(doc, parent, 0, 'wrong');
    const range1 = buildRange(doc, parent, 1, 'next');
    const declaration = [paragraph('right'), paragraph('next')];
    const directory = openStaticSiblingDirectory(
      asParent(parent),
      declaration,
      'fixtures/M07-4-first.tsx',
    );
    const held = [...parent.childNodes];
    const mark = doc.log.events.length;
    const before = runtimeProbe.snapshot();
    const error = capture(() =>
      claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(error.message).toContain('static-seed');
    expect(error.message).not.toContain('consumed:');
    expect(error.message).not.toContain('busy:');
    expect(doc.log.writesSince(mark)).toEqual([]);
    const after = runtimeProbe.snapshot();
    expect(after.owners).toBe(before.owners);
    expect(after.rangeCleanups).toBe(before.rangeCleanups);
    expect(after.projections).toBe(before.projections);
    expect(after.subscriptions).toBe(before.subscriptions);
    expectSameChildren(parent, held);
    expect(range0.element.parentNode).toBe(parent);
    expect(range1.element.parentNode).toBe(parent);

    const reopened = openStaticSiblingDirectory(
      asParent(parent),
      declaration,
      'fixtures/M07-4-first.tsx',
    );
    range0.text.nodeValue = 'right';
    const claimed = claimStaticSiblingRange(reopened, 0, new LifetimeScope(), () => undefined);
    expect(claimed.ordinal).toBe(0);
    expect(claimed.start).toBe(range0.start);
    expect(claimed.owner.disposed).toBe(false);
    const second = claimStaticSiblingRange(reopened, 1, new LifetimeScope(), () => undefined);
    expect(second.start).toBe(range1.start);
    const duplicate = capture(() =>
      claimStaticSiblingRange(reopened, 0, new LifetimeScope(), () => undefined),
    );
    expect(duplicate.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(duplicate.message).toContain('consumed:');
  });

  test('a range-1 validation failure rolls back the range committed in that attempt', () => {
    const doc = new LogDocument();
    const parent = doc.element('div');
    const range0 = buildRange(doc, parent, 0, 'keep');
    const range1 = buildRange(doc, parent, 1, 'wrong');
    const directory = openStaticSiblingDirectory(
      asParent(parent),
      [paragraph('keep'), paragraph('right')],
      'fixtures/M07-4-seed.tsx',
    );
    const held = [...parent.childNodes];
    let released = false;
    const first = claimStaticSiblingRange(directory, 0, new LifetimeScope(), (scope) => {
      scope.add(() => {
        released = true;
      });
    });
    const mark = doc.log.events.length;
    const seed = capture(() =>
      claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined),
    );
    expect(seed.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(seed.message).toContain('static-seed');
    expect(seed.message).not.toContain('consumed:');
    expect(doc.log.writesSince(mark)).toEqual([]);
    expect(released).toBe(true);
    expect(first.owner.disposed).toBe(true);
    expectSameChildren(parent, held);
    expect(range0.element.parentNode).toBe(parent);
    expect(range1.element.parentNode).toBe(parent);
    expect(range0.start).toBe(held[0]);
    expect(range1.end).toBe(held[held.length - 1]);

    const tooSoon = capture(() =>
      claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined),
    );
    expect(tooSoon.message).toContain('order:');
    expect(tooSoon.message).not.toContain('consumed:');
    expect(tooSoon.message).not.toContain('busy:');

    const restarted = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
    expect(restarted.start).toBe(range0.start);
    expect(restarted.owner).not.toBe(first.owner);
    expect(restarted.owner.disposed).toBe(false);
    const again = capture(() =>
      claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined),
    );
    expect(again.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(again.message).toContain('static-seed');
    expect(again.message).not.toContain('consumed:');
    expect(restarted.owner.disposed).toBe(true);
    expectSameChildren(parent, held);

    range1.text.nodeValue = 'right';
    const restored = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
    const fixed = claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined);
    expect(restored.interior[0]).toBe(range0.element);
    expect(fixed.interior[0]).toBe(range1.element);
    const permanent = capture(() =>
      claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(permanent.message).toContain('consumed:');
  });

  test('a range-1 activation failure rolls the attempt back and leaves the dynamic write', () => {
    const doc = new LogDocument();
    const parent = doc.element('div');
    const range0 = buildRange(doc, parent, 0, 'keep');
    const range1 = buildRange(doc, parent, 1, 'keep');
    const directory = openStaticSiblingDirectory(
      asParent(parent),
      [paragraph('keep'), paragraph('keep')],
      'fixtures/M07-4-activate.tsx',
    );
    const held = [...parent.childNodes];
    const first = claimStaticSiblingRange(directory, 0, new LifetimeScope(), (_scope, interior) => {
      (interior[0] as unknown as LogElement).setAttribute('data-from', 'range-0');
    });
    const mark = doc.log.events.length;
    let activationReleased = false;
    expect(() =>
      claimStaticSiblingRange(directory, 1, new LifetimeScope(), (scope, interior) => {
        const element = interior[0] as unknown as LogElement;
        element.setAttribute('data-from', 'range-1');
        scope.add(() => {
          activationReleased = true;
        });
        throw new Error('activation failed');
      }),
    ).toThrow(/activation failed/);
    expect(activationReleased).toBe(true);
    expect(first.owner.disposed).toBe(true);
    expect(range0.element.attributes.entries).toEqual([{ name: 'data-from', value: 'range-0' }]);
    expect(range1.element.attributes.entries).toEqual([{ name: 'data-from', value: 'range-1' }]);
    expect(doc.log.writesSince(mark)).toContain('write:attribute');
    expect(doc.log.writesSince(mark)).not.toContain('write:remove');
    expectSameChildren(parent, held);
    expect(range0.start.parentNode).toBe(parent);
    expect(range0.element.parentNode).toBe(parent);
    expect(range0.end.parentNode).toBe(parent);
    expect(range1.start.parentNode).toBe(parent);
    expect(range1.element.parentNode).toBe(parent);
    expect(range1.end.parentNode).toBe(parent);

    // The leftover attributes are not restored, so a fresh claim fails the
    // seed compare. It must not fail with consumed: because of the partial commit.
    const blocked = capture(() =>
      claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(blocked.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(blocked.message).toContain('static-seed');
    expect(blocked.message).not.toContain('consumed:');
    expect(range0.element.attributes.entries).toEqual([{ name: 'data-from', value: 'range-0' }]);
    expect(range1.element.attributes.entries).toEqual([{ name: 'data-from', value: 'range-1' }]);
    expectSameChildren(parent, held);

    range0.element.attributes.entries.length = 0;
    range1.element.attributes.entries.length = 0;
    const retry0 = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
    const retry1 = claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined);
    expect(retry0.start).toBe(range0.start);
    expect(retry1.start).toBe(range1.start);
    expect(retry0.owner.disposed).toBe(false);
    expectSameChildren(parent, held);
    const duplicate = capture(() =>
      claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(duplicate.message).toContain('consumed:');
  });

  test('a later validation failure rolls back every range committed in that attempt', () => {
    const doc = new LogDocument();
    const parent = doc.element('div');
    const ranges = [0, 1, 2].map((ordinal) =>
      buildRange(doc, parent, ordinal, ordinal === 2 ? 'wrong' : 'ok'),
    );
    const directory = openStaticSiblingDirectory(
      asParent(parent),
      [paragraph('ok'), paragraph('ok'), paragraph('ok')],
      'fixtures/M07-4-three.tsx',
    );
    const held = [...parent.childNodes];
    const first = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
    const second = claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined);
    const error = capture(() =>
      claimStaticSiblingRange(directory, 2, new LifetimeScope(), () => undefined),
    );
    expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(error.message).toContain('static-seed');
    expect(first.owner.disposed).toBe(true);
    expect(second.owner.disposed).toBe(true);
    expectSameChildren(parent, held);
    for (const range of ranges) {
      expect(range.start.parentNode).toBe(parent);
      expect(range.element.parentNode).toBe(parent);
      expect(range.end.parentNode).toBe(parent);
    }

    const restarted = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
    expect(restarted.owner.disposed).toBe(false);
    expect(
      capture(() => claimStaticSiblingRange(directory, 2, new LifetimeScope(), () => undefined))
        .message,
    ).toContain('order:');
    ranges[2]!.text.nodeValue = 'ok';
    const retry1 = claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined);
    const retry2 = claimStaticSiblingRange(directory, 2, new LifetimeScope(), () => undefined);
    expect(retry1.start).toBe(ranges[1]!.start);
    expect(retry2.start).toBe(ranges[2]!.start);
    expect(
      capture(() => claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined))
        .message,
    ).toContain('consumed:');
  });

  test('a completed directory claim stays consumed after dispose', () => {
    const { parent, ranges, directory } = openPair();
    const host = new LifetimeScope();
    const first = claimStaticSiblingRange(directory, 0, host, () => undefined);
    const second = claimStaticSiblingRange(directory, 1, host, () => undefined);
    first.dispose(false);
    second.dispose(false);
    expect(ranges[0].element.parentNode).toBe(parent);
    expect(ranges[1].element.parentNode).toBe(parent);
    expect(first.owner.disposed).toBe(true);
    expect(second.owner.disposed).toBe(true);
    const again = capture(() =>
      claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(again.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(again.message).toContain('consumed:');
    const byHandle = capture(() =>
      claimStaticSiblingRange(
        directory,
        { start: asNode(ranges[1].start) },
        new LifetimeScope(),
        () => undefined,
      ),
    );
    expect(byHandle.message).toContain('consumed:');

    const removed = openPair();
    const claimed = claimStaticSiblingRange(
      removed.directory,
      0,
      new LifetimeScope(),
      () => undefined,
    );
    const rest = claimStaticSiblingRange(
      removed.directory,
      1,
      new LifetimeScope(),
      () => undefined,
    );
    claimed.dispose(true);
    rest.dispose(true);
    expect(removed.ranges[0].element.parentNode).toBeNull();
    expect(removed.ranges[1].start.parentNode).toBeNull();
    const afterDetach = capture(() =>
      claimStaticSiblingRange(removed.directory, 0, new LifetimeScope(), () => undefined),
    );
    expect(afterDetach.message).toContain('consumed:');
  });

  test('an unfinished reservation stays exclusive, and recovery can reserve again', () => {
    const { directory, ranges, parent } = openPair();
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
    expect(busy?.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(busy?.message).toContain('busy:');
    expect(claimed.owner.disposed).toBe(false);
    expect(claimed.start).toBe(ranges[0].start);
    const duplicate = capture(() => claimStaticSiblingRange(directory, 0, host, () => undefined));
    expect(duplicate.message).toContain('consumed:');
    expect(duplicate.message).not.toContain('busy:');

    expect(() =>
      claimStaticSiblingRange(directory, 1, host, () => {
        throw new Error('activation failed');
      }),
    ).toThrow(/activation failed/);
    expect(claimed.owner.disposed).toBe(true);
    expect(ranges[0].element.parentNode).toBe(parent);
    expect(ranges[0].start.parentNode).toBe(parent);
    expect(ranges[1].element.parentNode).toBe(parent);

    let reentered: OpenElementError | undefined;
    const recovered = claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => {
      try {
        claimStaticSiblingRange(directory, 0, new LifetimeScope(), () => undefined);
      } catch (error) {
        if (error instanceof OpenElementError) reentered = error;
        else throw error;
      }
    });
    expect(reentered?.message).toContain('busy:');
    expect(recovered.owner.disposed).toBe(false);
    expect(recovered.start).toBe(ranges[0].start);
    const finished = claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined);
    expect(finished.start).toBe(ranges[1].start);
    expect(finished.owner.disposed).toBe(false);
  });

  test('rolled-back ranges release the owner, the cleanup, the subscription, and the reservation', () => {
    const count = signal(1);
    const seen: number[] = [];
    const doc = new LogDocument();
    const parent = doc.element('div');
    buildRange(doc, parent, 0, 'keep');
    const broken = buildRange(doc, parent, 1, 'wrong');
    const declaration = [paragraph('keep'), paragraph('right')];
    const directory = openStaticSiblingDirectory(
      asParent(parent),
      declaration,
      'fixtures/M07-4-release.tsx',
    );
    let cleanups = 0;
    const first = claimStaticSiblingRange(directory, 0, new LifetimeScope(), (scope) => {
      scope.add(() => {
        cleanups += 1;
      });
      bindSignalWrites(scope, count, 'count', (value) => {
        seen.push(Number(value));
      });
    });
    const beforeFail = runtimeProbe.snapshot();
    expect(beforeFail.subscriptions).toBe(1);
    expect(beforeFail.unsubscribed).toBe(0);
    const error = capture(() =>
      claimStaticSiblingRange(directory, 1, new LifetimeScope(), () => undefined),
    );
    expect(error.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
    expect(error.message).toContain('static-seed');
    expect(first.owner.disposed).toBe(true);
    expect(cleanups).toBe(1);
    const after = runtimeProbe.snapshot();
    expect(after.subscriptions).toBe(1);
    expect(after.unsubscribed).toBe(1);
    count.value = 9;
    expect(seen).toEqual([]);
    let late = 0;
    first.owner.add(() => {
      late += 1;
    });
    expect(late).toBe(1);

    const opened = openStaticSiblingDirectory(
      asParent(parent),
      declaration,
      'fixtures/M07-4-release.tsx',
    );
    broken.text.nodeValue = 'right';
    const retry = claimStaticSiblingRange(opened, 0, new LifetimeScope(), () => undefined);
    expect(retry.owner.disposed).toBe(false);
    const rest = claimStaticSiblingRange(opened, 1, new LifetimeScope(), () => undefined);
    expect(rest.owner.disposed).toBe(false);
    expect(broken.element.parentNode).toBe(parent);
    expect(
      capture(() => claimStaticSiblingRange(opened, 0, new LifetimeScope(), () => undefined))
        .message,
    ).toContain('consumed:');
  });
});
