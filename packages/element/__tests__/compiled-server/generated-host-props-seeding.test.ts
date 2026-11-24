/**
 * M11-2 — canonical SSR host-attribute projection from the generated host
 * seed (Node unit; the real page vertical is the router/fixture e2e).
 *
 * The generated host producer seeds content props once, then projects the SAME
 * seeded record into the canonical host attribute pairs the client claim
 * re-reads. Conversion is the shared `convertToAttribute` over the descriptor
 * row's declared type/default — never a field-name guess — so explicit
 * `attribute: 'data-x'` renames, number coercion and boolean presence have one
 * source of truth with the class lane.
 *
 * Also pins the getter-read accounting the producer relies on: a supplied
 * attribute-backed value is read exactly ONCE during the seed projection (the
 * leaf's own reads are extra reads of the same getter), while a supplied
 * non-attribute row stays lazy (zero reads during the seed).
 *
 * 2026-11-23 — ADR-0181 A5 amendment: the SAME one JSON seed now also carries a
 * supplied PROPERTY-ONLY PRIMITIVE row (`attribute: null`). Before this rule the
 * claim re-read the declared default and silently wiped the server content a
 * page root had rendered. The claim half therefore has to run the real connect
 * path here, so this file uses the facade DOM harness (the same pattern the
 * hardening suite uses) instead of a DOM-free import.
 */

import { describe, expect, test } from 'vitest';
import { installFacadeDom, mountSerialized } from '../compiled-runtime/facade-dom.ts';

// The harness must own the platform globals BEFORE the shell module evaluates:
// the generated class captures `HTMLElement` at module scope, so a static import
// would bind the SSR stub. Dynamic imports below follow the repo's pattern.
const dom = installFacadeDom();

const { createGeneratedElementClass, seedGeneratedElementHostProperties } =
  await import('../../src/internal/compiled/generated-element/shell.ts');
const { createRecipe } = await import('../../src/internal/compiled/runtime/recipe.ts');
const { renderToString } = await import('../../src/public-runtime.ts');

const KEY = '__oeHostAttributes';
const SEED = 'data-oe-prop-seed';

interface Row {
  readonly name: string;
  readonly attribute?: string | null;
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'trustedHtml';
  readonly reflect?: boolean;
  readonly default?: string | number | boolean | (() => unknown);
}

function seed(
  rows: readonly Row[],
  props: Record<string, unknown>,
  attrs?: ReadonlyArray<readonly [string, string]>,
) {
  const seeded = seedGeneratedElementHostProperties(rows as never, props, attrs as never) as Record<
    string,
    unknown
  > & { [KEY]?: ReadonlyArray<readonly [string, string]> };
  return seeded;
}

let counter = 0;
const uniqueTag = (label: string): string => `oe-prop-seed-${label}-${++counter}`;

/**
 * Register one generated LIGHT host whose claim is the runtime's own recipe
 * projection (the shape the emitted `create<Name>Recipe` produces), so the
 * claim half of the round trip runs the REAL `connectedCallback` path.
 */
function registerLeaf(
  tag: string,
  rows: readonly Row[],
  producer?: (props: unknown) => string,
): void {
  const ctor = createGeneratedElementClass({
    tag,
    root: 'light',
    properties: rows as never,
    ssrProducer: producer ?? (() => '<span id="content">seeded</span>'),
    createRecipe: (owner: unknown) =>
      createRecipe({
        definitionOwner: owner as never,
        mount: () => [],
        claim: (_scope: unknown, _props: unknown, parent: Node) => [...parent.childNodes],
        createProps: () => ({}),
      }) as never,
  }) as unknown as CustomElementConstructor;
  dom.registry.define(tag, ctor);
}

/** Create a host, give it the producer's wire, and let the claim run. */
function connect(tag: string, attrs: ReadonlyArray<readonly [string, string]>) {
  const element = dom.document.createElement(tag) as HTMLElement & Record<string, unknown>;
  for (const [name, value] of attrs) element.setAttribute(name, value);
  dom.document.body.appendChild(element);
  return element;
}

describe('generated host seed → canonical host attributes', () => {
  test('explicit attribute rename, number coercion and boolean presence are canonical', () => {
    const seeded = seed(
      [
        { name: 'title', attribute: 'data-title', type: 'string', default: '' },
        { name: 'count', attribute: 'data-count', type: 'number', default: 0 },
        { name: 'enabled', attribute: 'data-enabled', type: 'boolean', default: false },
      ],
      { title: 'Hello', count: 2, enabled: true },
    );
    expect(seeded[KEY]).toEqual([
      ['data-title', 'Hello'],
      ['data-count', '2'],
      // convertToAttribute(boolean,true) is the canonical presence pair.
      ['data-enabled', ''],
    ]);
    // Content seed keeps the same facts for the leaf.
    expect(seeded.title).toBe('Hello');
    expect(seeded.count).toBe(2);
    expect(seeded.enabled).toBe(true);
  });

  test('declared defaults stay off the wire; a supplied attribute:false row rides the ONE seed', () => {
    const seeded = seed(
      [
        { name: 'title', attribute: 'data-title', type: 'string', default: 'seed' },
        { name: 'note', attribute: null, type: 'string', default: 'content only' },
        { name: 'flag', attribute: 'data-flag', type: 'boolean', default: false },
      ],
      { title: 'seed', note: 'kept', flag: false },
    );
    // title equals its default; boolean false serializes to null; both
    // suppressed. `note` has no PER-ROW attribute — its ONE wire is the JSON
    // seed (ADR-0181 A5 amendment, 2026-11-23).
    expect(seeded[KEY]).toEqual([[SEED, '{"note":"kept"}']]);
  });

  test('a supplied prop wins over the caller attribute wire on the host tag too', () => {
    const seeded = seed(
      [
        { name: 'title', attribute: 'data-title', type: 'string', default: '' },
        { name: 'count', attribute: 'data-count', type: 'number', default: 0 },
      ],
      { title: 'prop wins', count: 5 },
      [
        ['data-title', 'caller value'],
        ['data-count', '1'],
        ['aria-label', 'authored extra'],
      ],
    );
    // Declared rows are replaced in place with the content-seed value (same
    // precedence as the content record); the undeclared authored attribute is
    // preserved after them.
    expect(seeded[KEY]).toEqual([
      ['data-title', 'prop wins'],
      ['data-count', '5'],
      ['aria-label', 'authored extra'],
    ]);
  });

  test('a boolean false against a presence-true default fails closed (no claim channel)', () => {
    expect(() =>
      seed([{ name: 'flag', attribute: 'flag', type: 'boolean', default: true }], { flag: false }),
    ).toThrow(/OEIR_LEAF_UNSEEDABLE_PROPERTY: flag is a boolean/);
    // The default-equal false is not a divergence and stays allowed.
    const seeded = seed([{ name: 'flag', attribute: 'flag', type: 'boolean', default: false }], {
      flag: false,
    });
    expect(seeded[KEY]).toBeUndefined();
  });

  test('a bare boolean attribute reads true in the seeded record (M11-2 wire rule)', () => {
    // JSX `<host flag>` lowers to `flag: ""`, and attribute presence means true.
    // The class-lane server coercion spells that rule once
    // (`public-runtime.ts` `coerceServerProp`); this fold is its generated-lane
    // counterpart. Without it the row resolved to `false` against a
    // presence-true wire and the projection threw OEIR_LEAF_UNSEEDABLE_PROPERTY —
    // measured while porting `open-reading-shell`, whose caller writes
    // `<open-reading-shell meta rail footer …>`.
    const seeded = seed([{ name: 'flag', attribute: 'flag', type: 'boolean', default: false }], {
      flag: '',
    });
    expect(seeded.flag).toBe(true);
    expect(seeded[KEY]).toEqual([['flag', '']]);
    // The other encodings keep their meaning.
    expect(
      seed([{ name: 'flag', attribute: 'flag', type: 'boolean', default: false }], { flag: true })
        .flag,
    ).toBe(true);
    expect(
      seed([{ name: 'flag', attribute: 'flag', type: 'boolean', default: false }], { flag: false })[
        KEY
      ],
    ).toBeUndefined();
  });

  /**
   * ADR-0181 A5 amendment (2026-11-23) — property-only primitives (`attribute:
   * null`) join the ONE JSON prop seed.
   *
   * The recorded boundary was: a page root's `attribute: false` primitive row
   * had no attribute pair, so the claim re-read the declared default and
   * SILENTLY WIPED the SSR content. These rows replace that boundary with the
   * new contract: the supplied value travels on `data-oe-prop-seed` (never a
   * per-row attribute), the claim restores it before setup, an omitted row
   * keeps its default, and the fail-closed / never-execute-an-accessor rules of
   * the D-18c wire are preserved.
   */
  describe('property-only primitives on the ONE JSON seed (A5 amendment)', () => {
    const propertyOnly = (): Row[] => [
      { name: 'inner', attribute: null, type: 'string', default: 'prop-only' },
      { name: 'count', attribute: null, type: 'number', default: 0 },
      { name: 'flag', attribute: null, type: 'boolean', default: false },
    ];

    test('round trip: producer wire → claim restores the supplied values', () => {
      const rows = propertyOnly();
      const seeded = seed(rows, { inner: 'route-inner', count: 2, flag: true });
      const pairs = seeded[KEY]!;
      // NOT one attribute per row: the emitted mode stays ONE host attribute.
      expect(pairs.map(([name]) => name)).toEqual([SEED]);
      const seedWire = pairs[0]![1]!;
      expect(JSON.parse(seedWire)).toEqual({ inner: 'route-inner', count: 2, flag: true });

      const tag = uniqueTag('round-trip');
      registerLeaf(tag, rows);
      const element = connect(tag, pairs);
      // The claim body reads the RESOLVED props: the supplied values, not the
      // declared defaults the old boundary left behind.
      expect(element.inner).toBe('route-inner');
      expect(element.count).toBe(2);
      expect(element.flag).toBe(true);
      // The seed is consumed once: a re-claim cannot replay stale bytes.
      expect(element.getAttribute(SEED)).toBeNull();
    });

    test('end to end: the light-root SSR producer writes the seed its claim restores', () => {
      // The page-root PATH, not a hand-built wire: `renderToString` runs the
      // shell's light producer + serializer (the emitted `__ssr` class static),
      // then the parsed markup is upgraded the way a browser does. Before the
      // A5 amendment the claim re-read `prop-only` here, wiping what the server
      // had rendered.
      const rows = propertyOnly();
      const tag = uniqueTag('ssr');
      registerLeaf(
        tag,
        rows,
        (props) => `<span id="content">${String((props as Record<string, unknown>).inner)}</span>`,
      );
      const html = renderToString(tag, {
        props: { inner: 'route-inner', count: 2, flag: true },
      });
      // ONE host attribute, never one per row.
      expect(html.match(new RegExp(SEED, 'g'))?.length).toBe(1);
      expect(html).toContain('<span id="content">route-inner</span>');

      const element = mountSerialized(dom, html) as unknown as HTMLElement &
        Record<string, unknown>;
      // The claim body reads the SAME value the SSR bytes rendered.
      expect(element.inner).toBe('route-inner');
      expect(element.count).toBe(2);
      expect(element.flag).toBe(true);
      expect(element.getAttribute(SEED)).toBeNull();
      // The adopted content still holds what the server wrote — the claim
      // neither re-rendered nor wiped it.
      interface FacadeNodeLike {
        readonly localName?: string;
        readonly childNodes: readonly FacadeNodeLike[];
        readonly data?: string;
      }
      const span = (element as unknown as FacadeNodeLike).childNodes[0]!;
      expect(span.localName).toBe('span');
      expect(span.childNodes[0]!.data).toBe('route-inner');
    });

    test('an attribute-backed primitive keeps its attribute pair and never enters the seed', () => {
      const rows: Row[] = [
        { name: 'title', attribute: 'data-title', type: 'string', default: '' },
        { name: 'inner', attribute: null, type: 'string', default: 'prop-only' },
      ];
      const seeded = seed(rows, { title: 'Hello', inner: 'route-inner' });
      // One wire per row: the attribute-backed row keeps its canonical pair and
      // the property-only row is ONLY in the JSON seed (no `inner=` pair).
      expect(seeded[KEY]).toEqual([
        ['data-title', 'Hello'],
        [SEED, '{"inner":"route-inner"}'],
      ]);

      const tag = uniqueTag('mixed');
      registerLeaf(tag, rows);
      const element = connect(tag, seeded[KEY]!);
      expect(element.title).toBe('Hello');
      expect(element.inner).toBe('route-inner');
    });

    test('an omitted row emits no seed (and the claim keeps the declared default)', () => {
      const rows = propertyOnly();
      const seeded = seed(rows, {});
      expect(seeded[KEY]).toBeUndefined();
      // The content record carries the declared primitive defaults.
      expect(seeded.inner).toBe('prop-only');
      expect(seeded.count).toBe(0);
      expect(seeded.flag).toBe(false);

      const tag = uniqueTag('omitted');
      registerLeaf(tag, rows);
      const element = connect(tag, []);
      expect(element.inner).toBe('prop-only');
      expect(element.count).toBe(0);
      expect(element.flag).toBe(false);
      expect(element.getAttribute(SEED)).toBeNull();
    });

    test('a supplied value equal to the declared default still seeds (D-18c rule)', () => {
      // The NON-PRIMITIVE family has never compared against the default: the
      // payload mirrors the caller's supplied set exactly, and the claim writes
      // the same value it would otherwise re-read. A default comparison here
      // would be a second rule the claim cannot check (and `__oePropSeedRows`
      // names what the payload actually carries).
      const rows = propertyOnly();
      const seeded = seed(rows, { inner: 'prop-only', count: 0, flag: false });
      expect(seeded[KEY]).toEqual([[SEED, '{"inner":"prop-only","count":0,"flag":false}']]);
    });

    test('a supplied accessor is never executed and gets no seed (still-unseeded case)', () => {
      let reads = 0;
      const props = {
        get inner() {
          reads += 1;
          return 'route-inner';
        },
      };
      const seeded = seed([propertyOnly()[0]!], props);
      // The seeder never runs the getter (the D-18c accessor rule) ...
      expect(reads).toBe(0);
      expect(seeded[KEY]).toBeUndefined();
      // ... while the content record still reads it lazily, per read.
      expect(seeded.inner).toBe('route-inner');
      expect(reads).toBe(1);
    });

    test('a value the JSON wire cannot carry fails closed', () => {
      // A function has no JSON representation (`JSON.stringify` returns
      // undefined), so the wire would silently lose the row.
      expect(() => seed([propertyOnly()[0]!], { inner: (() => 'x') as never })).toThrow(
        /OEIR_LEAF_UNSEEDABLE_PROPERTY: inner .*serializes to undefined under JSON/,
      );
      // A bigint makes `JSON.stringify` throw; the producer refuses it too.
      expect(() => seed([propertyOnly()[1]!], { count: 1n as never })).toThrow(
        /OEIR_LEAF_UNSEEDABLE_PROPERTY: count .*not JSON-encodable/,
      );
    });

    test('a bare boolean lowers to `""` and seeds the presence fact `true`', () => {
      // JSX `<host flag>` lowers to `flag: ""`; the content fold reads `true`
      // (attribute presence), so the wire must carry `true` or the claim's
      // `Boolean('')` would restore `false` against `true` content.
      const seeded = seed([propertyOnly()[2]!], { flag: '' });
      expect(seeded.flag).toBe(true);
      expect(seeded[KEY]).toEqual([[SEED, '{"flag":true}']]);
    });
  });

  test('getter accounting: one projection read for attribute rows, lazy elsewhere', () => {
    let titleReads = 0;
    let noteReads = 0;
    const props = {
      get title() {
        titleReads += 1;
        return 'T';
      },
      get note() {
        noteReads += 1;
        return 'N';
      },
    };
    const seeded = seed(
      [
        { name: 'title', attribute: 'data-title', type: 'string', default: '' },
        { name: 'note', attribute: null, type: 'string', default: '' },
      ],
      props,
    );
    // Attribute-backed supplied value is read once by the canonical projection.
    expect(titleReads).toBe(1);
    // Non-attribute row stays lazy: the seed itself reads it zero times.
    expect(noteReads).toBe(0);
    expect(seeded.note).toBe('N');
    expect(noteReads).toBe(1);
    // The content record still reads the supplied getter per leaf read.
    expect(seeded.title).toBe('T');
    expect(titleReads).toBe(2);
  });
});
