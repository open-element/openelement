/**
 * Read opening tags from serialized HTML. The build's island manifest and
 * the document bootstrap both consume this walk, including the contents of
 * declarative shadow roots. It does not run a second render.
 */

const RAW_TEXT_TAGS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

function readTagName(html: string, start: number): { name: string; end: number } | undefined {
  let end = start;
  while (end < html.length && /[A-Za-z0-9:._-]/.test(html[end])) end++;
  if (end === start) return undefined;
  return { name: html.slice(start, end).toLowerCase(), end };
}

function skipThroughClosingTag(html: string, from: number, tagName: string): number {
  const close = new RegExp(`</${tagName}(?=[\\t\\n\\f\\r />])`, 'gi');
  close.lastIndex = from;
  const match = close.exec(html);
  if (!match) return html.length;
  const end = html.indexOf('>', close.lastIndex);
  return end < 0 ? html.length : end + 1;
}

export interface RenderedTag {
  name: string;
  attributes: ReadonlyMap<string, string>;
  inOpenShadow: boolean;
}

/** Attribute names are ASCII-case-insensitive, and a duplicate keeps its first value. */
function readAttributes(
  html: string,
  from: number,
): { attributes: Map<string, string>; end: number } | undefined {
  const token =
    /[\t\n\f\r /]*([^\t\n\f\r "'<>/=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?/y;
  const attributes = new Map<string, string>();
  let index = from;
  while (index < html.length) {
    token.lastIndex = index;
    const match = token.exec(html);
    if (!match) {
      const closing = /^[\t\n\f\r /]*>/.exec(html.slice(index));
      return closing ? { attributes, end: index + closing[0].length } : undefined;
    }
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
    index = token.lastIndex;
  }
}

/**
 * Return false when authored markup cannot be read confidently. The
 * bootstrap caller can retain the client for that document; the manifest
 * caller keeps the definite tags it already observed.
 */
export function visitRenderedTags(
  html: string,
  visit: (tag: RenderedTag) => boolean | void,
): boolean {
  let index = 0;
  const templates: Array<'inert' | 'open' | 'closed'> = [];
  let inertTemplates = 0;
  let openRoots = 0;
  let closedRoots = 0;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) return false;
      index = end + 3;
      continue;
    }
    const next = html[start + 1];
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', start + 2);
      if (end < 0) return false;
      index = end + 1;
      continue;
    }
    const closing = next === '/';
    const nameStart = start + (closing ? 2 : 1);
    const tag = readTagName(html, nameStart);
    if (!tag || !/[A-Za-z]/.test(html[nameStart])) {
      index = start + 1;
      continue;
    }
    const parsed = readAttributes(html, tag.end);
    if (!parsed) return false;
    const { name } = tag;
    const { attributes } = parsed;
    index = parsed.end;
    if (closing) {
      if (name === 'template') {
        const mode = templates.pop();
        if (mode === 'inert') inertTemplates--;
        if (mode === 'open') openRoots--;
        if (mode === 'closed') closedRoots--;
      }
      continue;
    }
    if (
      inertTemplates === 0 &&
      visit({ name, attributes, inOpenShadow: openRoots > 0 && closedRoots === 0 }) === false
    ) {
      return true;
    }
    if (name === 'template') {
      const value = attributes.get('shadowrootmode')?.toLowerCase();
      // HTML decodes character references before testing this enumerated
      // attribute. Treat entity-bearing modes as potentially open.
      const mode = value?.includes('&') ? 'open' : value;
      if (inertTemplates > 0 || (mode !== 'open' && mode !== 'closed')) {
        templates.push('inert');
        inertTemplates++;
      } else {
        templates.push(mode);
        if (mode === 'open') openRoots++;
        else closedRoots++;
      }
    }
    if (name === 'plaintext') return true;
    if (RAW_TEXT_TAGS.has(name)) index = skipThroughClosingTag(html, index, name);
  }
  return templates.length === 0;
}
