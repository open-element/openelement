/**
 * island-style-specifiers.ts — the one admission rule for the generated-island
 * `styles` declaration (`IslandConfig.styles`, GH issue #1800).
 *
 * `styles` names the authored `.css` files a generated-element (function) island
 * needs. This module is the ONE accepted-shape rule; the delivery is one per
 * root/delivery shape and all of it rides the EXISTING style plan:
 *
 * - the island scan records the declaration, and the client build's style-edge
 *   discovery registers it in the same compiler registry the class lane's
 *   `static styles` imports ride, so the sheet is emitted as the same
 *   content-addressed client asset and recorded in the client asset manifest
 *   (`styles`);
 * - an SSR/DSD shadow island declares the sheet as the canonical marked
 *   `<link>` inside its template (M09-2e / #1803);
 * - a light-root island's sheet is delivered to the document (the render's
 *   document sink / the head `<link>`);
 * - a CLIENT-ONLY island (`ssr: false` or `hydrate: 'only'`) has no template
 *   and no server render, so the compiler emits a real module-graph import of
 *   the same sheet and the generated shell adopts the resulting sheet object
 *   into the root it creates (2026-11-20).
 *
 * Two real ingestion paths validate the same value and stay separate by design
 * (the authoring-time `defineIslandConfig()` with `IslandErrorCode` in
 * `authoring.ts`, and the build-time static island scan with its coded metadata
 * refusal in `vite/internal/ssg/island-scanner.ts`). This module is the single
 * source for the accepted SHAPE both readers agree on, so the runtime descriptor
 * and the static sidecar can never admit different specifiers (P8).
 *
 * The shape is intentionally narrow: a relative specifier (`.css` extension, no
 * query/fragment, no backslashes, no whitespace, no control characters, bounded
 * length) resolved by the build against the island module. A bare package
 * specifier or an absolute/URL path is refused — the class lane's sheet-import
 * grammar refuses the same forms for the same reason (one style channel, one
 * specifier grammar).
 */

import { hasControlCharacter } from './control-characters.ts';

/**
 * Maximum accepted length of one island style specifier. Specifiers are data in
 * generated artifacts and build diagnostics, never executable source; the bound
 * keeps an accidental or hostile value from inflating every artifact and log
 * line that embeds it.
 */
export const ISLAND_STYLE_SPECIFIER_MAX_LENGTH = 256;

/**
 * Maximum number of declared style sheets for one island. The class lane's
 * `static styles` array has no enforced count, but this list rides the build's
 * style-edge plan and its emitted-asset budget, so an accidental duplicate-heavy
 * or runaway list must not become an unbounded edge set.
 */
export const ISLAND_STYLES_MAX_ENTRIES = 16;

/** One admitted specifier, or the reason the value is refused. */
export type IslandStyleSpecifierCheck =
  | { readonly ok: true; readonly style: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Admit one `IslandConfig.styles` entry.
 *
 * The checks are ordered so the cheapest and most common authoring mistake is
 * reported first, and every reason is a complete sentence fragment the caller
 * can drop into its coded error message ("styles entry 0 …").
 */
export function checkIslandStyleSpecifier(value: unknown): IslandStyleSpecifierCheck {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'must be a string naming a relative .css file' };
  }
  if (value === '') {
    return { ok: false, reason: 'must not be empty' };
  }
  if (value.length > ISLAND_STYLE_SPECIFIER_MAX_LENGTH) {
    return {
      ok: false,
      reason: `must stay under ${ISLAND_STYLE_SPECIFIER_MAX_LENGTH} characters`,
    };
  }
  if (hasControlCharacter(value)) {
    return { ok: false, reason: 'must not contain control characters' };
  }
  if (value !== value.trim()) {
    return { ok: false, reason: 'must not carry leading or trailing whitespace' };
  }
  if (value.includes('\\')) {
    return { ok: false, reason: 'must use "/" path separators' };
  }
  if (!value.startsWith('./') && !value.startsWith('../')) {
    return {
      ok: false,
      reason:
        "must be a relative specifier ('./island.css' or '../shared/island.css'); a bare " +
        'package specifier or an absolute path does not resolve against the island module',
    };
  }
  if (value.includes('?') || value.includes('#')) {
    return { ok: false, reason: 'must not carry a query or fragment' };
  }
  if (value.includes('//')) {
    return { ok: false, reason: 'must not contain an empty path segment' };
  }
  // `:` would make the value a scheme URL on one platform family and a
  // drive-letter path on another; neither has a build-graph identity here.
  if (value.includes(':')) {
    return { ok: false, reason: 'must not be a URL or an absolute path' };
  }
  if (/\s/.test(value)) {
    return { ok: false, reason: 'must not contain whitespace' };
  }
  if (!value.endsWith('.css')) {
    return { ok: false, reason: "must name a '.css' file" };
  }
  return { ok: true, style: value };
}

/** One admitted ordered list of specifiers, or the reason the list is refused. */
export type IslandStyleListCheck =
  | { readonly ok: true; readonly styles: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Admit the whole `IslandConfig.styles` list: a non-empty, bounded, duplicate-
 * free array of admitted specifiers in authored order.
 *
 * A duplicate entry is refused rather than collapsed: the list is the authored
 * statement of which sheets the island needs, and a repeated entry is far more
 * likely a copy/paste mistake than a request for two references to one sheet
 * (the style-edge registry would key both onto one resource anyway).
 */
export function checkIslandStyleList(value: unknown): IslandStyleListCheck {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      reason: 'must be an array of relative .css specifiers (styles: ["./island.css"])',
    };
  }
  if (value.length === 0) {
    return { ok: false, reason: 'must not be empty; omit the field for an unstyled island' };
  }
  if (value.length > ISLAND_STYLES_MAX_ENTRIES) {
    return {
      ok: false,
      reason: `must declare at most ${ISLAND_STYLES_MAX_ENTRIES} sheets`,
    };
  }
  const styles: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const check = checkIslandStyleSpecifier(entry);
    if (!check.ok) {
      return { ok: false, reason: `entry ${index} ${check.reason}` };
    }
    if (seen.has(check.style)) {
      return { ok: false, reason: `entry ${index} repeats "${check.style}"` };
    }
    seen.add(check.style);
    styles.push(check.style);
  }
  return { ok: true, styles };
}
