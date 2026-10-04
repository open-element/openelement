import { expect, test } from 'vitest';
import { hasControlCharacter } from '../src/internal/control-characters.ts';

test('hasControlCharacter rejects C0 controls and DEL', () => {
  // The full C0 block: U+0000 through U+001F.
  for (let code = 0x00; code <= 0x1f; code++) {
    expect(
      hasControlCharacter(String.fromCodePoint(code)),
      `expected U+${code.toString(16).padStart(4, '0')} to be rejected`,
    ).toBeTruthy();
  }
  expect(hasControlCharacter('a\u007fb'), 'expected DEL (U+007F) to be rejected').toBeTruthy();
  expect(
    hasControlCharacter('\u001f'),
    'expected the highest C0 control to be rejected',
  ).toBeTruthy();
});

test('hasControlCharacter accepts printable ASCII and non-control code points', () => {
  expect(hasControlCharacter(''), 'empty string carries no control character').toBeFalsy();
  expect(hasControlCharacter(' '), 'space (U+0020) is printable').toBeFalsy();
  expect(hasControlCharacter('~'), 'tilde (U+007E) is printable').toBeFalsy();
  expect(
    hasControlCharacter('abcdefghijklmnopqrstuvwxyz0123456789-._:/@'),
    'plain specifier characters are printable',
  ).toBeFalsy();
  expect(
    hasControlCharacter('\u0080'),
    'U+0080 is a C1 control, outside this predicate',
  ).toBeFalsy();
  expect(hasControlCharacter('\u00e9'), 'non-ASCII printable text is accepted').toBeFalsy();
  expect(
    hasControlCharacter('(min-width: 48rem)'),
    'a well-formed island media query is accepted',
  ).toBeFalsy();
});
