/**
 * A10.4 / #1212 — canonical Part paths through nested when/each claim.
 *
 * The audit suspected that Region claim recursion resetting `programPath`
 * could misidentify dynamic-attribute sinks, whose identity derives from
 * canonical template Part paths. These fixtures lock the invariant
 * observationally:
 *
 *  - Valid programs: the full chain is proven per fixture — server serialize
 *    → browser receives DOM (parsed serializer output) → claim → exact
 *    Part/Region identity (zero allocations, zero replacements) → subsequent
 *    signal update mutates the exact sink node — and SSR/fresh/claim remain
 *    observationally equivalent. This covers the only dynamic-attribute
 *    forms the grammar admits near or below a Region: a sink element
 *    preceding a Region anchor, a sink element owning a Region, and
 *    per-item attribute slots inside an each Region.
 *  - Invalid programs (`when └ element(signal attr)`, nested Region anchors,
 *    fixed-part paths crossing or preceded by an anchor): the validator
 *    rejects them fail-closed, so every executor entry point rejects the
 *    identical wire program. That rejection is why the audited drift is
 *    unrepresentable — this is the permanent guard, not a bug fix.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { validatePartProgram } from '@openelement/protocol/part-program';
import { PartProgramClaimError } from '../../src/internal/compiled/runtime.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { parseHtml, TestDocument, TestElement, TestText } from '../compiled-runtime/test-dom.ts';
import {
  claimExisting,
  createFresh,
  eachHost,
  eachSiblingProgram as buildEachSiblingProgram,
  serializeSeed,
  serializeServer,
  Sig,
  whenHost,
  whenSiblingProgram as buildWhenSiblingProgram,
} from './claim-harness.ts';

const TAG_PREFIX = 'oe-a104';
const whenSiblingProgram = () => buildWhenSiblingProgram(TAG_PREFIX);
const eachSiblingProgram = () => buildEachSiblingProgram(TAG_PREFIX);

interface RawProgram {
  template: unknown[];
  parts: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
}

/** #1374 fixture: an each Region keyed by a field holding mixed value types,
 * so server duplicate detection and client reuse must agree on identity. */
function mixedKeyProgram(): unknown {
  return testProgram({
    tag: 'oe-mixed-keys',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'label',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
      },
    ],
  });
}

interface MixedKeyHost {
  signals: { items: Sig<Array<{ id: number | string; label: string }>> };
}

function mixedKeyHost(items: Array<{ id: number | string; label: string }>): MixedKeyHost {
  return { signals: { items: new Sig(items) } };
}

/** `element(dynamic attr) └ when └ element` — a Region nested inside the
 * sink element's own subtree (deeper valid Region combination). */
function regionInsideSinkProgram(): unknown {
  return testProgram({
    tag: 'oe-a104-region-in-sink',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [{ k: 'part', index: 1 }],
      },
    ],
    parts: [
      { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
      {
        k: 'when',
        index: 1,
        signal: 'count',
        test: { signal: 'count', op: 'greater-than', value: 0 },
        on: [{ k: 'el', tag: 'span', attrs: [['title', 'static-on']], children: [] }],
        off: [{ k: 'el', tag: 'span', attrs: [['title', 'static-off']], children: [] }],
      },
    ],
  });
}

/** Prove serializer/fresh equivalence, then claim the parsed SSR DOM. */
function receiveAndClaim(
  program: unknown,
  serverHost: unknown,
  browserHost: unknown,
): { html: string; doc: TestDocument; root: TestElement; instance: { dispose(): void } } {
  const html = serializeServer(program, serverHost);
  // The seed serializer and a fresh browser mount must agree with the SSR
  // payload byte-for-byte: SSR/fresh/claim observational equivalence.
  expect(serializeSeed(program, serverHost)).toEqual(html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  const freshInstance = createFresh(program, serverHost, freshRoot as unknown as Node);
  expect(freshRoot.innerHTML).toEqual(html);
  freshInstance.dispose();

  // Browser receives the DOM: parse the serialized payload into fresh nodes.
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const before = { ...doc.counts };
  const instance = claimExisting(program, browserHost, root as unknown as Node);
  // A successful claim allocates and replaces nothing: exact node identity.
  expect({ ...doc.counts }).toEqual(before);
  return { html, doc, root, instance };
}

test('A10.4: when Region branch never inherits the sibling sink path (serialize → claim → exact-sink update)', () => {
  const program = whenSiblingProgram();
  const browser = whenHost();
  const { html, root, instance } = receiveAndClaim(program, whenHost(), browser);
  expect(html).toEqual(
    '<div title="DYN"></div><!--oe:p1--><span title="static-on"></span><!--oe:/p1-->',
  );

  // Exact Part/Region identity after claim.
  const div = root.childNodes[0] as TestElement;
  const anchor = root.childNodes[1];
  const span = root.childNodes[2] as TestElement;
  const end = root.childNodes[3];
  expect(div.getAttribute('title')).toEqual('DYN');
  expect(span.getAttribute('title')).toEqual('static-on');

  // A subsequent update mutates the exact sink node — no replacement, and
  // the Region-internal static attribute is not touched by the sink.
  browser.signals.title.value = 'DYN2';
  expect(root.childNodes[0]).toBe(div);
  expect(div.getAttribute('title')).toEqual('DYN2');
  expect(root.childNodes[2]).toBe(span);
  expect(span.getAttribute('title')).toEqual('static-on');

  // The Region still owns its range: a branch swap replaces only the branch
  // content; the anchors and the sibling sink keep their node identity.
  browser.signals.count.value = 0;
  expect(root.childNodes[1]).toBe(anchor);
  expect(root.childNodes[3]).toBe(end);
  const offSpan = root.childNodes[2] as TestElement;
  expect(offSpan).not.toBe(span);
  expect(offSpan.getAttribute('title')).toEqual('static-off');
  expect(root.childNodes[0]).toBe(div);
  expect(div.getAttribute('title')).toEqual('DYN2');
  instance.dispose();
});

test('A10.4: claim fails closed on static drift inside a when Region branch', () => {
  const program = whenSiblingProgram();
  const html = serializeServer(program, whenHost());
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const span = root.childNodes[2] as TestElement;
  span.setAttribute('title', 'tampered');
  // The branch element holds no dynamic sink: a rewritten static attribute is
  // real drift and must not hide behind a reset path colliding with the
  // sibling sink at canonical path [0].
  const error = assertThrowsIncludes(
    () => claimExisting(program, whenHost(), root as unknown as Node),
    PartProgramClaimError,
  );
  expect(error.message).toContain('template[1].branch[0]');
  expect(error.message).toContain('attribute drift on "title"');
});

test('A10.4: each Region item attribute slots round-trip with exact keyed-sink updates', () => {
  const program = eachSiblingProgram();
  const browser = eachHost();
  const { html, root, instance } = receiveAndClaim(program, eachHost(), browser);
  expect(html).toEqual(
    '<div title="DYN"></div><!--oe:p1-->' +
      '<li title="item-static" data-label="alpha"></li>' +
      '<li title="item-static" data-label="beta"></li>' +
      '<!--oe:/p1-->',
  );

  const div = root.childNodes[0] as TestElement;
  const liA = root.childNodes[2] as TestElement;
  const liB = root.childNodes[3] as TestElement;
  expect(liA.getAttribute('data-label')).toEqual('alpha');
  expect(liB.getAttribute('data-label')).toEqual('beta');

  // An item-field update mutates the exact keyed item element in place.
  browser.signals.items.value = [
    { id: 'a', label: 'alpha2' },
    { id: 'b', label: 'beta' },
  ];
  expect(root.childNodes[2]).toBe(liA);
  expect(liA.getAttribute('data-label')).toEqual('alpha2');
  expect(liA.getAttribute('title')).toEqual('item-static');
  expect(root.childNodes[3]).toBe(liB);
  expect(liB.getAttribute('data-label')).toEqual('beta');

  // The sibling fixed sink keeps its canonical identity through the update.
  browser.signals.title.value = 'DYN2';
  expect(root.childNodes[0]).toBe(div);
  expect(div.getAttribute('title')).toEqual('DYN2');
  instance.dispose();
});

test('A10.4: claim fails closed on static and per-item drift inside an each Region', () => {
  const program = eachSiblingProgram();

  // Static item attribute rewritten in transit.
  const staticDoc = new TestDocument();
  const staticRoot = parseHtml(staticDoc, serializeServer(program, eachHost()));
  (staticRoot.childNodes[2] as TestElement).setAttribute('title', 'tampered');
  const staticError = assertThrowsIncludes(
    () => claimExisting(program, eachHost(), staticRoot as unknown as Node),
    PartProgramClaimError,
  );
  expect(staticError.message).toContain('template[1].item[0][0]');
  expect(staticError.message).toContain('attribute drift on "title"');

  // Per-item attribute slot rewritten in transit.
  const itemDoc = new TestDocument();
  const itemRoot = parseHtml(itemDoc, serializeServer(program, eachHost()));
  (itemRoot.childNodes[2] as TestElement).setAttribute('data-label', 'tampered');
  const itemError = assertThrowsIncludes(
    () => claimExisting(program, eachHost(), itemRoot as unknown as Node),
    PartProgramClaimError,
  );
  expect(itemError.message).toContain('item attribute drift on "data-label"');
});

test('A10.4: a Region nested inside the sink element keeps canonical paths (deeper combination)', () => {
  const program = regionInsideSinkProgram();
  const browser = whenHost();
  const { html, root, instance } = receiveAndClaim(program, whenHost(), browser);
  expect(html).toEqual(
    '<div title="DYN"><!--oe:p1--><span title="static-on"></span><!--oe:/p1--></div>',
  );

  const div = root.childNodes[0] as TestElement;
  const span = div.childNodes[1] as TestElement;
  browser.signals.title.value = 'DYN2';
  expect(root.childNodes[0]).toBe(div);
  expect(div.getAttribute('title')).toEqual('DYN2');
  expect(span.getAttribute('title')).toEqual('static-on');
  instance.dispose();

  // Static drift one level deeper still fails closed.
  const tamperedDoc = new TestDocument();
  const tamperedRoot = parseHtml(tamperedDoc, html);
  const tamperedDiv = tamperedRoot.childNodes[0] as TestElement;
  (tamperedDiv.childNodes[1] as TestElement).setAttribute('title', 'tampered');
  const error = assertThrowsIncludes(
    () => claimExisting(program, whenHost(), tamperedRoot as unknown as Node),
    PartProgramClaimError,
  );
  expect(error.message).toContain('attribute drift on "title"');
});

/**
 * Retarget the fixture's attr sink (part 0, location p0) onto a wire path
 * that crosses the Region anchor — the `when/each └ element(dynamic attr)`
 * shape the audit suspected. The validator must refuse to represent it.
 */
function retargetAttrSink(raw: RawProgram, path: number[]): void {
  raw.parts[0].path = path;
  (raw.parts[0].location as Record<string, unknown>).path = path;
  const location = raw.locations.find((candidate) => candidate.id === 'p0');
  if (location) location.path = path;
}

test('A10.4: a fixed Part path crossing a when/each anchor is rejected fail-closed everywhere', () => {
  for (const base of [whenSiblingProgram(), eachSiblingProgram()]) {
    const raw = base as RawProgram;
    retargetAttrSink(raw, [1, 0]);
    const error = assertThrowsIncludes(() => validatePartProgram(raw), Error);
    expect(error.message).toContain('parts[0].path [1,0] is unresolved');
    // Every executor entry point validates the identical wire program and
    // fails closed: no serializer or mount path can execute the drift shape.
    assertThrowsIncludes(() => serializeServer(raw, whenHost()));
    assertThrowsIncludes(() => serializeSeed(raw, whenHost()));
    assertThrowsIncludes(() =>
      createFresh(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node),
    );
    assertThrowsIncludes(() =>
      claimExisting(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node),
    );
  }
});

test('A10.4: a fixed Part path preceded by a Region anchor is rejected fail-closed everywhere', () => {
  // The builder round-trips through the real validator, so the rejected spec
  // fails at build time with the validator diagnostic.
  const error = assertThrowsIncludes(
    () =>
      testProgram({
        tag: 'oe-a104-preceded',
        template: [
          { k: 'part', index: 0 },
          { k: 'el', tag: 'div', attrs: [], children: [] },
        ],
        parts: [
          {
            k: 'when',
            index: 0,
            signal: 'count',
            test: { signal: 'count', op: 'greater-than', value: 0 },
            on: [{ k: 'el', tag: 'span', attrs: [], children: [] }],
            off: [{ k: 'el', tag: 'span', attrs: [], children: [] }],
          },
          { k: 'attr', index: 1, signal: 'title', name: 'title', path: [1] },
        ],
      }),
    Error,
  );
  expect(error.message).toContain('parts[1].path is preceded by a dynamic anchor');

  // The identical wire shape (anchor reordered before the sink element) is
  // refused by every executor entry point as well.
  const raw = whenSiblingProgram() as RawProgram;
  const [divNode, anchorNode] = raw.template;
  raw.template[0] = anchorNode;
  raw.template[1] = divNode;
  retargetAttrSink(raw, [1]);
  raw.parts[1].location = { id: 'p1', kind: 'anchor', path: [0] };
  const anchorLocation = raw.locations.find((candidate) => candidate.id === 'p1');
  if (anchorLocation) anchorLocation.path = [0];
  assertThrowsIncludes(() => validatePartProgram(raw));
  assertThrowsIncludes(() => serializeServer(raw, whenHost()));
  assertThrowsIncludes(() => serializeSeed(raw, whenHost()));
  assertThrowsIncludes(() =>
    createFresh(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node),
  );
  assertThrowsIncludes(() =>
    claimExisting(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node),
  );
});

/** Inject a nested Region/text anchor `p9` into an existing Region subtree. */
function withNestedAnchor(base: unknown, inject: (raw: RawProgram) => void): RawProgram {
  const raw = base as RawProgram;
  inject(raw);
  raw.parts.push({
    k: 'text',
    index: 9,
    signal: 'label',
    location: { id: 'p9', kind: 'anchor', path: [0] },
  });
  return raw;
}

function regionSubtree(
  raw: RawProgram,
  partIndex: number,
  field: 'on' | 'off' | 'item',
): unknown[] {
  return raw.parts[partIndex][field] as unknown[];
}

test('A10.4: nested Region anchors (when └ each, each └ when, deeper) are rejected fail-closed everywhere', () => {
  const nested = { k: 'part', id: 'p9', index: 9 };
  const cases: Array<[string, RawProgram, string]> = [
    [
      'when └ anchor',
      withNestedAnchor(whenSiblingProgram(), (raw) => regionSubtree(raw, 1, 'on').push(nested)),
      'parts[1].on[1] may not contain a part anchor',
    ],
    [
      'each └ anchor',
      withNestedAnchor(eachSiblingProgram(), (raw) => regionSubtree(raw, 1, 'item').push(nested)),
      'parts[1].item[1] may not contain a part anchor',
    ],
    [
      'when └ element └ anchor (deeper)',
      withNestedAnchor(regionInsideSinkProgram(), (raw) => {
        const branch = regionSubtree(raw, 1, 'on') as Array<{ children: unknown[] }>;
        branch[0].children.push(nested);
      }),
      'parts[1].on[0].children[0] may not contain a part anchor',
    ],
    [
      'each └ element └ anchor (deeper)',
      withNestedAnchor(eachSiblingProgram(), (raw) => {
        const item = regionSubtree(raw, 1, 'item') as Array<{ children: unknown[] }>;
        item[0].children.push(nested);
      }),
      'parts[1].item[0].children[0] may not contain a part anchor',
    ],
  ];
  for (const [name, raw, diagnostic] of cases) {
    const error = assertThrowsIncludes(() => validatePartProgram(raw), Error);
    expect(error.message, name).toContain(diagnostic);
    const host = whenHost();
    assertThrowsIncludes(() => serializeServer(raw, host));
    assertThrowsIncludes(() => serializeSeed(raw, host));
    assertThrowsIncludes(() =>
      createFresh(raw, host, new TestDocument().createElement('host') as unknown as Node),
    );
    assertThrowsIncludes(() =>
      claimExisting(raw, host, new TestDocument().createElement('host') as unknown as Node),
    );
  }
});

test('#1374: mixed number/string each keys keep distinct identity from SSR through claim', () => {
  const program = mixedKeyProgram();
  const items: Array<{ id: number | string; label: string }> = [
    { id: 1, label: 'number' },
    { id: '1', label: 'string' },
  ];
  const browser = mixedKeyHost(items);
  const { html, root, instance } = receiveAndClaim(program, mixedKeyHost(items), browser);
  expect(html).toEqual('<ul><!--oe:p0--><li>number</li><li>string</li><!--oe:/p0--></ul>');

  const list = root.childNodes[0] as TestElement;
  const numberItem = list.childNodes[1] as TestElement;
  const stringItem = list.childNodes[2] as TestElement;
  expect((numberItem.childNodes[0] as TestText).data).toEqual('number');
  expect((stringItem.childNodes[0] as TestText).data).toEqual('string');

  // A reorder moves each node with its own identity: number 1 and string "1"
  // are distinct keys, so the entries swap without collapsing into one.
  browser.signals.items.value = [
    { id: '1', label: 'STRING' },
    { id: 1, label: 'NUMBER' },
  ];
  expect(list.childNodes[1]).toBe(stringItem);
  expect(list.childNodes[2]).toBe(numberItem);
  expect((stringItem.childNodes[0] as TestText).data).toEqual('STRING');
  expect((numberItem.childNodes[0] as TestText).data).toEqual('NUMBER');

  // Removing one identity keeps the other's node; re-adding allocates fresh.
  browser.signals.items.value = [{ id: 1, label: 'only number' }];
  expect(list.childNodes[1]).toBe(numberItem);
  expect(stringItem.parentNode).toBe(null);
  browser.signals.items.value = [
    { id: 1, label: 'only number' },
    { id: '1', label: 'STRING' },
  ];
  const reattached = list.childNodes[2] as TestElement;
  expect(reattached).not.toBe(stringItem);
  expect((reattached.childNodes[0] as TestText).data).toEqual('STRING');
  instance.dispose();
});

test('#1374: a genuine duplicate each key still fails closed on both executors', () => {
  const program = mixedKeyProgram();
  const duplicated = [
    { id: 1, label: 'one' },
    { id: 1, label: 'again' },
  ];

  // Server duplicate detection still rejects same-type collisions.
  const serverError = assertThrowsIncludes(
    () => serializeServer(program, mixedKeyHost(duplicated)),
    Error,
  );
  expect(serverError.message).toContain('duplicate each Region key 1');

  // Claim still fails closed before attaching anything.
  const doc = new TestDocument();
  const root = parseHtml(doc, '<ul><!--oe:p0--><li>one</li><li>again</li><!--oe:/p0--></ul>');
  const claimError = assertThrowsIncludes(
    () => claimExisting(program, mixedKeyHost(duplicated), root as unknown as Node),
    PartProgramClaimError,
  );
  expect(claimError.message).toContain('duplicate key');
});

/** #1372: the widened operator set must hold across SSR/fresh/claim parity. */
test('#1372: equals and truthy conditions hold through SSR/fresh/claim', () => {
  function equalsProgram(): unknown {
    return testProgram({
      tag: 'oe-1372-equals',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
      parts: [
        {
          k: 'when',
          index: 0,
          signal: 'status',
          test: { signal: 'status', op: 'equals', value: 'pending' },
          on: [{ k: 'text', value: 'PENDING' }],
          off: [{ k: 'text', value: 'SETTLED' }],
        },
      ],
    });
  }
  function truthyProgram(): unknown {
    return testProgram({
      tag: 'oe-1372-truthy',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
      parts: [
        {
          k: 'when',
          index: 0,
          signal: 'ready',
          test: { signal: 'ready', op: 'truthy', value: false },
          on: [{ k: 'text', value: 'LOADING' }],
          off: [{ k: 'text', value: 'READY' }],
        },
      ],
    });
  }

  // Strict string equality: on while equal, off after the write flips it.
  const status = new Sig('pending');
  const eq = receiveAndClaim(equalsProgram(), { signals: { status } }, { signals: { status } });
  expect(eq.html).toContain('PENDING');
  status.value = 'done';
  expect(eq.root.innerHTML).toContain('SETTLED');
  eq.instance.dispose();

  // Negated truthiness: Boolean(value) === false while the signal is empty.
  const ready = new Sig('');
  const tr = receiveAndClaim(truthyProgram(), { signals: { ready } }, { signals: { ready } });
  expect(tr.html).toContain('LOADING');
  ready.value = 'loaded';
  expect(tr.root.innerHTML).toContain('READY');
  tr.instance.dispose();
});
