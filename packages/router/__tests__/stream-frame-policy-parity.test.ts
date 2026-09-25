/**
 * The router build-side stream-frame policy (build manifest scan + browser
 * bootstrap injection) must stay in exact parity with the element protocol
 * policy the deferred executor admits against. The element package cannot
 * depend on the router, so the router pins its copy to the element canonical
 * module here: any drift fails loud instead of producing frames the server
 * emits and the browser silently discards.
 */
import { assertEquals } from '@std/assert';
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute,
} from '../src/vite/internal/ssg/stream-frame-policy.ts';
import {
  STREAM_FRAME_FORBIDDEN_TAGS as ELEMENT_TAGS,
  STREAM_FRAME_UNSAFE_URL as ELEMENT_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES as ELEMENT_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX as ELEMENT_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute as elementUnsafeStreamFrameAttribute,
} from '../../element/src/internal/protocol/stream-frame-policy.ts';

Deno.test('router stream-frame policy stays in exact parity with the element protocol policy', () => {
  assertEquals(
    [...STREAM_FRAME_FORBIDDEN_TAGS],
    [...ELEMENT_TAGS],
    'forbidden frame tag lists diverged between router and element',
  );
  assertEquals(
    [...STREAM_FRAME_URL_ATTRIBUTES],
    [...ELEMENT_URL_ATTRIBUTES],
    'frame URL attribute lists diverged between router and element',
  );
  assertEquals(STREAM_FRAME_URL_CONTROL_MAX, ELEMENT_URL_CONTROL_MAX);
  assertEquals(STREAM_FRAME_UNSAFE_URL.source, ELEMENT_UNSAFE_URL.source);

  const corpus: Array<[string, string]> = [
    ['href', 'javascript:alert(1)'],
    ['href', 'java\tscript:alert(1)'],
    ['href', '/safe/path'],
    ['src', 'data:text/html,<b>'],
    ['src', 'https://example.test/x.png'],
    ['onclick', 'alert(1)'],
    ['ONCLICK', 'x'],
    ['onPointerDown', 'x'],
    ['data-oe-frame', 'spoof'],
    ['data-oe-seed', 'spoof'],
    ['srcdoc', '<b>'],
    ['SRCDOC', '<b>'],
    ['title', 'anything'],
    ['formaction', 'javascript:x'],
    ['xlink:href', 'data:x'],
    ['action', 'vbscript:x'],
    // Entity obfuscation: the compiler keeps static attribute strings
    // verbatim (no entity decoding into the AST), so admission decodes the
    // standard entity set before the URL check — both copies must agree.
    ['href', 'javascript&#58;alert(1)'],
    ['href', 'javascript&#x3a;alert(1)'],
    ['href', 'javascript&#x3A;alert(1)'],
    ['href', 'javascript&#X3A;alert(1)'],
    ['href', 'javascript&#58alert(1)'],
    ['href', 'javascript&#X3A(1)'],
    ['href', 'javascript&colon;alert(1)'],
    ['href', 'java&Tab;script:alert(1)'],
    ['href', 'java&#9;script:alert(1)'],
    ['href', 'javascript&NewLine;alert(1)'],
    // Parser-faithful non-matches: a hex digit run greedily eats a following
    // 'a' ('&#X3Aalert' decodes to U+03AA + 'lert', not to ':' + 'lert'),
    // and named references without a semicolon are not decoded at all.
    ['href', 'javascript&#X3Aalert(1)'],
    ['href', 'javascript&colonalert(1)'],
    // Decoded ampersands must not turn benign values into matches.
    ['href', '/path&#63;x=1'],
    ['href', '/redirect?to=javascript&#58;void'],
    // Entities outside URL attributes stay out of scope.
    ['title', 'javascript&#58;alert(1)'],
  ];
  for (const [name, value] of corpus) {
    assertEquals(
      unsafeStreamFrameAttribute(name, value),
      elementUnsafeStreamFrameAttribute(name, value),
      `frame-attribute predicate diverged for ${name}=${value}`,
    );
  }
  // The decode must actually tighten the check (not merely stay in parity),
  // including the uppercase-hex and semicolon-less numeric forms an HTML
  // parser decodes.
  assertEquals(
    unsafeStreamFrameAttribute('href', 'javascript&#58;alert(1)'),
    true,
    'entity-obfuscated script URLs must be rejected',
  );
  assertEquals(
    unsafeStreamFrameAttribute('href', 'javascript&#X3A;alert(1)'),
    true,
    'uppercase-hex entity obfuscation must be rejected',
  );
  assertEquals(
    unsafeStreamFrameAttribute('href', 'javascript&#58alert(1)'),
    true,
    'semicolon-less numeric entity obfuscation must be rejected',
  );
  assertEquals(
    unsafeStreamFrameAttribute('href', 'javascript&#X3A(1)'),
    true,
    'semicolon-less uppercase-hex obfuscation must be rejected when the colon lands',
  );
  assertEquals(
    unsafeStreamFrameAttribute('href', 'javascript&#X3Aalert(1)'),
    false,
    'greedy hex consumption turns the ref into U+03AA, not a colon: parser-faithful non-match',
  );
  assertEquals(
    unsafeStreamFrameAttribute('href', '/redirect?to=javascript&#58;void'),
    false,
    'entity decoding must not widen matches past the scheme anchor',
  );
});
