/**
 * The public streamed-frame policy export: the deny lists and attribute
 * predicate the router's build manifest scan, the deferred executor
 * admission, and the generated browser installer all consume. These tests
 * pin the public surface's behavior directly (entity obfuscation forms, the
 * greedy-hex parser-faithful non-match, and the scheme-anchored boundary).
 */
import { assertEquals } from '@std/assert';
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute,
} from '../src/index.ts';

Deno.test('streamed-frame policy: attribute predicate screens names and URL values', () => {
  const corpus: Array<[string, string, boolean]> = [
    // Names fail outright regardless of value.
    ['onclick', 'alert(1)', true],
    ['ONCLICK', 'x', true],
    ['onPointerDown', 'x', true],
    ['data-oe-frame', 'spoof', true],
    ['data-oe-seed', 'spoof', true],
    ['srcdoc', '<b>', true],
    ['SRCDOC', '<b>', true],
    // URL attributes with script schemes fail.
    ['href', 'javascript:alert(1)', true],
    ['href', 'java\tscript:alert(1)', true],
    ['src', 'data:text/html,<b>', true],
    ['formaction', 'javascript:x', true],
    ['xlink:href', 'data:x', true],
    ['action', 'vbscript:x', true],
    // Benign values pass.
    ['href', '/safe/path', false],
    ['src', 'https://example.test/x.png', false],
    ['title', 'anything', false],
    // Entity obfuscation: the compiler keeps static attribute strings
    // verbatim (no entity decoding into the AST), so the predicate decodes
    // the standard entity set before the URL check.
    ['href', 'javascript&#58;alert(1)', true],
    ['href', 'javascript&#x3a;alert(1)', true],
    ['href', 'javascript&#x3A;alert(1)', true],
    ['href', 'javascript&#X3A;alert(1)', true],
    ['href', 'javascript&#58alert(1)', true],
    ['href', 'javascript&#X3A(1)', true],
    ['href', 'javascript&colon;alert(1)', true],
    ['href', 'java&Tab;script:alert(1)', true],
    ['href', 'java&#9;script:alert(1)', true],
    // Parser-faithful non-match: &NewLine; here replaces the colon itself,
    // so the decoded, control-stripped value carries no scheme delimiter.
    ['href', 'javascript&NewLine;alert(1)', false],
    // Parser-faithful non-matches: a hex digit run greedily eats a following
    // 'a' ('&#X3Aalert' decodes to U+03AA + 'lert', not to ':' + 'lert'),
    // and named references without a semicolon are not decoded at all.
    ['href', 'javascript&#X3Aalert(1)', false],
    ['href', 'javascript&colonalert(1)', false],
    // Decoded ampersands must not turn benign values into matches.
    ['href', '/path&#63;x=1', false],
    ['href', '/redirect?to=javascript&#58;void', false],
    // Entities outside URL attributes stay out of scope.
    ['title', 'javascript&#58;alert(1)', false],
  ];
  for (const [name, value, expected] of corpus) {
    assertEquals(
      unsafeStreamFrameAttribute(name, value),
      expected,
      `frame-attribute predicate mismatch for ${name}=${value}`,
    );
  }
});

Deno.test('streamed-frame policy: exported deny lists match the documented contract', () => {
  assertEquals([...STREAM_FRAME_FORBIDDEN_TAGS], [
    'script',
    'style',
    'template',
    'iframe',
    'object',
    'embed',
    'base',
    'meta',
    'link',
  ]);
  assertEquals([...STREAM_FRAME_URL_ATTRIBUTES], [
    'href',
    'src',
    'action',
    'formaction',
    'xlink:href',
  ]);
  assertEquals(STREAM_FRAME_URL_CONTROL_MAX, 32);
  assertEquals(STREAM_FRAME_UNSAFE_URL.source, '^(javascript|vbscript|data):');
  assertEquals(STREAM_FRAME_UNSAFE_URL.flags, 'i');
});
