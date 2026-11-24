import { expect, test } from 'vitest';
import { selectOptionValue } from '../../src/internal/compiled/runtime/values.ts';

test('implicit option values trim and collapse HTML ASCII whitespace only', () => {
  expect(selectOptionValue('\t\n\f\r  green \t\n\f\r blue\r\n')).toBe('green blue');
  expect(selectOptionValue('\t\n\f\r ')).toBe('');
  expect(selectOptionValue('\u00a0green\u00a0')).toBe('\u00a0green\u00a0');
  expect(selectOptionValue('green\u000bblue')).toBe('green\u000bblue');
});

test('implicit option value normalization handles large strings', () => {
  const firstRun = 'a'.repeat(100_000);
  const secondRun = 'b'.repeat(100_000);

  expect(selectOptionValue(`${firstRun}\t\n${secondRun}`)).toBe(`${firstRun} ${secondRun}`);
});
