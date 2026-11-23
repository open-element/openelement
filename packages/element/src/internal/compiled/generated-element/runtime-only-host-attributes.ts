/**
 * The runtime-only host attributes the compiled element runtime writes on a
 * host tag AFTER (or independently of) server serialization — the ONE fact
 * (P6/P8) shared by the generated-element shell's writers and the compiled
 * runtime's hydration executor.
 *
 * WHY A SEPARATE LEAF: two consumers need exactly these names and neither may
 * import the other.
 *
 * - The generated-element shell WRITES them: its host seeder writes the JSON
 *   prop seed, the DSD producer marks light roots, and the document-theme
 *   broadcaster mirrors the broadcast attribute on every connected host.
 * - `internal/compiled/runtime/hydrate.ts` must EXEMPT them from its
 *   "unexpected attribute" drift check: a class-lane parent can claim a nested
 *   host that the runtime already touched (a seeded generated child island, a
 *   theme-mirrored custom element), and those attributes are runtime-managed
 *   state, not server drift.
 *
 * Hydration cannot import the shell (the shell's module graph captures
 * `HTMLElement` at `open-element-base.ts` evaluation, so the compiled runtime
 * barrel would stop being safely importable before a DOM harness exists — the
 * existing `compiled-hydration/*` consumer-form tests pin that), and the
 * generated lane must never pull the executor in the other direction. A third
 * hand-written list in hydration is exactly the C-1 defect: the JSON prop seed
 * was written on nested generated hosts but missing from the claim's
 * exemption, so the parent's claim failed with `unexpected attribute`. The
 * names therefore live here, import-only:
 *
 * - zero DOM and no import of the shell or the runtime barrel (this leaf may
 *   be imported by both sides without evaluating either side);
 * - not a package export subpath and not re-exported from any barrel, so it
 *   never appears in the public interface snapshot.
 *
 * A name here is exempted only on a CUSTOM-ELEMENT host: every writer targets
 * a compiled/generated host, so the same name on a plain element stays genuine
 * drift. `data-oe-static-styles` is NOT a member: it rides the DSD template's
 * `<style>`/`<link>` nodes, never a host tag.
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
 *
 * The generated-element shell writes these; the compiled hydration executor
 * derives its exemption from this set. A writer that adds an attribute here
 * and a hydrator that consumes it are updated together because there is only
 * one list.
 */
export const GENERATED_RUNTIME_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set([
  DATA_OE_LIGHT,
  THEME_ATTRIBUTE,
  GENERATED_PROP_SEED,
]);
