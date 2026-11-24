/**
 * Tracked props: the replaceable backing record behind per-read props getters
 * (JSX model §4.2a/§4.3, TSX-04/TSX-28).
 *
 * The approved owner ruling is that **props getters evaluate per read**: every
 * read of a props getter runs the getter body again in the reading context,
 * with no per-update-tick value cache and no de-duplication across bindings.
 * Most getters are compiler-emitted JavaScript (`get step() { return
 * step.value; }`) and need no runtime helper at all — the closure already reads
 * the defining scope every time.
 *
 * What keyed reuse adds is the one thing plain getters cannot express: the
 * value behind a prop must be replaceable WITHOUT recreating the props record,
 * the instance or the DOM (the invariant the Part Program list already enforces
 * through `itemBox`, blocks.ts:204-224). {@linkcode createTrackedProps} is that
 * mechanism one level up:
 *
 * - the props record has ONE stable identity for the instance's lifetime;
 * - each getter reads the current backing value on every read (per-read rule);
 * - {@linkcode TrackedProps.replace} swaps the whole backing record in one
 *   write, so existing effects re-run and event handlers that read the prop at
 *   dispatch time see the new value — never a stale capture;
 * - tracking granularity is one version signal per props record (the coarse
 *   option §4.3 recommends starting with). This is an invalidation-channel
 *   choice only: no read is cached, so the observable evaluation contract is
 *   unchanged.
 *
 * The props shape is the compile-time known prop set: getters are defined for
 * the keys present at creation and replacement must carry the same shape.
 *
 * @module ./props.ts
 */

import { signal } from '../../signal/framework.ts';
import type { WritableSignal } from '../../signal/types.ts';

/**
 * The replaceable props of one component instance.
 *
 * `props` is the record the generated mount reads; its identity never changes.
 * `replace` swaps the backing values without touching that identity.
 */
export interface TrackedProps<T extends object> {
  /** The stable per-instance props record (read-only). */
  readonly props: Readonly<T>;
  /**
   * The ONE invalidation channel for this record (ADR-0183 D-2/D-5): every
   * getter read and every write in this module goes through this one signal.
   * A second channel for the same record (a counter beside it, a manual dirty
   * flag, a hand-rolled listener) is a defect against that record.
   */
  readonly version: WritableSignal<number>;
  /** Replace the backing values; the getter record identity, effects and DOM stay. */
  replace(next: T): void;
  /**
   * Per-key write: the element-shell path (`el.prop = x`, attribute replay,
   * pre-upgrade reconciliation) writes ONE declared row at a time, which a
   * whole-record `replace` cannot express without copying the record.
   * Returns whether the value changed (an equal write notifies nobody).
   */
  set<K extends keyof T & string>(name: K, value: T[K]): boolean;
  /**
   * Untracked internal read for the owner's own bookkeeping (attribute mirror,
   * form sync, property-change event payload). The author-facing record getter
   * is the tracked path; this one deliberately registers no dependency.
   */
  read<K extends keyof T & string>(name: K): T[K];
}

/**
 * Build one instance's replaceable props from its initial backing values.
 *
 * The returned getters are plain accessors over one version signal: a read
 * performed inside an effect tracks that signal, so a replacement invalidates
 * exactly the bindings that read a prop — and every read still evaluates the
 * getter, as the approved per-read contract requires.
 */
export function createTrackedProps<T extends object>(initial: T): TrackedProps<T> {
  let backing: T = initial;
  // A monotonic version signal rather than a signal OF the record: writing one
  // key must not copy the whole record, and every reader only needs "did
  // anything change". Reads through the getters below register this signal, so
  // an effect (and therefore a `computed`) is invalidated by exactly the writes
  // that changed a value; an equal write bumps nothing.
  const version = signal(0);
  const props = {} as Record<string, unknown>;
  for (const key of Object.keys(initial)) {
    Object.defineProperty(props, key, {
      enumerable: true,
      configurable: false,
      get: () => {
        // The tracked read: `version` is read BEFORE the value so a dependency
        // is registered even for a value that happens to be `undefined`.
        version.value;
        return backing[key as keyof T];
      },
    });
  }
  Object.freeze(props);
  const record: TrackedProps<T> = {
    props: props as Readonly<T>,
    version,
    replace(next: T): void {
      backing = next;
      version.value += 1;
    },
    set<K extends keyof T & string>(name: K, value: T[K]): boolean {
      if (Object.is(backing[name], value)) return false;
      backing[name] = value;
      version.value += 1;
      return true;
    },
    read<K extends keyof T & string>(name: K): T[K] {
      return backing[name];
    },
  };
  return Object.freeze(record);
}
