/**
 * @openelement/router/server-runtime — the generated-app factory.
 *
 * `createGeneratedApp` is the assembly half of the generated server entry
 * (#1470 block e): the entry's final form is imports + a
 * route descriptor + one factory call, and this module owns the entry
 * assembly — the internal WinterCG composition layer (#1560: the middleware
 * chain, the fn-form API mounts, and the 404 terminal — no Hono), the
 * composed `openElementHandler` (with the middleware.use onion), the
 * runtime adapter exports, the island client-script plumbing (#951), the
 * SSR registration seam (security.ts), the page-render runtime
 * bindings (renderer/page-props/status/layout), and the action body-limit
 * middleware bound to the canonical policy constant.
 *
 * The generated entry still owns route wiring: it imports the route modules,
 * emits the per-route GET/POST/404 wiring, registers components through the
 * guard, and re-exports the factory results under the contract names the
 * consumers read (`default` app, `openElementHandler`, `openElementDevFetch`,
 * `openElementRuntimeAdapter`, `__setRequestTimeClientScript`).
 *
 * Imports stay on the kernel-free leaves: element/logger,
 * element/build-utils, element/authoring — the same leaves the generated
 * entries already carried — so the LIT entry's module graph never reaches the
 * Native runtime kernel (#1339). Hono is an optional peer behind the single
 * `@openelement/router/hono` adapter and never appears in this graph.
 */

import { MAX_ACTION_BODY_BYTES } from '@openelement/element/authoring';
import { composeFetchMiddleware, createRuntimeAdapter } from '@openelement/element/build-utils';
import type { LayoutPlan } from '@openelement/protocol/ssg';
import type { ClientIslandAsset } from '@openelement/protocol/client-assets';
import type { ClientScriptDescriptor } from '../../../loading/module/nonce.ts';
import {
  ISLAND_CATALOGUE_SCRIPT_TYPE,
  resolveDocumentIslandCatalogue,
} from '../ssg/document-island-catalogue.ts';
import { visitRenderedTags, type RenderedTag } from '../ssg/rendered-html.ts';
import { createActionBodyLimit } from './action-runtime.ts';
import { createLayoutRuntime, createStatusHtml } from './document-runtime.ts';
import type { LayoutRuntime, StatusHtmlRenderer } from './document-runtime.ts';
import { createPagePropsRuntime } from './page-render.ts';
import type { PagePropsRuntime } from './page-render.ts';
import { createNativePageRenderer } from './renderer-runtime.ts';
import type {
  NativePageRendererDeps,
  PageSsrRenderer,
  TrustedHtmlValue,
} from './renderer-runtime.ts';
import { createMethodNotAllowedResponder, createPageHandlerTable } from './route-dispatch.ts';
import { DANGEROUS_KEYS, installSsrRegistryGuard } from './security.ts';
import { createWinterCgApp } from './wintercg.ts';
import type { OpenElementRequestScope, WinterCgApp } from './wintercg.ts';

/** The WinterCG fetch middleware a `middleware.use` module default-exports. */
type FetchMiddleware = (request: Request, next: () => Promise<Response>) => Promise<Response>;

/**
 * The page-render seam the entry's Element imports feed (renderer-adapter
 * selected). Present only when the entry has page routes: an API-only entry
 * imports no Element renderer and binds none of it.
 */
export interface GeneratedPageRuntime {
  mode: 'native';
  /** Build-admitted SSR-renderable tags (serialized generated data). */
  ssrRenderableTags: readonly string[];
  trustedHtml: (html: string) => TrustedHtmlValue;
  escapeHtml: (value: string) => string;
  /** The compiled serializer and the SSR registry. */
  renderToString?: NativePageRendererDeps['renderToString'];
  customElements?: { get(tag: string): unknown };
}

/** The route-descriptor data the generated entry hands the factory. */
export interface GeneratedAppConfig {
  /** Build-time island map: tag -> client module path (#951 upgrade URLs). */
  islands: Record<string, string>;
  /** Dev delivery tags with a client upgrade strategy. */
  clientIslandTags?: readonly string[];
  /** The build's layout plan (serialized generated data). */
  layoutPlan: LayoutPlan;
  /** Declared project locales (serialized generated data). */
  locales: readonly string[];
  /** Nav sections (serialized generated data; empty on the 1.0 surface). */
  navSections: readonly unknown[];
  /** Header nav links (serialized generated data; empty on the 1.0 surface). */
  headerNav: readonly Record<string, unknown>[];
  /** The project's default locale (generated data). */
  defaultLocale: string;
  /**
   * The dev island-client URL the entry computed from its compile-time
   * `import.meta.env` constants; null when the app ships no client entry.
   */
  devClientScriptSrc: string | null;
  /** Page route paths, in route order — the handler table's keys. */
  pageHandlerPaths: readonly string[];
  /** `middleware.use` module defaults, user-configured order (use[0] outermost). */
  fetchMiddleware?: readonly FetchMiddleware[];
  pageRuntime?: GeneratedPageRuntime;
}

/** Everything the generated entry destructures and re-exports. */
export interface GeneratedApp {
  /** The internal WinterCG app — the entry's default export. */
  app: WinterCgApp;
  /**
   * The per-request scope accessor the generated handlers bind
   * (`__requestScope`): one scope per dispatch, keyed by request identity.
   */
  requestScope: (request: Request) => OpenElementRequestScope | undefined;
  /**
   * The WinterCG request handler: the app's composed dispatch with the
   * fetch-middleware onion composed around it when `middleware.use` is
   * configured (#858).
   */
  handler: (request: Request, context?: { env?: unknown; platform?: unknown }) => Promise<Response>;
  /** Dev-server boundary export, present only with `middleware.use` (#858). */
  devFetch?: {
    fetch: (request: Request, env: unknown, executionContext: unknown) => Promise<Response>;
  };
  /** Deployment adapter record (`openElementRuntimeAdapter`). */
  runtimeAdapter: Record<string, unknown>;
  /** Per-path page handler table the generated GET/POST wiring populates. */
  pageHandlers: Record<string, Record<string, unknown>>;
  /** API route records the generated API wiring pushes into. */
  apiRouteRecords: Array<{ id: string; path: string; handlers: unknown }>;
  /** The 405 responder for `createRouteMiddleware({ methodNotAllowed })` (#572). */
  methodNotAllowed: (request: Request, allow: string[]) => Response;
  /** The default action body-limit middleware (#568), bound to the policy constant. */
  actionBodyLimit: ReturnType<typeof createActionBodyLimit>;
  /** SSR registration seam (security.ts). */
  registerSsrComponent(tag: string, ctor: unknown): void;
  /**
   * Generated-island registration seam (M11): pairs the generated element
   * class with its compiler-emitted host renderer atomically, through the same
   * guard owner. The generated entry calls it only for ssr-admitted islands
   * whose compiler fact names a host producer.
   */
  registerSsrIsland(tag: string, ctor: unknown, hostRenderer: unknown): void;
  /** Request-time client-script src setter (`dist/server/index.js` startup). */
  setRequestTimeClientScript(
    src: string | null | undefined,
    islands?: readonly string[] | Readonly<Record<string, ClientIslandAsset>>,
    entryPreloads?: readonly string[],
  ): void;
  /** wrapInDocument `scripts` descriptors for the rendered document (#951). */
  clientScriptDescriptors(html?: string, executableHead?: string): ClientScriptDescriptor[];
  clientDocumentResources(
    html?: string,
    executableHead?: string,
  ): {
    scripts: ClientScriptDescriptor[];
    entryPreloads?: readonly string[];
  };
  locales: readonly string[];
  getDefaultLocale(): string;
  /** Page-render bindings — present only when the config carried `pageRuntime`. */
  ssr?: PageSsrRenderer;
  pageProps?: PagePropsRuntime['pageProps'];
  pageErrorProps?: PagePropsRuntime['pageErrorProps'];
  statusHtml?: StatusHtmlRenderer;
  resolveLayout?: LayoutRuntime['resolveLayout'];
  renderLayout?: LayoutRuntime['renderLayout'];
}

const DATA_SCRIPT_TYPES = new Set([
  'application/json',
  ISLAND_CATALOGUE_SCRIPT_TYPE,
  'application/ld+json',
  'importmap',
  'speculationrules',
]);

function canRunAuthoredScript({ name, attributes }: RenderedTag): boolean {
  if (
    name === 'script' &&
    !DATA_SCRIPT_TYPES.has(attributes.get('type')?.trim().toLowerCase() ?? '')
  ) {
    return true;
  }
  for (const attribute of attributes.keys()) {
    if (attribute.startsWith('on')) return true;
  }
  return false;
}

const FRAME_TAGS = new Set(['iframe', 'object', 'embed']);
// The rendered-tag walker reads raw attribute text. Only the references that
// can contribute to an ASCII JavaScript scheme or its URL whitespace matter.
const SCRIPT_URL_CHARACTER = /&(?:#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?|colon;|Tab;|NewLine;)/g;

function isJavaScriptUrl(value: string | undefined): boolean {
  if (!value) return false;
  const decoded = value.replace(SCRIPT_URL_CHARACTER, (entity, hex, decimal) => {
    if (entity === '&colon;') return ':';
    if (entity === '&Tab;') return '\t';
    if (entity === '&NewLine;') return '\n';
    const code = hex === undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x7f ? String.fromCharCode(code) : entity;
  });
  const normalized = decoded.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < normalized.length && normalized.charCodeAt(start) <= 0x20) start++;
  return normalized.slice(start).toLowerCase().startsWith('javascript:');
}

function hasJavaScriptNavigation({ name, attributes }: RenderedTag): boolean {
  switch (name) {
    case 'a':
    case 'area':
      return isJavaScriptUrl(attributes.get('href') ?? attributes.get('xlink:href'));
    case 'form':
      return isJavaScriptUrl(attributes.get('action'));
    case 'button':
    case 'input':
      return isJavaScriptUrl(attributes.get('formaction'));
    case 'iframe':
      return !attributes.has('sandbox') && isJavaScriptUrl(attributes.get('src'));
    default:
      return false;
  }
}

function documentClientFacts(
  html: string | undefined,
  islands: ReadonlySet<string>,
  executableHead: string | undefined,
) {
  const observed = new Set<string>();
  let enhanced = false;
  let fragments = false;
  let authoredCode = html === undefined;
  let opaque = false;
  if (html !== undefined) {
    const complete = visitRenderedTags(html, (tag) => {
      const { name, attributes, inOpenShadow } = tag;
      if (islands.has(name)) observed.add(name);
      if (name === 'form' && attributes.has('data-open-enhance')) enhanced = true;
      if (inOpenShadow && attributes.get('id')) fragments = true;
      if (canRunAuthoredScript(tag) || hasJavaScriptNavigation(tag)) authoredCode = true;
      if (FRAME_TAGS.has(tag.name) || tag.attributes.has('is')) opaque = true;
    });
    authoredCode ||= !complete;
  }
  if (executableHead && !authoredCode) {
    const complete = visitRenderedTags(executableHead, (tag) => {
      if (canRunAuthoredScript(tag) || hasJavaScriptNavigation(tag)) authoredCode = true;
      if (FRAME_TAGS.has(tag.name) || tag.attributes.has('is')) opaque = true;
      return !authoredCode;
    });
    authoredCode ||= !complete;
  }
  return { observed, enhanced, fragments, authoredCode, opaque };
}

function isIslandTagList(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * Assembles the generated app from the entry's route descriptor.
 * Pure factory: descriptor data in, handler contract out — every emitted
 * call site in the entry binds a property of the returned record.
 */
export function createGeneratedApp(config: GeneratedAppConfig): GeneratedApp {
  const app = createWinterCgApp();
  const guard = installSsrRegistryGuard();

  // #951: one render-time seam for the island client entry. The dev URL was
  // computed by the entry from its compile-time import.meta.env constants;
  // the prod src arrives from whoever knows the final asset addresses — the
  // generated dist/server/index.js at request-time startup, and the SSG
  // build before prerendering (both hand in the Phase 2 client asset
  // manifest's entry URL and delivery tags, #1471). A caller that has
  // rendered the body can select the descriptor from the actual document.
  let requestTimeClientScriptSrc: string | null = null;
  const devIslandTags = new Set(config.clientIslandTags ?? Object.keys(config.islands));
  let requestTimeIslandTags = devIslandTags;
  let requestTimeIslands: Readonly<Record<string, ClientIslandAsset>> | undefined;
  let requestTimeEntryPreloads: readonly string[] = [];
  const fetchMiddleware = config.fetchMiddleware ?? [];
  const clientScriptDescriptors = (
    html?: string,
    executableHead?: string,
  ): ClientScriptDescriptor[] => {
    const src = config.devClientScriptSrc || requestTimeClientScriptSrc;
    if (!src) return [];
    const islands = config.devClientScriptSrc ? devIslandTags : requestTimeIslandTags;
    const facts = documentClientFacts(html, islands, executableHead);
    // An enhanced response can morph islands in from any eligible route.
    // Fetch middleware can replace the body after route rendering.
    const authored = facts.authoredCode || fetchMiddleware.length > 0;
    if (!authored && facts.observed.size === 0 && !facts.enhanced && !facts.fragments) return [];
    const module = { type: 'module', src };
    if (config.devClientScriptSrc || !requestTimeIslands) return [module];
    const catalogue = resolveDocumentIslandCatalogue(
      requestTimeIslands,
      facts.observed,
      authored || facts.opaque || facts.enhanced,
    );
    if (
      catalogue.length === 0 &&
      !Object.values(requestTimeIslands).some((asset) => asset.activation)
    )
      return [module];
    const code = JSON.stringify(catalogue).replaceAll('<', '\\u003c');
    return [{ type: ISLAND_CATALOGUE_SCRIPT_TYPE, code }, module];
  };

  // The composed handler contract (#858): fetch middleware
  // composes at the handler boundary in onion order (use[0] outermost),
  // outside the app's own chain, so the dev server, the start CLI, the e2e
  // fixture server, and the Nitro production entry share one composed
  // handler.
  type HandlerContext = { env?: unknown; platform?: unknown };
  const dispatchApp = (request: Request, context: HandlerContext = {}): Promise<Response> =>
    app.fetch(request, (context.env || {}) as Record<string, unknown>, context.platform);
  const handler =
    fetchMiddleware.length > 0
      ? composeFetchMiddleware([...fetchMiddleware], dispatchApp)
      : dispatchApp;

  const generated: GeneratedApp = {
    app,
    requestScope: app.requestScope,
    handler,
    ...(fetchMiddleware.length > 0
      ? {
          devFetch: {
            // The dev server (@hono/vite-dev-server) reads this named export
            // instead of the default app when middleware.use is configured
            // (see plugin.ts); it adapts the (request, env, executionCtx) call
            // shape onto the same composed handler every other runtime uses.
            fetch: (request: Request, env: unknown, executionContext: unknown) =>
              handler(request, { env: env || {}, platform: executionContext }),
          },
        }
      : {}),
    runtimeAdapter: {
      ...createRuntimeAdapter({ name: 'openelement', fetch: handler }),
    },
    pageHandlers: createPageHandlerTable(config.pageHandlerPaths),
    apiRouteRecords: [],
    methodNotAllowed: createMethodNotAllowedResponder(),
    actionBodyLimit: createActionBodyLimit(MAX_ACTION_BODY_BYTES),
    registerSsrComponent: (tag, ctor) => guard.register(tag, ctor),
    registerSsrIsland: (tag, ctor, hostRenderer) => guard.registerIsland(tag, ctor, hostRenderer),
    setRequestTimeClientScript: (src, islands, entryPreloads = []) => {
      requestTimeClientScriptSrc = src || null;
      requestTimeIslands = isIslandTagList(islands) ? undefined : islands;
      requestTimeEntryPreloads = entryPreloads;
      const tags = isIslandTagList(islands) ? islands : islands && Object.keys(islands);
      requestTimeIslandTags = tags === undefined ? devIslandTags : new Set(tags);
    },
    clientScriptDescriptors,
    clientDocumentResources: (html, executableHead) => {
      const scripts = clientScriptDescriptors(html, executableHead);
      return scripts.length > 0 && !config.devClientScriptSrc && requestTimeEntryPreloads.length > 0
        ? { scripts, entryPreloads: requestTimeEntryPreloads }
        : { scripts };
    },
    locales: config.locales,
    getDefaultLocale: () => config.defaultLocale,
  };

  // The page-render seam binds to the entry's injected
  // Element functions and its serialized build data. The
  // dangerous keys are the canonical policy imported from the kernel-free
  // /authoring leaf: the entry carries no serialized copy of it (#1214,
  // #1470 block e).
  const page = config.pageRuntime;
  if (page) {
    const ssr = createNativePageRenderer({
      renderToString: page.renderToString!,
      customElements: page.customElements!,
      ssrRenderableTags: page.ssrRenderableTags,
    });
    const layout = createLayoutRuntime({
      ssr,
      trustedHtml: page.trustedHtml,
      layoutPlan: config.layoutPlan,
      locales: config.locales,
      navSections: config.navSections,
      headerNav: config.headerNav,
      defaultLocale: config.defaultLocale,
    });
    const props = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
    generated.ssr = ssr;
    generated.statusHtml = createStatusHtml(page.escapeHtml);
    generated.resolveLayout = layout.resolveLayout;
    generated.renderLayout = layout.renderLayout;
    generated.pageProps = props.pageProps;
    generated.pageErrorProps = props.pageErrorProps;
  }

  return generated;
}
