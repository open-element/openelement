/**
 * The dynamic-text marker vocabulary is owned by `markers.ts`. These tests pin
 * the private spelling, canonical ordinals and the mutual exclusion with the
 * static-range vocabulary: a `oe:t`/`oe:/t` pair can never be parsed as a
 * directory range marker, and a directory marker can never be parsed as a text
 * boundary.
 */

import { describe, expect, test } from 'vitest';
import {
  markerText,
  parseRangeMarker,
  parseTextSlotMarker,
  textSlotMarker,
} from '../../src/internal/compiled/runtime/markers.ts';

describe('text slot marker vocabulary', () => {
  test('writes the canonical pair spelling', () => {
    expect(markerText(textSlotMarker(0))).toBe('oe:t:0');
    expect(markerText(textSlotMarker(0, true))).toBe('oe:/t:0');
    expect(markerText(textSlotMarker(17))).toBe('oe:t:17');
    expect(markerText(textSlotMarker(17, true))).toBe('oe:/t:17');
    expect(markerText(textSlotMarker(Number.MAX_SAFE_INTEGER))).toBe(
      `oe:t:${Number.MAX_SAFE_INTEGER}`,
    );
  });

  test('round-trips start and end with canonical ordinals', () => {
    expect(parseTextSlotMarker('oe:t:0')).toEqual({ end: false, ordinal: 0 });
    expect(parseTextSlotMarker('oe:/t:0')).toEqual({ end: true, ordinal: 0 });
    expect(parseTextSlotMarker('oe:t:42')).toEqual({ end: false, ordinal: 42 });
    expect(parseTextSlotMarker(`oe:/t:${Number.MAX_SAFE_INTEGER}`)).toEqual({
      end: true,
      ordinal: Number.MAX_SAFE_INTEGER,
    });
  });

  test.each([
    '',
    'oe:t:',
    'oe:/t:',
    'oe:t:00',
    'oe:t:01',
    'oe:t:-1',
    'oe:t:+1',
    'oe:t:1.0',
    'oe:t:1e2',
    'oe:t:1a',
    'oe:t: 1',
    'oe:t:1 ',
    'oe:t:9007199254740992',
    'oe:t:999999999999999999999999999999',
    'oe:r:0',
    'oe:/r:0',
    'oe:when',
    'oe:each',
    't:0',
    '/t:0',
  ])('rejects a non-text-slot value: %j', (value) => {
    expect(parseTextSlotMarker(value)).toBeNull();
  });

  test('the two vocabularies do not parse each other', () => {
    expect(parseRangeMarker('oe:t:0')).toBeNull();
    expect(parseRangeMarker('oe:/t:0')).toBeNull();
    expect(parseTextSlotMarker('oe:r:0')).toBeNull();
    expect(parseTextSlotMarker('oe:/r:0')).toBeNull();
    expect(parseRangeMarker('oe:r:0')).toEqual({ end: false, ordinal: 0 });
    expect(parseRangeMarker('oe:/r:0')).toEqual({ end: true, ordinal: 0 });
  });

  test('a null comment value is not a boundary', () => {
    expect(parseTextSlotMarker(null)).toBeNull();
  });
});
