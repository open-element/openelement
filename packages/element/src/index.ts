/**
 * Canonical component-authoring facade for openElement (0.44).
 *
 * This package is the single import surface for authoring compiled custom
 * elements. The public OpenElement base class runs on the compiled Part
 * Program kernel; the legacy VNode renderer and runtime JSX factories were
 * removed — components are compiled by @openelement/element/compiler. Build
 * orchestration remains in @openelement/router;
 * build adapters import build-time helpers from `@openelement/element/build-utils`.
 */

// ─── Core exports ───────────────────────────────────────

export { OpenElement } from './open-element.ts';

export { ErrorBoundary } from './error-boundary.ts';

export { collectPublicProps } from './public-runtime.ts';

// ─── Server render + client bootstrap (compiled pipeline) ──────────

// renderDsd serializes a compiled class to deterministic HTML for generated
// server entries; ensurePreHydrationClickCapture installs the pre-upgrade
// capture that the compiled claim replays after upgrade (generated client
// entries call it).
export { ensurePreHydrationClickCapture, renderDsd } from './public-runtime.ts';
export type { RenderDsdOptions } from './public-runtime.ts';

// Explicit type-only surface for build adapters (#488): no star seams, so the
// public type surface is exactly the names listed here. SafeHtml, UnsafeHtml
// and StyleSheetRule stay internal (#487).
export type { RenderOutput, SsrAdmissionDecision } from './public-runtime.ts';
export { assertValidTagName } from './public-runtime.ts';

// ─── Context (re-export from core) ───────────────────────

export { consumeContext, createContext, provideContext } from './public-runtime.ts';
export type { Context } from './public-runtime.ts';

// ─── Error types (re-export from core) ───────────────────

export type { ErrorTelemetryHook, RenderError } from './public-runtime.ts';
export { ERROR_PREFIX, reportError, setErrorTelemetryHook } from './public-runtime.ts';

// ─── Signals (re-export) ─────────────────────────────────

export { computed, effect, signal } from './public-runtime.ts';
export type { Signal } from './public-runtime.ts';

/**
 * @experimental Compile-time-only decorator intrinsics (#1209): the compiler
 * admits these by binding provenance (a runtime named import from this
 * module) and erases them from generated code — they carry no runtime
 * semantics and are not a second recognizer. When a module is evaluated
 * WITHOUT the compiler (unit tests, config evaluation), these are inert
 * no-op decorators so module evaluation and class definition stay safe.
 * May move to a dedicated authoring subpath at the B1.2 surface freeze.
 */
export { element, property } from './public-runtime.ts';

// ─── HTML utilities (re-export from core) ────────────────

export { escapeAttr, escapeHtml, wrapInDocument } from './public-runtime.ts';

// ─── Security predicates (re-export from core) ───────────────────

export { isSafeAttributeName } from './public-runtime.ts';
export { trustedHtml } from './public-runtime.ts';
export type { TrustedHtml } from './public-runtime.ts';
/**
 * @experimental Canonical dangerous-key guard (#903, #1214): the single
 * prototype-pollution rule shared by host prop collection, page projection,
 * and generated server runtimes (which serialize `DANGEROUS_KEYS` into
 * generated code at build time). May move to a dedicated security subpath at
 * the B1.2 surface freeze.
 */
export { DANGEROUS_KEYS, injectPropsSafe, isDangerousKey } from './public-runtime.ts';

// ─── Island types (protocol) ─────────────────────────────

export type { IslandOptions } from './public-runtime.ts';

// ─── StyleSheet (re-export from core) ────────────────────

export {
  createLogger,
  formatError,
  isValidTagName,
  OpenElementError,
  StyleSheet,
} from './public-runtime.ts';
export type { StyleSheetLike } from './public-runtime.ts';

// App-owned contracts use these types without reopening the retired protocol package.
export type {
  Action,
  ActionContext,
  ActionResult,
  Loader,
  LoaderContext,
  ProblemDetails,
  ServerRouteContext,
  ServerRouteMetadata,
  SpaAction,
  SpaActionContext,
  SpaLoader,
  SpaLoaderContext,
} from './public-contracts.ts';
export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from './public-contracts.ts';
export type {
  AppShellConfig,
  CompatibilityClassification,
  CompatibilityTier,
  ComponentLayer,
  FrameworkOptions,
  HydrationStrategy,
  LocalePath,
  Middleware,
  RouteEntry,
  SpecialFileType,
} from './public-contracts.ts';
// Runtime export: canonical hydration strategy list consumed by app and build
// adapters (#496). The HydrationStrategy type derives from this const.
export { HYDRATION_STRATEGIES } from './public-contracts.ts';
export type { OpenElementRouteKind, OpenElementRouteNode } from './public-contracts.ts';
export type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from './public-contracts.ts';

// ─── Deep-fragment navigation ───────────────────────────

export { deepGetElementById, ensureDeepFragmentNavigation } from './public-runtime.ts';
