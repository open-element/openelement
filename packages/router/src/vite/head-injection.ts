/**
 * @openelement/router — Head injection validation & serialization.
 *
 * Extracted from index.ts in v0.22 (SOP-004: build tooling decomposition).
 *
 * Provides:
 * - assertNoScriptTags() — script tag safety check for head fragments
 * - validateSafeUrl()    — URL protocol validation against XSS vectors
 * - buildHeadExtras()    — serialize headFragments, stylesheets, and scripts
 *                          into a single headExtras string
 */

import type { FrameworkOptions } from './internal/protocol/framework.ts';

import { OpenElementError } from '@openelement/element';
import { escapeAttr as escapeHtmlAttr } from '@openelement/element';
import { createLogger, isSafeAttributeName } from '@openelement/element';
import { sanitizeHtml, type SanitizeOptions } from '@openelement/element/sanitize';

const log = createLogger('router-vite:head-injection');

const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel', 'sms'];
const HEAD_SANITIZE_OPTIONS: SanitizeOptions = {
  // <base> is excluded: it can hijack every relative URL in the document.
  allowedTags: ['link', 'meta', 'noscript', 'title'],
  allowedAttributes: {
    link: [
      'as',
      'crossorigin',
      'href',
      'hreflang',
      'imagesizes',
      'imagesrcset',
      'integrity',
      'media',
      'referrerpolicy',
      'rel',
      'sizes',
      'title',
      'type',
    ],
    // http-equiv is excluded because http-equiv="refresh" enables open redirects.
    // charset/viewport/name/
    // property metas do not need it; CSP metas are emitted by the SSG
    // postprocess, not through this allow-list.
    meta: ['charset', 'content', 'name', 'property'],
    noscript: [],
    title: [],
  },
  allowedSchemes: SAFE_SCHEMES,
  disallowedTagsMode: 'discard',
  allowDangerousTags: ['link', 'meta', 'noscript'],
  allowProtocolRelative: false,
  voidElementStyle: 'xhtml',
};

/** Fold CSS escapes and strip comments so the blacklist below cannot be
 *  bypassed by `@\69mport`, `@im/**\/port`, or `u\72l(...)`. */
function foldCssForCheck(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10FFFF ? '\uFFFD' : String.fromCodePoint(code);
    })
    .replace(/\\(.)/g, '$1');
}

function sanitizeStyleTag(attributes: string, css: string, context: string): string {
  if (
    /(?:@import|expression\s*\(|url\s*\(\s*["']?\s*(?:javascript|data|vbscript|file)\s*:)/i.test(
      foldCssForCheck(css),
    )
  ) {
    throw new OpenElementError(`Unsafe CSS in ${context}`, {
      code: 'UNSAFE_HEAD_INJECTION',
      statusCode: 400,
      recoverable: false,
    });
  }
  const rendered: string[] = [];
  const attributePattern = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/gy;
  let offset = 0;
  while (offset < attributes.length) {
    attributePattern.lastIndex = offset;
    const match = attributePattern.exec(attributes);
    if (!match || match.index !== offset) {
      throw new OpenElementError(`Malformed style attribute in ${context}`, {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      });
    }
    const name = match[1].toLowerCase();
    if (!['media', 'nonce', 'title'].includes(name) || /^on/i.test(name)) {
      throw new OpenElementError(`Unsafe style attribute in ${context}: "${name}"`, {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      });
    }
    const value = match[2] ?? match[3];
    rendered.push(value === undefined ? name : `${name}="${escapeHtmlAttr(value)}"`);
    offset = attributePattern.lastIndex;
  }
  return `<style${rendered.length ? ` ${rendered.join(' ')}` : ''}>${css}</style>`;
}

function sanitizeHeadHtml(html: string, context: string): string {
  const styles: string[] = [];
  let marker = '__OPEN_ELEMENT_SAFE_STYLE_';
  while (html.includes(marker)) marker += '_';
  const withoutStyles = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (_, attrs, css) => {
      const index = styles.push(sanitizeStyleTag(attrs, css, context)) - 1;
      return `${marker}${index}__`;
    },
  );
  let sanitized = sanitizeHtml(withoutStyles, HEAD_SANITIZE_OPTIONS);
  sanitized = sanitized.replace(
    new RegExp(`${marker}(\\d+)__`, 'g'),
    (_, index) => styles[Number(index)],
  );
  if (sanitized.trim() !== html.trim()) {
    log.warn(`${context} contained unsafe head markup; sanitized before injection`);
  }
  return sanitized;
}

function assertSafeAttributeName(name: string, context: string): void {
  // The predicate itself lives in @openelement/element (#1033); this path
  // keeps its own failure strategy (throw instead of silent skip).
  if (!isSafeAttributeName(name)) {
    throw new OpenElementError(`Unsafe attribute in ${context}: "${name}"`, {
      code: 'UNSAFE_HEAD_INJECTION',
      statusCode: 400,
      recoverable: false,
    });
  }
}

/**
 * Serialize an attribute record into escaped `name="value"` tokens.
 * `undefined`/`false` values are dropped; `true` renders as a bare
 * (boolean) attribute. Names are validated against `context`.
 */
function serializeAttrList(
  attrs: Record<string, string | number | boolean | undefined>,
  context: string,
): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    assertSafeAttributeName(name, context);
    out.push(
      value === true
        ? escapeHtmlAttr(name)
        : `${escapeHtmlAttr(name)}="${escapeHtmlAttr(String(value))}"`,
    );
  }
  return out;
}

/**
 * Assert that HTML content does NOT contain <script> tags.
 * Scripts must go through inject.scripts for URL validation.
 */
export function assertNoScriptTags(html: string, context: string): void {
  if (/<script[\s>/]/i.test(html)) {
    throw new OpenElementError(
      `${context} must not contain <script> tags. Use inject.scripts for scripts so ` +
        'openElement can validate script URLs and mark the generated head injection as trusted.',
      {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      },
    );
  }
}

/**
 * Validate a URL string for known XSS vectors (javascript:, data:, etc.).
 * Also validates percent-encoding is not malformed.
 * Returns the normalized URL string.
 */
export function validateSafeUrl(url: string, context: string): string {
  // Normalise: strip tab/LF/CR anywhere (WHATWG URL parsing removes them,
  // so "da\tta:…" would otherwise bypass the protocol blocklist), strip
  // surrounding whitespace; protocol checks run on the decoded value.
  const normalised = url.replace(/[\t\n\r]/g, '').trim();
  try {
    const decoded = decodeURIComponent(normalised); // catch malformed %XX
    const lower = decoded.toLowerCase().replace(/[\t\n\r]/g, '').trim();
    const blockedProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    for (const proto of blockedProtocols) {
      if (lower.startsWith(proto)) {
        throw new OpenElementError(
          `Unsafe URL in ${context}: "${url}" - ${proto} protocol is not allowed`,
          {
            code: 'UNSAFE_URL',
            statusCode: 400,
            recoverable: false,
          },
        );
      }
    }
  } catch (e) {
    // H-01 fix: Re-throw OpenElementError so security warnings are not swallowed
    if (e instanceof OpenElementError) throw e;
    // v0.14.3: decodeURIComponent can throw for two reasons:
    //   1. Malicious URLs with invalid percent-encoding (e.g., "%ZZ")
    //   2. Legitimate URLs with lone surrogates (rare, but valid URI-encoded)
    // We treat actual URIError as unsafe, but log the distinction for debugging.
    if (e instanceof URIError) {
      log.debug(
        `decodeURIComponent failed for URL in ${context}: "${url}" - ${e.message}. ` +
          'This may be a legitimate encoding issue or a malicious URL.',
      );
    }
    throw new OpenElementError(
      `Invalid URL in ${context}: "${url}" - malformed percent-encoding`,
      {
        code: 'UNSAFE_URL',
        statusCode: 400,
        recoverable: false,
      },
    );
  }
  return normalised;
}

/** Result of building head extras from FrameworkOptions. */
export interface HeadExtrasResult {
  headExtras: string | undefined;
  allowHeadExtrasScripts: boolean;
}

/**
 * Build the headExtras string from FrameworkOptions.inject.
 *
 * Serializes headFragments, stylesheets, and scripts into a single
 * HTML string to inject into <head>. Validates all URLs and ensures
 * no raw <script> tags bypass the structured injection APIs.
 */
export function buildHeadExtras(options: FrameworkOptions): HeadExtrasResult {
  // If direct headExtras provided, validate and return
  if (options.headExtras) {
    assertNoScriptTags(options.headExtras, 'headExtras');
    return {
      headExtras: sanitizeHeadHtml(options.headExtras, 'headExtras'),
      allowHeadExtrasScripts: false,
    };
  }

  // No inject config - no head extras
  if (!options.inject) {
    return { headExtras: undefined, allowHeadExtrasScripts: false };
  }

  const fragments: string[] = [];

  // headFragments FIRST (meta, styles, anti-flash) - must exist in DOM
  // before scripts that reference them (e.g. theme-init.js removes anti-flash).
  for (const frag of options.inject.headFragments || []) {
    assertNoScriptTags(frag, 'inject.headFragments');
    fragments.push(sanitizeHeadHtml(frag, 'inject.headFragments'));
  }

  // Stylesheets second
  for (const entry of options.inject.stylesheets || []) {
    const isObj = typeof entry === 'object';
    const href = isObj ? entry.href : entry;
    const safeHref = escapeHtmlAttr(validateSafeUrl(href, 'inject.stylesheets'));
    const linkAttrs: string[] = [`rel="stylesheet"`, `href="${safeHref}"`];
    if (isObj) {
      if (entry.integrity) linkAttrs.push(`integrity="${escapeHtmlAttr(entry.integrity)}"`);
      if (entry.crossorigin) linkAttrs.push(`crossorigin="${escapeHtmlAttr(entry.crossorigin)}"`);
      if (entry.integrity && !entry.crossorigin) linkAttrs.push('crossorigin="anonymous"');
      if (entry.attrs) {
        linkAttrs.push(...serializeAttrList(entry.attrs, 'inject.stylesheets.attrs'));
      }
    }
    fragments.push(`<link ${linkAttrs.join(' ')} />`);
  }

  // Scripts last - depend on headFragments being in DOM
  for (const script of options.inject.scripts || []) {
    const isObjectScript = typeof script === 'object';
    const src = validateSafeUrl(isObjectScript ? script.src : script, 'inject.scripts');
    const attrs: Record<string, string | number | boolean> = {
      ...(!isObjectScript || script.type ? { type: isObjectScript ? script.type! : 'module' } : {}),
      ...(isObjectScript && script.defer ? { defer: true } : {}),
      ...(isObjectScript && script.async ? { async: true } : {}),
      src,
    };
    if (isObjectScript && script.attrs) {
      for (const [k, v] of Object.entries(script.attrs)) {
        assertSafeAttributeName(k, 'inject.scripts.attrs');
        attrs[k] = v;
      }
    }
    // H-04/05 fix: Add SRI attributes for CDN security
    if (isObjectScript) {
      if (script.integrity) attrs.integrity = script.integrity;
      if (script.crossorigin) attrs.crossorigin = script.crossorigin;
      else if (script.integrity) attrs.crossorigin = 'anonymous';
    }
    const attrText = serializeAttrList(attrs, 'inject.scripts').join(' ');
    fragments.push(`<script ${attrText}></script>`);
  }

  return {
    headExtras: fragments.join('\n  '),
    allowHeadExtrasScripts: true,
  };
}
