import { expect, test } from 'vitest';
import { escapeAttr } from '../src/internal/core/html-escape.ts';
import { escapeText } from '../src/internal/compiled/escape-text.ts';

test('escape parity: canonical contract escapes & < > " and \'', () => {
  expect(escapeAttr(`a&b"c<d>e'f`)).toEqual('a&amp;b&quot;c&lt;d&gt;e&#39;f');
});

test('escape parity: text contract escapes & < > and passes quotes and non-ASCII through', () => {
  expect(escapeText(`a&b"c<d>e'f`)).toEqual('a&amp;b"c&lt;d&gt;e\'f');
  expect(escapeText(`unicode é ‹› „ “`)).toEqual(`unicode é ‹› „ “`);
});
