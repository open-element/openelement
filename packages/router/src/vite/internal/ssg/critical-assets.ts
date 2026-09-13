/**
 * Declarative critical-rendering-path assets for the alpha.4 adapter.
 *
 * This is a build-time serializer. It emits ordinary HTML head resources and
 * never adds a second rendering or client-runtime path. External blocking
 * resources are rejected by default; an explicit opt-out is required because
 * a CDN is an operational dependency, not a harmless formatting choice.
 */

import { escapeAttr, OpenElementError } from '@openelement/element';
import { validateSafeUrl } from '../../head-injection.ts';

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

export interface CriticalFontAsset {
  href: string;
  type?: string;
  integrity?: string;
  crossorigin?: 'anonymous' | 'use-credentials';
}

export interface CriticalStyleAsset {
  /** External stylesheet URL. */
  href?: string;
  /** Inline CSS source. Exactly one of href/css is required. */
  css?: string;
  media?: string;
  type?: string;
  integrity?: string;
  crossorigin?: 'anonymous' | 'use-credentials';
  /** Emit a preload hint before the stylesheet link. Defaults to true. */
  preload?: boolean;
  /** Mark an external stylesheet as intentionally non-blocking. */
  renderBlocking?: boolean;
}

export interface CriticalInlineScriptAsset {
  code: string;
  type?: string;
}

export interface CriticalAssetsOptions {
  fonts?: CriticalFontAsset[];
  styles?: Array<CriticalStyleAsset | string>;
  /** Alias for styles accepted by config producers. */
  stylesheets?: Array<CriticalStyleAsset | string>;
  inlineScripts?: Array<string | CriticalInlineScriptAsset>;
  /** Allow intentional external render-blocking styles/scripts. */
  allowExternalRenderBlocking?: boolean;
  /** Alias retained only within this build-side config shape. */
  allowRenderBlockingExternal?: boolean;
  /** Minify inline CSS. Defaults to true. */
  minifyInlineStyles?: boolean;
  /** Origin used to distinguish same-origin and cross-origin absolute URLs. */
  origin?: string;
}

export interface CriticalAssetsResult {
  headExtras?: string;
  allowHeadExtrasScripts: boolean;
}

interface RecordLike {
  [key: string]: unknown;
}

function asRecord(value: unknown, context: string): RecordLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenElementError(`${context} must be an object`, {
      code: 'INVALID_CRITICAL_ASSETS',
      statusCode: 400,
      recoverable: false,
    });
  }
  return value as RecordLike;
}

function stringValue(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OpenElementError(`${context} must be a non-empty string`, {
      code: 'INVALID_CRITICAL_ASSETS',
      statusCode: 400,
      recoverable: false,
    });
  }
  const normalized = value.trim();
  if (hasControlCharacters(normalized)) {
    throw new OpenElementError(`${context} contains control characters`, {
      code: 'INVALID_CRITICAL_ASSETS',
      statusCode: 400,
      recoverable: false,
    });
  }
  return normalized;
}

function optionalString(value: unknown, context: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, context);
}

function assertNoControls(value: string, context: string): void {
  // Newlines, carriage returns, and tabs are ordinary CSS/JavaScript
  // whitespace. Reject the remaining C0 controls, which cannot carry useful
  // critical asset content and can confuse HTML parsers/logs.
  if (hasControlCharacters(value)) {
    throw new OpenElementError(`${context} contains control characters`, {
      code: 'INVALID_CRITICAL_ASSETS',
      statusCode: 400,
      recoverable: false,
    });
  }
}

function arrayValue(value: unknown, context: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new OpenElementError(`${context} must be an array`, {
      code: 'INVALID_CRITICAL_ASSETS',
      statusCode: 400,
      recoverable: false,
    });
  }
  return value;
}

function crossoriginValue(
  value: unknown,
  context: string,
): 'anonymous' | 'use-credentials' | undefined {
  if (value === undefined) return undefined;
  const normalized = stringValue(value, context);
  if (normalized !== 'anonymous' && normalized !== 'use-credentials') {
    throw new OpenElementError(
      `${context} must be "anonymous" or "use-credentials"`,
      { code: 'INVALID_CRITICAL_ASSETS', statusCode: 400, recoverable: false },
    );
  }
  return normalized;
}

/** Small deterministic CSS minifier that preserves quoted strings and values. */
function stripCssComments(css: string): string {
  let out = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    const next = css[index + 1];
    if (quote) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index + 1 < css.length && !(css[index] === '*' && css[index + 1] === '/')) {
        index += 1;
      }
      if (index + 1 >= css.length) {
        throw new OpenElementError('Invalid CSS: unterminated CSS comment', {
          code: 'INVALID_CRITICAL_ASSETS',
          statusCode: 400,
          recoverable: false,
        });
      }
      index += 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function foldCssForCheck(css: string): string {
  return stripCssComments(css)
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10FFFF ? '\uFFFD' : String.fromCodePoint(code);
    })
    .replace(/\\(.)/g, '$1');
}

function assertSafeInlineCss(css: string, context: string): void {
  if (
    /<\/style/i.test(css) ||
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
}

export function minifyCriticalCss(css: string): string {
  assertNoControls(css, 'critical inline CSS');
  let out = '';
  let quote = '';
  let escaped = false;
  let pendingSpace = false;
  const withoutComments = stripCssComments(css);

  const flushSpace = (next: string): void => {
    if (!pendingSpace) return;
    const previous = out[out.length - 1] ?? '';
    if (previous && !/[{[:,;>+~]/.test(previous) && !/[}]/.test(next)) out += ' ';
    pendingSpace = false;
  };

  for (const char of withoutComments) {
    if (quote) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      flushSpace(char);
      quote = char;
      out += char;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (/[{[:,;>+~]/.test(char) || char === '}') {
      pendingSpace = false;
      while (out.endsWith(' ')) out = out.slice(0, -1);
      out += char;
      continue;
    }
    flushSpace(char);
    out += char;
  }
  return out.trim();
}

/** Minify only inline style bodies in already validated head HTML. */
export function minifyCriticalStyleBlocks(html: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_m, open, css, close) => `${open}${minifyCriticalCss(css)}${close}`,
  );
}

function safeUrl(value: unknown, context: string): string {
  return escapeAttr(validateSafeUrl(stringValue(value, context), context));
}

function isCrossOrigin(href: string, origin: string | undefined): boolean {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const isProtocolRelative = href.startsWith('//');
  if (!hasScheme && !isProtocolRelative) return false;
  let url: URL;
  try {
    url = new URL(href, origin || 'https://open-element.invalid');
  } catch {
    return true;
  }
  if (!/^https?:$/i.test(url.protocol)) return false;
  if (!origin) return true;
  try {
    return url.origin !== new URL(origin).origin;
  } catch {
    return true;
  }
}

function renderFont(font: unknown, index: number): string {
  const value = asRecord(font, `criticalAssets.fonts[${index}]`);
  const href = safeUrl(value.href, `criticalAssets.fonts[${index}].href`);
  const attrs = [`rel="preload"`, `as="font"`, `href="${href}"`, 'crossorigin="anonymous"'];
  const type = optionalString(value.type, `criticalAssets.fonts[${index}].type`);
  const integrity = optionalString(value.integrity, `criticalAssets.fonts[${index}].integrity`);
  const crossorigin = crossoriginValue(
    value.crossorigin,
    `criticalAssets.fonts[${index}].crossorigin`,
  );
  if (type) attrs.push(`type="${escapeAttr(type)}"`);
  if (integrity) attrs.push(`integrity="${escapeAttr(integrity)}"`);
  if (crossorigin) attrs[3] = `crossorigin="${escapeAttr(crossorigin)}"`;
  return `<link ${attrs.join(' ')} />`;
}

function renderStyle(
  style: unknown,
  index: number,
  config: CriticalAssetsView,
): string {
  const value = typeof style === 'string'
    ? { href: style }
    : asRecord(style, `criticalAssets.styles[${index}]`);
  const href = value.href === undefined
    ? undefined
    : stringValue(value.href, `criticalAssets.styles[${index}].href`);
  const css = value.css === undefined
    ? undefined
    : stringValue(value.css, `criticalAssets.styles[${index}].css`);
  if ((href === undefined) === (css === undefined)) {
    throw new OpenElementError(
      `criticalAssets.styles[${index}] must provide exactly one of href or css`,
      { code: 'INVALID_CRITICAL_ASSETS', statusCode: 400, recoverable: false },
    );
  }
  if (css !== undefined) {
    assertSafeInlineCss(css, `criticalAssets.styles[${index}].css`);
    const body = config.minifyInlineStyles === false ? css : minifyCriticalCss(css);
    const safeBody = body.replace(/<\/style/gi, '<\\/style');
    const attrs = value.media === undefined
      ? ''
      : ` media="${escapeAttr(stringValue(value.media, `criticalAssets.styles[${index}].media`))}"`;
    const type = value.type === undefined
      ? ''
      : ` type="${escapeAttr(stringValue(value.type, `criticalAssets.styles[${index}].type`))}"`;
    return `<style${attrs}${type}>${safeBody}</style>`;
  }

  const safeHref = safeUrl(href, `criticalAssets.styles[${index}].href`);
  const renderBlocking = value.renderBlocking !== false;
  const allowExternal = config.allowExternalRenderBlocking === true ||
    config.allowRenderBlockingExternal === true;
  if (renderBlocking && isCrossOrigin(href!, config.origin) && !allowExternal) {
    throw new OpenElementError(
      `criticalAssets.styles[${index}] is a cross-origin render-blocking stylesheet; ` +
        'set renderBlocking:false or explicitly allowExternalRenderBlocking:true',
      { code: 'CRITICAL_EXTERNAL_BLOCKING_ASSET', statusCode: 400, recoverable: false },
    );
  }
  const attrs = [`rel="stylesheet"`, `href="${safeHref}"`];
  const media = optionalString(value.media, `criticalAssets.styles[${index}].media`);
  const type = optionalString(value.type, `criticalAssets.styles[${index}].type`);
  const integrity = optionalString(value.integrity, `criticalAssets.styles[${index}].integrity`);
  const crossorigin = crossoriginValue(
    value.crossorigin,
    `criticalAssets.styles[${index}].crossorigin`,
  );
  if (media) attrs.push(`media="${escapeAttr(media)}"`);
  if (type) attrs.push(`type="${escapeAttr(type)}"`);
  if (integrity) attrs.push(`integrity="${escapeAttr(integrity)}"`);
  if (crossorigin) attrs.push(`crossorigin="${escapeAttr(crossorigin)}"`);
  const link = `<link ${attrs.join(' ')} />`;
  if (value.preload === false) return link;
  const preloadAttrs = [`rel="preload"`, `as="style"`, `href="${safeHref}"`];
  if (media) preloadAttrs.push(`media="${escapeAttr(media)}"`);
  if (integrity) preloadAttrs.push(`integrity="${escapeAttr(integrity)}"`);
  if (crossorigin) preloadAttrs.push(`crossorigin="${escapeAttr(crossorigin)}"`);
  return `<link ${preloadAttrs.join(' ')} />\n${link}`;
}

function renderInlineScript(script: unknown, index: number): string {
  const value = typeof script === 'string'
    ? { code: script }
    : asRecord(script, `criticalAssets.inlineScripts[${index}]`);
  const code = stringValue(value.code, `criticalAssets.inlineScripts[${index}].code`);
  assertNoControls(code, `criticalAssets.inlineScripts[${index}].code`);
  const type = optionalString(value.type, `criticalAssets.inlineScripts[${index}].type`);
  // Closing script markup must never terminate the surrounding head element.
  const safeCode = code.replace(/<\/script/gi, '<\\/script');
  return `<script${type ? ` type="${escapeAttr(type)}"` : ''}>${safeCode}</script>`;
}

/**
 * Normalized view over the criticalAssets config record. Item-level
 * validation lives in the render helpers (which accept unknown by design),
 * so array fields stay unknown here; the scalar policy flags are consumed
 * with strict === / !== comparisons. `origin` is narrowed to a string
 * because isCrossOrigin() uses it as a URL base (a non-string origin would
 * fail URL parsing there and be treated as cross-origin, so narrowing it to
 * undefined preserves that outcome).
 */
interface CriticalAssetsView {
  fonts?: unknown;
  styles?: unknown;
  stylesheets?: unknown;
  inlineScripts?: unknown;
  allowExternalRenderBlocking?: unknown;
  allowRenderBlockingExternal?: unknown;
  minifyInlineStyles?: unknown;
  origin?: string;
}

function normalizeConfig(input: unknown): CriticalAssetsView | undefined {
  const options = asRecord(input, 'createOpenPlugin options');
  const candidate = options.criticalAssets ?? options.critical ??
    (typeof options.performance === 'object' && options.performance !== null
      ? (options.performance as RecordLike).criticalAssets
      : undefined);
  if (candidate === undefined) return undefined;
  const record = asRecord(candidate, 'criticalAssets');
  return {
    fonts: record.fonts,
    styles: record.styles,
    stylesheets: record.stylesheets,
    inlineScripts: record.inlineScripts,
    allowExternalRenderBlocking: record.allowExternalRenderBlocking,
    allowRenderBlockingExternal: record.allowRenderBlockingExternal,
    minifyInlineStyles: record.minifyInlineStyles,
    origin: typeof record.origin === 'string' ? record.origin : undefined,
  };
}

/**
 * Serialize critical assets from the complete adapter options object. The
 * result is joined with the validated legacy head extras by plugin.ts.
 */
export function buildCriticalHeadExtras(input: unknown): CriticalAssetsResult {
  const config = normalizeConfig(input);
  if (!config) return { headExtras: undefined, allowHeadExtrasScripts: false };
  const fragments: string[] = [];
  const fonts = arrayValue(config.fonts, 'criticalAssets.fonts');
  for (const [index, font] of fonts.entries()) fragments.push(renderFont(font, index));
  const styles = arrayValue(config.styles ?? config.stylesheets, 'criticalAssets.styles');
  for (const [index, style] of styles.entries()) fragments.push(renderStyle(style, index, config));
  const inlineScripts = arrayValue(config.inlineScripts, 'criticalAssets.inlineScripts');
  for (const [index, script] of inlineScripts.entries()) {
    fragments.push(renderInlineScript(script, index));
  }

  // The opt-in critical policy also diagnoses sync external scripts in the
  // legacy structured inject channel. Existing apps retain their old behavior
  // unless they opt into criticalAssets, keeping this convention incremental.
  const inputRecord = asRecord(input, 'createOpenPlugin options');
  const inject = inputRecord.inject;
  if (inject && typeof inject === 'object') {
    const scripts = (inject as RecordLike).scripts;
    if (
      Array.isArray(scripts) && config.allowExternalRenderBlocking !== true &&
      config.allowRenderBlockingExternal !== true
    ) {
      for (const [index, script] of scripts.entries()) {
        const record = typeof script === 'string'
          ? { src: script }
          : asRecord(script, `inject.scripts[${index}]`);
        const src = stringValue(record.src, `inject.scripts[${index}].src`);
        const asyncValue = record.async === true;
        const deferValue = record.defer === true;
        if (!asyncValue && !deferValue && isCrossOrigin(src, config.origin)) {
          throw new OpenElementError(
            `inject.scripts[${index}] is a cross-origin synchronous script; ` +
              'set defer/async or explicitly allowExternalRenderBlocking:true',
            { code: 'CRITICAL_EXTERNAL_BLOCKING_ASSET', statusCode: 400, recoverable: false },
          );
        }
      }
    }
  }
  return {
    headExtras: fragments.length > 0 ? fragments.join('\n  ') : undefined,
    allowHeadExtrasScripts: fragments.some((fragment) => fragment.startsWith('<script')),
  };
}
