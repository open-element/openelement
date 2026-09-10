/**
 * @openelement/app - SPA (Single Page Application) bootstrap.
 *
 * Creates a client-side SPA with history-based routing, loader/action
 * data flow, and form action interception.
 */
import {
  createRouter,
  type RouteConfig,
  type RouterInstance,
  type RouterMode,
} from './internal/router/client-router.ts';
import { normalizeActionFailure, normalizeLoaderFailure } from './internal/action-error.ts';
import {
  classifyActionResult,
  isOpenElementNotFound,
  isOpenElementRedirect,
  projectPageProps,
} from './authoring.ts';
import type { OpenElementPageDescriptor, PagePropsContext } from './authoring.ts';
import { SpaRequestCache } from './internal/spa-request-cache.ts';
import { isDevMode } from './internal/dev-mode.ts';
import { assertValidTagName, ERROR_PREFIX, injectPropsSafe } from '@openelement/element/authoring';
import { createLogger } from '@openelement/element/logger';

const log = createLogger('spa');

const development = isDevMode();

/** Read the page descriptor definePage() attached to the registered class. */
function pageDescriptorOf(tagName: string): OpenElementPageDescriptor | undefined {
  if (typeof customElements === 'undefined') return undefined;
  const ctor = customElements.get(tagName) as
    | (CustomElementConstructor & { openElementPage?: OpenElementPageDescriptor })
    | undefined;
  return ctor?.openElementPage;
}

/**
 * Project loader/action state onto a compiled page host (v0.44): the page's
 * compiled properties receive the projected values as pre-connect own
 * properties, which the element facade reconciles into the compiled signals
 * at connect. Without a descriptor projector the default projection applies
 * (params + loader-data record entries); the error projector, when declared,
 * wins on the loader/action failure channel so the page's error variant
 * renders — mirroring the server entry chain.
 *
 * The write boundary is the canonical guarded assigner injectPropsSafe
 * (#1214): dangerous keys from any projector (default, props, or error) are
 * dropped with a warning, so projected data can never re-prototype the live
 * page host (e.g. JSON.parse('{"__proto__": ...}') loader payloads).
 */
function applyCompiledPageProps(
  el: HTMLElement,
  route: RouteConfig,
  context: PagePropsContext,
  error: unknown,
): void {
  const descriptor = pageDescriptorOf(route.tagName);
  const projected = error !== undefined && typeof descriptor?.error === 'function'
    ? descriptor.error(error, context)
    : typeof descriptor?.props === 'function'
    ? descriptor.props(context)
    : projectPageProps(context);
  injectPropsSafe(
    el as HTMLElement & Record<string, unknown>,
    (projected ?? {}) as Record<string, unknown>,
    route.tagName,
    log,
  );
}

// ─── Public types ──────────────────────────────────────────────

interface SpaAppOptions {
  mode: 'spa';
  /** Route definitions. If omitted, no routes are registered. */
  routes?: RouteConfig[];
  /** Router mode. Defaults to auto: history on http(s), hash on file://. */
  routerMode?: RouterMode;
}

/** A mounted SPA: idempotent mount/dispose plus the client-side router instance. */
export interface SpaAppInstance {
  /** Mount the SPA into the given CSS selector. Idempotent — re-mount starts fresh. */
  mount(selector: string): void;
  /** Dispose the SPA: clear DOM, dispose router, and remove listeners. Idempotent. */
  dispose(): void;
  /** The client-side router instance. Null before mount. */
  readonly router: RouterInstance | null;
}

// ─── defineApp ─────────────────────────────────────────────────

/** Define a client-side SPA application: route table, router mode and mount/dispose lifecycle. */
export function defineApp(options: SpaAppOptions): SpaAppInstance {
  let router: RouterInstance | null = null;
  let rootEl: Element | null = null;
  let submitHandler: ((e: Event) => void) | null = null;
  let renderId = 0;
  let execution = new AbortController();
  function cancelPending(): void {
    execution.abort();
    execution = new AbortController();
    renderId++;
  }
  let currentLoaderData: unknown;
  let currentLoaderError: unknown;
  let currentActionData: unknown;
  const requestCache = new SpaRequestCache();

  /**
   * Run loader for current route (if any). On failure returns a normalized
   * page error (#676) instead of fake loader data — the error rides the page
   * error channel (the descriptor's error projector, v0.44), mirroring the
   * action failure channel (normalizeActionFailure), so pages render their
   * error variant rather than silently receiving an empty data shape.
   *
   * redirect()/notFound() are control flow, not failures (#731): a redirect
   * navigates the router (a committed navigation bumps renderId, so the
   * in-flight render cycle aborts before committing; a guard-vetoed redirect
   * is flagged via `redirected` so the caller keeps the current page data
   * instead of clearing it — #802), and a notFound rides the same page error
   * channel with the original error so the error projector can read its 404
   * status/message — mirroring the server chain.
   */
  async function runLoader(
    ticket = renderId,
  ): Promise<{ data: unknown; error?: unknown; redirected?: boolean }> {
    if (!router) return { data: undefined };
    const route = router.currentRoute;
    if (!route?.loader) return { data: undefined };
    try {
      return {
        data: await route.loader({
          params: router.params,
          searchParams: router.searchParams,
          signal: execution.signal,
        }),
      };
    } catch (err) {
      if (isOpenElementRedirect(err)) {
        // Skip navigation if the app was disposed while the loader awaited.
        if (router && ticket === renderId) await router.navigate(err.location);
        return { data: undefined, redirected: true };
      }
      if (isOpenElementNotFound(err)) {
        return { data: undefined, error: err };
      }
      return { data: undefined, error: normalizeLoaderFailure(err, development, log.error) };
    }
  }

  /** Render the current custom-element route into rootEl. */
  function renderComponent(): void {
    if (!router || !rootEl) return;
    const route = router.currentRoute;
    rootEl.innerHTML = '';

    if (!route) return;

    // tagName is required by RouteConfig. Validate before touching the DOM so a
    // malformed value fails loudly (SyntaxError) instead of silently rendering
    // nothing (#642).
    assertValidTagName(route.tagName);

    // Unregistered custom elements would render as inert, empty hosts. Warn and
    // skip rendering rather than injecting an unknown element (#642).
    if (typeof customElements !== 'undefined' && !customElements.get(route.tagName)) {
      log.warn(`unregistered tagName: ${route.tagName}`);
      return;
    }

    const el = document.createElement(route.tagName);
    const request = typeof location === 'undefined' ? undefined : requestCache.get(
      new URL(router.currentPath || '/', location.href).href,
    );
    applyCompiledPageProps(el, route, {
      data: currentLoaderData,
      actionData: currentActionData,
      params: router.params,
      request,
      route: { path: route.path },
      meta: {},
    }, currentLoaderError);
    rootEl.appendChild(el);
  }

  /**
   * Full render cycle: pop old data → run loader → push loader data → render component.
   */
  async function renderRoute(): Promise<void> {
    if (!router || !rootEl) return;
    const currentRender = ++renderId;

    // Load before committing so stale navigations cannot overwrite the current route.
    const { data: loaderData, error: loaderError, redirected } = await runLoader();
    if (currentRender !== renderId || !router || !rootEl) return;
    // A guard vetoed the loader's redirect: the navigation never committed, so
    // keep the current page's loader data rather than re-rendering with
    // `data: undefined` — mirroring the action redirect path (#802).
    if (redirected) return;
    currentLoaderData = loaderData;
    currentLoaderError = loaderError;
    currentActionData = undefined;

    renderComponent();
  }

  /** Duck-type check: is this element a form? Works in test environments without HTMLElement globals. */
  function isFormElement(el: unknown): el is HTMLFormElement {
    return (
      el !== null &&
      typeof el === 'object' &&
      'tagName' in el &&
      (el as { tagName: string }).tagName === 'FORM'
    );
  }

  function createFormData(form: HTMLFormElement): FormData | undefined {
    try {
      return new FormData(form);
    } catch (err) {
      log.warn('FormData construction failed; action runs without form data:', err);
      return undefined;
    }
  }

  /**
   * Handle form submissions via event delegation on the root element.
   * Runs the current route's action, re-runs the loader, pushes both
   * loader and action data, then re-renders the component.
   */
  async function handleFormSubmit(event: Event): Promise<void> {
    // A submit event originating inside a shadow tree is only visible here
    // when it was dispatched as composed — the native submit behavior of a
    // shadow <button> never crosses the boundary, which is why open-button
    // explicitly re-dispatches a composed submit on the form (see
    // open-button.tsx). By the time that event bubbles out to this root
    // listener, event.target is retargeted to the shadow host (e.g.
    // open-button), NOT the <form>. Use composedPath() to find the actual
    // form in the shadow tree.
    let form: unknown = event.target;
    if (!isFormElement(form)) {
      const path = event.composedPath();
      for (const node of path) {
        if (isFormElement(node)) {
          form = node;
          break;
        }
      }
    }
    if (!isFormElement(form)) return;
    if (!router || !rootEl) return;

    const route = router.currentRoute;
    if (!route?.action) return;
    const currentRender = ++renderId;

    event.preventDefault();

    // Run action
    let actionData: unknown = undefined;
    try {
      const outcome = classifyActionResult(
        await route.action({
          params: router.params,
          searchParams: router.searchParams,
          signal: execution.signal,
          formData: createFormData(form),
        }),
      );
      actionData = outcome.data;
    } catch (err) {
      // #731: redirect()/notFound() are control flow, not action failures —
      // they must not be normalized into `{ error: 'Action failed' }` data.
      if (isOpenElementRedirect(err)) {
        // PRG: navigate to the redirect target; its own render cycle renders
        // the destination. Skip if the app was disposed while awaiting.
        if (router && currentRender === renderId) await router.navigate(err.location);
        return;
      }
      if (isOpenElementNotFound(err)) {
        // Mirror the server chain: render the page error channel with the
        // original 404 error instead of re-running the loader.
        if (currentRender !== renderId || !router || !rootEl) return;
        currentLoaderError = err;
        currentActionData = undefined;
        renderComponent();
        return;
      }
      actionData = normalizeActionFailure(err, development, log.error);
    }

    if (currentRender !== renderId || !router || !rootEl) return;
    // Re-run loader for fresh data
    const { data: loaderData, error: loaderError, redirected } = await runLoader();
    if (currentRender !== renderId || !router || !rootEl) return;
    // A guard vetoed the loader's redirect: the navigation never committed, so
    // keep the current page's data rather than re-rendering with
    // `data: undefined` — same guard as renderRoute (#802, #810).
    if (redirected) return;

    currentLoaderData = loaderData;
    currentLoaderError = loaderError;
    currentActionData = actionData;

    renderComponent();
  }

  function mount(selector: string): void {
    // Clean up any previous mount (idempotent re-mount)
    if (router) {
      dispose();
    }
    // Each mount gets a fresh execution controller: the previous mount's
    // signal stays aborted (stale loaders/actions must not commit) while the
    // new mount's initial loader/action runs un-aborted.
    execution = new AbortController();
    renderId++;

    const el = document.querySelector(selector);
    if (!el) {
      throw new Error(`${ERROR_PREFIX} Mount target not found: "${selector}"`);
    }
    rootEl = el;

    router = createRouter({
      mode: options.routerMode ?? 'auto',
      routes: options.routes ?? [],
      onPending: cancelPending,
      onChange: renderRoute,
    });

    /** Intercept form submissions for action support. */
    submitHandler = (e: Event) => {
      void handleFormSubmit(e).catch((err) => {
        log.error('form submit failed:', err);
      });
    };
    rootEl.addEventListener('submit', submitHandler);

    // Initial render for the current URL
    void renderRoute().catch((err) => {
      log.error('initial render failed:', err);
    });
  }

  function dispose(): void {
    execution.abort();
    // Remove form submit listener
    renderId++;
    if (submitHandler && rootEl) {
      rootEl.removeEventListener('submit', submitHandler);
      submitHandler = null;
    }

    if (router) {
      router.dispose();
      router = null;
    }
    if (rootEl) {
      rootEl.innerHTML = '';
      rootEl = null;
    }

    currentLoaderData = undefined;
    currentLoaderError = undefined;
    currentActionData = undefined;
    requestCache.clear();
  }

  return {
    mount,
    dispose,
    get router() {
      return router;
    },
  };
}
