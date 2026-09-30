import { assert, assertFalse } from '@std/assert';
import { hasControlCharacter } from '../src/internal/control-characters.ts';

Deno.test('hasControlCharacter rejects C0 controls and DEL', () => {
  // The full C0 block: U+0000 through U+001F.
  for (let code = 0x00; code <= 0x1f; code++) {
    assert(
      hasControlCharacter(String.fromCodePoint(code)),
      `expected U+${code.toString(16).padStart(4, '0')} to be rejected`,
    );
  }
  assert(hasControlCharacter('a\u007fb'), 'expected DEL (U+007F) to be rejected');
  assert(hasControlCharacter('\u001f'), 'expected the highest C0 control to be rejected');
});

Deno.test('hasControlCharacter accepts printable ASCII and non-control code points', () => {
  assertFalse(hasControlCharacter(''), 'empty string carries no control character');
  assertFalse(hasControlCharacter(' '), 'space (U+0020) is printable');
  assertFalse(hasControlCharacter('~'), 'tilde (U+007E) is printable');
  assertFalse(
    hasControlCharacter('abcdefghijklmnopqrstuvwxyz0123456789-._:/@'),
    'plain specifier characters are printable',
  );
  assertFalse(hasControlCharacter('\u0080'), 'U+0080 is a C1 control, outside this predicate');
  assertFalse(hasControlCharacter('\u00e9'), 'non-ASCII printable text is accepted');
  assertFalse(
    hasControlCharacter('(min-width: 48rem)'),
    'a well-formed island media query is accepted',
  );
});
