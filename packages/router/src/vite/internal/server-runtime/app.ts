/**
 * @openelement/router/server-runtime — the generated-app factory.
 *
 * `createGeneratedApp` is the assembly half of the generated Hono entry
 * (#1470 block e): the entry's final form is imports + a
 * route descriptor + one factory call, and this module owns the entry
 * assembly — the Hono app and its
 * WinterCG bridge, the composed `openElementHandler` (with the middleware.use
 * onion), the runtime adapter exports, the island client-script plumbing
 * (#951), the SSR registration seam (security.ts), the page-render runtime
 * bindings (renderer/page-props/status/app-shell), and the action body-limit
 * middleware bound to the canonical policy constant.
 *
 * The generated entry still owns route wiring: it imports the route modules,
 * emits the per-route GET/POST/404 wiring, registers components through the
 * guard, and re-exports the factory results under the contract names the
 * consumers read (`default` app, `openElementHandler`, `openElementDevFetch`,
 * `openElementRuntimeAdapter`, `__setRequestTimeClientScript`).
 *
 * Imports stay on the kernel-free leaves: hono, element/logger,
 * element/build-utils, element/authoring — the same leaves the generated
 * entries already carried — so the LIT entry's module graph never reaches the
 * Native runtime kernel (#1339).
 */

import { MAX_ACTION_BODY_BYTES } from '@openelement/element/authoring';
import { composeFetchMiddleware, createRuntimeAdapter } from '@openelement/element/build-utils';
import { Hono } from 'hono';
import type { AppShellPlan } from '../protocol/ssg.ts';
import { createActionBodyLimit, createHonoBridge } from './action-runtime.ts';
import type { HonoBridge } from './action-runtime.ts';
import { createAppShellRuntime, createStatusHtml } from './document-runtime.ts';
import type { AppShellRuntime, StatusHtmlRenderer } from './document-runtime.ts';
import { createPagePropsRuntime } from './page-render.ts';
import type { PagePropsRuntime } from './page-render.ts';
import { createLitPageRenderer, createNativePageRenderer } from './renderer-runtime.ts';
import type {
  LitPageRendererDeps,
  NativePageRendererDeps,
  PageSsrRenderer,
  TrustedHtmlValue,
} from './renderer-runtime.ts';
import { createMethodNotAllowedResponder, createPageHandlerTable } from './route-dispatch.ts';
import { DANGEROUS_KEYS, installSsrRegistryGuard } from './security.ts';

/** The WinterCG fetch middleware a `middleware.use` module default-exports. */
type FetchMiddleware = (request: Request, next: () => Promise<Response>) => Promise<Response>;

/**
 * The page-render seam the entry's Element imports feed (renderer-adapter
 * selected). Present only when the entry has page routes: an API-only entry
 * imports no Element renderer and binds none of it.
 */
export interface GeneratedPageRuntime {
  mode: 'native' | 'lit';
  /** Build-admitted SSR-renderable tags (serialized generated data). */
  ssrRenderableTags: readonly string[];
  trustedHtml: (html: string) => TrustedHtmlValue;
  escapeHtml: (value: string) => string;
  /** native only: the compiled serializer and the SSR registry. */
  renderDsd?: NativePageRendererDeps['renderDsd'];
  customElements?: { get(tag: string): unknown };
  /** lit only: the lit-ssr page renderer. */
  renderLitPageToHtml?: LitPageRendererDeps['renderLitPageToHtml'];
}

/** The route-descriptor data the generated entry hands the factory. */
export interface GeneratedAppConfig {
  /** Build-time island map: tag -> client module path (#951 upgrade URLs). */
  islands: Record<string, string>;
  /** The build's shell plan (serialized generated data). */
  appShellPlan: AppShellPlan;
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
  /** The Hono app — the entry's default export. */
  app: Hono;
  /**
   * The internal Hono↔WinterCG bridge: `contexts` feeds the entry's
   * `app.all('*')` request hook, `asFetchHandler`/`asFetchMiddleware` adapt
   * every generated page handler onto the WinterCG route middleware.
   */
  hono: HonoBridge;
  /**
   * The WinterCG request handler: `app.fetch` with the fetch-middleware
   * onion composed around it when `middleware.use` is configured (#858).
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
  /** Request-time client-script src setter (`dist/server/index.js` startup). */
  setRequestTimeClientScript(src: string | null | undefined): void;
  /** wrapInDocument `scripts` descriptors for the current runtime mode (#951). */
  clientScriptDescriptors(): Array<{ type: 'module'; src: string }>;
  locales: readonly string[];
  getDefaultLocale(): string;
  /** Page-render bindings — present only when the config carried `pageRuntime`. */
  ssr?: PageSsrRenderer;
  pageProps?: PagePropsRuntime['pageProps'];
  pageErrorProps?: PagePropsRuntime['pageErrorProps'];
  statusHtml?: StatusHtmlRenderer;
  resolveAppShell?: AppShellRuntime['resolveAppShell'];
  renderAppShell?: AppShellRuntime['renderAppShell'];
}

/**
 * Assembles the generated Hono app from the entry's route descriptor.
 * Pure factory: descriptor data in, handler contract out — every emitted
 * call site in the entry binds a property of the returned record.
 */
export function createGeneratedApp(config: GeneratedAppConfig): GeneratedApp {
  const app = new Hono();
  const bridge: HonoBridge = createHonoBridge();
  const guard = installSsrRegistryGuard();

  // #951: one render-time seam for the island client entry. The dev URL was
  // computed by the entry from its compile-time import.meta.env constants;
  // the prod src arrives from whoever knows the final asset addresses — the
  // generated dist/server/index.js at request-time startup, and the SSG
  // build before prerendering (both hand in the Phase 2 client asset
  // manifest's entry URL, #1471). The descriptors ride the resolved
  // document, so every render channel serializes the same tag.
  let requestTimeClientScriptSrc: string | null = null;
  const clientScriptDescriptors = () => {
    const src = config.devClientScriptSrc || requestTimeClientScriptSrc;
    return src ? [{ type: 'module' as const, src }] : [];
  };

  // The composed handler contract (#858): fetch middleware
  // composes at the handler boundary in onion order (use[0] outermost),
  // outside the Hono app, so the dev server, the start CLI, the e2e fixture
  // server, and the Nitro production entry share one composed handler.
  const baseHandler = (
    request: Request,
    context: { env?: unknown; platform?: unknown } = {},
  ): Promise<Response> =>
    Promise.resolve(
      app.fetch(
        request,
        (context.env || {}) as Record<string, unknown>,
        context.platform as Parameters<typeof app.fetch>[2],
      ),
    );
  const fetchMiddleware = config.fetchMiddleware ?? [];
  const handler =
    fetchMiddleware.length > 0
      ? composeFetchMiddleware([...fetchMiddleware], baseHandler)
      : baseHandler;

  const generated: GeneratedApp = {
    app,
    hono: bridge,
    handler,
    ...(fetchMiddleware.length > 0
      ? {
          devFetch: {
            // The dev server (@hono/vite-dev-server) reads this named export
            // instead of the default Hono app when middleware.use is configured
            // (see plugin.ts); it adapts the (request, env, executionCtx) call
            // shape onto the same composed handler every other runtime uses.
            fetch: (request: Request, env: unknown, executionContext: unknown) =>
              handler(request, { env: env || {}, platform: executionContext }),
          },
        }
      : {}),
    runtimeAdapter: {
      ...createRuntimeAdapter({ name: 'openelement-hono', fetch: handler }),
    },
    pageHandlers: createPageHandlerTable(config.pageHandlerPaths),
    apiRouteRecords: [],
    methodNotAllowed: createMethodNotAllowedResponder(bridge.contexts),
    actionBodyLimit: createActionBodyLimit(MAX_ACTION_BODY_BYTES),
    registerSsrComponent: (tag, ctor) => guard.register(tag, ctor),
    setRequestTimeClientScript: (src) => {
      requestTimeClientScriptSrc = src || null;
    },
    clientScriptDescriptors,
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
    const ssr =
      page.mode === 'native'
        ? createNativePageRenderer({
            renderDsd: page.renderDsd!,
            customElements: page.customElements!,
            ssrRenderableTags: page.ssrRenderableTags,
          })
        : createLitPageRenderer({ renderLitPageToHtml: page.renderLitPageToHtml! });
    const appShell = createAppShellRuntime({
      ssr,
      trustedHtml: page.trustedHtml,
      appShellPlan: config.appShellPlan,
      locales: config.locales,
      navSections: config.navSections,
      headerNav: config.headerNav,
      defaultLocale: config.defaultLocale,
    });
    const props = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
    generated.ssr = ssr;
    generated.statusHtml = createStatusHtml(page.escapeHtml);
    generated.resolveAppShell = appShell.resolveAppShell;
    generated.renderAppShell = appShell.renderAppShell;
    generated.pageProps = props.pageProps;
    generated.pageErrorProps = props.pageErrorProps;
  }

  return generated;
}
