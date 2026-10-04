/**
 * Build-time utilities for OpenElement build adapters.
 *
 * These helpers exist for build orchestration (SSG, island transforms,
 * deployment adapters) and are consumed by @openelement/router tooling.
 * They are NOT part of the component-authoring runtime surface: application
 * code should import from `@openelement/element` instead.
 *
 * @module @openelement/element/build-utils
 */

export { formatJson } from './internal/core/write-json.ts';
export { normalizeSeparators, pathToTagName } from './internal/core/path-utils.ts';
export { SsrRenderError } from './internal/core/errors.ts';
export { transformIslandSource } from './internal/core/island-transform.ts';
export { insertBeforeBodyClose } from './internal/core/html-route-utils.ts';
export type { OpenElementRequestHandler, RuntimeContext } from './internal/core/runtime.ts';
export { composeFetchMiddleware, createRuntimeAdapter } from './internal/core/runtime.ts';
