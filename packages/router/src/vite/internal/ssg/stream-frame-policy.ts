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
 * Entity obfuscation: this module must stay in exact parity with the
 * canonical element-internal policy module (the import-free protocol module
 * the element package admits deferred frames against) — a parity test in the
 * router suite pins both copies, including the entity decode below. The
 * TSX→Part Program compiler
 * keeps static attribute strings verbatim (no HTML-entity decoding into the
 * AST), and the serializer's escapeAttr re-escapes every `&`, so this decode
 * is defense in depth: admission judges the entity-decoded form an HTML
 * parser would produce, independent of the serializer's escaping invariant.
 *
 * What an HTML parser actually decodes, and therefore what this decode
 * covers: numeric character references with an `x`/`X` hex marker, with or
 * without the trailing semicolon (both `&#58;`/`&#X3A;` and the
 * semicolon-less `&#58`/`&#X3A` decode); the named colon/Tab/NewLine
 * obfuscation set, which requires the semicolon — HTML parsers do not decode
 * non-legacy named references without one. Greedy digit consumption stays
 * parser-faithful for the deny outcome: `&#X3Aalert` decodes to U+03AA
 * ('ʒ'), not a colon — the corpus pins that as a non-match.
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
