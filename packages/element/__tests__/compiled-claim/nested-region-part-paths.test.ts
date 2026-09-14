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

import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import { validatePartProgram } from '../../src/internal/protocol/part-program.ts';
import {
  claimExistingDom,
  createFreshDom,
  PartProgramClaimError,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { parseHtml, TestDocument, TestElement } from '../compiled-runtime/test-dom.ts';

/** Structural signal matching the runtime's SignalLike contract. */
class Sig<T> {
  #value: T;
  readonly #listeners = new Set<(value: T) => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T {
    return this.#value;
  }

  set value(next: T) {
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

interface WhenHost {
  signals: { title: Sig<string>; count: Sig<number> };
}

interface EachHost {
  signals: { title: Sig<string>; items: Sig<Array<{ id: string; label: string }>> };
}

function whenHost(): WhenHost {
  return { signals: { title: new Sig('DYN'), count: new Sig(5) } };
}

function eachHost(): EachHost {
  return {
    signals: {
      title: new Sig('DYN'),
      items: new Sig([{ id: 'a', label: 'alpha' }, { id: 'b', label: 'beta' }]),
    },
  };
}

/** The executor entry points viewed through their wire-level shape. */
const serializeServer = serializeProgramContent as unknown as (
  program: unknown,
  host: unknown,
) => string;
const serializeSeed = serializeToHtml as unknown as (program: unknown, host: unknown) => string;
const createFresh = createFreshDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };
const claimExisting = claimExistingDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };

interface RawProgram {
  template: unknown[];
  parts: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
}

/**
 * `element(dynamic attr)` immediately followed by `when └ element` — the
 * valid shape closest to the audit suspicion: the branch element's
 * Region-relative position collides with the sibling sink's canonical path
 * [0] if the claim/serialize recursion ever resets the path.
 */
function whenSiblingProgram(): unknown {
  return testProgram({
    tag: 'oe-a104-when-sibling',
    template: [
      { k: 'el', tag: 'div', attrs: [], children: [] },
      { k: 'part', index: 1 },
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

/**
 * `element(dynamic attr)` followed by `each └ element(item attr)` — the only
 * dynamic-attribute form valid INSIDE a Region: per-item attribute slots.
 */
function eachSiblingProgram(): unknown {
  return testProgram({
    tag: 'oe-a104-each-sibling',
    template: [
      { k: 'el', tag: 'div', attrs: [], children: [] },
      { k: 'part', index: 1 },
    ],
    parts: [
      { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
      {
        k: 'each',
        index: 1,
        signal: 'items',
        key: 'id',
        item: [{
          k: 'el',
          tag: 'li',
          attrs: [['title', 'item-static']],
          iattrs: [['data-label', 'label']],
          children: [],
        }],
      },
    ],
  });
}

/** `element(dynamic attr) └ when └ element` — a Region nested inside the
 * sink element's own subtree (deeper valid Region combination). */
function regionInsideSinkProgram(): unknown {
  return testProgram({
    tag: 'oe-a104-region-in-sink',
    template: [{
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [{ k: 'part', index: 1 }],
    }],
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
  assertEquals(serializeSeed(program, serverHost), html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  const freshInstance = createFresh(program, serverHost, freshRoot as unknown as Node);
  assertEquals(freshRoot.innerHTML, html);
  freshInstance.dispose();

  // Browser receives the DOM: parse the serialized payload into fresh nodes.
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const before = { ...doc.counts };
  const instance = claimExisting(program, browserHost, root as unknown as Node);
  // A successful claim allocates and replaces nothing: exact node identity.
  assertEquals({ ...doc.counts }, before);
  return { html, doc, root, instance };
}

Deno.test('A10.4: when Region branch never inherits the sibling sink path (serialize → claim → exact-sink update)', () => {
  const program = whenSiblingProgram();
  const browser = whenHost();
  const { html, root, instance } = receiveAndClaim(program, whenHost(), browser);
  assertEquals(
    html,
    '<div title="DYN"></div><!--oe:p1--><span title="static-on"></span><!--oe:/p1-->',
  );

  // Exact Part/Region identity after claim.
  const div = root.childNodes[0] as TestElement;
  const anchor = root.childNodes[1];
  const span = root.childNodes[2] as TestElement;
  const end = root.childNodes[3];
  assertEquals(div.getAttribute('title'), 'DYN');
  assertEquals(span.getAttribute('title'), 'static-on');

  // A subsequent update mutates the exact sink node — no replacement, and
  // the Region-internal static attribute is not touched by the sink.
  browser.signals.title.value = 'DYN2';
  assertStrictEquals(root.childNodes[0], div);
  assertEquals(div.getAttribute('title'), 'DYN2');
  assertStrictEquals(root.childNodes[2], span);
  assertEquals(span.getAttribute('title'), 'static-on');

  // The Region still owns its range: a branch swap replaces only the branch
  // content; the anchors and the sibling sink keep their node identity.
  browser.signals.count.value = 0;
  assertStrictEquals(root.childNodes[1], anchor);
  assertStrictEquals(root.childNodes[3], end);
  const offSpan = root.childNodes[2] as TestElement;
  assertNotStrictEquals(offSpan, span);
  assertEquals(offSpan.getAttribute('title'), 'static-off');
  assertStrictEquals(root.childNodes[0], div);
  assertEquals(div.getAttribute('title'), 'DYN2');
  instance.dispose();
});

Deno.test('A10.4: claim fails closed on static drift inside a when Region branch', () => {
  const program = whenSiblingProgram();
  const html = serializeServer(program, whenHost());
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const span = root.childNodes[2] as TestElement;
  span.setAttribute('title', 'tampered');
  // The branch element holds no dynamic sink: a rewritten static attribute is
  // real drift and must not hide behind a reset path colliding with the
  // sibling sink at canonical path [0].
  const error = assertThrows(
    () => claimExisting(program, whenHost(), root as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(error.message, 'template[1].branch[0]');
  assertStringIncludes(error.message, 'attribute drift on "title"');
});

Deno.test('A10.4: each Region item attribute slots round-trip with exact keyed-sink updates', () => {
  const program = eachSiblingProgram();
  const browser = eachHost();
  const { html, root, instance } = receiveAndClaim(program, eachHost(), browser);
  assertEquals(
    html,
    '<div title="DYN"></div><!--oe:p1-->' +
      '<li title="item-static" data-label="alpha"></li>' +
      '<li title="item-static" data-label="beta"></li>' +
      '<!--oe:/p1-->',
  );

  const div = root.childNodes[0] as TestElement;
  const liA = root.childNodes[2] as TestElement;
  const liB = root.childNodes[3] as TestElement;
  assertEquals(liA.getAttribute('data-label'), 'alpha');
  assertEquals(liB.getAttribute('data-label'), 'beta');

  // An item-field update mutates the exact keyed item element in place.
  browser.signals.items.value = [{ id: 'a', label: 'alpha2' }, { id: 'b', label: 'beta' }];
  assertStrictEquals(root.childNodes[2], liA);
  assertEquals(liA.getAttribute('data-label'), 'alpha2');
  assertEquals(liA.getAttribute('title'), 'item-static');
  assertStrictEquals(root.childNodes[3], liB);
  assertEquals(liB.getAttribute('data-label'), 'beta');

  // The sibling fixed sink keeps its canonical identity through the update.
  browser.signals.title.value = 'DYN2';
  assertStrictEquals(root.childNodes[0], div);
  assertEquals(div.getAttribute('title'), 'DYN2');
  instance.dispose();
});

Deno.test('A10.4: claim fails closed on static and per-item drift inside an each Region', () => {
  const program = eachSiblingProgram();

  // Static item attribute rewritten in transit.
  const staticDoc = new TestDocument();
  const staticRoot = parseHtml(staticDoc, serializeServer(program, eachHost()));
  (staticRoot.childNodes[2] as TestElement).setAttribute('title', 'tampered');
  const staticError = assertThrows(
    () => claimExisting(program, eachHost(), staticRoot as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(staticError.message, 'template[1].item[0][0]');
  assertStringIncludes(staticError.message, 'attribute drift on "title"');

  // Per-item attribute slot rewritten in transit.
  const itemDoc = new TestDocument();
  const itemRoot = parseHtml(itemDoc, serializeServer(program, eachHost()));
  (itemRoot.childNodes[2] as TestElement).setAttribute('data-label', 'tampered');
  const itemError = assertThrows(
    () => claimExisting(program, eachHost(), itemRoot as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(itemError.message, 'item attribute drift on "data-label"');
});

Deno.test('A10.4: a Region nested inside the sink element keeps canonical paths (deeper combination)', () => {
  const program = regionInsideSinkProgram();
  const browser = whenHost();
  const { html, root, instance } = receiveAndClaim(program, whenHost(), browser);
  assertEquals(
    html,
    '<div title="DYN"><!--oe:p1--><span title="static-on"></span><!--oe:/p1--></div>',
  );

  const div = root.childNodes[0] as TestElement;
  const span = div.childNodes[1] as TestElement;
  browser.signals.title.value = 'DYN2';
  assertStrictEquals(root.childNodes[0], div);
  assertEquals(div.getAttribute('title'), 'DYN2');
  assertEquals(span.getAttribute('title'), 'static-on');
  instance.dispose();

  // Static drift one level deeper still fails closed.
  const tamperedDoc = new TestDocument();
  const tamperedRoot = parseHtml(tamperedDoc, html);
  const tamperedDiv = tamperedRoot.childNodes[0] as TestElement;
  (tamperedDiv.childNodes[1] as TestElement).setAttribute('title', 'tampered');
  const error = assertThrows(
    () => claimExisting(program, whenHost(), tamperedRoot as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(error.message, 'attribute drift on "title"');
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

Deno.test('A10.4: a fixed Part path crossing a when/each anchor is rejected fail-closed everywhere', () => {
  for (const base of [whenSiblingProgram(), eachSiblingProgram()]) {
    const raw = base as RawProgram;
    retargetAttrSink(raw, [1, 0]);
    const error = assertThrows(() => validatePartProgram(raw), Error);
    assertStringIncludes(error.message, 'parts[0].path [1,0] is unresolved');
    // Every executor entry point validates the identical wire program and
    // fails closed: no serializer or mount path can execute the drift shape.
    assertThrows(() => serializeServer(raw, whenHost()));
    assertThrows(() => serializeSeed(raw, whenHost()));
    assertThrows(() =>
      createFresh(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node)
    );
    assertThrows(() =>
      claimExisting(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node)
    );
  }
});

Deno.test('A10.4: a fixed Part path preceded by a Region anchor is rejected fail-closed everywhere', () => {
  // The builder round-trips through the real validator, so the rejected spec
  // fails at build time with the validator diagnostic.
  const error = assertThrows(() =>
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
    }), Error);
  assertStringIncludes(error.message, 'parts[1].path is preceded by a dynamic anchor');

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
  assertThrows(() => validatePartProgram(raw));
  assertThrows(() => serializeServer(raw, whenHost()));
  assertThrows(() => serializeSeed(raw, whenHost()));
  assertThrows(() =>
    createFresh(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node)
  );
  assertThrows(() =>
    claimExisting(raw, whenHost(), new TestDocument().createElement('host') as unknown as Node)
  );
});

/** Inject a nested Region/text anchor `p9` into an existing Region subtree. */
function withNestedAnchor(
  base: unknown,
  inject: (raw: RawProgram) => void,
): RawProgram {
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

Deno.test('A10.4: nested Region anchors (when └ each, each └ when, deeper) are rejected fail-closed everywhere', () => {
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
    const error = assertThrows(() => validatePartProgram(raw), Error);
    assertStringIncludes(error.message, diagnostic, name);
    const host = whenHost();
    assertThrows(() => serializeServer(raw, host));
    assertThrows(() => serializeSeed(raw, host));
    assertThrows(() =>
      createFresh(raw, host, new TestDocument().createElement('host') as unknown as Node)
    );
    assertThrows(() =>
      claimExisting(raw, host, new TestDocument().createElement('host') as unknown as Node)
    );
  }
});
