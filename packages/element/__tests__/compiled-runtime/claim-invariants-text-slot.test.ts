/**
 * The generated claim checks exactly one expected dynamic-text boundary at the
 * current position. The helper must accept only a canonical Comment pair value
 * and must fail closed with the internal leaf mismatch identity otherwise; it
 * is deliberately not a scanner.
 */

import { describe, expect, test } from 'vitest';
import {
  assertTextSlotMarker,
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
  throw new Error('expected assertTextSlotMarker to throw');
}

describe('assertTextSlotMarker', () => {
  test('accepts the expected start and end', () => {
    expect(() => assertTextSlotMarker(comment('oe:t:0'), 0, false, '/0/0')).not.toThrow();
    expect(() => assertTextSlotMarker(comment('oe:/t:0'), 0, true, '/0/0')).not.toThrow();
    expect(() => assertTextSlotMarker(comment('oe:t:12'), 12, false, '/')).not.toThrow();
  });

  test('rejects a missing node', () => {
    for (const node of [null, undefined]) {
      const error = mismatch(() => assertTextSlotMarker(node, 0, false, '/0/0'));
      expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(error.message).toContain('text boundary start is missing at /0/0');
    }
  });

  test('rejects a non-comment node', () => {
    for (const node of [text('oe:t:0'), element()]) {
      const error = mismatch(() => assertTextSlotMarker(node, 0, false, '/0/0'));
      expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(error.message).toContain('is not a comment');
      expect(error.message).toContain('/0/0');
    }
  });

  test('rejects the wrong ordinal, the wrong end and a foreign comment', () => {
    for (const [node, ordinal, end] of [
      [comment('oe:t:1'), 0, false],
      [comment('oe:/t:0'), 0, false],
      [comment('oe:t:0'), 0, true],
      [comment('oe:/t:1'), 0, true],
      [comment('comment'), 0, false],
      [comment('oe:r:0'), 0, false],
      [comment('oe:when'), 0, false],
      [comment('oe:t:01'), 0, false],
      [comment(null), 0, false],
    ] as const) {
      const error = mismatch(() => assertTextSlotMarker(node, ordinal, end, '/0/1'));
      expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
      expect(error.message).toContain('/0/1');
    }
  });

  test('does not echo the comment text into the error', () => {
    const error = mismatch(() =>
      assertTextSlotMarker(comment('foreign<!--<script>'), 0, false, '/'),
    );
    expect(error.message).not.toContain('foreign');
    expect(error.message).not.toContain('<script>');
  });
});
