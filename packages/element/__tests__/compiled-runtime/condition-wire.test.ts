/**
 * The fixed condition markers are owned by `markers.ts`; the one-position
 * checks are owned by `claim-invariants.ts`. The wire is the existing `oe:when`
 * anchor plus `oe:/when`, with no branch id. These tests pin the spelling,
 * mutual exclusion from the other marker families, and the fail-closed
 * identity of the claim checks.
 */

import { describe, expect, test } from 'vitest';
import {
  MARKERS,
  markerText,
  parseRangeMarker,
  parseTextSlotMarker,
  parseWhenMarker,
} from '../../src/internal/compiled/runtime/markers.ts';
import {
  assertWhenAnchor,
  assertWhenEndMarker,
  isWhenEndMarker,
  LEAF_CLAIM_MISMATCH,
} from '../../src/internal/compiled/runtime/claim-invariants.ts';

function comment(nodeValue: string | null): Node {
  return { nodeType: 8, nodeValue } as unknown as Node;
}

function text(nodeValue: string): Node {
  return { nodeType: 3, nodeValue } as unknown as Node;
}

function element(): Node {
  return { nodeType: 1, localName: 'p', namespaceURI: 'http://www.w3.org/1999/xhtml' } as Node;
}

function mismatch(run: () => void): { code?: string; message: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error('expected the condition assert to throw');
}

describe('condition marker vocabulary', () => {
  test('writes the fixed start and end marker text', () => {
    expect(markerText(MARKERS.when)).toBe('oe:when');
    expect(markerText(MARKERS.whenEnd)).toBe('oe:/when');
    expect(markerText(MARKERS.each)).toBe('oe:each');
  });

  test('round-trips the exact fixed values only', () => {
    expect(parseWhenMarker('oe:when')).toBe('start');
    expect(parseWhenMarker('oe:/when')).toBe('end');
    for (const value of [
      '',
      'oe:when:',
      'oe:/when:',
      'oe:when:0',
      'oe:/when:0',
      'oe:whenx',
      'oe:when ',
      ' oe:when',
      'oe:when//',
      'oe:t:0',
      'oe:/t:0',
      'oe:r:0',
      'oe:/r:0',
      'oe:each',
      'comment',
      null,
    ]) {
      expect(parseWhenMarker(value), String(value)).toBeNull();
    }
  });

  test('the marker families do not parse each other', () => {
    expect(parseRangeMarker('oe:when')).toBeNull();
    expect(parseRangeMarker('oe:/when')).toBeNull();
    expect(parseTextSlotMarker('oe:when')).toBeNull();
    expect(parseTextSlotMarker('oe:/when')).toBeNull();
    expect(parseWhenMarker('oe:r:0')).toBeNull();
    expect(parseWhenMarker('oe:t:0')).toBeNull();
  });
});

describe('condition claim one-position checks', () => {
  test('detects only the exact end comment', () => {
    expect(isWhenEndMarker(comment('oe:/when'))).toBe(true);
    for (const node of [
      comment('oe:when'),
      comment('oe:/when:'),
      comment('oe:t:0'),
      text('oe:/when'),
      element(),
      null,
      undefined,
    ]) {
      expect(isWhenEndMarker(node), String(node)).toBe(false);
    }
  });

  test('accepts the expected anchor and end', () => {
    expect(() => assertWhenAnchor(comment('oe:when'), '/0')).not.toThrow();
    expect(() => assertWhenEndMarker(comment('oe:/when'), '/0')).not.toThrow();
  });

  test('rejects a missing anchor/end with the leaf mismatch identity', () => {
    for (const node of [null, undefined]) {
      const anchorError = mismatch(() => assertWhenAnchor(node, '/0'));
      expect(anchorError.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(anchorError.message).toContain('condition anchor is missing at /0');
      const endError = mismatch(() => assertWhenEndMarker(node, '/0'));
      expect(endError.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(endError.message).toContain('condition end is missing at /0');
    }
  });

  test('rejects non-comment nodes', () => {
    for (const node of [text('oe:when'), element()]) {
      const error = mismatch(() => assertWhenAnchor(node, '/0'));
      expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(error.message).toContain('is not a comment');
    }
  });

  test('rejects the swapped marker, a foreign comment and a null value', () => {
    for (const [node, anchor] of [
      [comment('oe:/when'), true],
      [comment('oe:when'), false],
      [comment('oe:whenx'), true],
      [comment('oe:t:0'), true],
      [comment('comment'), false],
      [comment(null), false],
    ] as const) {
      const error = mismatch(() =>
        anchor ? assertWhenAnchor(node, '/0/1') : assertWhenEndMarker(node, '/0/1'),
      );
      expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(error.message).toContain('/0/1');
      expect(error.message).not.toContain('oe:t:0');
    }
  });
});
