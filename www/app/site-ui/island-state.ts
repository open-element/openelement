const stores = new WeakMap<object, Map<string, unknown>>();

export function readIslandState<T>(host: object, key: string, init: () => T): T {
  let store = stores.get(host);
  if (!store) {
    store = new Map();
    stores.set(host, store);
  }
  if (!store.has(key)) store.set(key, init());
  return store.get(key) as T;
}

export function writeIslandState(host: object, key: string, value: unknown): void {
  let store = stores.get(host);
  if (!store) {
    store = new Map();
    stores.set(host, store);
  }
  store.set(key, value);
}
