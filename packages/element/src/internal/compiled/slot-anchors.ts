/**
 * slot-anchors.ts — substitute caller projections into a generated LIGHT-root
 * producer's `<slot>` regions.
 *
 * A light root's children ARE its region: it has no shadow boundary, so the
 * platform distributes nothing and the caller's children must be written into
 * the producer's own `<slot>` elements. The producer is a finished STRING, so
 * the only way to find a slot without pattern-matching markup is a marker the
 * producer itself wrote. That marker is the slot-anchor pair from
 * `./runtime/markers.ts` (`oe:s:<ordinal>:<hex-name>` / `oe:/s:…`), emitted
 * INSIDE the slot element so the element's own attribute spelling never has to
 * be parsed.
 *
 * This module therefore reads COMMENT TOKENS only:
 *
 * - `<!--` … `-->` pairs are located by their own delimiters;
 * - a comment whose text parses as a slot anchor is a region boundary;
 * - every other comment (a range / `when` / `each` / text-slot marker) belongs
 *   to a different consumer and is skipped, never rewritten;
 * - element markup is copied verbatim, including the `<slot …>` start tag.
 *
 * No second marker table and no second escaper live here: the spelling comes
 * from `slotAnchorMarker`/`parseSlotAnchorMarker`, and the caller has already
 * escaped the bytes it hands in (they are `trustedHtml`).
 *
 * Failure modes are deliberate and closed: a dangling start anchor, an end that
 * does not close the innermost open anchor, or a projection naming a slot the
 * content never declared all refuse instead of emitting half-substituted
 * markup — a wrong substitution silently lands the caller's children in the
 * wrong element, which no later stage can notice.
 *
 * @module ./slot-anchors.ts
 */

import { markerText, parseSlotAnchorMarker, slotAnchorMarker } from './runtime/markers.ts';
/**
 * The opening bytes of a slot-anchor comment, derived from the marker module's
 * own writers instead of restated: `slotAnchorMarker(0, '')` spells
 * `oe:s:0:`, so dropping the trailing `<ordinal>:` leaves exactly the family
 * prefix the scan looks for. A new family spelling can therefore never leave
 * this file looking for the old one.
 */
const EMPTY_NAME_ANCHOR = markerText(slotAnchorMarker(0, ''));
const ANCHOR_PREFIX = EMPTY_NAME_ANCHOR.slice(0, EMPTY_NAME_ANCHOR.indexOf('0'));

/** `<!--oe:s:` — the cheapest possible "does this content carry an anchor?". */
const ANCHOR_OPEN = `<!--${ANCHOR_PREFIX}`;

/**
 * One substitution refusal. The identity is the caller's to choose: this module
 * reports `{ path, message }` and the serializer wraps it in the existing
 * compiled-validation error, so neither layer invents a second error class.
 */
export interface SlotProjectionFailure {
  readonly path: 'projectedChildren' | 'content';
  readonly message: string;
}

/**
 * `true` when the content carries at least one slot-anchor comment. The
 * cheapest form of the question the substitution asks before it walks.
 */
function contentDeclaresAnySlotAnchor(content: string): boolean {
  return content.includes(ANCHOR_OPEN);
}

/** One accepted substitution, keyed by the slot name the anchor carried. */
export type SlotProjections = ReadonlyMap<string, string>;

export interface SlotSubstitutionResult {
  readonly html: string;
  /** The projection names this content actually consumed, once each. */
  readonly consumed: ReadonlySet<string>;
}

/**
 * Substitute every projection into its anchored region and strip the anchors
 * themselves.
 *
 * The anchor pair is this lane's PRIVATE locator: it must never reach the
 * document, whether or not a projection was supplied. A slot with no projection
 * keeps its own fallback bytes, so the emitted HTML is exactly what the authored
 * tree says:
 *
 * ```
 * <slot name="x"><!--oe:s:0:78--><!--oe:/s:0:78--></slot>   producer bytes
 * <slot name="x"></slot>                                    no projection
 * <slot name="x"><b>caller</b></slot>                       projected
 * ```
 *
 * `null`/empty projections therefore still cost one scan, and the returned
 * `html` is byte-identical to the input whenever the producer wrote no anchor
 * at all (a slotless component, a shadow producer) — the byte-identity case.
 * A projection supplied to content that declares no anchor is a failure: the
 * caller's children have nowhere to go, and silently dropping them would render
 * a component that looks correct but lost its content.
 */
export function substituteSlotAnchors(
  content: string,
  projections: SlotProjections | undefined,
): SlotSubstitutionResult | SlotProjectionFailure {
  const supplied = projections !== undefined && projections.size > 0 ? projections : null;
  if (!contentDeclaresAnySlotAnchor(content)) {
    // No anchor in the content. With nothing to place the bytes are already
    // final (byte identity); with a projection the caller's children have
    // nowhere to go, so refuse instead of rendering a component that silently
    // lost its content.
    if (supplied === null) return { html: content, consumed: new Set<string>() };
    return {
      path: 'projectedChildren',
      message: `light content targets missing slot ${JSON.stringify(slotLabel(firstName(supplied)))}`,
    };
  }
  const placed = supplied ?? new Map<string, string>();
  /**
   * Accumulated output chunks. An open region's chunks are everything pushed
   * after its recorded `mark`; on the closing anchor they are taken back out
   * (via `splice`) so a nested region's own substitution survives inside its
   * enclosing region's replacement.
   */
  const output: string[] = [];
  /** Open anchors, innermost last. */
  const open: Array<{ ordinal: number; name: string; mark: number }> = [];
  const consumed = new Set<string>();
  let cursor = 0;
  for (;;) {
    const openAt = content.indexOf('<!--', cursor);
    if (openAt < 0) break;
    const closeAt = content.indexOf('-->', openAt + 4);
    // An unterminated comment cannot contain a complete anchor; a dangling
    // START anchor is reported by the open-stack check below.
    if (closeAt < 0) break;
    output.push(content.slice(cursor, openAt));
    const token = content.slice(openAt, closeAt + 3);
    const anchor = parseSlotAnchorMarker(content.slice(openAt + 4, closeAt));
    if (anchor === null) {
      // A foreign marker: another consumer's locator, copied through untouched.
      output.push(token);
      cursor = closeAt + 3;
      continue;
    }
    if (!anchor.end) {
      open.push({ ordinal: anchor.ordinal, name: anchor.name, mark: output.length });
      cursor = closeAt + 3;
      continue;
    }
    const innermost = open[open.length - 1];
    if (innermost === undefined || innermost.ordinal !== anchor.ordinal) {
      return {
        path: 'content',
        message:
          `slot anchor end ${anchor.ordinal} does not close the innermost open anchor ` +
          `(${innermost === undefined ? 'none' : String(innermost.ordinal)})`,
      };
    }
    open.pop();
    // The region's bytes are everything accumulated after its mark, with any
    // nested region already substituted.
    const fallback = output.splice(innermost.mark).join('');
    // The projection replaces the anchor PAIR AND the fallback: the markers are
    // this lane's private locator and must not reach the document. Without a
    // projection the FALLBACK survives byte-for-byte, which is what the producer
    // wrote between the pair.
    output.push(placed.has(innermost.name) ? placed.get(innermost.name)! : fallback);
    consumed.add(innermost.name);
    cursor = closeAt + 3;
  }
  output.push(content.slice(cursor));
  const dangling = open[open.length - 1];
  if (dangling !== undefined) {
    return {
      path: 'content',
      message: `slot anchor ${dangling.ordinal} has no closing marker`,
    };
  }
  for (const name of placed.keys()) {
    if (consumed.has(name)) continue;
    return {
      path: 'projectedChildren',
      message: `light content targets missing slot ${JSON.stringify(slotLabel(name))}`,
    };
  }
  return { html: output.join(''), consumed };
}

/** `''` is the default slot; every diagnostic spells it the way a caller reads it. */
function slotLabel(name: string): string {
  return name === '' ? 'default' : name;
}

function firstName(projections: SlotProjections): string {
  for (const name of projections.keys()) return name;
  return '';
}
