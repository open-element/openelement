/**
 * index.ts - Pure runtime.
 *
 * openElement is a static-first framework with a pure runtime core:
 * - Zero node:* imports - no filesystem, no process, no path
 * - Zero Vite dependency - no Plugin, no build orchestration
 * - Single chartered engine dependency: @preact/signals-core (the
 *   SignalEngine backing signal/computed/effect, see internal/signal/).
 *   Everything else resolves to Web Standards: URL, fetch, import.meta.url,
 *   console - so the runtime works in Deno, Node, Bun and Edge.
 *
 * Rendering is owned by generated Part Programs. This module contains only
 * reusable platform helpers and contracts; it is not a renderer barrel.
 *
 * Build orchestration (Vite plugins) lives in @openelement/router/vite.
 * For the unified openElement() entry, use @openelement/router/vite.
 */

// --- Public API re-exports -----------------------------------------

export type {
  AppShellConfig,
  ComponentLayer,
  FrameworkOptions,
  HydrationStrategy,
  LocalePath,
  OpenElementBuildContextLike,
  RouteEntry,
  SafeHtml,
  SpecialFileType,
  StrategySource,
  UnsafeHtml,
} from '../protocol/framework.ts';

export {
  ERROR_PREFIX,
  ErrorCode,
  OpenElementError,
  RenderError,
  reportError,
  setErrorTelemetryHook,
  SsrRenderError,
} from './errors.ts';
export type { ErrorPhase, ErrorSeverity, ErrorTelemetryHook } from '../protocol/errors.ts';
export { wrapInDocument } from './html-escape.ts';
export { StyleSheet } from './style-sheet.ts';
export type { StyleSheetLike, StyleSheetRule } from '../protocol/style-sheet.ts';
export { camelToKebab } from './tag-utils.ts';
export type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from '../protocol/manifest.ts';
export type {
  CemCompatibilityReport,
  CompatibilityClassification,
  CompatibilityTier,
} from '../protocol/manifest.ts';
export { escapeAttr, escapeAttrValue, escapeHtml } from './html-escape.ts';
export type { SignalLike, Unsubscribe } from '../protocol/signal.ts';
export { consumeContext, type Context, createContext, provideContext } from './signal-context.ts';
export { createLogger } from './logger.ts';
export { assertValidTagName, isValidTagName } from './tag-utils.ts';
export { normalizeSeparators, pathToTagName } from './path-utils.ts';
export { transformIslandSource } from './island-transform.ts';
export type { IslandTransformOptions, IslandTransformResult } from '../protocol/island.ts';

// Data adapters — type contract surface only (ADR-0095)
export type {
  Action,
  ActionContext,
  Loader,
  LoaderContext,
  ServerRouteContext,
  ServerRouteMetadata,
  SpaAction,
  SpaActionContext,
  SpaLoader,
  SpaLoaderContext,
} from '../protocol/data.ts';

export {
  deepGetElementById,
  ensureDeepFragmentNavigation,
  isDeepFragmentNavigationInstalled,
} from './deep-fragment.ts';
