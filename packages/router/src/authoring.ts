import { ERROR_PREFIX } from '@openelement/element/authoring';
/**
 * @openelement/router - application authoring API for the compiled architecture.
 *
 * This file is intentionally free of Vite/build imports. Route modules can
 * import from @openelement/router without pulling adapter-vite into the runtime
 * graph.
 *
 * v0.44 (ADR-0143): a route module's default export is the COMPILED page
 * element class itself — `@element('page-home') export default class
 * HomePage extends OpenElement { ... }` produced by the
 * `open:compiled-element` transform. `definePage(Class, descriptor?)`
 * attaches the page descriptor (head, route, renderIntent, the props
 * projector and the error projector) to that class as the `openElementPage`
 * static the pipeline reads; it never creates classes and never holds a
 * render function. There is no runtime JSX render path.
 */

import { isDangerousKey, isValidTagName, OpenElementError } from '@openelement/element/authoring';
import { HYDRATION_STRATEGIES } from '@openelement/element/authoring';
import type { HydrationStrategy } from '@openelement/element/authoring';

/**
 * Where a page renders (#609, ADR-0123):
 * - `'static'` (default when renderIntent.mode is unset): prerendered at
 *   build time by SSG; pages exporting an action must NOT use this mode —
 *   the build rejects prerendered action pages (ADR-0120).
 * - `'dynamic'`: skipped by prerendering and rendered per request through
 *   the generated `dist/server` entry, running the route loader on every
 *   request.
 *
 * The former `'auto'` value collapsed into `'static'`: it never had distinct
 * behavior — an unset or `'auto'` mode always meant prerender-at-build.
 */
type PageRenderingMode = 'static' | 'dynamic';
export type PageMeta = Record<string, unknown>;

interface PageRouteIntent {
  id?: string;
  params?: readonly string[];
}

interface PageRenderIntent {
  mode?: PageRenderingMode;
}

interface NormalizedPageRenderIntent {
  mode: PageRenderingMode;
}

export interface PageRouteContext {
  path?: string;
  filePath?: string;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Redirect signal thrown from a loader/action to short-circuit rendering with an HTTP redirect. */
export class OpenElementRedirect extends OpenElementError {
  readonly location: string;
  readonly status: number;

  constructor(location: string | URL, status = 302) {
    // ADR-0121 §3: only real redirect statuses — a non-3xx "redirect" is a
    // response the browser never follows, silently stranding the mutation.
    if (!REDIRECT_STATUSES.has(status)) {
      throw new OpenElementError(
        `${ERROR_PREFIX} redirect() status must be one of 301/302/303/307/308 (got ${status}). ` +
          'In the POST action context every 3xx is coerced to 303 (PRG).',
        { code: 'INVALID_REDIRECT_STATUS', phase: 'validation' },
      );
    }
    super(`Redirect to ${String(location)}`, {
      code: 'REDIRECT',
      severity: 'error',
      phase: 'navigation',
      recoverable: false,
      statusCode: status,
    });
    this.name = 'OpenElementRedirect';
    this.location = String(location);
    this.status = status;
  }
}

/** Not-found signal thrown from a loader to render the route's 404 path. */
export class OpenElementNotFound extends OpenElementError {
  readonly status = 404;

  constructor(message = 'Not Found') {
    super(message, {
      code: 'NOT_FOUND',
      severity: 'error',
      phase: 'navigation',
      recoverable: false,
      statusCode: 404,
    });
    this.name = 'OpenElementNotFound';
  }
}

/** Throw an {@linkcode OpenElementRedirect} for `location` (status must be a real 3xx). */
export function redirect(location: string | URL, status = 302): never {
  throw new OpenElementRedirect(location, status);
}

/** Throw an {@linkcode OpenElementNotFound} to render the 404 path. */
export function notFound(message = 'Not Found'): never {
  throw new OpenElementNotFound(message);
}

/** Type guard for {@linkcode OpenElementRedirect}, including its duck-typed cross-realm shape. */
export function isOpenElementRedirect(error: unknown): error is OpenElementRedirect {
  return error instanceof OpenElementRedirect ||
    (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'OpenElementRedirect' &&
      typeof (error as { location?: unknown }).location === 'string' &&
      typeof (error as { status?: unknown }).status === 'number' &&
      // ADR-0121 (#583): the duck-typed branch honors the same whitelist —
      // a shaped object must not smuggle an arbitrary status into the
      // redirect channel.
      REDIRECT_STATUSES.has((error as { status: number }).status)
    );
}

/** Type guard for {@linkcode OpenElementNotFound}, including its duck-typed cross-realm shape. */
export function isOpenElementNotFound(error: unknown): error is OpenElementNotFound {
  return error instanceof OpenElementNotFound ||
    (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'OpenElementNotFound' &&
      typeof (error as { status?: unknown }).status === 'number' &&
      (error as { status: number }).status === 404
    );
}

/**
 * Expected-failure channel for actions (0.42.0-alpha.2, ADR-0120): validation
 * failures RETURN `fail(status, data)` — never throw — so the server can
 * answer 422 with the form re-rendered and the submitted values echoed back.
 * Thrown values keep the exception channel (redirect/notFound/error page).
 */
export class OpenElementActionFailure<Data = unknown> {
  readonly name = 'OpenElementActionFailure';
  readonly status: number;
  readonly data: Data;

  constructor(status: number, data: Data) {
    if (status < 400 || status > 499) {
      throw new OpenElementError(
        `${ERROR_PREFIX} fail() status must be a 4xx code (got ${status}); ` +
          'validation failures are client errors, use 400/422.',
        { code: 'INVALID_FAIL_STATUS', phase: 'validation' },
      );
    }
    this.status = status;
    this.data = data;
  }
}

/** Return a structured action failure with an HTTP status and typed data payload. */
export function fail<Data>(status: number, data: Data): OpenElementActionFailure<Data> {
  return new OpenElementActionFailure(status, data);
}

/** Type guard for {@linkcode OpenElementActionFailure}, including its duck-typed cross-realm shape. */
export function isActionFailure(error: unknown): error is OpenElementActionFailure {
  return error instanceof OpenElementActionFailure ||
    (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'OpenElementActionFailure' &&
      typeof (error as { status?: unknown }).status === 'number' &&
      'data' in (error as Record<string, unknown>)
    );
}

export type ActionOutcome<Data = unknown> =
  | { kind: 'success'; data: Data }
  | { kind: 'failure'; status: number; data: unknown };

/**
 * Canonical application-level classification for an action return value.
 * Hono and SPA executors project this result differently, but neither may
 * redefine validation failure or admit a raw Response as action data.
 */
export function classifyActionResult<Data>(result: Data): ActionOutcome<Data> {
  if (result instanceof Response) {
    throw new OpenElementError(
      `${ERROR_PREFIX} Actions must not return a Response object; return data, ` +
        'fail(status, data), or throw redirect().',
      { code: 'INVALID_ACTION_RESPONSE', phase: 'validation' },
    );
  }
  if (isActionFailure(result)) {
    return { kind: 'failure', status: result.status, data: result.data };
  }
  return { kind: 'success', data: result };
}

/**
 * Page <head> meaning declared by a route descriptor (v0.44, ADR-0143;
 * canonical/alternates added in Beta.2.2, #1326). Either a static object or —
 * via PageHeadResolver — resolved per render from the request-scoped context
 * by resolvePageDocument (@openelement/router/document) before either serializer
 * runs.
 */
export interface PageHead {
  title?: string;
  description?: string;
  meta?: Array<Record<string, string | number | boolean>>;
  /**
   * Canonical URL of this page (Beta.2.2, #1326), resolved into
   * <link rel="canonical"> by the shared Document seam.
   */
  canonical?: string;
  /**
   * Locale alternates of this page (Beta.2.2, #1326), resolved into
   * <link rel="alternate" hreflang="..."> entries in author order.
   */
  alternates?: Array<{ href: string; hreflang?: string }>;
  dangerouslyHeadFragments?: string[];
}

/**
 * The request-scoped context handed to a page's props projector. Everything a
 * compiled page can render must pass through here: the compiled render() only
 * reads `this.<property>`, so the projector is the single deterministic seam
 * that maps loader data, action data, params and request onto the page's
 * compiled properties (v0.44, ADR-0143).
 */
export interface PagePropsContext<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  data: Data | undefined;
  actionData: unknown;
  params: Params;
  request?: Request;
  /** Resolved application locale for this render, when i18n is configured. */
  locale?: string;
  route: PageRouteContext;
  meta: PageMeta;
}

/**
 * Maps the request-scoped context onto the page's compiled properties.
 * Declared as part of the page descriptor; the generated server entry and the
 * SPA bootstrap call it per render and feed the result to renderDsd() props
 * (server) or pre-connect property sets (SPA).
 */
export type PagePropsProjector<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> = (context: PagePropsContext<Data, Params>) => Record<string, unknown>;

/**
 * Maps a caught render/loader/action failure onto the error variant of the
 * page's compiled properties. Its presence declares that the page's compiled
 * markup carries an error variant (the generated entry renders the page with
 * these props and status 500 — the POST/GET error-boundary channel of
 * ADR-0121 §7); without it the generic status page answers.
 */
export type PageErrorProjector<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> = (
  error: unknown,
  context: PagePropsContext<Data, Params>,
) => Record<string, unknown>;

/**
 * Resolves a page's head from the request-scoped context (Beta.2.2, #1326).
 * The resolver receives the same context object the props projector gets and
 * must stay a pure function of it — the Document seam (@openelement/router/
 * document) never fetches, caches, or schedules loaders on its own.
 */
export type PageHeadResolver<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> = (context: PagePropsContext<Data, Params>) => PageHead;

interface PageDescriptorInput<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  route?: PageRouteIntent;
  head?: PageHead | PageHeadResolver<Data, Params>;
  renderIntent?: PageRenderIntent;
  props?: PagePropsProjector<Data, Params>;
  error?: PageErrorProjector<Data, Params>;
}

/**
 * The page descriptor the pipeline reads (`module.default.openElementPage`).
 * Attached to the compiled page class by definePage(); the class owns the
 * render program, so the descriptor carries metadata and projectors only.
 */
export interface OpenElementPageDescriptor<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  kind: 'page';
  route?: PageRouteIntent;
  head?: PageHead | PageHeadResolver<Data, Params>;
  renderIntent: NormalizedPageRenderIntent;
  props?: PagePropsProjector<Data, Params>;
  error?: PageErrorProjector<Data, Params>;
}

/** A compiled element class carrying the page descriptor static. */
export type PageComponentConstructor<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> = CustomElementConstructor & {
  openElementPage: OpenElementPageDescriptor<Data, Params>;
};

const PAGE_DESCRIPTOR_FIELDS = new Set([
  'route',
  'head',
  'renderIntent',
  'props',
  'error',
]);

/**
 * Attach a page descriptor to a compiled page element class.
 *
 * Canonical 0.44 page authoring: the route module default-exports the
 * compiled class (produced by the open:compiled-element transform) wrapped in
 * definePage(). The descriptor holds head/route/renderIntent metadata plus
 * the optional props/error projectors; it must NOT create classes or hold a
 * render function — the compiled class's Part Program is the render.
 *
 *   import { definePage } from '@openelement/router';
 *   import { HomePage } from '../components/page-home.tsx';
 *   export const loader = async (ctx) => ({ ... });   // module named exports
 *   export default definePage(HomePage, {
 *     head: { title: 'Home' },
 *     props: ({ data }) => ({ heading: data?.heading ?? '' }),
 *   });
 */
export function definePage<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
>(
  componentClass: CustomElementConstructor,
  descriptor?: PageDescriptorInput<Data, Params>,
): PageComponentConstructor<Data, Params> {
  if (
    typeof componentClass !== 'function' ||
    // Arrow functions are not constructors (no prototype): the compiled page
    // element class must be one.
    !componentClass.prototype
  ) {
    throw new Error(
      `${ERROR_PREFIX} definePage() requires the compiled page element class as its first ` +
        'argument: definePage(HomePage, { head, renderIntent, props, error }). The class is ' +
        'produced by the open:compiled-element transform (@element(...) class extends OpenElement).',
    );
  }
  if (descriptor !== undefined) {
    if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
      throw new Error(`${ERROR_PREFIX} definePage() requires an object descriptor.`);
    }
    for (const key of Object.keys(descriptor)) {
      if (PAGE_DESCRIPTOR_FIELDS.has(key)) continue;
      throw new Error(
        `${ERROR_PREFIX} definePage() does not accept top-level "${key}". ` +
          'Use only route, head, renderIntent, props, and error. Compiled pages render from ' +
          'their Part Program — there is no render() function field (v0.44).',
      );
    }
    if (descriptor.route && Object.hasOwn(descriptor.route, 'path')) {
      throw new Error(
        `${ERROR_PREFIX} definePage route.path is not supported; the route file owns its URL path.`,
      );
    }
    if (descriptor.props !== undefined && typeof descriptor.props !== 'function') {
      throw new Error(`${ERROR_PREFIX} definePage() props must be a projector function.`);
    }
    if (descriptor.error !== undefined && typeof descriptor.error !== 'function') {
      throw new Error(`${ERROR_PREFIX} definePage() error must be an error projector function.`);
    }
  }
  // ADR-0121 (#572): validate the mode at definition time — a typo like
  // 'dynmaic' must not silently prerender a request-time page.
  const renderMode = descriptor?.renderIntent?.mode ?? 'static';
  if (renderMode !== 'static' && renderMode !== 'dynamic') {
    throw new Error(
      `${ERROR_PREFIX} renderIntent.mode must be 'static' or 'dynamic' ` +
        `(got "${String(descriptor?.renderIntent?.mode)}").`,
    );
  }
  const pageDescriptor: OpenElementPageDescriptor<Data, Params> = {
    kind: 'page',
    ...(descriptor?.route !== undefined ? { route: descriptor.route } : {}),
    ...(descriptor?.head !== undefined ? { head: descriptor.head } : {}),
    renderIntent: {
      mode: renderMode,
    },
    ...(descriptor?.props !== undefined ? { props: descriptor.props } : {}),
    ...(descriptor?.error !== undefined ? { error: descriptor.error } : {}),
  };

  Object.defineProperty(componentClass, 'openElementPage', {
    value: pageDescriptor,
    writable: true,
    configurable: true,
  });
  return componentClass as PageComponentConstructor<Data, Params>;
}

/**
 * Default request-to-props projection used when a page descriptor declares no
 * props projector: route params first, then loader-data record entries. The
 * compiled serializer consumes only the page's declared compiled properties,
 * so extra entries are ignored. Shared by the generated server entries and
 * the SPA bootstrap (each carries its own copy — generated code cannot import
 * this module's internals).
 *
 * Dangerous keys are filtered through the canonical isDangerousKey predicate
 * (#1214): a hostile loader payload such as JSON.parse('{"__proto__": ...}')
 * can never re-prototype the projection record or the page host it is
 * projected onto. The generated server runtime enforces the same rule with a
 * serialized copy of the canonical DANGEROUS_KEYS list.
 */
export function projectPageProps(
  context: { params?: Record<string, string>; data?: unknown },
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context.params ?? {})) {
    if (isDangerousKey(key)) continue;
    props[key] = value;
  }
  const data = context.data;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (isDangerousKey(key)) continue;
      props[key] = value;
    }
  }
  return props;
}

/** Delivery strategy for an island: a hydration trigger or media-gated loading. */
export type IslandDeliveryStrategy = HydrationStrategy | 'media';

/** Per-island delivery configuration (SSR/DSD participation and hydration strategy). */
export interface IslandConfig {
  ssr?: boolean;
  dsd?: boolean;
  /**
   * Hydration strategy — same values as `IslandOptions.hydrate` on the
   * element package (`packages/element/src/internal/protocol/island.ts`):
   * 'load' | 'idle' | 'visible' | 'media' | 'only'.
   */
  hydrate?: IslandDeliveryStrategy;
  /** Media query required by the `media` delivery strategy. */
  media?: string;
  /** Custom-element tags delivered by this one capability module. */
  tags?: readonly string[];
  /** Alias accepted by generated artifact producers. */
  tagNames?: readonly string[];
  /** Named constructor exports keyed by delivered custom-element tag. */
  exportNames?: Readonly<Record<string, string>>;
}

const ISLAND_CONFIG_FIELDS = new Set([
  'ssr',
  'dsd',
  'hydrate',
  'media',
  'tags',
  'tagNames',
  'exportNames',
]);
const ISLAND_DELIVERY_STRATEGIES = [...HYDRATION_STRATEGIES, 'media'] as const;
const HYDRATION_STRATEGY_SET: ReadonlySet<string> = new Set(ISLAND_DELIVERY_STRATEGIES);

function validateIslandMedia(media: unknown): string {
  if (typeof media !== 'string' || media.trim() === '') {
    throw new Error(
      `${ERROR_PREFIX} defineIslandConfig() media must be a non-empty string.`,
    );
  }
  const value = media.trim();
  if (value.length > 512) {
    throw new Error(
      `${ERROR_PREFIX} defineIslandConfig() media contains an unsafe or oversized query.`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(
        `${ERROR_PREFIX} defineIslandConfig() media contains an unsafe or oversized query.`,
      );
    }
  }
  return value;
}

function validateIslandTags(value: unknown, field: 'tags' | 'tagNames'): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${ERROR_PREFIX} defineIslandConfig() ${field} must be a non-empty array.`);
  }
  const seen = new Set<string>();
  return value.map((tag) => {
    if (typeof tag !== 'string' || !isValidTagName(tag) || seen.has(tag)) {
      throw new Error(
        `${ERROR_PREFIX} defineIslandConfig() ${field} contains an invalid or duplicate tag.`,
      );
    }
    seen.add(tag);
    return tag;
  });
}

/** Validate and register an island delivery descriptor; returns the normalized config. */
export function defineIslandConfig(config: IslandConfig): IslandConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${ERROR_PREFIX} defineIslandConfig() requires an object descriptor.`);
  }
  for (const key of Object.keys(config)) {
    if (!ISLAND_CONFIG_FIELDS.has(key)) {
      throw new Error(
        `${ERROR_PREFIX} defineIslandConfig() does not accept "${key}". ` +
          'Use only ssr, dsd, hydrate, media, tags, tagNames, and exportNames.',
      );
    }
  }
  if (config.ssr !== undefined && typeof config.ssr !== 'boolean') {
    throw new Error(`${ERROR_PREFIX} defineIslandConfig() ssr must be a boolean.`);
  }
  if (config.dsd !== undefined && typeof config.dsd !== 'boolean') {
    throw new Error(`${ERROR_PREFIX} defineIslandConfig() dsd must be a boolean.`);
  }
  if (config.hydrate !== undefined && !HYDRATION_STRATEGY_SET.has(config.hydrate)) {
    throw new Error(
      `${ERROR_PREFIX} Invalid island hydrate strategy "${String(config.hydrate)}". ` +
        'Use one of: load, idle, visible, media, only.',
    );
  }
  const media = config.media === undefined ? undefined : validateIslandMedia(config.media);
  if (config.hydrate === 'media' && media === undefined) {
    throw new Error(
      `${ERROR_PREFIX} defineIslandConfig() media is required when hydrate is "media".`,
    );
  }
  if (config.hydrate !== 'media' && media !== undefined) {
    throw new Error(
      `${ERROR_PREFIX} defineIslandConfig() media is only valid with hydrate "media".`,
    );
  }
  const tags = config.tags === undefined ? undefined : validateIslandTags(config.tags, 'tags');
  const tagNames = config.tagNames === undefined
    ? undefined
    : validateIslandTags(config.tagNames, 'tagNames');
  if (
    tags && tagNames &&
    (tags.length !== tagNames.length || tags.some((tag, index) => tag !== tagNames[index]))
  ) {
    throw new Error(`${ERROR_PREFIX} defineIslandConfig() tags and tagNames must agree.`);
  }
  const deliveryTags = tags ?? tagNames;
  const exportNames = config.exportNames;
  if (exportNames !== undefined) {
    if (typeof exportNames !== 'object' || exportNames === null || Array.isArray(exportNames)) {
      throw new Error(`${ERROR_PREFIX} defineIslandConfig() exportNames must be an object.`);
    }
    const allowedTags = new Set(deliveryTags ?? []);
    for (const [tag, exportName] of Object.entries(exportNames)) {
      if (
        !isValidTagName(tag) ||
        (deliveryTags !== undefined && !allowedTags.has(tag)) ||
        typeof exportName !== 'string' ||
        exportName.trim() === '' ||
        (() => {
          for (let index = 0; index < exportName.length; index++) {
            const code = exportName.charCodeAt(index);
            if (code <= 0x1f || code === 0x7f) return true;
          }
          return false;
        })()
      ) {
        throw new Error(
          `${ERROR_PREFIX} defineIslandConfig() exportNames contains an invalid entry.`,
        );
      }
    }
  }
  return {
    ...config,
    ...(media === undefined ? {} : { media }),
    ...(tags === undefined ? {} : { tags }),
    ...(tagNames === undefined ? {} : { tagNames }),
  };
}
