/**
 * Canonical each-Region item-key derivation (issue #1374, P6).
 *
 * The server serializer's duplicate detection and the client runtime's
 * keyed-reuse maps must derive the identical key from the identical item —
 * two derivations of one truth failed exactly here: `String()` collapsed
 * number 1 and string "1" into one server-side key the typed client kept
 * distinct, so SSR refused data the runtime accepts. This module is the
 * single source both executors import. Keys carry the value's `typeof` tag,
 * and values that cannot round-trip (objects, functions, symbols) are
 * rejected here rather than collapsing into `String()`.
 */

import type { ProgramEachPart } from '../protocol/part-program.ts';
import { EachKeyErrorCode, OpenElementError } from '../protocol/errors.ts';

/**
 * One keyed each item cannot participate in keyed identity: the item is not
 * a record, or its key value cannot round-trip (object, function, symbol).
 * `reason` is the authored explanation — no part index or runtime internal —
 * so each executor frames it for the reader without translating again.
 *
 * Part of the single error dialect (#1386 item 3): an `OpenElementError` with
 * the caller's `EachKeyErrorCode`, so a consumer catches keyed-identity
 * failures by code instead of by class or message text.
 */
export class EachKeyError extends OpenElementError {
  readonly reason: string;

  constructor(partIndex: number, code: string, reason: string) {
    super(`${reason} (list Region ${partIndex})`, {
      code,
      severity: 'error',
      phase: 'validation',
      recoverable: false,
    });
    this.name = 'EachKeyError';
    this.reason = reason;
  }
}

/**
 * Derive one keyed each item's identity string: `` `${typeof}:${String}` ``.
 * Both executors must consult this function and no other, so server-side
 * duplicate detection and client-side reuse decisions cannot drift.
 */
export function eachItemKey(part: ProgramEachPart, item: unknown): string {
  if (typeof item !== 'object' || item === null) {
    throw new EachKeyError(
      part.index,
      EachKeyErrorCode.ITEM_NOT_A_RECORD,
      `every item in a keyed list must be an object carrying ${JSON.stringify(part.key)}`,
    );
  }
  const value = (item as Record<string, unknown>)[part.key];
  if (
    (value !== null && typeof value === 'object') || typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new EachKeyError(
      part.index,
      EachKeyErrorCode.KEY_NOT_ROUND_TRIPPABLE,
      `the list key field ${JSON.stringify(part.key)} must be a string, number, boolean or null ` +
        `— objects, functions and symbols have no stable identity across renders`,
    );
  }
  return `${typeof value}:${String(value)}`;
}
