import { expect, test } from 'vitest';
import { assertSafeUrlAttribute } from '../../src/internal/compiled/leaf-runtime.ts';
import { __h } from '../../src/server.ts';

/** Schemes the shared protocol predicate refuses, with its escape forms. */
const HOSTILE_URLS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'jav&#x0A;ascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
];

/** Values the same predicate admits (relative, fragment, http, mailto). */
const SAFE_URLS = [
  '/docs/intro',
  '#main',
  'https://example.test/x?a=1',
  'mailto:team@example.test',
];

const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction'];

test('generated leaf and server function sinks refuse unsafe URLs with the same code', () => {
  for (const name of URL_ATTRIBUTES) {
    for (const url of HOSTILE_URLS) {
      const expected = expect.objectContaining({ code: 'OE_UNSAFE_URL_SINK' });
      expect(() => assertSafeUrlAttribute(name, url), name).toThrow(expected);
      expect(() => __h('div', { [name]: url }), name).toThrow(expected);
    }
  }
});

test('relative, fragment, HTTPS and mailto URLs remain admissible', () => {
  for (const name of URL_ATTRIBUTES) {
    for (const url of SAFE_URLS) {
      expect(() => assertSafeUrlAttribute(name, url), name).not.toThrow();
      expect(__h('div', { [name]: url })).toContain(`${name}="${url}"`);
    }
  }
});
