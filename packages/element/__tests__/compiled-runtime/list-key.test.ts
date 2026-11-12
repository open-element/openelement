/**
 * Pins the list wire key codec: primitive keys -> canonical tokens, the
 * canonical-shape predicate, the internal coded refusal of every unsupported
 * key, and agreement with the mount's raw `entry.key === key` identity.
 *
 * The encoder is the only key -> token surface: no JSON, no object fallback and
 * no marker/comment writing. The predicate checks canonical spelling: its `n:`
 * branch round-trips the payload through `Number`/`String` (the encoder's own
 * rule), while its `s:` branch checks the hex alphabet without decoding or
 * UTF-8 validation.
 */

import { describe, expect, test } from 'vitest';
import { OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
import {
  encodeListKey,
  isCanonicalListKeyToken,
  LEAF_UNSUPPORTED_KEY,
} from '../../src/internal/compiled/runtime/list-key.ts';

const UTF8 = new TextEncoder();
const HEX = '0123456789abcdef';

function hex(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += HEX[byte >> 4] + HEX[byte & 15];
  return text;
}

function unsupported(value: unknown): OpenElementError {
  try {
    encodeListKey(value);
  } catch (error) {
    expect(error).toBeInstanceOf(OpenElementError);
    return error as OpenElementError;
  }
  throw new Error('expected encodeListKey to reject the value');
}

/** Deterministic PRNG (mulberry32), so the property corpus is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

describe('encodeListKey — string tokens', () => {
  test('uses UTF-8 lowercase hex, not UTF-16 code units', () => {
    expect(encodeListKey('')).toBe('s:');
    expect(encodeListKey('a')).toBe('s:61');
    expect(encodeListKey('A')).toBe('s:41');
    expect(encodeListKey('\u0000')).toBe('s:00');
    expect(encodeListKey('\u00e9')).toBe('s:c3a9');
    expect(encodeListKey('\u{1f600}')).toBe('s:f09f9880');
    expect(encodeListKey('e\u0301')).toBe('s:65cc81');
    expect(encodeListKey('\ufffd')).toBe('s:efbfbd');
  });

  test('matches TextEncoder byte-for-byte and never normalises', () => {
    for (const value of [
      '',
      'a',
      '--',
      '-->',
      '<script>',
      '&;',
      '"',
      "'",
      'é',
      'e\u0301',
      '😀',
      '\u0000\n',
    ]) {
      expect(encodeListKey(value)).toBe(`s:${hex(UTF8.encode(value))}`);
    }
    expect(encodeListKey('\u00e9')).not.toBe(encodeListKey('e\u0301'));
  });

  test('keeps injection characters inside the hex alphabet', () => {
    for (const value of [
      '--',
      '-->',
      '<',
      '>',
      '&',
      ';',
      '</script>',
      '<!--',
      '\u0000',
      '\n',
      'é😀',
    ]) {
      const token = encodeListKey(value);
      expect(token).toMatch(/^s:[0-9a-f]*$/);
      expect(token).not.toContain('--');
      for (const unsafe of ['<', '>', '&', ';', ' ', '\n', '"', "'"]) {
        expect(token).not.toContain(unsafe);
      }
    }
  });

  test('rejects lone surrogates instead of folding them to U+FFFD', () => {
    for (const value of ['\ud800', '\udc00', '\ud83d', '\ude00', 'a\ud800b', '\ud800\ud800']) {
      expect(unsupported(value).code).toBe(LEAF_UNSUPPORTED_KEY);
    }
    expect(encodeListKey('\ud83d\ude00')).toBe('s:f09f9880');
  });
});

describe('encodeListKey — number tokens', () => {
  test('uses String(value) with -0 normalised to 0', () => {
    expect(encodeListKey(0)).toBe('n:0');
    expect(encodeListKey(-0)).toBe('n:0');
    expect(encodeListKey(42)).toBe('n:42');
    expect(encodeListKey(-42)).toBe('n:-42');
    expect(encodeListKey(1.5)).toBe('n:1.5');
    expect(encodeListKey(-1e-7)).toBe('n:-1e-7');
    expect(encodeListKey(1e21)).toBe('n:1e+21');
    expect(encodeListKey(1e-7)).toBe('n:1e-7');
    expect(encodeListKey(1e-6)).toBe('n:0.000001');
    expect(encodeListKey(Number.MAX_VALUE)).toBe('n:1.7976931348623157e+308');
    expect(encodeListKey(Number.MIN_VALUE)).toBe('n:5e-324');
    expect(encodeListKey(1e-320)).toBe('n:1e-320');
    expect(encodeListKey(Number.MAX_SAFE_INTEGER)).toBe('n:9007199254740991');
  });

  test('rejects every non-finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(unsupported(value).code).toBe(LEAF_UNSUPPORTED_KEY);
    }
  });

  test('keeps the number and boolean alphabets free of comment delimiters', () => {
    for (const value of [-1e-7, 1e21, 1.5e-7, Number.MAX_VALUE]) {
      const token = encodeListKey(value);
      expect(token).toMatch(/^n:[0-9.e+-]+$/);
      expect(token).not.toContain('--');
      expect(token).not.toContain('>');
      expect(token).not.toContain('&');
    }
    expect(encodeListKey(true)).toMatch(/^b:[01]$/);
    expect(encodeListKey(false)).toMatch(/^b:[01]$/);
  });

  test('accepts the encoder output of a random finite double corpus', () => {
    const random = mulberry32(0x0e1e6e75);
    const view = new DataView(new ArrayBuffer(8));
    let checked = 0;
    for (let attempt = 0; attempt < 2000 && checked < 512; attempt += 1) {
      view.setUint32(0, random());
      view.setUint32(4, random());
      const value = view.getFloat64(0);
      if (!Number.isFinite(value)) continue;
      checked += 1;

      const token = encodeListKey(value);
      expect(isCanonicalListKeyToken(token)).toBe(true);
      const payload = token.slice(2);
      expect(String(Number(payload))).toBe(payload);
      expect(encodeListKey(Number(payload))).toBe(token);
    }
    expect(checked).toBe(512);
  });
});

describe('encodeListKey — boolean tokens', () => {
  test('uses the closed 0/1 payload', () => {
    expect(encodeListKey(true)).toBe('b:1');
    expect(encodeListKey(false)).toBe('b:0');
  });
});

describe('encodeListKey — unsupported keys', () => {
  test('throws the internal coded framework error', () => {
    const values: unknown[] = [
      null,
      undefined,
      1n,
      Symbol('key'),
      {},
      [],
      () => {},
      new Date(),
      new Map(),
    ];
    for (const value of values) {
      const error = unsupported(value);
      expect(error).toBeInstanceOf(OpenElementError);
      expect(error.name).toBe('OpenElementError');
      expect(error.code).toBe(LEAF_UNSUPPORTED_KEY);
      expect(error.phase).toBe('render');
      expect(error.severity).toBe('error');
      expect(error.recoverable).toBe(false);
      expect(error.message).toContain('list key must be');
    }
  });

  test('does not stringify, serialise or coerce an object key', () => {
    let calls = 0;
    const key = {
      toString: () => {
        calls += 1;
        return '{"id":"a"}';
      },
      toJSON: () => {
        calls += 1;
        return { id: 'a' };
      },
      valueOf: () => {
        calls += 1;
        return 'a';
      },
      [Symbol.toPrimitive]: () => {
        calls += 1;
        return 'a';
      },
    };
    const error = unsupported(key);
    expect(calls).toBe(0);
    expect(error.message).not.toContain('id');
    expect(error.message).not.toContain('{');
  });

  test('the internal identity is not a public runtime code', () => {
    expect(LEAF_UNSUPPORTED_KEY.startsWith('OEIR_')).toBe(true);
    expect(Object.values(RuntimeErrorCode)).not.toContain(LEAF_UNSUPPORTED_KEY);
  });
});

describe('isCanonicalListKeyToken — canonical spellings', () => {
  test('accepts every token the encoder produces', () => {
    const values: unknown[] = [
      '',
      'a',
      'é',
      'e\u0301',
      '😀',
      '\ufffd',
      0,
      -0,
      42,
      -1.5,
      1e21,
      1e-7,
      1e-6,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      1e-320,
      -Number.MAX_VALUE,
      true,
      false,
    ];
    for (const value of values) {
      expect(isCanonicalListKeyToken(encodeListKey(value))).toBe(true);
    }
  });

  test.each([
    's:',
    's:61',
    's:c3a9',
    's:f09f9880',
    'n:0',
    'n:42',
    'n:-1.5',
    'n:0.000001',
    'n:1e-7',
    'n:1e+21',
    'n:1.5e+21',
    'n:5e-324',
    'n:1e-320',
    'n:1.7976931348623157e+308',
    'n:-0.5',
    'b:0',
    'b:1',
  ])('accepts %j', (token) => {
    expect(isCanonicalListKeyToken(token)).toBe(true);
  });

  test('rejects anything that is not a token string', () => {
    for (const token of [null, undefined, 61, true, {}, ['s:61']]) {
      expect(isCanonicalListKeyToken(token)).toBe(false);
    }
  });

  test('rejects every non-canonical spelling', () => {
    const tokens = [
      '',
      's',
      'n',
      'b',
      'u',
      'u:',
      'S:61',
      's:AB',
      's:aB',
      's:a',
      's:zz',
      's:0x61',
      's: 61',
      's:61 ',
      's:61\n',
      's:61\n\n',
      'oe:k:s:61',
      '<!--oe:k:s:61-->',
      'n:',
      'n:-0',
      'n:+1',
      'n:01',
      'n:00',
      'n:1.0',
      'n:1.',
      'n:.5',
      'n:0.0',
      'n:1e2',
      'n:1e+20',
      'n:1e-6',
      'n:1.5e+3',
      'n:1E+21',
      'n:1e+021',
      'n:1e-07',
      'n:Infinity',
      'n:NaN',
      'n:-Infinity',
      'n:0.0000001',
      'n: 1',
      'n:1 ',
      'n:1\n',
      'n:1\n\n',
      'b:',
      'b:2',
      'b:01',
      'b:true',
      'b:-0',
      'b: 1',
      'b:1 ',
    ];
    for (const token of tokens) expect(isCanonicalListKeyToken(token)).toBe(false);
  });

  test('rejects finite-looking number payloads that no finite double spells', () => {
    for (const payload of [
      '1e+999',
      '-1e+999',
      '1e-999',
      '9007199254740993.5',
      '1.234567890123456789',
      '1.7976931348623159e+308',
    ]) {
      expect(isCanonicalListKeyToken(`n:${payload}`)).toBe(false);
    }
  });

  test('rejects a trailing line terminator for every kind', () => {
    const max = String(Number.MAX_VALUE);
    const min = String(Number.MIN_VALUE);
    for (const token of [
      's:61\n',
      'n:0\n',
      'n:-0\n',
      'n:1e+21\n',
      'n:1e-7\n',
      `n:${max}\n`,
      `n:${min}\n`,
      'b:1\n',
    ]) {
      expect(isCanonicalListKeyToken(token)).toBe(false);
    }
  });

  test('checks the s: payload as hex shape, not as valid UTF-8', () => {
    // 0x80 and ED B0 80 are not valid UTF-8, but both are canonical hex shape.
    expect(isCanonicalListKeyToken('s:80')).toBe(true);
    expect(isCanonicalListKeyToken('s:edb080')).toBe(true);
  });
});

describe('mount key identity is raw ===', () => {
  // generate.ts emitList: `entry.key === key` over the previous entries.
  function mountReuses(previous: readonly unknown[], key: unknown): boolean {
    return previous.some((entryKey) => entryKey === key);
  }

  test('-0 and 0 are the same mount key and the same token', () => {
    const negativeZero = -0;
    const zero = 0;
    expect(mountReuses([negativeZero], zero)).toBe(true);
    expect(encodeListKey(negativeZero)).toBe(encodeListKey(zero));
    expect(encodeListKey(negativeZero)).toBe('n:0');
  });

  test('primitive kinds that === separates stay separate tokens', () => {
    const distinct = (left: unknown, right: unknown): void => {
      expect(left === right).toBe(false);
      expect(encodeListKey(left)).not.toBe(encodeListKey(right));
    };
    distinct(1, '1');
    distinct(0, false);
    distinct(1, true);
    distinct('0', 0);
    distinct('true', true);
  });

  test('different code point sequences stay different', () => {
    const composed: string = '\u00e9';
    const decomposed: string = 'e\u0301';
    expect(composed === decomposed).toBe(false);
    expect(encodeListKey(composed)).not.toBe(encodeListKey(decomposed));

    const astral = '\u{1f600}';
    const pair = '\ud83d\ude00';
    expect(astral === pair).toBe(true);
    expect(encodeListKey(astral)).toBe(encodeListKey(pair));
  });

  test('a value with no === identity has no token', () => {
    const left = Number.NaN;
    const right = Number.NaN;
    expect(left === right).toBe(false);
    expect(unsupported(left).code).toBe(LEAF_UNSUPPORTED_KEY);
  });

  test('a stable primitive reuses its entry and its token', () => {
    expect(mountReuses(['a', 1, true], 'a')).toBe(true);
    expect(encodeListKey('a')).toBe(encodeListKey('a'));
  });
});

describe('token surface', () => {
  test('returns a token, never marker text or a comment', () => {
    for (const value of ['a', 1, true]) {
      const token = encodeListKey(value);
      expect(token.startsWith('oe:k:')).toBe(false);
      expect(token).not.toContain('<!--');
      expect(token).not.toContain('-->');
    }
  });
});
