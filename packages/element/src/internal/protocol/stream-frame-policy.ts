/**
 * Streamed-frame admission policy — the canonical deny lists a deferred
 * text/Region Part frame must satisfy for the browser installer to accept it.
 *
 * This module is import-free and host-free by design (same base-of-graph
 * contract as forbidden-sinks.ts). It is the SINGLE policy source for every
 * streaming admission boundary:
 *
 * - the compiler-side build manifest scan (the router package re-pins this
 *   exact content in its own stream-frame-policy module; a parity test in the
 *   router suite fails loud on drift, because the element package must not
 *   depend on the router),
 * - the element-side deferred executor admission
 *   (internal/compiled/server/index.ts), so the public API's hand-written
 *   manifest path cannot emit frames the browser is contractually required to
 *   discard,
 * - the browser installer bootstrap emitted by the router (the list is
 *   injected verbatim into the runtime script).
 *
 * The lists must never diverge: a frame the server emits and the browser
 * rejects is silently lost content.
 */

/** Tags a deferred frame cannot safely install into an owned Part range. */
export const STREAM_FRAME_FORBIDDEN_TAGS = [
  'script',
  'style',
  'template',
  'iframe',
  'object',
  'embed',
  'base',
  'meta',
  'link',
] as const;

export const STREAM_FRAME_URL_ATTRIBUTES = [
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
] as const;

export const STREAM_FRAME_URL_CONTROL_MAX = 32;
export const STREAM_FRAME_UNSAFE_URL = /^(javascript|vbscript|data):/i;

const urlAttributes: ReadonlySet<string> = new Set(STREAM_FRAME_URL_ATTRIBUTES);

/**
 * Entity obfuscation, verified against the compiler on 2026-09-25: the
 * TSX→Part Program compiler keeps static attribute strings verbatim —
 * `href="javascript&#58;alert(1)"` compiles to the raw entity text
 * `javascript&#58;alert(1)` in the AST, with no HTML-entity decoding.
 * The serializer's escapeAttr re-escapes every `&`, so program data cannot
 * reach the browser as a live entity today: the browser parser sees exactly
 * the AST string and its own URL check runs on that. The decode below is
 * defense in depth, not a currently exploitable gap: it makes admission
 * judge the entity-decoded form, so the deny decision no longer depends on
 * the serializer's escaping invariant.
 *
 * What an HTML parser actually decodes, and therefore what this decode
 * covers: numeric character references with an `x`/`X` hex marker, with or
 * without the trailing semicolon (both `&#58;`/`&#X3A;` and the
 * semicolon-less `&#58`/`&#X3A` decode); the named colon/Tab/NewLine
 * obfuscation set, which requires the semicolon — HTML parsers do not decode
 * non-legacy named references without one.
 *
 * Digit runs are consumed greedily and the outcome stays parser-faithful:
 * the decoded code point equals the parser's, and the scheme-anchored deny
 * regex matches or not exactly as it would on the parser's output. One
 * greedy-hex consequence the corpus pins as a non-match: `&#X3Aalert`
 * decodes to U+03AA ('ʒ') because the trailing 'a' is itself a hex digit —
 * that form never lands a colon.
 */
const STREAM_FRAME_ENTITY = /&(?:#[xX]?[0-9a-fA-F]+;?|colon;|Tab;|NewLine;)/g;

function decodeStreamFrameEntities(value: string): string {
  return value.replace(STREAM_FRAME_ENTITY, (entity) => {
    if (entity.charCodeAt(1) !== 0x23) { // named form: &colon; &Tab; &NewLine;
      if (entity === '&colon;') return ':';
      return entity === '&Tab;' ? '\t' : '\n';
    }
    const body = entity.slice(2);
    const hex = body.charCodeAt(0) === 0x78 || body.charCodeAt(0) === 0x58;
    const digits = body.slice(
      hex ? 1 : 0,
      body.endsWith(';') ? -1 : undefined,
    );
    const code = hex ? parseInt(digits, 16) : parseInt(digits, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  });
}

export function unsafeStreamFrameAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('on') || lower.startsWith('data-oe-') || lower === 'srcdoc' ||
    (urlAttributes.has(lower) &&
      STREAM_FRAME_UNSAFE_URL.test(
        decodeStreamFrameEntities(value)
          .split('').filter((char) => char.charCodeAt(0) > STREAM_FRAME_URL_CONTROL_MAX)
          .join(''),
      ));
}
