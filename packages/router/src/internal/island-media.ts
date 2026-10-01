/**
 * island-media.ts — the shared admission bound for island media queries.
 *
 * Two real ingestion paths validate the same value and stay separate by
 * design (authoring-time `defineIslandConfig()` with IslandErrorCode in
 * authoring.ts; build-time generated-artifact intake with DeliveryErrorCode
 * in vite/internal/ssg/delivery.ts). This module is the single source for
 * what those validators agree on: the length bound and the combined
 * bound-plus-control-characters predicate, so the two paths cannot drift.
 */

import { hasControlCharacter } from './control-characters.ts';

/**
 * Maximum accepted length of an island media query, measured after
 * trimming. Media queries are data in generated artifacts (quoted as
 * JavaScript literals and handed to `matchMedia`), never executable
 * source; the bound keeps an accidental or hostile value from inflating
 * every artifact that embeds it.
 */
export const ISLAND_MEDIA_QUERY_MAX_LENGTH = 512;

/**
 * Whether {@linkcode media} exceeds the island media-query bound or
 * carries a control character. The length is checked first so an oversized
 * value never pays for the character scan.
 */
export function isInvalidIslandMedia(media: string): boolean {
  return media.length > ISLAND_MEDIA_QUERY_MAX_LENGTH || hasControlCharacter(media);
}
