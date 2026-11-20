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
 * module may read these comments. There are three ordinal-bearing families
 * with deliberately distinct prefixes — static sibling ranges (`oe:r:` /
 * `oe:/r:`), dynamic text slots (`oe:t:` / `oe:/t:`) and light-root slot
 * anchors (`oe:s:` / `oe:/s:`) — plus the fixed `when`/`each` anchors, their
 * closing markers, and the per-entry list key marker (`oe:k:`).
 * The `when` family has a closing marker (`oe:/when`) so an empty branch is
 * decidable; it deliberately has no branch id. The `each` family has a
 * list-level closing marker (`oe:/each`) and exactly one `oe:k:` marker per
 * entry; there is no per-entry end marker. Neither parser accepts the other
 * family's spelling.
 *
 * The slot-anchor family is the only one whose payload is not just an ordinal:
 * it carries the slot NAME as well, because a light-root producer's `<slot>`
 * elements are a finished string and the serializer that substitutes caller
 * children into them has no second lookup to run. The name rides as UTF-8
 * lowercase hex (`./utf8-hex.ts`, the same alphabet the list-key token uses),
 * so a name containing `-->` cannot terminate the comment early.
 *
 * @module ./markers.ts
 */

import { isCanonicalListKeyToken, LIST_KEY_UNSUPPORTED } from './list-key.ts';
import { decodeUtf8Hex, encodeUtf8Hex } from './utf8-hex.ts';

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

/** The fixed list anchor and its list-level closing marker. */
const EACH_OPEN = 'oe:each';
const EACH_CLOSE = 'oe:/each';

/** The private marker vocabulary. One table, one owner, branded values. */
export const MARKERS = {
  when: makeMarker(WHEN_OPEN),
  whenEnd: makeMarker(WHEN_CLOSE),
  each: makeMarker(EACH_OPEN),
  eachEnd: makeMarker(EACH_CLOSE),
} as const;

const ENTRY_KEY_PREFIX = 'oe:k:';

/**
 * One per-entry list identity marker (`oe:k:<token>`). The token comes from
 * `encodeListKey` and never carries the marker prefix itself. The same token may
 * appear more than once: mount's duplicate-key rule inserts after the first
 * occurrence, and the claim pairs each wire occurrence with a distinct client
 * occurrence. `null` writes the mount-only `u` payload: mount keeps its
 * historical tolerance for unsupported key values, while SSR never emits `u`
 * (and a claimed list never writes it) and claim rejects it.
 */
export function entryKeyMarker(token: string | null): Marker {
  return makeMarker(ENTRY_KEY_PREFIX + (token ?? LIST_KEY_UNSUPPORTED));
}

/**
 * Read an entry-key marker value. Returns `{ token }` for `oe:k:u` and for any
 * canonical `s:`/`n:`/`b:` token; every other comment returns `null`. The
 * claim uses this as a non-throwing lookahead (so the `u` case reaches the
 * precise `readEntryKeyMarker` mismatch) and never parses a token back into a
 * key.
 */
export function parseEntryKeyMarker(value: string | null): { readonly token: string } | null {
  if (value === null || !value.startsWith(ENTRY_KEY_PREFIX)) return null;
  const token = value.slice(ENTRY_KEY_PREFIX.length);
  if (token === LIST_KEY_UNSUPPORTED) return { token };
  return isCanonicalListKeyToken(token) ? { token } : null;
}

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

const SLOT_OPEN = 'oe:s:';
const SLOT_CLOSE = 'oe:/s:';
/**
 * Slot-name payload separator. `oe:s:<ordinal>:<hex>` — the ordinal first
 * because every other ordinal-bearing family leads with it, then the name.
 * The separator cannot collide with a name payload: the payload is hex only.
 */
const SLOT_NAME_SEPARATOR = ':';

/**
 * One light-root slot anchor. The pair surrounds a `<slot>` ELEMENT in a
 * generated light-root producer's bytes so the serializer can substitute the
 * caller's children into exactly that element without pattern-matching markup.
 *
 * Three things make this family distinct from `rangeMarker`, and the
 * distinction is the reason it exists:
 *
 * - a range marker names a SIBLING RANGE inside a claim parent and is consumed
 *   by `claimStaticSiblingRange` for the 0-mutation claim verification; an
 *   anchor names a single `<slot>` region and is consumed by the SSR
 *   serializer, never by a claim;
 * - an anchor carries the slot NAME (UTF-8 hex) because the serializer reading
 *   a finished string has no structure to look the name up in;
 * - the empty name (`''`, the default slot) is a legal payload and encodes to
 *   the empty hex string, so `oe:s:0:` is the default slot's start and
 *   `oe:/s:0:` its end. A name is NOT normalized here: the producer bakes the
 *   name exactly as the element lane's `slotNameOf` reads it.
 */
export function slotAnchorMarker(ordinal: number, name: string, end = false): Marker {
  return makeMarker(
    (end ? SLOT_CLOSE : SLOT_OPEN) + ordinal + SLOT_NAME_SEPARATOR + encodeUtf8Hex(name),
  );
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
 * Read a light-root slot anchor. The value is `oe:s:<ordinal>:<hex>` or
 * `oe:/s:<ordinal>:<hex>`; both the ordinal and the name must be canonical, so
 * a malformed/trailing/foreign comment reads as `null` instead of a guess.
 * The returned name is the decoded UTF-8 string, and `''` is the default slot.
 *
 * A payload whose bytes are not well-formed UTF-8 is also `null`: this parser
 * never substitutes a replacement character, because a repaired name could
 * match a projection the producer never wrote.
 */
export function parseSlotAnchorMarker(
  value: string | null,
): { end: boolean; ordinal: number; name: string } | null {
  if (value === null) return null;
  for (const end of [false, true]) {
    const prefix = end ? SLOT_CLOSE : SLOT_OPEN;
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    const separator = rest.indexOf(SLOT_NAME_SEPARATOR);
    if (separator < 0) return null;
    const ordinal = canonicalOrdinal(rest.slice(0, separator));
    if (ordinal === null) return null;
    const name = decodeUtf8Hex(rest.slice(separator + 1));
    return name === null ? null : { end, ordinal, name };
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

/**
 * Read a fixed list marker. Exact comparison only: `start` for `oe:each` and
 * `end` for `oe:/each`; every other comment is foreign.
 */
export function parseEachMarker(value: string | null): 'start' | 'end' | null {
  if (value === EACH_OPEN) return 'start';
  if (value === EACH_CLOSE) return 'end';
  return null;
}
