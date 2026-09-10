/**
 * @openelement/app/internal/router/client-router - URLPattern/RouteTable client router.
 *
 * Supports history (pushState), hash, and auto-detection modes.
 * Alpha.9 authority: URLPattern owns pathname grammar and RouteTable owns
 * declaration order, separate query/captures, and HTTP policy.
 *
 * Alpha.9 removes client-local route grammars and compatibility matchers so
 * browser navigation and the other route consumers share one semantic owner.
 */
// SPA loader/action contexts are deliberately narrower than the request-time
// LoaderContext/ActionContext: the client-side chain supplies only params
// (+ formData for actions) and signals failure by throwing (#570, ADR-0119
// frozen semantics — types clarified, runtime unchanged).
import { type RouteMatch, type RouteRecord, RouteTable } from './route-table.ts';

const ERROR_PREFIX = '[openElement]';
const log = {
  error: (...args: unknown[]) => console.error('[router]', ...args),
};

export interface SpaLoaderContext {
  params: Record<string, string>;
}

export interface SpaActionContext extends SpaLoaderContext {
  formData?: FormData;
}

export type RouterMode = 'history' | 'hash' | 'auto';

export interface RouteConfig extends RouteRecord {
  /** Custom element tag to instantiate directly in SPA mode. */
  tagName: string;
  /** Client-side loader — runs before component render. Receives matched route params. */
  loader?: (
    ctx: SpaLoaderContext & { searchParams: URLSearchParams; signal: AbortSignal },
  ) => Promise<unknown>;
  /** Client-side action — runs on form submit. Receives matched route params and form data. */
  action?: (
    ctx: SpaActionContext & { searchParams: URLSearchParams; signal: AbortSignal },
  ) => Promise<unknown>;
  guard?: () => Promise<boolean | string>;
}

interface RouterOptions {
  mode: RouterMode;
  routes: RouteConfig[];
  /** Called after navigation or browser history/hash changes update the current match. */
  onChange?: () => void | Promise<void>;
  /** Invalidate pending execution as soon as a newer navigation owns intent. */
  onPending?: () => void;
}

export interface RouterInstance {
  navigate(path: string): Promise<void>;
  replace(path: string): Promise<void>;
  dispose(): void;
  currentPath: string;
  currentRoute: RouteConfig | null;
  params: Record<string, string>;
  readonly searchParams: URLSearchParams;
}

const MAX_GUARD_REDIRECTS = 10;

export type CompiledRouteMatcher = Pick<
  RouteTable<RouteConfig>,
  'match' | 'resolve' | 'candidateCount'
>;

// ─── Internal helpers ─────────────────────────────────────────────

function resolveMode(mode: RouterMode): 'history' | 'hash' {
  if (mode === 'auto') {
    // detect file:// protocol for local dev; use hash routing
    return typeof location !== 'undefined' && location.protocol === 'file:' ? 'hash' : 'history';
  }
  return mode;
}

/** Match a route through the canonical Alpha.9 RouteTable. */
export function matchRoute(
  pathname: string,
  search: string,
  routes: RouteConfig[],
): RouteMatch<RouteConfig> | null {
  return matcherFor(routes).match(pathname, search);
}

export function compileRouteMatcher(routes: RouteConfig[]): CompiledRouteMatcher {
  return new RouteTable(routes);
}

const compiledMatchers = new WeakMap<RouteConfig[], CompiledRouteMatcher>();

function matcherFor(routes: RouteConfig[]): CompiledRouteMatcher {
  let matcher = compiledMatchers.get(routes);
  if (!matcher) {
    matcher = compileRouteMatcher(routes);
    compiledMatchers.set(routes, matcher);
  }
  return matcher;
}

// ─── createRouter ─────────────────────────────────────────────────

export function createRouter(options: RouterOptions): RouterInstance {
  const mode = resolveMode(options.mode);
  const { routes } = options;
  const routeMatcher = matcherFor(routes);

  let currentPath = '';
  let currentRoute: RouteConfig | null = null;
  let currentParams: Record<string, string> = Object.create(null);
  let currentSearchParams = new URLSearchParams();
  const checkedNavigation = Object.freeze({});
  /** One-shot URL of the router's own guard-veto restore (Navigation API path). */
  let pendingRestoreUrl: string | null = null;
  const nativeNavigation = mode === 'history' && typeof navigation !== 'undefined'
    ? navigation
    : undefined;
  let disposed = false;

  /** Registered listeners keyed by event type, to support dispose. */
  const listeners: Array<{ type: string; handler: EventListener }> = [];

  function addCleanupListener(
    type: string,
    handler: EventListener,
  ): void {
    listeners.push({ type, handler });
    addEventListener(type, handler);
  }

  function readPath(): string {
    if (mode === 'hash') {
      const hash = location.hash.replace(/^#/, '') || '/';
      return hash;
    }
    return location.pathname + location.search;
  }

  function toHashUrl(path: string): string {
    return '#' + (path.startsWith('#') ? path.slice(1) : path);
  }

  function resolveTarget(url: URL): RouteMatch<RouteConfig> | null {
    const resolution = routeMatcher.resolve(url);
    return resolution.kind === 'match' ? resolution : null;
  }

  function rematch(raw = readPath()): void {
    const u = new URL(raw, location.href);
    const search = u.search;
    const matched = resolveTarget(u);

    currentPath = raw;
    currentRoute = matched?.route ?? null;
    currentParams = matched?.params ?? Object.create(null);
    currentSearchParams = matched?.searchParams ?? new URLSearchParams(search);
  }

  function notifyChange(): void {
    if (disposed) return;
    // Outer try/catch catches synchronous throws from onChange().
    // Promise.resolve().catch() only handles async rejections; a sync throw
    // during argument evaluation would crash the router.
    try {
      void Promise.resolve(options.onChange?.()).catch((err) => {
        log.error('onChange failed:', err);
      });
    } catch (err) {
      log.error('onChange failed:', err);
    }
  }

  /**
   * Restore the entry the user came from after a guard vetoed a
   * browser-driven navigation. The vetoed entry is rewritten, not pushed
   * (#1036): pushing left the vetoed entry sitting directly below the
   * restored copy, so the next back re-landed on the vetoed URL and bounced
   * again, trapping every earlier entry behind the guard (the user could
   * never back out past the guard). Under the Navigation API the rewrite
   * goes through a marked replace navigation; elsewhere history.replaceState
   * fires no popstate/hashchange. Neither re-enters commitBrowserNavigation
   * for the router's own restore.
   */
  function restoreBlockedEntry(): void {
    const url = mode === 'hash' ? toHashUrl(currentPath) : currentPath;
    if (nativeNavigation) {
      // An intercepted traverse must be superseded by a real navigation to
      // leave the vetoed URL. history.replaceState fires a navigate event
      // (navigationType "replace") for it; the one-shot URL marker lets
      // onNativeNavigate recognize that event as the router's own restore
      // and intercept it without rematch/notify — an unintercepted replace
      // races the in-flight traverse and does not land.
      pendingRestoreUrl = url;
      history.replaceState(null, '', url);
      return;
    }
    history.replaceState(null, '', url);
  }

  async function commitNavigation(
    path: string,
    navOptions: { replace: boolean; depth?: number; restoreOnBlock?: boolean },
    ticket?: number,
  ): Promise<void> {
    if (disposed) return;
    const depth = navOptions.depth ?? 0;
    if (depth > MAX_GUARD_REDIRECTS) {
      throw new Error(
        `${ERROR_PREFIX} Guard redirect limit exceeded while navigating to "${path}"`,
      );
    }

    // Run guard if we have a matching target route
    const u = new URL(path, location.href);
    if (mode === 'history' && u.origin !== new URL(location.href).origin) {
      if (navOptions.replace) location.replace(u.href);
      else location.assign(u.href);
      return;
    }
    const matched = resolveTarget(u);
    if (matched?.route.guard) {
      const result = await matched.route.guard();
      if (disposed) return;
      // Latest-wins (#1023): a newer programmatic navigation already owns the
      // outcome; a superseded guard resolution must not push state.
      if (ticket !== undefined && ticket !== programmaticNavigationSeq) return;
      if (result === false) {
        if (navOptions.restoreOnBlock) {
          // Browser-driven navigation already landed on this URL (via a guard
          // redirect); restore the entry the user came from, same as the
          // direct block path in commitBrowserNavigation.
          restoreBlockedEntry();
        }
        return; // blocked
      }
      if (typeof result === 'string') {
        return commitNavigation(result, {
          replace: navOptions.replace,
          depth: depth + 1,
          restoreOnBlock: navOptions.restoreOnBlock,
        }, ticket);
      }
    }

    if (disposed || (ticket !== undefined && ticket !== programmaticNavigationSeq)) return;
    const url = mode === 'hash' ? toHashUrl(path) : path;
    if (nativeNavigation) {
      // Under the Navigation API the commit point is the navigate event:
      // onPending fires when onNativeNavigate intercepts it (the guard above
      // already passed), so a vetoed navigation cancels nothing.
      await nativeNavigation.navigate(url, {
        history: navOptions.replace ? 'replace' : 'push',
        info: checkedNavigation,
      }).finished;
      return;
    }
    // Ownership point: every guard passed and this navigation still holds the
    // latest ticket. Only now is pending execution invalidated — a navigation
    // that was vetoed above never owned intent and left it running (#1343).
    options.onPending?.();
    if (navOptions.replace) {
      history.replaceState(null, '', url);
    } else {
      history.pushState(null, '', url);
    }
    // The router now owns the address bar, so the browser-event dedup key no
    // longer describes it: it may still name the URL an earlier guard
    // restore/redirect rewrote the landed entry to, and a genuine back onto
    // that entry must not be deduped away. commitBrowserNavigation re-derives
    // the key in its finally block after browser-driven processing.
    lastLandedUrl = null;
    rematch();
    notifyChange();
  }

  // Latest-wins sequencing for programmatic navigations (#1023): guards are
  // async, so without ordering a slow guard from an earlier navigate() would
  // commit after a newer navigation and roll the UI back to the stale intent.
  let programmaticNavigationSeq = 0;

  function navigate(path: string): Promise<void> {
    // No onPending here: pending execution is cancelled at the ownership
    // point (guard passed, latest ticket held), never on a navigation attempt
    // a guard may still veto (#1343 review).
    return commitNavigation(path, { replace: false }, ++programmaticNavigationSeq);
  }

  function replace(path: string): Promise<void> {
    return commitNavigation(path, { replace: true }, ++programmaticNavigationSeq);
  }

  /**
   * Reconcile router state after the browser itself moved the history
   * pointer (back/forward buttons, direct hash edits). The landed URL
   * cannot be withheld the way commitNavigation withholds pushState, so
   * a rejected guard rewrites the landed entry back to the previous URL,
   * and a guard redirect replaces the landed entry with the redirect target.
   */
  // Dedup consecutive browser events that land on the same URL (rapid
  // popstate/hashchange bursts) so guards and onChange do not run twice
  // for what is effectively a single navigation.
  let lastLandedUrl: string | null = null;

  async function commitBrowserNavigation(
    ticket = programmaticNavigationSeq,
    landed = readPath(),
  ): Promise<void> {
    if (disposed) return;
    if (landed === lastLandedUrl) return;
    try {
      const u = new URL(landed, location.href);
      const matched = resolveTarget(u);
      if (matched?.route.guard) {
        const seqAtGuardStart = programmaticNavigationSeq;
        const result = await matched.route.guard();
        if (disposed || ticket !== programmaticNavigationSeq) return;
        if (result === false) {
          // Blocked: restore the entry the user came from (see
          // restoreBlockedEntry for why this rewrites rather than pushes).
          restoreBlockedEntry();
          return;
        }
        if (typeof result === 'string') {
          // Latest-wins (#1023): a programmatic navigation committed while
          // the guard was pending already owns the outcome; the stale
          // redirect must not replaceState over it. The captured seq rides
          // along as the ticket so the check keeps holding across the
          // redirect target's own guard await as well.
          if (seqAtGuardStart !== programmaticNavigationSeq) return;
          await commitNavigation(result, {
            replace: true,
            depth: 1,
            restoreOnBlock: true,
          }, seqAtGuardStart);
          return;
        }
      }
      if (disposed || ticket !== programmaticNavigationSeq) return;
      // Ownership point (see commitNavigation): the guard allowed this
      // traversal, so pending execution for the previous route is cancelled
      // now — and only now.
      options.onPending?.();
      rematch(landed);
      notifyChange();
    } finally {
      // Track the committed URL (restored on block, replaced on redirect) so
      // only bursts landing on the same URL are deduped, not genuine retries.
      if (ticket === programmaticNavigationSeq) lastLandedUrl = currentPath;
    }
  }

  // Serialize browser-driven navigations: guards are async, and rapid
  // back/forward sequences must resolve in order against the latest URL.
  let browserNavigationQueue: Promise<void> = Promise.resolve();

  function onBrowserNavigation(): void {
    if (disposed) return;
    // No onPending at event time: the guard in commitBrowserNavigation may
    // veto this traversal, and a veto must leave the current route's pending
    // render untouched (#1343 review).
    const ticket = ++programmaticNavigationSeq;
    browserNavigationQueue = browserNavigationQueue
      .then(() =>
        ticket === programmaticNavigationSeq ? commitBrowserNavigation(ticket) : undefined
      )
      .catch((err) => {
        if (disposed || ticket !== programmaticNavigationSeq) return;
        // Intentional fail-open: a rejected guard or a router error must not
        // wedge the queue or leave the UI inconsistent with the address bar,
        // so we log and converge to the real URL instead of rethrowing.
        log.error('browser navigation failed:', err);
        rematch();
        lastLandedUrl = currentPath;
        notifyChange();
      });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Supersede every programmatic guard ticket that was issued before
    // disposal. Browser guards use the same disposed check after each await.
    programmaticNavigationSeq++;
    for (const { type, handler } of listeners) {
      removeEventListener(type, handler);
    }
    listeners.length = 0;
    nativeNavigation?.removeEventListener('navigate', onNativeNavigate);
  }

  function onNativeNavigate(event: NavigateEvent): void {
    // Ownership before side effects: our own programmatic navigations opt
    // into SPA handling; browser-driven POST/fragment/reload default to the
    // browser. No onPending, no ticket bump, no intercept for those.
    const eventInfo = (event as NavigateEvent & { info?: unknown }).info;
    if (pendingRestoreUrl !== null) {
      // The navigate event fired by our own guard-veto replaceState: intercept
      // so the vetoed traverse stays superseded, but never rematch/notify —
      // the router state already describes the restored URL. A genuine
      // navigation clears a stale marker via the URL/type match.
      const navigationType = (event as NavigateEvent & { navigationType?: string }).navigationType;
      const matches = eventInfo === undefined && navigationType === 'replace' &&
        new URL(event.destination.url).href === new URL(pendingRestoreUrl, location.href).href;
      pendingRestoreUrl = null;
      if (matches) {
        event.intercept({ handler: () => {} });
        return;
      }
    }
    const isOwn = eventInfo === checkedNavigation;
    if (!isOwn) {
      // Native POST forms carry formData: leave to browser/server unless an
      // explicit action-navigation protocol claims them (none yet — the SPA
      // submit handler owns in-page actions via preventDefault, so no
      // navigate event fires there; this guard covers the rest).
      const formData = (event as NavigateEvent & { formData?: FormData | null }).formData;
      const eventMethod = (event as NavigateEvent & { method?: string }).method;
      if (formData != null || eventMethod === 'POST') return;
      // Reload defaults to the browser; app data refresh never poses as reload.
      const navigationType = (event as NavigateEvent & { navigationType?: string }).navigationType;
      if (navigationType === 'reload') return;
      // Fragment-only in history mode: preserve native scroll, don't cancel
      // unrelated loaders or run guard/loader/render. Hash-router semantics
      // are separate (nativeNavigation is history-only).
      try {
        const probe = new URL(event.destination.url);
        if (
          probe.origin === location.origin &&
          probe.pathname === location.pathname &&
          probe.search === location.search
        ) return;
      } catch {
        // Malformed destination URL falls through to normal handling below.
      }
    }
    const target = new URL(event.destination.url);
    // Firefox can emit a follow-up navigate with downloadRequest=null for
    // the same download anchor. Preserve the originating element's policy.
    const downloadLink = event.sourceElement?.hasAttribute('download') ?? false;
    if (
      !event.canIntercept || event.downloadRequest !== null || downloadLink ||
      target.origin !== location.origin ||
      !resolveTarget(target)
    ) return;
    if (isOwn) {
      // Programmatic commit under the Navigation API: the guard already
      // passed in commitNavigation, so this is the ownership point.
      // Browser-driven traverses instead cancel pending execution in
      // commitBrowserNavigation after their guard resolves — an intercepted
      // traverse that is vetoed cancels nothing (#1343 review).
      options.onPending?.();
    }
    const ticket = ++programmaticNavigationSeq;
    event.signal.addEventListener('abort', () => {
      if (ticket === programmaticNavigationSeq) programmaticNavigationSeq++;
    }, { once: true });
    event.intercept({
      handler: async () => {
        if (event.signal.aborted || ticket !== programmaticNavigationSeq) return;
        if (event.info === checkedNavigation) {
          lastLandedUrl = null;
          rematch(target.pathname + target.search);
          notifyChange();
        } else {
          await commitBrowserNavigation(ticket, target.pathname + target.search);
        }
      },
    });
  }

  // ─── Initialization ───────────────────────────────────────────

  if (nativeNavigation) {
    nativeNavigation.addEventListener('navigate', onNativeNavigate);
  } else if (mode === 'history') {
    addCleanupListener('popstate', onBrowserNavigation);
  } else {
    addCleanupListener('hashchange', onBrowserNavigation);
  }

  // Initial match
  rematch();

  return {
    navigate,
    replace,
    dispose,
    get currentPath(): string {
      return currentPath;
    },
    get currentRoute(): RouteConfig | null {
      return currentRoute;
    },
    get searchParams(): URLSearchParams {
      // Mutable interface over an immutable snapshot: every reader (and each
      // loader/action context) gets its own copy, so user code can never
      // rewrite the router's canonical state behind the address bar.
      return new URLSearchParams(currentSearchParams);
    },
    get params(): Record<string, string> {
      return currentParams;
    },
  };
}
