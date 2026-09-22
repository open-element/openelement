/**
 * logger.ts - Tagged console logger.
 *
 * Lightweight scoped logger. Returns plain functions so it is tree-shakable
 * and has zero class overhead.
 *
 * @module ./logger.ts
 */

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/** Create a {@link Logger} that prefixes every message with `[tag]`. */
export function createLogger(tag: string): Logger {
  return {
    debug: (msg: string, ...args: unknown[]) => console.debug(`[${tag}] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => console.info(`[${tag}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[${tag}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${tag}] ${msg}`, ...args),
  };
}

/**
 * A render-scoped warning tracker.
 *
 * Pass a fresh `WarnScope` (via `createWarnScope()`) into `warnOnce` at a
 * render entry (e.g. once per SSR document in `wrapInDocument`). This keeps a
 * given key from being suppressed for the entire process: the next page/request
 * gets a new scope and the warning can fire again. This fixes the previous
 * behavior where `warnOnce` permanently muted a key across all requests/SSG
 * pages (v0.42.0-alpha.9, #643).
 */
export interface WarnScope {
  warned: Set<string>;
}

/** Create a fresh, empty warning scope for one render. */
export function createWarnScope(): WarnScope {
  return { warned: new Set() };
}

// Module-level fallback for call sites that don't pass an explicit render scope.
const _globalWarned = new Set<string>();

/**
 * Warn at most once per `key` for the given render {@link WarnScope},
 * falling back to a process-wide set when no scope is passed.
 */
export function warnOnce(key: string, logger: Logger, msg: string, scope?: WarnScope): void {
  const set = scope ? scope.warned : _globalWarned;
  if (!set.has(key)) {
    set.add(key);
    logger.warn(msg);
  }
}

/** @internal Test isolation only. Not exported from the package public facade. */
export function resetWarnOnceForTests(): void {
  _globalWarned.clear();
}
