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

/**
 * One keyed each item cannot participate in keyed identity: the item is not
 * a record, or its key value cannot round-trip (object, function, symbol).
 * `reason` is the bare tail so each executor can frame it with its own
 * error vocabulary.
 */
export class EachKeyError extends Error {
  readonly reason: string;

  constructor(partIndex: number, reason: string) {
    super(`[compiled-runtime] each part ${partIndex} ${reason}`);
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
    throw new EachKeyError(part.index, 'keyed items must be records');
  }
  const value = (item as Record<string, unknown>)[part.key];
  if (
    (value !== null && typeof value === 'object') || typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new EachKeyError(part.index, 'keys must be serializable values');
  }
  return `${typeof value}:${String(value)}`;
}
