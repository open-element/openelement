/**
 * The single public export list of @openelement/element — the names every
 * entry of this package re-exports, spelled out exactly once (#1416).
 *
 * Two entries re-export this module and differ in exactly one thing: the
 * claim executor install. `index.ts` (the default `.` entry) installs it, so
 * elements may hydrate server-rendered roots. `client-only.ts` does not, so a
 * bundle for a page where no island can hydrate server DOM carries no claim
 * machinery at all. Keeping the list here rather than in each entry is what
 * stops the two surfaces from drifting apart.
 *
 * The list stays explicit — no star re-export from the implementation modules
 * (#488): the public surface is exactly the names written in this file.
 * SafeHtml, UnsafeHtml and StyleSheetRule stay internal (#487).
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
export {
  createDeferredDsdExecutor,
  ensurePreHydrationClickCapture,
  renderDsd,
} from './public-runtime.ts';
export type { RenderDsdOptions } from './public-runtime.ts';
export type {
  CreateDeferredDsdOptions,
  DeferredDsdExecutor,
  DeferredDsdManifest,
} from './public-runtime.ts';

// Explicit type-only surface for build adapters (#488).
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
export type { ReadonlySignal, Signal } from './public-runtime.ts';

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

export { documentStreamParts, escapeAttr, escapeHtml, wrapInDocument } from './public-runtime.ts';

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

// ─── Streamed-frame policy (re-export from core) ───────────────────

// The streamed-frame admission policy: one deny list for the build manifest
// scan, the deferred executor admission, and the generated browser installer.
// Consumed by the router's streaming pipeline and available to custom
// deferred executors.
export {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute,
} from './public-runtime.ts';

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
export type { Logger, StyleSheetLike } from './public-runtime.ts';

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
