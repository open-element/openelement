/**
 * markers.ts — the single owner of the compiled-authoring marker vocabulary.
 *
 * The compiler emits marker comments and the directory consumer reads them
 * back. Both sides call the functions in this module and neither restates the
 * spelling: the contract lives in one module instead of being a string
 * convention that two systems have to keep in sync.
 *
 * The vocabulary is private to the compiled-authoring chain. It is not a
 * public ABI, no product entry depends on it, and nothing outside a generated
 * module may read these comments. There are two ordinal-bearing families with
 * deliberately distinct prefixes — static sibling ranges (`oe:r:` / `oe:/r:`)
 * and dynamic text slots (`oe:t:` / `oe:/t:`) — plus the fixed `when`/`each`
 * anchors. The `when` family has a closing marker (`oe:/when`) so an empty
 * branch is decidable; it deliberately has no branch id. Neither parser accepts
 * the other family's spelling.
 *
 * @module ./markers.ts
 */

/**
 * A marker is a branded value, not a string. A generated module can only
 * obtain one from this module (`MARKERS.*`, `rangeMarker(n)` or
 * `textSlotMarker(n)`), and the only way to turn one into a DOM comment is
 * `emitComment(marker)` below. A future
 * generator change that tried `emitComment("oe:something")` would fail the
 * emitted-module type check rather than quietly inventing a second spelling —
 * the constraint is the type system, not a linter, a registry or a test.
 */
const MARKER_BRAND: unique symbol = Symbol('openelement.marker');

export interface Marker {
  readonly [MARKER_BRAND]: true;
  /** The comment text. Read it with `markerText`, never by string building. */
  readonly text: string;
}

function makeMarker(text: string): Marker {
  return { [MARKER_BRAND]: true, text };
}

/** The fixed condition anchor and its closing marker (no ordinal, no branch id). */
const WHEN_OPEN = 'oe:when';
const WHEN_CLOSE = 'oe:/when';

/** The private marker vocabulary. One table, one owner, branded values. */
export const MARKERS = {
  when: makeMarker(WHEN_OPEN),
  whenEnd: makeMarker(WHEN_CLOSE),
  each: makeMarker('oe:each'),
} as const;

const RANGE_OPEN = 'oe:r:';
const RANGE_CLOSE = 'oe:/r:';
/**
 * Dynamic-text slot boundary. A start/end pair surrounds an optional Text
 * node; the pair is the slot identity and the value is not encoded in it.
 *
 * The spelling is private to this module. `parseRangeMarker` and
 * `parseTextSlotMarker` deliberately do not recognize each other's prefixes:
 * a text boundary can never be accepted as a static range marker or vice
 * versa.
 */
const TEXT_OPEN = 'oe:t:';
const TEXT_CLOSE = 'oe:/t:';

/**
 * Longest canonical decimal that still fits `Number.MAX_SAFE_INTEGER`.
 * Computed once so the parser and the writer cannot disagree on the bound.
 */
const MAX_ORDINAL_DIGITS = String(Number.MAX_SAFE_INTEGER).length;

/**
 * Canonical decimal, no sign, no leading zero, no truncation. `parseInt` is
 * intentionally not used: it accepts `01` and stops early on `1e2` / `1.0`.
 * A digit string that would exceed `Number.MAX_SAFE_INTEGER` is rejected
 * instead of being rounded.
 */
export function canonicalOrdinal(digits: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(digits)) return null;
  if (digits.length > MAX_ORDINAL_DIGITS) return null;
  let value = 0;
  for (const char of digits) {
    const digit = char.charCodeAt(0) - 48;
    if (value > (Number.MAX_SAFE_INTEGER - digit) / 10) return null;
    value = value * 10 + digit;
  }
  return value;
}

/** One static sibling range marker. `end` selects the closing marker. */
export function rangeMarker(ordinal: number, end = false): Marker {
  return makeMarker((end ? RANGE_CLOSE : RANGE_OPEN) + ordinal);
}

/**
 * One dynamic-text slot boundary. `end` selects the closing marker. The pair is
 * value-independent: an empty slot is two adjacent comments, and a lazily
 * created Text node never changes the marker text.
 */
export function textSlotMarker(ordinal: number, end = false): Marker {
  return makeMarker((end ? TEXT_CLOSE : TEXT_OPEN) + ordinal);
}

/** Read a marker's text. The only sanctioned way to get the string out. */
export function markerText(marker: Marker): string {
  return marker.text;
}

/**
 * Write a marker comment. This is the only DOM entry for the vocabulary, so a
 * generated module cannot create an unregistered comment through this path.
 */
export function emitComment(marker: Marker): Comment {
  return document.createComment(marker.text);
}

/**
 * Read a comment value back. Returns the ordinal and whether it is the closing
 * marker, or `null` when the value is not a range marker at all (a foreign
 * comment, a block anchor, or a malformed ordinal).
 */
export function parseRangeMarker(value: string | null): { end: boolean; ordinal: number } | null {
  if (value === null) return null;
  for (const end of [false, true]) {
    const prefix = end ? RANGE_CLOSE : RANGE_OPEN;
    if (!value.startsWith(prefix)) continue;
    const ordinal = canonicalOrdinal(value.slice(prefix.length));
    return ordinal === null ? null : { end, ordinal };
  }
  return null;
}

/**
 * Read a dynamic-text boundary comment. Returns `null` for anything that is not
 * exactly a canonical start/end pair value: a foreign comment, a range marker,
 * a malformed ordinal or trailing data. The claim uses this for a single
 * expected position; it never scans for markers.
 */
export function parseTextSlotMarker(
  value: string | null,
): { end: boolean; ordinal: number } | null {
  if (value === null) return null;
  for (const end of [false, true]) {
    const prefix = end ? TEXT_CLOSE : TEXT_OPEN;
    if (!value.startsWith(prefix)) continue;
    const ordinal = canonicalOrdinal(value.slice(prefix.length));
    return ordinal === null ? null : { end, ordinal };
  }
  return null;
}

/**
 * Read a fixed condition marker. Returns `start` for the existing `oe:when`
 * anchor and `end` for the added `oe:/when` marker; every other comment is
 * foreign. The comparison is exact: there is no prefix scan, ordinal or branch
 * id, so a future marker family cannot be mistaken for this one.
 */
export function parseWhenMarker(value: string | null): 'start' | 'end' | null {
  if (value === WHEN_OPEN) return 'start';
  if (value === WHEN_CLOSE) return 'end';
  return null;
}
