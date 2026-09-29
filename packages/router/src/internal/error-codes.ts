/**
 * @openelement/router — application-authoring and build-pipeline error codes.
 *
 * Every failure raised by the authoring surface (`definePage`,
 * `defineIslandConfig`), the serve CLI, the island-delivery build pipeline,
 * and the Document seam carries a stable code, a phase and a severity,
 * exactly like the element package's `OpenElementError` contract (decision
 * 0053). Before this module those throws were bare `Error`s, so a host could
 * not classify a failure, and the CLI could not decide what to show without
 * pattern-matching message text.
 *
 * Phase follows the surface that raises the code: `validation` for the
 * authoring descriptors and the Document head contract (each one rejects an
 * author's data before any render work starts), and `build` for the SSG
 * pipeline's build-time admission checks. One table per raising surface, so a
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
 * Stable codes for the Document seam (`document.ts`). Phase `validation`:
 * the head is authored data, resolved per render, and a malformed field is
 * rejected the same way at build time and request time.
 */
export const DocumentErrorCode = {
  /** A page head field or structured-data value violates the Document contract. */
  HEAD_INVALID: 'OE_DOCUMENT_HEAD_INVALID',
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
