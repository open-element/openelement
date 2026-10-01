/**
 * @openelement/router/server-runtime — the page SSR renderer seam.
 *
 * `__ssr` renders one registered page/island host to HTML. The native fork
 * routes through Element's compiled serializer (`renderDsd`, which fails
 * closed for unregistered or uncompiled classes); the lit fork (#1339)
 * routes through @lit-labs/ssr (`renderLitPageToHtml`). The fork point is the
 * renderer adapter (renderer-adapter.ts): each adapter picks which factory
 * and which page-tag resolver the entry imports and binds to `__ssr` /
 * `__resolvePageTag` — the call sites never fork.
 *
 * Element functions are injected, never imported: the typed module carries no
 * @openelement/element edge, so the LIT entry's import graph stays free of
 * the Native runtime kernel (#1339 boundary) and the
 * bundler inlines the module into every generated entry. The admitted tag
 * list is generated data (serialized into the entry) for the same reason.
 *
 * Bodies are migrated verbatim from the generated-entry helpers
 * (entry-render-runtime.ts).
 */

import { RendererErrorCode, serveError } from '../../../internal/error-codes.ts';

/** Opaque capability marking HTML the application has explicitly vetted as trusted. */
export interface TrustedHtmlValue {
  readonly html: string;
}

/** Source metadata the serializer attributes to a render (the `{ route }` seam). */
export interface PageSsrSourceInfo {
  route?: string;
  source?: string;
}

/** Trusted parent-owned light children keyed by slot name (the shell slot claim). */
export type ProjectedChildren = ReadonlyMap<string, TrustedHtmlValue>;

/**
 * The generated entry's `__ssr` binding: render one registered host tag to
 * HTML. `depth` bounds nested island expansion; `projectedChildren` claims
 * external content (the app-shell slot). Fails closed per the forks below.
 */
export type PageSsrRenderer = (
  tag: string,
  props?: Record<string, unknown>,
  sourceInfo?: PageSsrSourceInfo,
  depth?: number,
  projectedChildren?: ProjectedChildren,
) => string;

/** The subset of the Element serializer the native renderer needs. */
export interface NativePageRendererDeps {
  /** Element's sync compiled serializer (`renderDsd`). */
  renderDsd: (
    tag: string,
    options: {
      componentClass?: unknown;
      props?: Record<string, unknown>;
      sourceInfo?: PageSsrSourceInfo;
      ssrRenderableTags?: readonly string[];
      projectedChildren?: ProjectedChildren;
    },
  ) => { html: string };
  /** The SSR registry (the runtime's `customElements` global). */
  customElements: { get(tag: string): unknown };
  /** Build-admitted nested compiled tags (serialized generated data). */
  ssrRenderableTags: readonly string[];
}

/**
 * The native renderer (default): render a registered compiled element class
 * through Element composition. Fails closed for invalid tags, depth-bound
 * violations, and unregistered hosts — an unknown OpenElement host cannot be
 * server-rendered (client-only and foreign tags pass through per the
 * admission plan).
 */
export function createNativePageRenderer(deps: NativePageRendererDeps): PageSsrRenderer {
  const { renderDsd, customElements, ssrRenderableTags } = deps;
  return (
    tag,
    props = {},
    sourceInfo = {},
    __depth = 0,
    projectedChildren,
  ): string => {
    // Validate tag name - must be a valid Custom Element (contains hyphen)
    if (!tag || !tag.includes('-')) {
      throw serveError(
        RendererErrorCode.TAG_INVALID,
        '[openElement] Invalid custom element tag: ' + String(tag) + '. Must contain a hyphen.',
      );
    }
    if (__depth > 8) {
      throw serveError(
        RendererErrorCode.DEPTH_BOUND,
        '[openElement] Nested element expansion exceeded the depth bound at <' + tag +
          '>; cyclic island nesting is not renderable.',
      );
    }
    const Cls = customElements.get(tag);
    if (!Cls) {
      throw serveError(
        RendererErrorCode.TAG_UNREGISTERED,
        '[openElement] <' + tag +
          '> is not registered in the SSR registry. Generated entries register every admitted route/island class explicitly; an unknown OpenElement host cannot be server-rendered (client-only and foreign tags pass through per the admission plan).',
      );
    }
    return renderDsd(tag, {
      componentClass: Cls,
      props,
      sourceInfo,
      ssrRenderableTags,
      projectedChildren,
    }).html;
  };
}

/** The subset of @openelement/router/lit-ssr the lit renderer needs. */
export interface LitPageRendererDeps {
  /** `renderLitPageToHtml` — the registered LitElement page host renders to DSD HTML. */
  renderLitPageToHtml: (input: { tag: string; props?: Record<string, unknown> }) => {
    html: string;
  };
}

/**
 * The lit renderer (#1339): render a registered LitElement page host to DSD
 * HTML through @lit-labs/ssr. Fails closed for invalid tags and unregistered
 * hosts (inside renderLitPageToHtml); nested admitted islands compose through
 * the same SSR registry — lit-ssr's job, no adapter code.
 */
export function createLitPageRenderer(deps: LitPageRendererDeps): PageSsrRenderer {
  const { renderLitPageToHtml } = deps;
  // depth/projectedChildren are accepted for call-site compatibility and
  // deliberately ignored: nested composition is lit-ssr's job, no adapter code.
  return (tag, props = {}) => renderLitPageToHtml({ tag, props }).html;
}

/**
 * Native page-tag resolution (#1276, B1.3-F1): the compiled Part Program is
 * the one canonical source for the route→program tag binding. A definePage
 * route module default-exports the compiled page class, whose
 * `__partProgram.tag` carries the @element(...) decorator tag; the route FILE
 * name derives the ROUTE, not the element's identity, so the bare
 * path-derived tag must never reach the serializer when the program declares
 * a different one. The path-derived fallback remains for classes without a
 * compiled program — the serializer fails closed on those exactly as before.
 */
export function resolveCompiledPageTag(routeModule: unknown, fallbackTag: string): string {
  const module = routeModule as
    | { default?: { __partProgram?: { tag?: unknown } } }
    | undefined
    | null;
  const program = module?.default?.__partProgram;
  if (program && typeof program.tag === 'string' && program.tag.includes('-')) return program.tag;
  return fallbackTag;
}

/**
 * Lit page-tag resolution (#1339 lit fork): a defineLitPage route records its
 * host tag on the class's `openElementPageTag` static (there is no compiled
 * Part Program in the lit path); the path-derived tag stays the fallback.
 */
export function resolveLitPageTag(routeModule: unknown, fallbackTag: string): string {
  const module = routeModule as
    | { default?: { openElementPageTag?: unknown } }
    | undefined
    | null;
  const tag = module?.default?.openElementPageTag;
  if (typeof tag === 'string' && tag.includes('-')) return tag;
  return fallbackTag;
}
