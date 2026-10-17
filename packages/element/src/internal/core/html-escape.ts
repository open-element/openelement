/**
 * html-escape.ts - Safe/Unsafe HTML Contract
 *
 * Branded types for HTML escaping semantics:
 * - SafeHtml:  A string that has been HTML-escaped (safe for text content)
 * - UnsafeHtml: A string that is intentionally raw HTML (do not double-escape)
 *
 * @module ./html-escape.ts
 */

// ─── L1: Safe/Unsafe HTML Contract ──────────────────────────────

import { createLogger, createWarnScope, warnOnce } from './logger.ts';
import type { WarnScope } from './logger.ts';

import { AuthoringErrorCode, frameworkError } from './errors.ts';
import { isSafeAttributeName } from './security.ts';
import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import { StyleErrorCode } from '@openelement/protocol/errors';

const log = createLogger('html-escape');

import type { SafeHtml, UnsafeHtml } from '@openelement/protocol/framework';
export type { SafeHtml, UnsafeHtml };

/**
 * Escape a string for safe HTML text content insertion.
 * Uses single-pass replacement for performance. The Safe/Unsafe brands are
 * compile-time only; this runtime escaping is the enforcement point.
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Escape the five HTML-significant characters in text content. */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] || ch);
}

/**
 * Escape an HTML attribute value.
 *
 * Delegates to `escapeHtml` so both share the single `ESCAPE_MAP` and the
 * same single-pass replacement (consolidated in #633).
 *
 * Empty-value conventions remain intentionally distinct by design:
 * - `escapeHtml` returns '' for non-string input.
 * - `escapeAttrValue` (below) coerces via `String()` and is the boundary
 *   meant for unknown/variable attribute values.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Escape a string for use as an attribute value (double-quoted) */
export function escapeAttrValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeAttr(String(value));
}

// The canonical HTML void-element set lives in one import-free protocol
// module; this runtime module re-exports it so existing consumers keep a
// single source of truth (issue #1220, M4).
export { VOID_TAGS } from '@openelement/protocol/void-tags';

/**
 * A framework-generated <script> to embed after the rendered HTML
 * with a CSP nonce closure. Structured alternative to the raw
 * `clientScript`/`devScripts` strings: wrapInDocument serializes every
 * descriptor through ONE code point, so a valid CSP nonce reaches every
 * framework-generated script tag uniformly.
 */
export interface DocumentScriptDescriptor {
  /** External script URL (attribute-escaped at serialization). */
  src?: string;
  /** Inline script body. Trusted input: never concatenate user content. */
  code?: string;
  /** Script type attribute, e.g. 'module'. Omitted means a classic script. */
  type?: string;
}

export interface DocumentWrapOptions {
  title?: string;
  lang?: string;
  clientScript?: string;
  scripts?: DocumentScriptDescriptor[];
  meta?: {
    description?: string;
    tags?: Array<Record<string, string | number | boolean>>;
  };
  devScripts?: string;
  headExtras?: string;
  dangerouslyHeadFragments?: string[];
  allowHeadExtrasScripts?: boolean;
  links?: Array<{ rel: string; href: string; hreflang?: string }>;
  structuredData?: ReadonlyArray<Record<string, unknown>>;
  cspNonce?: string;
  /** Trusted framework bootstrap emitted synchronously in the document head. */
  streamBootstrap?: string;
  /**
   * The document's light-root component stylesheets: external resource URLs
   * (alpha15 S lane, S-C1.2) serialized as marked `<link rel="stylesheet">`
   * nodes after `headExtras`, so a light component is styled by the document
   * that contains it — without JavaScript and without a runtime style node.
   */
  styleLinks?: readonly string[];
}

/**
 * The document-level stylesheet resources ONE server render discovered
 * (alpha15 S lane, S-C1.2).
 *
 * A light-root component's DOM lives in the document, so its sheet cannot
 * ride the component's own subtree the way a shadow template's link does: the
 * document owns it. This object is the one carrier between the two halves of
 * that render — the compiled serializer, which discovers a component's
 * external sheets while serializing the component, and the document
 * serializer, which writes the head. It is created per render and never
 * shared, so one page's stylesheets can never reach another page's head.
 */
export interface DocumentStyleResources {
  /** Discovered resource URLs, deduplicated, in discovery (cascade) order. */
  readonly links: readonly string[];
  /** Record the external stylesheet URLs one rendered component contributes. */
  add(urls: readonly string[]): void;
}

/** Create the per-render document stylesheet collection. */
export function createDocumentStyleResources(): DocumentStyleResources {
  const links: string[] = [];
  const seen = new Set<string>();
  return {
    get links(): readonly string[] {
      return [...links];
    },
    add(urls: readonly string[]): void {
      for (const url of urls) {
        if (typeof url !== 'string' || url === '' || seen.has(url)) continue;
        seen.add(url);
        links.push(url);
      }
    },
  };
}

/**
 * True when an href has the shape a framework-emitted component stylesheet
 * address takes: a site-absolute path or an absolute http(s) URL, without
 * whitespace or markup-significant characters. ONE rule for both sinks that
 * serialize such an address — the DSD template's links and the document
 * head's — so a component's stylesheet reaches a browser the same way
 * whichever root kind the component has.
 */
export function isComponentStyleHref(href: string): boolean {
  return /^(?:\/[^/\s]|https?:\/\/[^\s])/.test(href) && !/["'<>\s]/.test(href);
}

/**
 * Serialize the document's light-root component stylesheets as marked
 * stylesheet `<link>` nodes. Marked (`data-oe-static-styles`) for the same
 * reason the DSD template's links are: the client's adoption guard
 * (`sheetDeliveredByLink`) reads that marker to keep ONE delivery per
 * resource — a document that already links this stylesheet must not adopt a
 * second constructable copy of it.
 *
 * The href rule is the S protocol's own (`isComponentStyleHref`): a
 * framework-emitted asset address always satisfies it, and a value that does
 * not is a defect that fails the render instead of escaping into markup.
 */
function buildStyleLinkTags(links: readonly string[]): string {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const href of links) {
    if (typeof href !== 'string' || href === '' || seen.has(href)) continue;
    if (!isComponentStyleHref(href)) {
      throw frameworkError(
        StyleErrorCode.INVALID_STYLE_HREF,
        `wrapInDocument: styleLinks href must be a site-absolute path or an absolute http(s) URL, got ${JSON.stringify(
          href,
        )}`,
        { phase: 'ssr' },
      );
    }
    seen.add(href);
    tags.push(`  <link rel="stylesheet" href="${escapeAttr(href)}" ${STATIC_STYLES_MARKER} />`);
  }
  return tags.length === 0 ? '' : '\n' + tags.join('\n');
}

/**
 * Wrap rendered HTML in a full HTML document.
 * Adds DOCTYPE, head (title, meta, preload), and body.
 * Supports CSP nonce and dev scripts (e.g. Vite client, route module registration).
 */
export function wrapInDocument(html: string, options: DocumentWrapOptions = {}): string {
  const { prefix, suffix } = documentStreamParts(options);
  return prefix + html + suffix;
}

/** The same document serialization boundary, with only body wrappers left open. */
export function documentStreamParts(options: DocumentWrapOptions = {}): {
  prefix: string;
  suffix: string;
} {
  // Per-render warning scope: the same headExtras key can warn again on the
  // next SSG page/request instead of being suppressed for the whole process
  // (#643).
  const warnScope = createWarnScope();
  const {
    title = 'openElement',
    lang = 'en',
    clientScript = '',
    scripts = [],
    meta,
    devScripts = '',
    headExtras = '',
    dangerouslyHeadFragments = [],
    allowHeadExtrasScripts = false,
    links = [],
    structuredData = [],
    cspNonce,
    streamBootstrap,
    styleLinks = [],
  } = options;
  // CSP nonce format validation per the CSP spec (base64 value)
  const NONCE_RE = /^[A-Za-z0-9+/=_-]+$/;
  const validNonce = cspNonce && NONCE_RE.test(cspNonce) ? cspNonce : undefined;
  if (cspNonce && !validNonce) {
    log.warn(`Invalid CSP nonce format: "${cspNonce}". Nonce should be a base64-encoded value.`);
  }
  const safeHeadExtras = sanitizeHeadExtras(headExtras, allowHeadExtrasScripts, warnScope);
  validateHeadExtrasBalance(headExtras);
  const metaTags = buildMetaTags(meta);
  const metaBlock = metaTags.length > 0 ? '\n' + metaTags.join('\n') + '\n' : '';
  const linkTags = buildLinkTags(links);
  const linkBlock = linkTags.length > 0 ? '\n' + linkTags.join('\n') : '';
  const structuredDataTags = buildStructuredDataTags(structuredData, validNonce);
  const structuredDataBlock =
    structuredDataTags.length > 0 ? '\n' + structuredDataTags.join('\n') + '\n' : '';
  const dangerousHeadBlock =
    dangerouslyHeadFragments.length > 0 ? '\n  ' + dangerouslyHeadFragments.join('\n  ') : '';

  const safeTitle = escapeHtml(title);
  const safeLang = escapeAttr(lang);
  const scriptBlock = buildScriptTags(scripts, validNonce);
  const streamBootstrapBlock = streamBootstrap
    ? `\n  ${buildScriptTags([{ code: streamBootstrap }], validNonce)}`
    : '';
  // The document's own component stylesheets (light roots, S-C1.2) sit after
  // headExtras: the site's document stylesheet is declared there, and a
  // component's rules must be able to win an equal-specificity tie against it
  // — the order the retired in-document style sink produced.
  const styleLinkBlock = buildStyleLinkTags(styleLinks);

  const prefix = `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>${metaBlock}${linkBlock}${structuredDataBlock}
  ${safeHeadExtras}${styleLinkBlock}${dangerousHeadBlock}${streamBootstrapBlock}
</head>
<body>
  `;
  const suffix = `
  ${clientScript}${devScripts}${scriptBlock}
</body>
</html>`;
  return { prefix, suffix };
}

/**
 * Serialize structured script descriptors (THE single nonce attachment
 * point). With no valid nonce the tags are byte-identical to the tags the
 * retired string-splice injectors emitted; with one, every tag carries
 * `nonce="..."`. Entries without src or code are meaningless and skipped.
 */
function buildScriptTags(scripts: DocumentScriptDescriptor[], nonce: string | undefined): string {
  const tags: string[] = [];
  for (const script of scripts) {
    if (!script || (!script.src && !script.code)) continue;
    const attrs: string[] = [];
    if (script.type) attrs.push(`type="${escapeAttrValue(script.type)}"`);
    if (script.src) attrs.push(`src="${escapeAttrValue(script.src)}"`);
    if (nonce) attrs.push(`nonce="${nonce}"`);
    // Inline bodies are trusted framework/developer input (same boundary as
    // headExtras with allowHeadExtrasScripts). The `<\/script` guard keeps a
    // literal end tag inside the body from closing the element early.
    const body = script.src ? '' : (script.code ?? '').replace(/<\/script/gi, '<\\/script');
    const open = attrs.length > 0 ? `<script ${attrs.join(' ')}>` : '<script>';
    tags.push(`${open}${body}</script>`);
  }
  return tags.join('\n  ');
}

/**
 * Serialize structured-data documents into `application/ld+json` script
 * elements (THE escaping point of the channel).
 *
 * The body is `JSON.stringify` output with every `<` replaced by `\u003C`.
 * `JSON.stringify` already escapes quotes and backslashes, so `<` is the only
 * byte that could leave the script raw-text element; escaping all of them
 * removes `</script`, `<!--` and `<script` in one pass. JSON parsers decode
 * the escape back to `<`, so a consumer reads the original text — the
 * serialization is lossless, it is only the markup that cannot be formed.
 *
 * A valid CSP nonce reaches this tag too (a strict `script-src` would
 * otherwise block the data block); with no valid nonce the tag carries no
 * attribute. Entries the serializer cannot turn into JSON throw instead of
 * being dropped from the document.
 */
function buildStructuredDataTags(
  entries: ReadonlyArray<Record<string, unknown>>,
  nonce: string | undefined,
): string[] {
  const tags: string[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw frameworkError(
        AuthoringErrorCode.INVALID_STRUCTURED_DATA,
        'wrapInDocument: every structuredData entry must be a JSON-LD document (a plain object).',
        { phase: 'build' },
      );
    }
    let json: string | undefined;
    try {
      json = JSON.stringify(entry);
    } catch (cause) {
      throw frameworkError(
        AuthoringErrorCode.INVALID_STRUCTURED_DATA,
        `wrapInDocument: structuredData entry is not JSON-serializable: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { phase: 'build', cause: cause instanceof Error ? cause : undefined },
      );
    }
    if (typeof json !== 'string') {
      throw frameworkError(
        AuthoringErrorCode.INVALID_STRUCTURED_DATA,
        'wrapInDocument: structuredData entry is not JSON-serializable.',
        { phase: 'build' },
      );
    }
    const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
    tags.push(
      `  <script type="application/ld+json"${nonceAttr}>${json.replace(/</g, '\\u003C')}</script>`,
    );
  }
  return tags;
}

/**
 * Runtime enforcement for headExtras: if headExtras contains <script> tags
 * and allowHeadExtrasScripts is false, strip them to prevent XSS. Use
 * inject.scripts for safe script injection.
 */
function sanitizeHeadExtras(
  headExtras: string,
  allowHeadExtrasScripts: boolean,
  warnScope: WarnScope,
): string {
  if (allowHeadExtrasScripts || !headExtras) return headExtras;
  // Strip <script> tags and their content. The delimiter class includes `/`
  // (`<script/src=...>` is still a script tag to the browser). The end-tag
  // pattern accepts attributes/whitespace because browsers ignore them on end
  // tags (`</script\t\n bar>` still ends the script raw-text element). Both
  // properties hold only when the strip runs to a fixed point: removing an
  // inner pair can re-form a live outer `<script>...</script>`, so the block
  // pass repeats until stable before the final backstop strips an unclosed
  // `<script ...>` to end-of-input (browsers treat the rest of the document
  // as script raw text). Fixed-point first keeps that backstop from eating
  // legitimate trailing markup (CodeQL #1281).
  const SCRIPT_BLOCK_RE = /<script[\s>/][\s\S]*?<\/script(?=[\s/>])[^>]*>/gi;
  const SCRIPT_OPEN_TO_EOF_RE = /<script[\s>/][\s\S]*$/gi;
  let safeHeadExtras = headExtras;
  for (;;) {
    const stripped = safeHeadExtras.replace(SCRIPT_BLOCK_RE, '');
    if (stripped === safeHeadExtras) break;
    safeHeadExtras = stripped;
  }
  safeHeadExtras = safeHeadExtras.replace(SCRIPT_OPEN_TO_EOF_RE, '');
  if (safeHeadExtras !== headExtras) {
    warnOnce(
      'headExtrasScripts',
      log,
      'headExtras contained <script> tags which were stripped for security. ' +
        'Use inject.scripts for safe script injection, or set allowHeadExtrasScripts: true.',
      warnScope,
    );
  }
  // Strip on* event handler attributes (strong XSS indicator). Also to a
  // fixed point: a match ending at a quoted value can leave a concatenated
  // `on...=` sequence that only becomes strippable once the earlier match is
  // removed (CodeQL #1281).
  if (/\s+on\w+\s*=/i.test(safeHeadExtras)) {
    const EVENT_HANDLER_ATTR_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
    for (;;) {
      const stripped = safeHeadExtras.replace(EVENT_HANDLER_ATTR_RE, '');
      if (stripped === safeHeadExtras) break;
      safeHeadExtras = stripped;
    }
    log.warn('headExtras contained on* event handler attributes which were stripped for security.');
  }
  return safeHeadExtras;
}

/**
 * Basic HTML tag balance validation for headExtras: opening and closing tag
 * counts must match for major HTML elements. This catches obviously
 * malformed HTML (e.g., unclosed <!-- comments).
 */
function validateHeadExtrasBalance(headExtras: string): void {
  if (!headExtras) return;
  // Check for unclosed HTML comments: <!-- without a matching close. The
  // HTML standard also accepts `--!>` as an (abrupt) comment close, so both
  // forms count (CodeQL #1281).
  const commentOpens = (headExtras.match(/<!--/g) || []).length;
  const commentCloses = (headExtras.match(/--!?>/g) || []).length;
  if (commentOpens !== commentCloses) {
    log.warn(
      'headExtras has unbalanced HTML comments (<!-- vs -->). ' +
        'This may cause HTML parsing issues.',
    );
  }
}

/**
 * Serialize the meta description and arbitrary meta tags.
 *
 * Tag keys are attribute *names*, not values: `escapeAttr` neutralizes value
 * characters (`&<>"'`) but not name grammar (spaces, `=`), so a key like
 * `"foo onload=alert(1)"` would otherwise inject attributes into the emitted
 * `<meta>` element. Every key is therefore validated against the one
 * canonical `isSafeAttributeName` predicate (`../protocol/forbidden-sinks.ts`,
 * #1033) — the same predicate the compiler, the Part Program validator, the
 * server serializer, and the router head-injection paths enforce — and a
 * violation throws (fail-closed):
 * `meta.tags` is not a documented dangerous channel, so CMS-fed metadata must
 * fail the render instead of being skipped (#1373).
 */
function buildMetaTags(meta?: {
  description?: string;
  tags?: Array<Record<string, string | number | boolean>>;
}): string[] {
  const metaTags: string[] = [];
  if (meta?.description) {
    const safeDesc = escapeAttrValue(meta.description);
    metaTags.push(`  <meta name="description" content="${safeDesc}">`);
  }
  if (Array.isArray(meta?.tags)) {
    for (const tag of meta.tags) {
      const attrs = Object.entries(tag)
        .map(([key, value]) => {
          if (!isSafeAttributeName(key)) {
            throw frameworkError(
              AuthoringErrorCode.UNSAFE_META_ATTRIBUTE,
              `wrapInDocument: unsafe meta attribute name: ${JSON.stringify(
                key,
              )}. Meta tag keys must be valid HTML attribute names and must not be event handlers.`,
              { phase: 'validation', statusCode: 400 },
            );
          }
          return `${escapeAttr(key)}="${escapeAttrValue(value)}"`;
        })
        .join(' ');
      if (attrs) metaTags.push(`  <meta ${attrs}>`);
    }
  }
  return metaTags;
}

/**
 * Serialize <link> tags (Beta.2.2, #1326). Attributes are escaped here; an
 * entry without both rel and href is meaningless and skipped — meaning-level
 * validation (which links a page declares) is resolvePageDocument's job.
 */
function buildLinkTags(links: Array<{ rel: string; href: string; hreflang?: string }>): string[] {
  const linkTags: string[] = [];
  for (const link of links) {
    if (!link || !link.rel || !link.href) continue;
    const attrs = [`rel="${escapeAttrValue(link.rel)}"`, `href="${escapeAttrValue(link.href)}"`];
    if (link.hreflang) attrs.push(`hreflang="${escapeAttrValue(link.hreflang)}"`);
    linkTags.push(`  <link ${attrs.join(' ')}>`);
  }
  return linkTags;
}
