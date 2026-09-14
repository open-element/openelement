/**
 * Minimal standard-mechanism replacement for Node's EventEmitter in the dev
 * rescan tests (section 17 rule 2: Deno-run tests use EventTarget or a
 * minimal standard mechanism, never `node:events`). It covers exactly the
 * Vite FSWatcher surface the core plugin touches: `on`/`off` for
 * `add`/`change`/`unlink`, `add`, and a test-only `emit`.
 */
export class TestFileWatcher {
  #handlers = new Map<string, Set<(path: string) => void>>();

  add(_path: string): void {}

  on(event: string, handler: (path: string) => void): void {
    const handlers = this.#handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(event, handlers);
  }

  off(event: string, handler: (path: string) => void): void {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event: string, path: string): void {
    for (const handler of [...this.#handlers.get(event) ?? []]) handler(path);
  }
}
