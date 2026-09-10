/**
 * @openelement/element/logger — the shared structured logger (Beta.2.2,
 * #1339 boundary). Browser runtimes (SPA bootstrap, client router), server
 * entries and authoring layers share exactly this logger; the leaf exists so
 * none of them has to import the package root barrel (which carries the
 * compiled Native runtime kernel) just to log. Pure re-export of the leaf
 * module; no runtime kernel is reachable from here.
 */
export { createLogger, createWarnScope, warnOnce } from './internal/core/logger.ts';
export type { Logger, WarnScope } from './internal/core/logger.ts';
