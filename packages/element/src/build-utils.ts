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

export { formatJson } from './public-build-runtime.ts';
export { normalizeSeparators, pathToTagName } from './public-build-runtime.ts';
export { SsrRenderError } from './public-build-runtime.ts';
export { transformIslandSource } from './public-build-runtime.ts';
export { insertBeforeBodyClose } from './public-build-runtime.ts';
export type { OpenElementRequestHandler, RuntimeContext } from './public-build-runtime.ts';
export { composeFetchMiddleware, createRuntimeAdapter } from './public-build-runtime.ts';
