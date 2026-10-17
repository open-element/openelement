/**
 * Canonical stylesheet resource identity (alpha15 S lane, S-C1.1).
 *
 * ONE semantic owner for the question "is the stylesheet link I observed the
 * resource the framework delivered?" — asked by Strict Claim about a marked
 * DSD link, whose DOM node is untrusted input, and answered exclusively from
 * the expected resources the build recorded on the sheet objects.
 *
 * Identity is the FULL canonical URL: origin + pathname + search.
 *
 *   - A site-owned expectation is recorded as a site path (`/client/assets/x.css`).
 *     Resolving it against the document base gives the deployment's own origin,
 *     so the server-rendered path matches the client's bundler-resolved,
 *     origin-absolute URL on the real site — and never matches a different
 *     origin, even when that origin serves the same path and query.
 *   - A trusted cross-origin expectation (a CDN or second host declared by the
 *     build) is recorded as an absolute URL and must match in full, including
 *     origin. Trust comes from the metadata, never from the observed link.
 *   - Query and version suffixes are part of the identity: two versions of one
 *     asset are two resources and never collapse into one.
 *   - A malformed URL has no canonical form; it keeps its raw text as its own
 *     identity, so it can only ever match an identical raw string — never a
 *     valid resource.
 *
 * The comparison is deliberately not a "looks like a URL" check: syntax alone
 * never earns acceptance.
 */

/** The document context an expected or observed URL is resolved against. */
export interface StyleResourceBase {
  /** The document's base URI (typically `document.baseURI`). */
  readonly baseURI: string;
}

/**
 * One resource's canonical identity: origin + pathname + search, resolved
 * against the document base. Unparseable input keeps its raw text.
 */
export function styleResourceIdentity(url: string, base: StyleResourceBase): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  try {
    const parsed = new URL(trimmed, base.baseURI);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/**
 * True when an observed href names one of the expected resources. An empty
 * expected list is "no fact was supplied" and reports false, so a caller that
 * has no expectation must decide explicitly instead of inheriting acceptance.
 */
export function isExpectedStyleResource(
  observedHref: string,
  expected: readonly string[],
  base: StyleResourceBase,
): boolean {
  if (expected.length === 0) return false;
  const identity = styleResourceIdentity(observedHref, base);
  if (identity === '') return false;
  for (const candidate of expected) {
    if (styleResourceIdentity(candidate, base) === identity) return true;
  }
  return false;
}
