/**
 * M08 list wire vocabulary: the fixed `each` pair, the per-entry `oe:k:` token
 * marker, and the pure server/client seed predicate.
 *
 * The spelling is owned by `markers.ts`; the one-position claim checks and the
 * seed rule are owned by `claim-invariants.ts`. These tests pin the shared
 * alphabet, family exclusion, the mount-only `u` payload, duplicate-token
 * multiplicity, and the S1–S3 order. The checks operate on parsed DOM only: an
 * EOF truncation the parser repairs into the same comment is not
 * distinguishable from a legal node here.
 */

import { describe, expect, test } from 'vitest';
import {
  entryKeyMarker,
  MARKERS,
  markerText,
  parseEachMarker,
  parseEntryKeyMarker,
  parseRangeMarker,
  parseTextSlotMarker,
  parseWhenMarker,
} from '../../src/internal/compiled/runtime/markers.ts';
import {
  assertEachAnchor,
  assertEachEndMarker,
  entrySeedMismatch,
  isEachEndMarker,
  LEAF_CLAIM_MISMATCH,
  readEntryKeyMarker,
} from '../../src/internal/compiled/runtime/claim-invariants.ts';
import {
  encodeListKey,
  LEAF_UNSUPPORTED_KEY,
  tryEncodeListKey,
} from '../../src/internal/compiled/runtime/list-key.ts';

function comment(nodeValue: string | null): Node {
  return { nodeType: 8, nodeValue } as unknown as Node;
}

function text(nodeValue: string): Node {
  return { nodeType: 3, nodeValue } as unknown as Node;
}

function element(): Node {
  return { nodeType: 1, localName: 'li', namespaceURI: 'http://www.w3.org/1999/xhtml' } as Node;
}

function mismatch(run: () => void): { code?: string; message: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error('expected the list assertion to throw');
}

describe('list marker vocabulary', () => {
  test('writes the list-level start/end and one key marker per entry', () => {
    expect(markerText(MARKERS.each)).toBe('oe:each');
    expect(markerText(MARKERS.eachEnd)).toBe('oe:/each');
    expect(markerText(entryKeyMarker('s:61'))).toBe('oe:k:s:61');
    expect(markerText(entryKeyMarker('n:1e+21'))).toBe('oe:k:n:1e+21');
    expect(markerText(entryKeyMarker('b:0'))).toBe('oe:k:b:0');
    // The mount-only unsupported payload; SSR never produces it.
    expect(markerText(entryKeyMarker(null))).toBe('oe:k:u');
  });

  test('parses only fixed list values and the entry-key family', () => {
    expect(parseEachMarker('oe:each')).toBe('start');
    expect(parseEachMarker('oe:/each')).toBe('end');
    for (const value of [
      '',
      'oe:each:',
      'oe:/each:',
      'oe:each:0',
      'oe:eachx',
      'oe:/each ',
      'oe:when',
      'oe:/when',
      'oe:t:0',
      'oe:r:0',
      'oe:k:s:61',
      null,
    ]) {
      expect(parseEachMarker(value), String(value)).toBeNull();
    }
  });

  test('entry-key lookahead accepts canonical tokens and the `u` payload only', () => {
    expect(parseEntryKeyMarker('oe:k:s:61')).toEqual({ token: 's:61' });
    expect(parseEntryKeyMarker('oe:k:s:')).toEqual({ token: 's:' });
    expect(parseEntryKeyMarker('oe:k:n:0')).toEqual({ token: 'n:0' });
    expect(parseEntryKeyMarker('oe:k:b:1')).toEqual({ token: 'b:1' });
    expect(parseEntryKeyMarker('oe:k:u')).toEqual({ token: 'u' });
    for (const value of [
      '',
      'oe:k:',
      'oe:k:S:61',
      'oe:k:s:6',
      'oe:k:n:1e+999',
      'oe:k:n:-0',
      'oe:k:b:2',
      'oe:k:x:0',
      'oe:each',
      'oe:/each',
      'comment',
      null,
    ]) {
      expect(parseEntryKeyMarker(value), String(value)).toBeNull();
    }
  });

  test('the marker families do not parse each other', () => {
    expect(parseRangeMarker('oe:each')).toBeNull();
    expect(parseTextSlotMarker('oe:/each')).toBeNull();
    expect(parseWhenMarker('oe:each')).toBeNull();
    expect(parseEachMarker('oe:k:s:61')).toBeNull();
    expect(parseRangeMarker('oe:k:s:61')).toBeNull();
    expect(parseTextSlotMarker('oe:k:s:61')).toBeNull();
  });
});

describe('list claim one-position checks', () => {
  test('detects only the exact list end comment', () => {
    expect(isEachEndMarker(comment('oe:/each'))).toBe(true);
    for (const node of [
      comment('oe:each'),
      comment('oe:/each:'),
      comment('oe:k:s:61'),
      text('oe:/each'),
      element(),
      null,
      undefined,
    ]) {
      expect(isEachEndMarker(node), String(node)).toBe(false);
    }
  });

  test('accepts the expected anchor/end and rejects a missing one', () => {
    expect(() => assertEachAnchor(comment('oe:each'), '/0')).not.toThrow();
    expect(() => assertEachEndMarker(comment('oe:/each'), '/0')).not.toThrow();
    for (const node of [null, undefined]) {
      expect(mismatch(() => assertEachAnchor(node, '/0')).code).toBe(LEAF_CLAIM_MISMATCH);
      expect(mismatch(() => assertEachAnchor(node, '/0')).message).toContain(
        'list anchor is missing at /0',
      );
      expect(mismatch(() => assertEachEndMarker(node, '/0')).code).toBe(LEAF_CLAIM_MISMATCH);
      expect(mismatch(() => assertEachEndMarker(node, '/0')).message).toContain(
        'list end is missing at /0',
      );
    }
  });

  test('rejects a non-comment anchor/end and a foreign comment value', () => {
    for (const node of [text('oe:each'), element()]) {
      expect(mismatch(() => assertEachAnchor(node, '/0')).message).toContain('is not a comment');
    }
    expect(() => assertEachAnchor(comment('oe:/each'), '/0')).toThrow(LEAF_CLAIM_MISMATCH);
    expect(() => assertEachEndMarker(comment('oe:each'), '/0')).toThrow(LEAF_CLAIM_MISMATCH);
  });

  test('reads a canonical entry token and rejects the mount-only `u` / malformed marker', () => {
    expect(readEntryKeyMarker(comment('oe:k:s:61'), '/0/entry')).toBe('s:61');
    expect(readEntryKeyMarker(comment('oe:k:n:0'), '/0/entry')).toBe('n:0');
    expect(readEntryKeyMarker(comment('oe:k:b:1'), '/0/entry')).toBe('b:1');
    const unsupported = mismatch(() => readEntryKeyMarker(comment('oe:k:u'), '/0/entry'));
    expect(unsupported.code).toBe(LEAF_CLAIM_MISMATCH);
    expect(unsupported.message).toContain('unsupported entry key kind at /0/entry');
    for (const node of [
      comment('oe:k:'),
      comment('oe:k:s:6'),
      comment('oe:each'),
      text('oe:k:s:61'),
      element(),
      null,
    ]) {
      expect(mismatch(() => readEntryKeyMarker(node, '/0/entry')).code).toBe(LEAF_CLAIM_MISMATCH);
    }
  });

  test('the unsupported key is one internal coded identity', () => {
    expect(LEAF_UNSUPPORTED_KEY).toBe('OEIR_LEAF_UNSUPPORTED_KEY');
    try {
      encodeListKey({ id: 'a' });
      throw new Error('expected unsupported');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(LEAF_UNSUPPORTED_KEY);
    }
    expect(tryEncodeListKey({ id: 'a' })).toBeNull();
    expect(tryEncodeListKey('a')).toBe('s:61');
  });
});

describe('entry seed predicate S1–S3', () => {
  test('equal token multiplicities pass regardless of order', () => {
    expect(entrySeedMismatch(['s:61', 's:63'], ['s:63', 's:61'])).toBeNull();
    expect(entrySeedMismatch([], [])).toBeNull();
    expect(entrySeedMismatch([], ['s:61'])).toBeNull();
    expect(entrySeedMismatch(['n:0', 'b:1'], ['b:1', 'n:0'])).toBeNull();
    // Duplicate keys keep mount's rule: the wire may repeat a token exactly as
    // often as the client list.
    expect(entrySeedMismatch(['s:61', 's:61'], ['s:61', 's:61'])).toBeNull();
    expect(entrySeedMismatch(['s:61', 's:61'], ['s:61', 's:61', 's:61'])).toBeNull();
    // Cross-key reorder keeps each token's occurrence order, not its position.
    expect(entrySeedMismatch(['s:61', 's:61', 's:63'], ['s:63', 's:61', 's:61'])).toBeNull();
  });

  test('S1 unsupported client key runs before the wire checks', () => {
    expect(entrySeedMismatch(['s:61'], [null])).toBe(
      'client entry key is not a supported primitive',
    );
    expect(entrySeedMismatch(['u'], [null])).toBe('client entry key is not a supported primitive');
  });

  test('S2 wire multiplicity above the client count fails closed', () => {
    expect(entrySeedMismatch(['s:61', 's:61'], ['s:61'])).toBe(
      'server entry key s:61 occurs 2 times, client has 1',
    );
    expect(entrySeedMismatch(['u', 'u'], ['u'])).toBe(
      'server entry key u occurs 2 times, client has 1',
    );
  });

  test('S3 wire-more fails closed; client-more is the insert path', () => {
    expect(entrySeedMismatch(['s:61', 's:63'], ['s:61'])).toBe(
      'server entry key has no client item',
    );
    expect(entrySeedMismatch(['s:61'], ['s:61', 's:63'])).toBeNull();
  });

  test('duplicate client tokens are legal (mount used-set semantics)', () => {
    expect(entrySeedMismatch(['s:61'], ['s:61', 's:61'])).toBeNull();
  });
});
