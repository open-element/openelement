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

/**
 * The replaceable props of one component instance.
 *
 * `props` is the record the generated mount reads; its identity never changes.
 * `replace` swaps the backing values without touching that identity.
 */
export interface TrackedProps<T extends object> {
  /** The stable per-instance props record (read-only). */
  readonly props: Readonly<T>;
  /** Replace the backing values; the getter record identity, effects and DOM stay. */
  replace(next: T): void;
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
  const version = signal(initial);
  const props = {} as Record<string, unknown>;
  for (const key of Object.keys(initial)) {
    Object.defineProperty(props, key, {
      enumerable: true,
      configurable: false,
      get: () => version.value[key as keyof T],
    });
  }
  Object.freeze(props);
  const record: TrackedProps<T> = {
    props: props as Readonly<T>,
    replace(next: T): void {
      version.value = next;
    },
  };
  return Object.freeze(record);
}
