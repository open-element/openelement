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

export function unsafeStreamFrameAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('on') || lower.startsWith('data-oe-') || lower === 'srcdoc' ||
    (urlAttributes.has(lower) &&
      STREAM_FRAME_UNSAFE_URL.test(
        value.split('').filter((char) => char.charCodeAt(0) > STREAM_FRAME_URL_CONTROL_MAX)
          .join(''),
      ));
}
