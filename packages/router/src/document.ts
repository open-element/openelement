/**
 * @openelement/router/document - resolved Document seam (#1326).
 *
 * Page meaning is resolved exactly once per render, before the serializer
 * runs: the page descriptor's head — a static object or a resolver function —
 * plus the request-scoped context become a ResolvedDocument: title,
 * description, meta, canonical, alternates/hreflang, locale, the normalized
 * link collection, and the structured-data (JSON-LD) documents the native
 * serializer emits into <head>.
 *
 * Boundaries of this seam:
 * - Pure resolution only. It never fetches, caches, reads a global request,
 *   or schedules loaders, so the same inputs always produce the same document
 *   and no cross-request data can flow through it.
 * - Response plumbing (status, headers, redirects) stays in the loader/action
 *   outcome channel; this module resolves document *meaning* only.
 * - No Vite or build-tool imports. Framework Mode surface: the module's only
 *   dependencies are the router authoring types, the neutral head-safety
 *   predicates, and the neutral client-script loading descriptors
 *   (loading/module/nonce.ts), and those use @openelement/element's
 *   trusted-HTML contract (escape/attribute rules) rather than a second copy
 *   of it. The resolved Document is the contract the serializer consumes.
 */

import type {
  PageHead,
  PageHeadResolver,
  PagePropsContext,
  StructuredDataEntry,
} from './authoring.ts';
import {
  type ClientScriptDescriptor,
  normalizeClientScriptDescriptors,
} from './loading/module/nonce.ts';
import { assertAllowlistedHeadFragment, assertNoScriptTags } from './internal/head-safety.ts';
import { authoringError, DocumentErrorCode } from './internal/error-codes.ts';

export type { ClientScriptDescriptor };

/** One <link rel="alternate"> record, typically carrying an hreflang. */
export interface PageHeadAlternate {
  href: string;
  hreflang?: string;
}

/** A normalized <link> the serializer emits into <head>. */
export interface ResolvedDocumentLink {
  rel: 'canonical' | 'alternate';
  href: string;
  hreflang?: string;
}

/**
 * A page's resolved document meaning: every <head> field after the head
 * resolver (when the descriptor declares one) has run, plus the normalized
 * `links` projection the serializer consumes. Call-site precedence is
 * resolved-document value first, route/build docConfig fallback second.
 */
export interface ResolvedDocument {
  title?: string;
  description?: string;
  meta?: Array<Record<string, string | number | boolean>>;
  /**
   * Structured data (JSON-LD), one serialized `<script type=
   * "application/ld+json">` element per entry. Normalized here to plain JSON
   * data so the serializer only has to escape, never interpret.
   */
  structuredData?: StructuredDataEntry[];
  dangerouslyHeadFragments?: string[];
  /**
   * The framework client scripts this document embeds before `</body>` —
   * structured descriptors rendered by the serializer at document time
   * (#1471), never by post-build HTML surgery. The serializer attaches the
   * per-request CSP nonce; SSG output carries none.
   */
  clientScripts?: ClientScriptDescriptor[];
  /**
   * Document language: the resolved application locale for this render, and
   * ONLY that. It stays undefined on a single-locale site — the seam never
   * defaults it to `'en'` — so the configured document `head.lang` remains
   * the fallback the serializer applies. A project that declared i18n always
   * resolves a locale, and that locale overrides the configured value
   * (the document-language decision record).
   */
  lang?: string;
  canonical?: string;
  alternates?: PageHeadAlternate[];
  /** Canonical first, then alternates in author order — deterministic. */
  links: ResolvedDocumentLink[];
}

function fail(message: string): never {
  throw authoringError(
    DocumentErrorCode.HEAD_INVALID,
    `[openElement] resolvePageDocument: ${message}`,
  );
}

/**
 * Copy one structured-data value into the JSON data model, fail-closed: only
 * strings, finite numbers, booleans, null, arrays and plain objects survive,
 * and the copy owns no prototype. That matters twice over — JSON.stringify
 * silently DROPS function- and undefined-valued properties and turns NaN into
 * `null`, so a permissive pass would ship a different document than the one
 * the page declared; and a null-prototype copy keeps a `__proto__` key inert
 * data instead of a prototype write on the way to the serializer.
 */
function normalizeStructuredDataValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        fail(`${path} must be a finite number; JSON has no NaN or Infinity.`);
      }
      return value;
    case 'object':
      break;
    default:
      fail(
        `${path} must be JSON data (string, number, boolean, null, array, or plain object); ` +
          `got ${typeof value}.`,
      );
  }
  const container = value as object;
  if (ancestors.has(container)) fail(`${path} must not contain a circular reference.`);
  ancestors.add(container);
  try {
    if (Array.isArray(container)) {
      return container.map((entry, index) =>
        normalizeStructuredDataValue(entry, `${path}[${index}]`, ancestors),
      );
    }
    const prototype = Object.getPrototypeOf(container);
    if (prototype !== null && prototype !== Object.prototype) {
      fail(
        `${path} must be a plain object or array; class instances, Date, Map and Set ` +
          'do not survive JSON serialization.',
      );
    }
    const copy: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(container)) {
      copy[key] = normalizeStructuredDataValue(entry, `${path}.${key}`, ancestors);
    }
    return copy;
  } finally {
    ancestors.delete(container);
  }
}

/**
 * Normalize `head.structuredData` into the JSON-LD documents the serializer
 * emits. A string entry is rejected rather than escaped: this channel carries
 * data, and the raw-markup channel (`dangerouslyHeadFragments`) keeps its own,
 * stricter rules.
 */
function normalizeStructuredData(structuredData: unknown): StructuredDataEntry[] {
  if (!Array.isArray(structuredData)) {
    fail('head.structuredData must be an array of JSON-LD documents.');
  }
  return structuredData.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(
        `head.structuredData[${index}] must be a JSON-LD document (a plain object); ` +
          `got ${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}.`,
      );
    }
    return normalizeStructuredDataValue(
      entry,
      `head.structuredData[${index}]`,
      new Set(),
    ) as StructuredDataEntry;
  });
}

/**
 * Resolves the descriptor head into the page's ResolvedDocument. A head may
 * be a static object or a resolver receiving the same request-scoped context
 * the props projector gets; resolver output is validated exactly like a
 * static head so malformed page meaning fails loudly at either build time or
 * request time instead of being silently dropped from the serialized
 * document.
 *
 * `clientScripts` carries the framework's client-script descriptors (the
 * build's client asset manifest — the render wiring hands them in, they are
 * never author head data); they are validated like every other field and
 * become part of the resolved document, so every render channel — the SSG
 * render pass included — serializes the final script tags from one place.
 */
export function resolvePageDocument(
  head: PageHead | PageHeadResolver | undefined,
  context: PagePropsContext,
  clientScripts?: readonly ClientScriptDescriptor[],
): ResolvedDocument {
  const resolved = typeof head === 'function' ? head(context) : head;
  // Only a derived, non-empty i18n locale becomes the document language.
  // An empty string is not a locale, and the absence of one must stay
  // `undefined` rather than a silent 'en' so `head.lang` can win downstream
  // (the document-language decision record).
  const lang =
    typeof context.locale === 'string' && context.locale.length > 0 ? context.locale : undefined;
  const normalizedClientScripts =
    clientScripts === undefined ? undefined : normalizeClientScriptDescriptors(clientScripts, fail);
  if (resolved === undefined) {
    return {
      links: [],
      ...(lang !== undefined ? { lang } : {}),
      ...(normalizedClientScripts !== undefined && normalizedClientScripts.length > 0
        ? { clientScripts: normalizedClientScripts }
        : {}),
    };
  }
  if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
    fail('head must be an object, or a resolver returning one.');
  }
  const {
    title,
    description,
    meta,
    structuredData,
    dangerouslyHeadFragments,
    canonical,
    alternates,
  } = resolved;
  if (title !== undefined && typeof title !== 'string') fail('head.title must be a string.');
  if (description !== undefined && typeof description !== 'string') {
    fail('head.description must be a string.');
  }
  if (meta !== undefined && !Array.isArray(meta)) fail('head.meta must be an array.');
  const normalizedStructuredData =
    structuredData !== undefined ? normalizeStructuredData(structuredData) : undefined;
  if (
    dangerouslyHeadFragments !== undefined &&
    (!Array.isArray(dangerouslyHeadFragments) ||
      dangerouslyHeadFragments.some((fragment) => typeof fragment !== 'string'))
  ) {
    fail('head.dangerouslyHeadFragments must be an array of strings.');
  }
  // Route-resolved fragments are the only raw-head channel reachable from
  // request data (loader output, params, query), so they are held to a whole
  // -fragment allowlist, not just the script/style predicates the config-time
  // channels (headExtras, inject.headFragments — build configuration, not
  // request data) use: only top-level <meta>/<link>/<style> elements plus
  // whitespace may appear, so request data can never close the head early,
  // inject a body, or hijack the document's base URL. The script predicate
  // stays first so the failing author gets its established "use inject.scripts"
  // guidance (and every <script> spelling the regex knows is named as such).
  for (const fragment of dangerouslyHeadFragments ?? []) {
    assertNoScriptTags(fragment, 'head.dangerouslyHeadFragments');
    assertAllowlistedHeadFragment(fragment, 'head.dangerouslyHeadFragments');
  }
  if (canonical !== undefined && typeof canonical !== 'string') {
    fail('head.canonical must be a string.');
  }
  if (alternates !== undefined && !Array.isArray(alternates)) {
    fail('head.alternates must be an array.');
  }
  const normalizedAlternates = alternates?.map((alternate, index) => {
    if (alternate === null || typeof alternate !== 'object' || Array.isArray(alternate)) {
      fail(`head.alternates[${index}] must be an object with an href.`);
    }
    const { href, hreflang } = alternate;
    if (typeof href !== 'string' || href.length === 0) {
      fail(`head.alternates[${index}].href must be a non-empty string.`);
    }
    if (hreflang !== undefined && typeof hreflang !== 'string') {
      fail(`head.alternates[${index}].hreflang must be a string.`);
    }
    const normalized: PageHeadAlternate = { href };
    if (hreflang !== undefined) normalized.hreflang = hreflang;
    return normalized;
  });

  const links: ResolvedDocumentLink[] = [];
  if (canonical !== undefined) links.push({ rel: 'canonical', href: canonical });
  for (const alternate of normalizedAlternates ?? []) {
    links.push({
      rel: 'alternate',
      href: alternate.href,
      ...(alternate.hreflang !== undefined ? { hreflang: alternate.hreflang } : {}),
    });
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(normalizedStructuredData !== undefined && normalizedStructuredData.length > 0
      ? { structuredData: normalizedStructuredData }
      : {}),
    ...(dangerouslyHeadFragments !== undefined ? { dangerouslyHeadFragments } : {}),
    ...(normalizedClientScripts !== undefined && normalizedClientScripts.length > 0
      ? { clientScripts: normalizedClientScripts }
      : {}),
    ...(lang !== undefined ? { lang } : {}),
    ...(canonical !== undefined ? { canonical } : {}),
    ...(normalizedAlternates !== undefined ? { alternates: normalizedAlternates } : {}),
    links,
  };
}
