/**
 * signal.ts - Signal contracts.
 *
 * Minimal signal protocol types shared across openElement packages.
 */

/** Unsubscribe function returned by subscriptions and effects. */
export type Unsubscribe = () => void;

/** Runtime/type brand for signals created by the configured reactive engine. */
export const SIGNAL_BRAND: unique symbol = Symbol('openElement.signal');

/** Minimal signal-like object accepted by renderers and bindings. */
export interface SignalLike<T = unknown> {
  readonly [SIGNAL_BRAND]: true;
  readonly value: T;
  subscribe(fn: (value: T) => void): Unsubscribe;
}

/** Writable signal protocol used by openElement integrations. */
export interface WritableSignal<T> extends SignalLike<T> {
  value: T;
}

/** Read-only signal protocol used by computed values. */
export interface ReadonlySignal<T> extends SignalLike<T> {
  readonly value: T;
}

/** Alias for APIs that accept either writable or read-only signals. */
export type Signal<T> = WritableSignal<T> | ReadonlySignal<T>;

/**
 * Signal engine protocol used by the framework's built-in adapter.
 *
 * This is a deliberate internal seam, not a public compatibility contract:
 * the framework layer talks to signals only through this narrow interface so
 * its call sites stay implementation-agnostic.
 *
 * 1.0.0-alpha.1 ships and verifies exactly one engine implementation
 * (`preact-engine`, backed by `@preact/signals-core`). Preact's own API is not
 * Element public API, and arbitrary third-party engines are not promised;
 * any future engine would be added behind this protocol rather than inline
 * (charter decision — see #723).
 */
export interface SignalEngine {
  signal<T>(initialValue: T): WritableSignal<T>;
  computed<T>(fn: () => T): ReadonlySignal<T>;
  effect(fn: () => void | Unsubscribe): Unsubscribe;
}
