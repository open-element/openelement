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
 * module may read these comments.
 *
 * @module ./markers.ts
 */

/** The private marker spelling. One table, one owner. */
export const MARKERS = {
  rangeOpen: 'oe:r:',
  rangeClose: 'oe:/r:',
  when: 'oe:when',
  each: 'oe:each',
} as const;

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

/**
 * The comment text a mount writes for one static sibling range. `end` selects
 * the closing marker. Generated modules call this instead of building the
 * string themselves.
 */
export function rangeMarkerText(ordinal: number, end = false): string {
  return (end ? MARKERS.rangeClose : MARKERS.rangeOpen) + ordinal;
}

/**
 * Read a comment value back. Returns the ordinal and whether it is the closing
 * marker, or `null` when the value is not a range marker at all (a foreign
 * comment, a block anchor, or a malformed ordinal).
 */
export function parseRangeMarker(value: string | null): { end: boolean; ordinal: number } | null {
  if (value === null) return null;
  for (const end of [false, true]) {
    const prefix = end ? MARKERS.rangeClose : MARKERS.rangeOpen;
    if (!value.startsWith(prefix)) continue;
    const ordinal = canonicalOrdinal(value.slice(prefix.length));
    return ordinal === null ? null : { end, ordinal };
  }
  return null;
}
