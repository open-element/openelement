/**
 * Runtime-safe i18n helpers (no node:* modules) — internal module, not a
 * public subpath.
 *
 * Thin re-export barrel from i18n-runtime.ts (options/data helpers) and
 * internal/router/i18n.ts (locale path helpers). Host-only i18n wiring must
 * NOT be re-exported here, to prevent node:process/node:path/node:fs from
 * being pulled into client island bundles via @openelement/router main
 * re-exports.
 */

export type { OpenElementI18nOptions } from './i18n-runtime.ts';
export { loadI18nData } from './i18n-runtime.ts';
export type { LocalePath } from './i18n-runtime.ts';
export { normalizeLocalePath } from './i18n-runtime.ts';
