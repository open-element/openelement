/**
 * article-body.ts — shared long-form article treatment for site routes.
 *
 * Extracted from routes/blog/[slug].tsx so the blog and the guide section
 * render identical prose typography (the guide redesign references the blog
 * as its layout model). `prepareArticle` post-processes compiled markdown
 * HTML: stable heading ids + rail outline, and <pre> → <open-code-block>
 * wrapping (copy button + highlighting).
 *
 * `articleContentStyles(scope)` emits the prose stylesheet scoped to the
 * caller's container class — blog keeps '.blog-content', guide-article uses
 * '.article-content' with its own additions on top.
 */

import { readingChromeStrings } from './chrome-strings.ts';

export type ArticleOutlineItem = Readonly<{ id: string; label: string; level: 2 | 3 }>;

/** One attribute parsed from a start tag, with its exact byte span. */
interface AttributeSpan {
  name: string;
  value: string | undefined;
  /** First byte of the attribute name. */
  start: number;
  /** One past the last byte of the attribute (name plus optional value). */
  end: number;
}

/** A real start tag: lowercased name and the span through its terminating '>'. */
interface StartTag {
  name: string;
  /** Index of the opening '<'. */
  start: number;
  /** One past the last tag-name byte. */
  nameEnd: number;
  /** Index of the terminating '>'. */
  tagEnd: number;
}

/** Elements whose bodies are raw text: never scanned for tags or ids. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'pre']);

/**
 * Quote-aware scanner for the attributes inside a start tag. This is the one
 * grammar shared by existing-id collection and authored-id removal; it is a
 * local start-tag scanner, not an HTML parser. Quoted values are skipped
 * wholesale (so `data-note="x id=foo"` never yields an `id`), unquoted
 * values run to ASCII whitespace or '>' with '/' belonging to the value, and
 * self-closing solidi are ignored.
 */
function scanAttributeSpans(source: string, start: number, end: number): AttributeSpan[] {
  const spans: AttributeSpan[] = [];
  let index = start;
  while (index < end) {
    const char = source[index];
    if (/\s/.test(char) || char === '/') {
      index += 1;
      continue;
    }
    const attrStart = index;
    while (index < end && !/[\s=/>]/.test(source[index])) index += 1;
    const name = source.slice(attrStart, index);
    if (name === '') {
      index += 1;
      continue;
    }
    let cursor = index;
    while (cursor < end && /\s/.test(source[cursor])) cursor += 1;
    let value: string | undefined;
    if (cursor < end && source[cursor] === '=') {
      cursor += 1;
      while (cursor < end && /\s/.test(source[cursor])) cursor += 1;
      if (cursor < end && (source[cursor] === '"' || source[cursor] === "'")) {
        const quote = source[cursor];
        cursor += 1;
        const valueStart = cursor;
        while (cursor < end && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (cursor < end) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < end && !/[\s>]/.test(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
      index = cursor;
    }
    spans.push({ name, value, start: attrStart, end: index });
  }
  return spans;
}

/**
 * Walk every real start tag, skipping comments, doctypes, processing
 * instructions, closing tags, and literal text `<`. Raw-text bodies are
 * yielded through (the generator stays simple); callers skip them by span.
 */
function* startTags(html: string): Generator<StartTag> {
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) return;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    const next = html[lt + 1];
    if (next === '!' || next === '?' || next === '/') {
      const end = html.indexOf('>', lt + 1);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      index = lt + 1;
      continue;
    }
    let cursor = lt + 1;
    while (cursor < html.length && !/[\s/>]/.test(html[cursor])) cursor += 1;
    const nameEnd = cursor;
    let quote = '';
    while (cursor < html.length) {
      const char = html[cursor];
      if (quote) {
        if (char === quote) quote = '';
        cursor += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        cursor += 1;
        continue;
      }
      if (char === '>') break;
      cursor += 1;
    }
    if (cursor >= html.length) return;
    yield { name: html.slice(lt + 1, nameEnd).toLowerCase(), start: lt, nameEnd, tagEnd: cursor };
    index = cursor + 1;
  }
}

/**
 * Every real `id` attribute value in document order: start-tag attributes
 * only, never text, and never inside raw-text element bodies (a code sample
 * or CSS string that spells `<p id=foo>` is content, not an element).
 */
function collectElementIds(html: string): string[] {
  const ids: string[] = [];
  const lower = html.toLowerCase();
  let rawUntil = -1;
  for (const tag of startTags(html)) {
    if (tag.start < rawUntil) continue;
    for (const span of scanAttributeSpans(html, tag.nameEnd, tag.tagEnd)) {
      if (span.name.toLowerCase() === 'id' && span.value !== undefined) ids.push(span.value);
    }
    if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      const close = lower.indexOf(`</${tag.name}`, tag.tagEnd + 1);
      rawUntil = close === -1 ? html.length : close;
    }
  }
  return ids;
}

/**
 * Split the document into strictly alternating [normal, raw, normal, ...]
 * segments whose concatenation is byte-identical to the input. Raw segments
 * carry complete raw-text elements; heading rewriting only runs on normal
 * segments, so a `<h2>` inside a code sample or CSS string stays literal.
 */
function headingSegments(html: string): string[] {
  const lower = html.toLowerCase();
  const segments: string[] = [];
  let cursor = 0;
  for (const tag of startTags(html)) {
    if (tag.start < cursor || !RAW_TEXT_ELEMENTS.has(tag.name)) continue;
    const close = lower.indexOf(`</${tag.name}`, tag.tagEnd + 1);
    if (close === -1) {
      // Malformed fragment (an opening tag with no matching close) is not a
      // raw-text element; keep scanning so legitimate headings that merely
      // spell a partial tag in their text stay processable.
      continue;
    }
    const gt = html.indexOf('>', close);
    const end = gt === -1 ? html.length : gt + 1;
    segments.push(html.slice(cursor, tag.start), html.slice(tag.start, end));
    cursor = end;
  }
  segments.push(html.slice(cursor));
  return segments;
}

/**
 * Remove every real `id` attribute span (duplicate authored ids included),
 * preserving every other byte. Removal runs back to front so earlier spans
 * keep their offsets; a heading with `id="a" id="b"` would otherwise keep
 * one id next to the generated one and render two.
 */
function removeIdAttribute(attrs: string): string {
  const spans = scanAttributeSpans(attrs, 0, attrs.length)
    .filter((span) => span.name.toLowerCase() === 'id');
  let out = attrs;
  for (const idSpan of spans.reverse()) {
    let removeStart = idSpan.start;
    while (removeStart > 0 && /\s/.test(out[removeStart - 1])) removeStart -= 1;
    out = out.slice(0, removeStart) + out.slice(idSpan.end);
  }
  return out;
}

/**
 * Strip HTML to plain text, completely: tags to a fixed point, then any
 * leftover angle bracket. A single `<[^>]+>` pass can leave a `<script`
 * fragment with no closing `>` behind (CodeQL
 * js/incomplete-multi-character-sanitization); the trailing bracket strip
 * closes that hole the same way prepareArticle's label pipeline does.
 */
export function stripHtmlToText(html: string): string {
  let out = html;
  for (;;) {
    const stripped = out.replace(/<[^>]+>/g, '');
    if (stripped === out) break;
    out = stripped;
  }
  return out.replace(/[<>]/g, '');
}

/**
 * Heading-id allocator shared by prepareArticle and the retired-URL gate:
 * same stem rule and same per-document collision handling, so an anchor
 * verified here is the anchor the article actually renders.
 *
 * `usedIds` carries every id already claimed (reserved page ids, ids
 * present in the document, ids handed out by earlier headings). A stem's
 * counter is not tracked separately: the next free suffix is found by
 * probing candidates, so an existing `foo-2` can never be re-issued to a
 * later `Foo` heading.
 */
export function slugifyHeadingId(label: string, usedIds: Set<string>): string {
  const stem = label.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(
    /(^-|-$)/g,
    '',
  ) || 'section';
  let candidate = stem;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function prepareArticle(
  html: string,
  locale: string = 'en',
  reservedIds: readonly string[] = [],
): { html: string; outline: ArticleOutlineItem[] } {
  const anchorLabel = readingChromeStrings(locale).sectionAnchor;
  const outline: ArticleOutlineItem[] = [];
  const usedIds = new Set<string>();
  // Occupy ids the allocator must not hand out: the caller's known page
  // ids plus every id already present in this document (.pkg-row rows,
  // authored anchors). A heading colliding with one takes the next free
  // suffix instead of emitting a duplicate DOM id.
  for (const id of reservedIds) usedIds.add(id);
  // Seed every id the document already carries, parsed from real start-tag
  // attributes in every legal quote style; text and raw-text bodies never
  // contribute (a code sample spelling `id=foo` is not an id). Same grammar
  // as the removal below.
  for (const id of collectElementIds(html)) usedIds.add(id);
  // Headings inside raw-text elements (fenced code, script strings, CSS)
  // are literal content, not sections: only normal segments are rewritten.
  const withIds = headingSegments(html)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /<h([23])((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/h\1>/gi,
        (_match, depth, attrs, body) => {
          // Strip tags to a fixed point, then any angle bracket the tag pattern
          // could not match (e.g. a `<script` fragment with no closing `>`), so
          // the plain-text label can never carry a partial tag into the rail
          // outline (issue 1281).
          let label = String(body);
          for (;;) {
            const stripped = label.replace(/<[^>]+>/g, '');
            if (stripped === label) break;
            label = stripped;
          }
          label = label.replace(/[<>]/g, '').replace(/&[^;]+;/g, ' ').trim();
          const id = slugifyHeadingId(label, usedIds);
          outline.push({ id, label, level: Number(depth) as 2 | 3 });
          const cleanAttrs = removeIdAttribute(String(attrs));
          // Hover/focus anchor: a real same-page link (keyboard-reachable, and the
          // fragment gate proves the id exists), revealed by CSS on hover/focus.
          // The "#" glyph lives in ::after so screen readers hear the bare title.
          return `<h${depth}${cleanAttrs} id="${id}">${body}<a class="heading-anchor" href="#${id}" aria-label="${anchorLabel}"></a></h${depth}>`;
        },
      );
    })
    .join('');
  // Code display goes through open-code-block (copy button + highlighting).
  const withCodeBlocks = withIds.replace(
    /(<pre[\s\S]*?<\/pre>)/gi,
    '<open-code-block>$1</open-code-block>',
  );
  return { html: withCodeBlocks, outline };
}

/** Prose typography shared by blog and guide article bodies. */
export function articleContentStyles(scope: string): string {
  return `
    ${scope} { font-family: var(--font-sans); font-size: var(--font-size-1); line-height: 1.8; color: var(--text-secondary); }
    ${scope} h2, ${scope} h3 { scroll-margin-top: calc(var(--nav-height) + var(--size-4)); }
    ${scope} h2 { margin-top: var(--size-10); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--font-size-4); font-weight: var(--font-weight-8); letter-spacing: -0.02em; text-wrap: balance; }
    ${scope} h3 { margin-top: var(--size-8); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--font-size-2); font-weight: var(--font-weight-8); text-wrap: balance; }
    /* Line-art diagrams (locale-free, static): ink from currentColor, one
       brand accent carried by the markup itself. */
    ${scope} figure.diagram { margin: var(--size-6) 0; color: var(--text-muted); }
    ${scope} figure.diagram svg { display: block; height: 120px; width: auto; }
    ${scope} .heading-anchor { margin-inline-start: var(--size-2); color: var(--text-muted); font-weight: var(--font-weight-4); text-decoration: none; opacity: 0; }
    ${scope} .heading-anchor::after { content: "#"; }
    ${scope} h2:hover .heading-anchor, ${scope} h3:hover .heading-anchor, ${scope} .heading-anchor:focus-visible { opacity: 1; color: var(--brand); }
    ${scope} p { margin: var(--size-4) 0; }
    ${scope} ul, ${scope} ol { padding-left: var(--size-6); margin: var(--size-4) 0; }
    ${scope} li { margin: 0.375rem 0; }
    ${scope} strong { color: var(--text-primary); }
    ${scope} code { background: var(--bg-surface); color: var(--text-primary); padding: 0.125rem 0.375rem; border-radius: var(--radius-1); font-size: var(--font-size-0); font-family: var(--font-mono); }
    ${scope} pre { background: var(--surface-code); border: 0.5px solid var(--border); border-radius: var(--radius-2); padding: var(--size-4); overflow-x: auto; margin: var(--size-4) 0; }
    ${scope} pre code { background: none; color: var(--code-text); padding: 0; font-size: var(--font-size-0); line-height: 1.6; }
    ${scope} open-code-block { margin: var(--size-5) 0; }
    /* Tables carry their own scroll container: a comparison table's min-content
       (706px on /architecture/comparison) exceeds the reading column below
       ~1280px, and at 390px it pushed the document to 722px. overflow is
       ignored on a display:table box, so the table becomes a block that
       scrolls only when its content actually needs the room — desktop output
       is byte-identical. */
    ${scope} table { display: block; width: 100%; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: var(--size-4) 0; font-size: var(--font-size-1); }
    ${scope} th, ${scope} td { padding: var(--size-2) var(--size-3); text-align: left; border-bottom: 0.5px solid var(--border); }
    ${scope} th { background: var(--bg-surface); color: var(--text-secondary); font-weight: var(--font-weight-6); font-size: var(--font-size-overline); text-transform: uppercase; letter-spacing: var(--font-letterspacing-2); }
    ${scope} a { color: var(--brand); text-decoration: none; }
    ${scope} a:hover { text-decoration: underline; }
    ${scope} hr { border: none; border-top: 0.5px solid var(--border); margin: var(--size-8) 0; }
    ${scope} blockquote { margin: var(--size-8) 0; padding: var(--size-6) var(--size-4); border: 0; border-block: 1.5px solid color-mix(in srgb, var(--violet-5) 55%, transparent); color: var(--violet-8); font-family: var(--font-serif); font-style: italic; font-size: clamp(1.5rem, 3vw, 2.2rem); line-height: 1.35; text-align: center; }
    ${scope} blockquote p { margin: 0; }
  `;
}
