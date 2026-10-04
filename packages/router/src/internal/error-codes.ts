/**
 * @openelement/router — application-authoring, build-pipeline, and
 * serve-runtime error codes.
 *
 * Every failure raised by the authoring surface (`definePage`,
 * `defineIslandConfig`), the serve CLI, the island-delivery build pipeline,
 * the Document seam, the `.mdx` pipeline, the route/island scanners, the
 * dynamic prerender, and the generated entry's server runtime carries a
 * stable code, a phase and a severity, exactly like the element package's
 * `OpenElementError` contract (decision 0053): a host classifies any failure
 * by its code and the CLI decides what to show without pattern-matching
 * message text.
 *
 * Phase follows the surface that raises the code: `validation` for the
 * authoring descriptors and the Document head contract (each one rejects an
 * author's data before any render work starts), `build` for the SSG
 * pipeline's build-time admission checks, and `ssr` for the generated
 * entry's request-time/startup runtime. One table per raising surface, so a
 * code points at one place in the pipeline.
 */

import { OpenElementError } from '@openelement/element/authoring';

/** Stable codes for the page-authoring surface (`definePage`). */
export const PageErrorCode = {
  /** First argument is not the compiled page element class. */
  NOT_COMPILED_CLASS: 'OE_PAGE_NOT_COMPILED_CLASS',
  /** Descriptor is not an object, or carries a field the contract removed. */
  DESCRIPTOR_SHAPE: 'OE_PAGE_DESCRIPTOR_SHAPE',
  /** `route` intent is unsupported (`route.path`, mistyped `layout`). */
  ROUTE_INTENT: 'OE_PAGE_ROUTE_INTENT',
  /** `props`/`error` are present but are not projector functions. */
  PROJECTOR: 'OE_PAGE_PROJECTOR',
  /** `renderIntent.mode` is neither `static` nor `dynamic`. */
  RENDER_MODE: 'OE_PAGE_RENDER_MODE',
} as const;

/** Stable codes for the island-delivery surface (`defineIslandConfig`). */
export const IslandErrorCode = {
  /** Config is not an object, or carries a field outside the contract. */
  DESCRIPTOR_SHAPE: 'OE_ISLAND_DESCRIPTOR_SHAPE',
  /** `hydrate` / `media` disagree or name an unsupported strategy. */
  HYDRATE: 'OE_ISLAND_HYDRATE',
  /** `tags`/`tagNames` are malformed or contradict each other. */
  TAGS: 'OE_ISLAND_TAGS',
  /** `exportNames` is malformed or names a tag outside the delivery set. */
  EXPORT_NAMES: 'OE_ISLAND_EXPORT_NAMES',
} as const;

/** Stable codes for the serve CLI (`start`/`preview`). */
export const ServeErrorCode = {
  /** `--mode` is missing a value or names an unknown mode. */
  MODE: 'OE_SERVE_MODE',
} as const;

/**
 * Stable codes for the island-delivery admission contract
 * (`vite/internal/ssg/delivery.ts`). Phase `build`: these reject a delivery
 * declaration while the build materializes the island manifests.
 */
export const DeliveryErrorCode = {
  /** A media query is not a non-empty, bounded, control-free string. */
  MEDIA_QUERY: 'OE_DELIVERY_MEDIA_QUERY',
  /** A tag list is missing/empty, or carries an invalid or duplicate tag. */
  TAGS: 'OE_DELIVERY_TAGS',
  /** `tags` and `tagNames` both resolve but disagree. */
  TAG_CONFLICT: 'OE_DELIVERY_TAG_CONFLICT',
  /** `exportNames` is not an object or names a tag outside the delivery set. */
  EXPORT_NAMES: 'OE_DELIVERY_EXPORT_NAMES',
} as const;

/**
 * Stable codes for the island entry admission checks
 * (`vite/internal/ssg/entry-generators.ts`). Phase `build`: one code per
 * entry field the generated client entry depends on.
 */
export const IslandEntryErrorCode = {
  /** An island module specifier fails the admission grammar. */
  MODULE_PATH: 'OE_ISLAND_ENTRY_MODULE_PATH',
  /** The island tag name is not a valid custom element name. */
  TAG_NAME: 'OE_ISLAND_ENTRY_TAG_NAME',
  /** The hydration strategy is not one of the delivered strategies. */
  STRATEGY: 'OE_ISLAND_ENTRY_STRATEGY',
  /** `media` presence/absence contradicts the chosen strategy. */
  MEDIA: 'OE_ISLAND_ENTRY_MEDIA',
  /** The single `exportName` is malformed. */
  EXPORT_NAME: 'OE_ISLAND_ENTRY_EXPORT_NAME',
} as const;

/**
 * Stable codes for the entry descriptor build
 * (`vite/internal/ssg/entry-descriptor.ts`). Phase `build`: these reject a
 * project configuration the generated entry could not honor.
 */
export const DescriptorErrorCode = {
  /** `middleware.corsOrigin`/`corsOriginModule` is not serializable or they conflict. */
  CORS: 'OE_DESCRIPTOR_CORS',
  /** A `middleware.use` entry is not a module path (string). */
  MIDDLEWARE_USE: 'OE_DESCRIPTOR_MIDDLEWARE_USE',
  /** A stream route reaches an opaque renderer wrapper. */
  STREAM_RENDERER: 'OE_DESCRIPTOR_STREAM_RENDERER',
  /** Streaming conflicts with the compiled app shell/layout wrapper. */
  STREAM_APP_SHELL: 'OE_DESCRIPTOR_STREAM_APP_SHELL',
  /** The lit renderer does not support a compiled appShell/layouts. */
  LIT_APP_SHELL: 'OE_DESCRIPTOR_LIT_APP_SHELL',
} as const;

/**
 * Stable codes for the SSG render pipeline (`vite/internal/ssg/ssg-render.ts`).
 * Phase `build`: these report the prerender pipeline failing, which fails the
 * whole build.
 */
export const SsgRenderErrorCode = {
  /** The SSR bundle does not export the `routeInfo` the pipeline requires. */
  ROUTE_INFO_MISSING: 'OE_SSG_ROUTE_INFO_MISSING',
  /** `routeInfo` resolved but enumerates no routes. */
  ROUTE_INFO_EMPTY: 'OE_SSG_ROUTE_INFO_EMPTY',
  /** The SSR bundle carries no default Hono app export. */
  APP_MISSING: 'OE_SSG_APP_MISSING',
  /** Prerendered static page routes returned non-200 and were not written. */
  STATIC_NON_200: 'OE_SSG_STATIC_NON_200',
} as const;

/**
 * Stable codes for the client island build (`cli/build-client.ts`). Phase
 * `build`: these fire while the client build turns the admitted island set
 * into chunks — the identity pass pins every admitted island's declared
 * specifier to its actual module id, and the chunk grouping groups on those
 * ids only.
 */
export const ClientBuildErrorCode = {
  /**
   * A package island's declared specifier has no module id from the client
   * build's identity pass when chunk grouping runs — an internal ordering
   * bug; the build fails instead of grouping chunks on the raw specifier.
   */
  PACKAGE_IDENTITY_UNRESOLVED: 'OE_CLIENT_BUILD_PACKAGE_IDENTITY_UNRESOLVED',
} as const;

/**
 * Stable codes for the Phase 2 client asset manifest
 * (`vite/client-asset-manifest.ts`) and the SSG post-processor's
 * manifest-keyed island chunk join (`vite/internal/ssg/build-postprocess.ts`).
 * Phase `build`: the client build's manifest is the single join between
 * compile-time island identity and the emitted client assets, so a missing,
 * corrupted, or incomplete record — an admitted island that cannot be
 * attributed to exactly one emitted module, a manifest that records more
 * than one client entry, and a delivery tag claimed by two islands — fails
 * the build instead of shipping silent or reordered identities.
 */
export const ClientAssetErrorCode = {
  /** dist/client/.vite/manifest.json is missing or unreadable. */
  MANIFEST_READ: 'OE_CLIENT_ASSET_MANIFEST_READ',
  /** The manifest exists but is not the JSON record the join requires. */
  MANIFEST_MALFORMED: 'OE_CLIENT_ASSET_MANIFEST_MALFORMED',
  /** The manifest records no emitted client entry file. */
  ENTRY_MISSING: 'OE_CLIENT_ASSET_ENTRY_MISSING',
  /** The manifest records several client entry files (no first-hit pick). */
  ENTRY_AMBIGUOUS: 'OE_CLIENT_ASSET_ENTRY_AMBIGUOUS',
  /** An admitted island matches no emitted module in the build graph. */
  ISLAND_UNMAPPED: 'OE_CLIENT_ASSET_ISLAND_UNMAPPED',
  /** An island identity matches several emitted modules (ambiguous package). */
  ISLAND_IDENTITY_AMBIGUOUS: 'OE_CLIENT_ASSET_ISLAND_IDENTITY_AMBIGUOUS',
  /**
   * A delivery tag is claimed by two island entries — even when both would
   * resolve to the same asset and strategy, tag ownership is one-to-one.
   */
  ISLAND_TAG_DUPLICATE: 'OE_CLIENT_ASSET_ISLAND_TAG_DUPLICATE',
} as const;

/**
 * Stable codes for the Document seam (`document.ts`). Phase `validation`:
 * the head is authored data, resolved per render, and a malformed field is
 * rejected the same way at build time and request time.
 */
export const DocumentErrorCode = {
  /** A page head field or structured-data value violates the Document contract. */
  HEAD_INVALID: 'OE_DOCUMENT_HEAD_INVALID',
} as const;

/**
 * Stable codes for the streaming pump
 * (`vite/internal/server-runtime/stream-runtime.ts`). Phase `ssr`: these
 * fire while the generated entry serves a streamed route — the payload
 * encoder, the deferred-field front gate, the timeout sweep, the Part
 * backfill pump, and the per-route shell gate.
 */
export const StreamErrorCode = {
  /** A seed attribute or Part frame encodes past the payload bound. */
  PAYLOAD_BOUND: 'OE_STREAM_PAYLOAD_BOUND',
  /** The loader data is not one plain object. */
  LOADER_NOT_OBJECT: 'OE_STREAM_LOADER_NOT_OBJECT',
  /** The route manifest declares past the field/Part budget. */
  MANIFEST_BUDGET: 'OE_STREAM_MANIFEST_BUDGET',
  /** A manifest-declared deferred field is absent from the loader data. */
  FIELD_MISSING: 'OE_STREAM_FIELD_MISSING',
  /** The loader data carries a thenable the manifest does not declare. */
  THENABLE_UNDECLARED: 'OE_STREAM_THENABLE_UNDECLARED',
  /** A deferred field did not settle within the policy timeout. */
  DEFERRED_TIMEOUT: 'OE_STREAM_DEFERRED_TIMEOUT',
  /** A resolved deferred range serializes past the payload bound. */
  RANGE_BOUND: 'OE_STREAM_RANGE_BOUND',
  /** The route, its build manifest, and its compiled Part Program disagree. */
  ROUTE_PROGRAM_MISMATCH: 'OE_STREAM_ROUTE_PROGRAM_MISMATCH',
} as const;

/**
 * Stable codes for the dispatch-table startup guards
 * (`vite/internal/server-runtime/route-dispatch.ts`). Phase `ssr`: these
 * reject a route whose compiled shape contradicts its renderer or its build
 * manifest while the generated entry wires its dispatch table.
 */
export const DispatchErrorCode = {
  /** A stream route is registered under the lit renderer, which cannot stream. */
  LIT_STREAM_UNSUPPORTED: 'OE_DISPATCH_LIT_STREAM',
  /** A stream route's literal declaration has no matching build manifest/program. */
  STREAM_DECLARATION_MISMATCH: 'OE_DISPATCH_STREAM_DECLARATION',
} as const;

/**
 * Stable codes for the page SSR renderer seam
 * (`vite/internal/server-runtime/renderer-runtime.ts`). Phase `ssr`: the
 * native renderer fails closed before any render work starts.
 */
export const RendererErrorCode = {
  /** A host tag is not a valid custom element name. */
  TAG_INVALID: 'OE_RENDERER_TAG_INVALID',
  /** Nested island expansion exceeded the depth bound (cyclic composition). */
  DEPTH_BOUND: 'OE_RENDERER_DEPTH_BOUND',
  /** A host tag is not registered in the SSR registry. */
  TAG_UNREGISTERED: 'OE_RENDERER_TAG_UNREGISTERED',
} as const;

/**
 * Stable codes for the `.mdx` route pipeline (`vite/plugin-mdx.ts` and its
 * lowering module `vite/plugin-mdx-lower.ts`). Phase `build`: one code per
 * way an MDX route fails the build — the optional `marked` peer missing, the
 * route file unreadable, and the source outside the static Markdown subset.
 */
export const MdxErrorCode = {
  /** An `.mdx` route exists but the optional `marked` peer is not installed. */
  OPTIONAL_PEER_MISSING: 'OE_MDX_OPTIONAL_PEER_MISSING',
  /** The `.mdx` route file cannot be read from disk. */
  PAGE_UNREADABLE: 'OE_MDX_PAGE_UNREADABLE',
  /** The MDX source uses raw HTML, JSX, or ESM outside the static subset. */
  STATIC_CONTRACT: 'OE_MDX_STATIC_CONTRACT',
} as const;

/**
 * Stable codes for the package-island manifest admission
 * (`vite/internal/ssg/island-scanner.ts`). Phase `build`: these reject a
 * package manifest declaration the island build could not honor.
 */
export const PackageIslandErrorCode = {
  /** A package manifest declaration carries no `openElement.module`. */
  MODULE_MISSING: 'OE_PACKAGE_ISLAND_MODULE_MISSING',
  /** The declaration resolves `hydrate: 'media'` but declares no media query. */
  MEDIA_WITHOUT_DELIVERY: 'OE_PACKAGE_ISLAND_MEDIA_WITHOUT_DELIVERY',
  /** The declaration carries a media query but does not use media delivery. */
  DELIVERY_WITHOUT_MEDIA: 'OE_PACKAGE_ISLAND_DELIVERY_WITHOUT_MEDIA',
} as const;

/**
 * Stable codes for the route-file scanner
 * (`vite/internal/ssg/route-scanner.ts`). Phase `build`: these reject a
 * routes tree whose file grammar would generate a broken or shadowed entry.
 */
export const RouteScanErrorCode = {
  /** A content element's tag equals its definePage route's fallback tag (#971). */
  TAG_SHADOW: 'OE_ROUTE_SCAN_TAG_SHADOW',
  /** Two route files fold to the same bracket-grammar shape (#1029). */
  EQUIVALENT_FILES: 'OE_ROUTE_SCAN_EQUIVALENT_FILES',
  /** Two route files fold to the same generated identifier (#1029). */
  VAR_NAME_COLLISION: 'OE_ROUTE_SCAN_VAR_NAME_COLLISION',
} as const;

/**
 * Stable codes for the dynamic-route prerender pipeline
 * (`vite/internal/ssg/ssg-dynamic.ts`, with the route-parameter admission of
 * `vite/internal/ssg/ssg-helpers.ts`). Phase `build`: a failed dynamic page
 * is a failed build (or a skipped page under the `warn` policy).
 */
export const SsgDynamicErrorCode = {
  /** A route parameter has no value to substitute. */
  PARAM_MISSING: 'OE_SSG_PARAM_MISSING',
  /** A route parameter value fails the traversal/control-character screen. */
  PARAM_UNSAFE: 'OE_SSG_PARAM_UNSAFE',
  /** The dynamic render pass failed and the failure policy is `fail`. */
  RENDER_FAILED: 'OE_SSG_RENDER_FAILED',
  /** A rendered page returned a failure status instead of page HTML. */
  RENDER_STATUS: 'OE_SSG_RENDER_STATUS',
} as const;

/**
 * One authoring-contract failure: `OpenElementError` with the shared
 * `validation` phase and `error` severity, so callers classify by code and
 * never by message text.
 */
export function authoringError(code: string, message: string): OpenElementError {
  return new OpenElementError(message, {
    code,
    phase: 'validation',
    severity: 'error',
    recoverable: false,
  });
}

/**
 * One build-pipeline failure: `OpenElementError` with the shared `build`
 * phase and `error` severity, so a build admission check is catchable by
 * code exactly like the authoring surfaces. `cause` preserves the wrapped
 * underlying failure for diagnostics.
 */
export function buildError(
  code: string,
  message: string,
  options: { cause?: Error } = {},
): OpenElementError {
  return new OpenElementError(message, {
    code,
    phase: 'build',
    severity: 'error',
    recoverable: false,
    ...(options.cause ? { cause: options.cause } : {}),
  });
}

/**
 * One serve-runtime failure: `OpenElementError` with the shared `ssr` phase
 * and `error` severity, so a request-time (or generated-entry startup)
 * failure is catchable by code exactly like the authoring and build
 * surfaces. The message text is carried verbatim from the raising site —
 * the wire frames and the CLI keep matching on it.
 */
export function serveError(code: string, message: string): OpenElementError {
  return new OpenElementError(message, {
    code,
    phase: 'ssr',
    severity: 'error',
    recoverable: false,
  });
}
