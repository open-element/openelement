/**
 * Host attributes owned by generated SSR, claim and the theme broadcaster.
 * Nested claim may ignore these names on a child host. An explicitly authored
 * attribute still participates in the static seed check.
 */

import { DATA_OE_LIGHT } from '@openelement/protocol/part-program';
// The broadcast attribute's single writer names it; this leaf only classifies.
import { THEME_ATTRIBUTE } from '../../../open-element-theme.ts';

/**
 * The host attribute carrying the JSON seed for declared rows with NO attribute
 * wire: the non-primitive `array`/`object` rows (ADR-0182 D-18c / M11-3) and,
 * since the 2026-11-23 ADR-0181 A5 amendment, the property-only primitives
 * (`attribute: null`). A row in that family has no attribute name to carry it,
 * so before this channel the server rendered a value while the claim re-read the
 * declared default — the content a visitor saw and the state the component
 * upgraded into were different facts (for a page root, the claim silently wiped
 * the SSR content).
 *
 * Shape: `{"<rowName>": <json value>, …}`. Only JSON-encodable rows are
 * carried; `trustedHtml` is excluded on purpose (a brand cannot be
 * reconstructed from JSON, and promoting a plain string back to it would be a
 * raw-markup channel — D-18c records that as a separate decision). An
 * ATTRIBUTE-BACKED primitive is excluded too: its declared attribute pair
 * already is the SSR→claim wire, and one row must not ride two wires.
 *
 * The shell parses the payload, validates every name against the descriptor's
 * JSON-seedable rows, and writes the values BEFORE setup. An unparseable
 * payload or an unknown row fails closed with the shell's seed-mismatch
 * identity rather than silently keeping the default.
 */
export const GENERATED_PROP_SEED = 'data-oe-prop-seed';

/**
 * SSR marker that caller-owned children were projected into a generated light
 * root's slot anchors. The generated parent and child cannot both claim that
 * region under the current ownership contract, so either upgrade fails closed.
 */
export const DATA_OE_LIGHT_PROJECTION = 'data-oe-light-projected';

/**
 * The runtime-only host attributes as one owner fact. Members are the WRITERS'
 * own constants, never restated literals:
 *
 * - `DATA_OE_LIGHT` — the server serializer's light-root ownership marker
 *   (protocol/part-program), written by the DSD producer and the light host
 *   writer;
 * - `THEME_ATTRIBUTE` — the document-theme broadcaster mirrors it on every
 *   connected compiled host at that host's own connect;
 * - `GENERATED_PROP_SEED` — the JSON seed the shell's host seeder writes and
 *   its claim removes.
 * - `DATA_OE_LIGHT_PROJECTION` — the SSR renderer marks a generated light host
 *   whose slot anchors received caller-owned children; both claim sides guard
 *   this unsupported cross-owner shape.
 *
 * The shell, SSR writers and theme broadcaster own these; the compiled
 * hydration executor derives its exemption from this set. A writer that adds an attribute here
 * and a hydrator that consumes it are updated together because there is only
 * one list.
 */
export const GENERATED_RUNTIME_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set([
  DATA_OE_LIGHT,
  THEME_ATTRIBUTE,
  GENERATED_PROP_SEED,
  DATA_OE_LIGHT_PROJECTION,
]);
