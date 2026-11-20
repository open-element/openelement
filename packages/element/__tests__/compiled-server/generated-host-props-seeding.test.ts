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
 */

import { describe, expect, test } from 'vitest';
import { seedGeneratedElementHostProperties } from '../../src/internal/compiled/generated-element/shell.ts';

const KEY = '__oeHostAttributes';

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

  test('declared defaults and attribute:false rows never emit host attributes', () => {
    const seeded = seed(
      [
        { name: 'title', attribute: 'data-title', type: 'string', default: 'seed' },
        { name: 'note', attribute: null, type: 'string', default: 'content only' },
        { name: 'flag', attribute: 'data-flag', type: 'boolean', default: false },
      ],
      { title: 'seed', note: 'kept', flag: false },
    );
    // title equals its default; boolean false serializes to null; both suppressed.
    expect(seeded[KEY]).toBeUndefined();
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

  test('property-only primitives stay a recorded boundary (no attribute pair)', () => {
    // ADR-0181 A5 does not claim attribute:false seed parity; the supplied
    // value stays content-only and the claim re-reads the declared default.
    const seeded = seed(
      [{ name: 'inner', attribute: null, type: 'string', default: 'prop-only' }],
      { inner: 'route-inner' },
    );
    expect(seeded.inner).toBe('route-inner');
    expect(seeded[KEY]).toBeUndefined();
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
