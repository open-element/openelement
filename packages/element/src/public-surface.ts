/**
 * The single public export list of @openelement/element — the names every
 * entry of this package re-exports, spelled out exactly once (#1416).
 *
 * Two entries re-export this module and differ in exactly one thing: the
 * hydration executor install. `index.ts` (the default `.` entry) installs it, so
 * elements may hydrate server-rendered roots. `client-only.ts` does not, so a
 * bundle for a page where no island can hydrate server DOM carries no hydration
 * machinery at all. Keeping the list here rather than in each entry is what
 * stops the two surfaces from drifting apart.
 *
 * The list stays explicit — no star re-export from the implementation modules
 * (#488): the public surface is exactly the names written in this file.
 * SafeHtml, UnsafeHtml and StyleSheetRule stay internal (#487).
 */

// ─── Core exports ───────────────────────────────────────
//
// `OpenElement` and `ErrorBoundary` were the CLASS lane's public base classes. The
// lane is deleted (F16): the generated lane's authoring form is a default-exported
// function component plus a `defineIslandConfig` sidecar, and its author-facing
// hooks (`onConnect`, `onDispose`, `onError`, `ref`, `useHost`, `useContext`) are
// the compiler-erased intrinsics re-exported further down this file. There is no
// replacement base class and no compatibility shim: an app that extended one must
// move to the generated lane.

export { collectPublicProps } from './public-runtime.ts';

// ─── Server render + client bootstrap (compiled pipeline) ──────────

// renderToString serializes a compiled class to deterministic HTML for generated
// server entries; ensurePreHydrationClickCapture installs the pre-upgrade
// capture that the compiled hydration replays after upgrade (generated client
// entries call it). The streamed-page shell executor (createStreamShellExecutor
// and its three types) is DELETED with the class lane's compiled stream
// channel: its one identity input was `componentClass.__partProgram`, and
// every consumer retired with renderIntent.stream (2026-11-24).
export { ensurePreHydrationClickCapture, renderToString } from './public-runtime.ts';
// alpha15 S lane: the component-stylesheet URL channel the router's generated
// SSR/SSG entry feeds before rendering (the DSD templates of components whose
// classes were statically admitted declare the emitted assets as external
// `<link rel="stylesheet">` nodes). Internal by convention (`__` prefix):
// application code never calls it; the generated entry does, and the deployed
// request-time server re-applies it at startup.
export { __setRequestTimeStyleSheetUrls } from './internal/compiled/server/style-links.ts';
// alpha15 S lane (S-C1.2): the per-render document stylesheet collection. The
// generated entry creates one per document render, hands it to the page render
// (light-root components report their external sheets into it) and to
// wrapInDocument (which declares them as marked head links). One collection
// per render is what keeps one page's component stylesheets out of another
// page's head.
export { createDocumentStyleResources } from './public-runtime.ts';
export type { DocumentStyleResources } from './public-runtime.ts';
export type { RenderToStringOptions } from './public-runtime.ts';

// Explicit type-only surface for build adapters (#488).
export type { SsrAdmissionDecision } from './public-runtime.ts';
export { assertValidTagName } from './public-runtime.ts';

// ─── Context (re-export from core) ───────────────────────

export {
  consumeContext,
  createContext,
  provideContext,
  releaseConsumedContext,
} from './public-runtime.ts';
export type { Context } from './public-runtime.ts';

// ─── Error types (re-export from core) ───────────────────

export type { ErrorTelemetryHook, RenderError } from './public-runtime.ts';
export { ERROR_PREFIX, reportError, setErrorTelemetryHook } from './public-runtime.ts';

// ─── Signals (re-export) ─────────────────────────────────

export { computed, effect, signal } from './public-runtime.ts';
export type { ReadonlySignal, Signal } from './public-runtime.ts';

// `element` and `property` were the CLASS lane's decorators. They survived as inert
// no-ops "so module evaluation and class definition stay safe" — but with the lane
// deleted nothing defines a class for them to decorate, and NO lane compiles a
// decorated module (both the generated and the server entry decline it). Keeping an
// exported decorator whose only effect is to make an uncompilable module evaluate is
// the opposite of failing closed: the module looks accepted and then renders nothing.
//
// Deleted with no replacement. `defineIslandConfig` is the authoring form.

/**
 * @experimental Compile-time-only lifecycle/change intrinsics (`16b-LC` plus
 * the experience-edition change channel), the author-facing error boundary
 * (`16b-EB`) and the node-handle factory (`16b-REF`): the generated-element
 * lane admits direct top-level `onConnect(cb)` / `onDispose(cb)` /
 * `onPropertyChange(cb)` / `onError(cb)` calls in the ROOT setup of a generated
 * element module, and a `const handle = ref(cb?)` declaration anywhere in an
 * admitted component body, by binding provenance (a canonical named import of
 * '@openelement/element', aliases followed) and ERASES them into
 * compiler-owned code — a connect callback list in the retained
 * `__oe_rootInstance` record, replayed by the generated mount/claim prologue on
 * the per-connection scope; instance cleanups for `onDispose`; one
 * element-lifetime listener registration on the instance host record for
 * `onPropertyChange` (fired by the shell after a declared row commits a value);
 * one error-handler registration on that same record for `onError` (run by the
 * shell at its connect/claim, update and event-dispatch capture points); for
 * `ref`, one handle object built in the retained setup factory and handed to
 * that node's existing JSX `ref` attribute, which populates `current` on
 * attach (mount AND server-DOM claim), clears it on detach and repopulates it
 * on reconnect; and, for `useContext` (`16b-CTX`), `const value =
 * useContext(token)` is one persistent consumer-local signal the retained
 * factory builds, so a tracked slot reading `.value` refreshes when a provider
 * changes. They are not a runtime dispatcher and not a second lifecycle
 * engine: outside a compiled generated element module the standalone functions
 * fail closed instead of silently doing nothing. Nested/hostless component
 * hooks and connection-scope helpers are the additive slices recorded in
 * ADR-0180. May move to a dedicated authoring subpath with the rest of the
 * intrinsics at the B1.2 surface freeze.
 *
 * `16b-CTX`'s PROVIDER intrinsic is deliberately NOT re-exported here: this
 * module already exports the class lane's host-side `provideContext(host,
 * context, value)` under that name. An author writes the provider intrinsic as
 * `import { provideContext } from '@openelement/element/lifecycle'` (documented
 * in the README's subpath row), which is the same spelling the class lane uses
 * — the difference is the receiver mode, not the name.
 */
export {
  onConnect,
  onDispose,
  onError,
  onPropertyChange,
  ref,
  useContext,
  useHost,
} from './public-runtime.ts';

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
// scan, the stream executor admission, and the generated browser installer.
// Consumed by the router's streaming pipeline and available to custom
// stream executors.
export {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute,
} from './public-runtime.ts';

// ─── Build/runtime policy budgets (re-export from core) ────────────

// The numeric admission budgets (streaming field/owner/seed/payload bounds,
// composition depth, action body limit, stream timeout, idle fallback): one
// value per policy boundary for the router's build pipeline, the generated
// entries, and the element runtime itself.
export {
  IDLE_FALLBACK_TIMEOUT_MS,
  MAX_ACTION_BODY_BYTES,
  MAX_COMPOSITION_DEPTH,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_PAYLOAD_LENGTH,
  STREAM_MAX_SEED_PROPERTIES,
  STREAM_TIMEOUT_MS,
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
  LayoutConfig,
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
