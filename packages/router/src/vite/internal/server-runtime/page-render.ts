/**
 * @openelement/router/server-runtime — page descriptor and props projection.
 *
 * The request-time page semantics of the generated Hono entry: the canonical
 * page-definition/route-meta extractors, the page props projection seams
 * (#1214: every projection filters the canonical dangerous-key set), and the
 * path-derived locale resolution. The logic lives in this real module rather
 * than inside a codegen template string, so it is directly unit-testable.
 *
 * The dangerous-key set is injected, not imported: the narrow runtime reads
 * mirror the generated helpers exactly, and the caller binds the policy —
 * since #1470 block e that caller is the generated-app factory (app.ts),
 * which imports the canonical DANGEROUS_KEYS constant re-exported by the
 * kernel-free /authoring leaf and hands it to
 * {@linkcode createPagePropsRuntime}; the generated
 * entry carries no serialized copy of it.
 *
 * Route modules are author-shaped and reach this module as opaque records —
 * the narrow runtime reads mirror the generated helpers exactly.
 */

import { PageErrorCode, serveError } from '../../../internal/error-codes.ts';

/** The page descriptor a definePage/defineLitPage route module carries on its default export. */
export type PageDefinition = Record<string, unknown>;

/** A route module namespace as the generated entry imports it (`import * as $route`). */
export interface RouteModule {
  default?: {
    openElementPage?: PageDefinition;
    [key: string]: unknown;
  };
  loader?: unknown;
  [key: string]: unknown;
}

/**
 * Canonical page-definition extractor: a route module's default export
 * carries the authoring descriptor on `openElementPage`; anything else
 * projects to the empty descriptor. Kept a hoisted-friendly plain function —
 * the generated entry calls it at module evaluation (route registration,
 * routeInfo) and inside every request handler.
 */
export function pageDefinition(routeModule: unknown): PageDefinition {
  const module = routeModule as RouteModule | undefined | null;
  return module?.default?.openElementPage || {};
}

/**
 * Canonical route metadata derived from a route module: only the keys the
 * entry consumers read (route, layout, title, description), each present
 * exactly when the descriptor defines it — spread-conditional, so an absent
 * key stays absent instead of becoming `undefined`.
 */
export function routeMeta(routeModule: unknown): Record<string, unknown> {
  const page = pageDefinition(routeModule) as {
    route?: { layout?: unknown };
    head?: { title?: unknown; description?: unknown };
  };
  return {
    ...(page.route !== undefined ? { route: page.route } : {}),
    ...(page.route?.layout !== undefined ? { layout: page.route.layout } : {}),
    ...(page.head?.title !== undefined ? { title: page.head.title } : {}),
    ...(page.head?.description !== undefined ? { description: page.head.description } : {}),
  };
}

/**
 * Path-derived locale resolution: the first non-empty path segment when it is
 * a declared locale, the fallback otherwise. `locales` is the generated
 * entry's `__locales` project declaration, so request-time resolution and the
 * pages the build emits agree (see expandI18nLocales).
 */
export function localeFromPath(
  locales: readonly string[],
  path: unknown,
  fallback: string,
): string {
  const first = String(path || '/')
    .split('/')
    .filter(Boolean)[0];
  return locales.includes(first) ? first : fallback;
}

/** The request-scoped page context the generated handlers build for one render (#1326). */
export interface PageContext {
  params?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

/** The projected props record handed to the compiled page host. */
export type ProjectedProps = Record<string, unknown>;

/**
 * The page props projection runtime: the default projection from route
 * params/loader data plus the descriptor's `props`/`error` projector seams.
 * Every seam filters the canonical dangerous-key set (#1214) so hostile
 * params, loader data, or author projector output can never pollute the props
 * record that flows into the compiled serializer.
 */
export interface PagePropsRuntime {
  /** The descriptor-less fallback: params + plain-object loader data. */
  defaultPageProps(context: PageContext): ProjectedProps;
  /** The descriptor `props` projector, falling back to the default projection. */
  pageProps(routeModule: unknown, context: PageContext): ProjectedProps;
  /** The descriptor `error` projector for the error-boundary re-render. */
  pageErrorProps(routeModule: unknown, error: unknown, context: PageContext): ProjectedProps;
}

/** The binding the generated-app factory hands {@linkcode createPagePropsRuntime}. */
export interface PagePropsRuntimeDeps {
  /**
   * The canonical dangerous-key set (the factory imports it from the
   * kernel-free /authoring leaf): one rule, no second copy.
   */
  dangerousKeys: ReadonlySet<string>;
}

/**
 * The server function page render seam (alpha15 server lane).
 *
 * A function-page descriptor's `render` is the compiled server constructor
 * function (the component lane lowered the authored TSX into `__h`/`__t`
 * composed code) — props in, final HTML out. Two boundary checks live here
 * because this is the ONE place loader-projected props meet the compiled
 * render:
 *
 * - the render must be a function (`OE_PAGE_FUNCTION_RENDER`) — a descriptor
 *   whose render never went through the compiler has nothing to call;
 * - the props must NOT carry the reserved `children` key
 *   (`OE_PAGE_FUNCTION_PROPS`). The compiled `props.children` channel is
 *   trusted final HTML produced by the COMPILER from a caller's own JSX
 *   children (the same trust level as an `__ssr` result); page props come
 *   from loader/params data, so a `children` key there is a smuggling
 *   attempt and is refused before the render function runs.
 *
 * The render function returns a string (the constructors always do); the
 * type is widened to `unknown` so a hostile loader cannot make this seam
 * trust a descriptor the compiler never produced.
 */
export function renderFunctionPage(page: unknown, props: ProjectedProps): string {
  const descriptor = (page ?? {}) as { render?: unknown };
  if (typeof descriptor.render !== 'function') {
    throw serveError(
      PageErrorCode.FUNCTION_RENDER,
      '[openElement] the server function page render is not a function — the route module must ' +
        'default-export definePage(Component), and the compiler must have compiled the ' +
        'component function into the route module.',
    );
  }
  if (Object.hasOwn(props, 'children')) {
    throw serveError(
      PageErrorCode.FUNCTION_PROPS,
      '[openElement] the server function page props carry the reserved "children" key, which is ' +
        'the compiler-owned composition channel — rename the loader field; HTML never arrives ' +
        'through page props.',
    );
  }
  return String((descriptor.render as (props: ProjectedProps) => unknown)(props));
}

/**
 * Binds the page props projection to the generated entry's serialized
 * dangerous-key list. Returns the three projection seams under their
 * generated binding names (`__pageProps`, `__pageErrorProps` — the entry
 * destructures them).
 */
export function createPagePropsRuntime(deps: PagePropsRuntimeDeps): PagePropsRuntime {
  const { dangerousKeys } = deps;

  function filterPageProps(record: Record<string, unknown>): ProjectedProps {
    const clean: ProjectedProps = {};
    for (const key of Object.keys(record)) {
      if (dangerousKeys.has(key)) continue;
      clean[key] = record[key];
    }
    return clean;
  }

  function defaultPageProps(context: PageContext): ProjectedProps {
    const props: ProjectedProps = {};
    const params = (context.params as Record<string, unknown> | undefined) || {};
    for (const key of Object.keys(params)) {
      if (dangerousKeys.has(key)) continue;
      props[key] = params[key];
    }
    const data = context.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of Object.keys(data as Record<string, unknown>)) {
        if (dangerousKeys.has(key)) continue;
        props[key] = (data as Record<string, unknown>)[key];
      }
    }
    return props;
  }

  return {
    defaultPageProps,
    pageProps(routeModule: unknown, context: PageContext): ProjectedProps {
      const module = routeModule as RouteModule | undefined | null;
      const page = module?.default?.openElementPage;
      if (page && typeof (page as { props?: unknown }).props === 'function') {
        const projected = (page.props as (context: PageContext) => unknown)(context);
        return projected && typeof projected === 'object'
          ? filterPageProps(projected as Record<string, unknown>)
          : {};
      }
      return defaultPageProps(context);
    },
    pageErrorProps(routeModule: unknown, error: unknown, context: PageContext): ProjectedProps {
      const module = routeModule as RouteModule | undefined | null;
      const page = module?.default?.openElementPage;
      const projected =
        page && typeof (page as { error?: unknown }).error === 'function'
          ? (page.error as (error: unknown, context: PageContext) => unknown)(error, context)
          : {};
      return projected && typeof projected === 'object'
        ? filterPageProps(projected as Record<string, unknown>)
        : {};
    },
  };
}
