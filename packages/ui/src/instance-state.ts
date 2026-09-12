/**
 * Per-instance mutable state for the compiled UI primitives.
 *
 * Compiled classes carry only @property fields and methods — ephemeral
 * imperative state (highlight bookkeeping, pointer guards, effect teardown)
 * lives here, in a plain module, keyed by host. This mirrors the fixture
 * pattern (packages/adapter-vite request-time zag-combobox-shared.ts): the
 * compiled kernel owns the program sinks; everything else is host-scoped and
 * garbage-collected with it.
 */

const stores = new WeakMap<object, Map<string, unknown>>();

/** Read the host's `key` slot, initializing it with `init()` on first use. */
export function readInstanceState<T>(host: object, key: string, init: () => T): T {
  let store = stores.get(host);
  if (!store) {
    store = new Map();
    stores.set(host, store);
  }
  if (!store.has(key)) store.set(key, init());
  return store.get(key) as T;
}

/** Overwrite the host's `key` slot. */
export function writeInstanceState(host: object, key: string, value: unknown): void {
  let store = stores.get(host);
  if (!store) {
    store = new Map();
    stores.set(host, store);
  }
  store.set(key, value);
}
