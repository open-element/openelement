/**
 * @openelement/router/internal/router/client-router - URLPattern/RouteTable client router.
 *
 * Supports history (pushState), hash, and auto-detection modes.
 * Alpha.9 authority: URLPattern owns pathname grammar and RouteTable owns
 * declaration order, separate query/captures, and HTTP policy.
 *
 * Alpha.9 removes client-local route grammars and compatibility matchers so
 * browser navigation and the other route consumers share one semantic owner.
 */
import { NavigationState, type NavigationTicket } from './navigation-state.ts';
import { type RouteMatch, type RouteRecord, RouteTable } from './route-table.ts';

const ERROR_PREFIX = '[openElement]';
const log = {
  error: (...args: unknown[]) => console.error('[router]', ...args),
};

/** Navigation strategy: the History API ('history'), the URL hash ('hash'), or file-protocol auto-detection ('auto'). */
export type RouterMode = 'history' | 'hash' | 'auto';

/**
 * One client route: a {@link RouteRecord} plus the custom element `tagName`
 * SPA mode instantiates for it and an optional `guard` that may veto the
 * navigation by returning `false` or a redirect path.
 */
export interface RouteConfig extends RouteRecord {
  /** Custom element tag to instantiate directly in SPA mode. */
  tagName: string;
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

/**
 * A live client router: the navigation entry points, the current match
 * (`currentPath`/`currentRoute`/`params`/`searchParams`), and `dispose()` to
 * release its listeners.
 */
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

/** The matcher surface a client route list compiles to: matching, resolution and candidate count. */
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

/**
 * Compile a client route list into the canonical {@link RouteTable} matcher,
 * with no router instance attached.
 */
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

/**
 * Create the client-side SPA router for `options.mode` over `options.routes`:
 * it matches through the shared RouteTable, owns its navigation listeners and
 * history/hash state, and reports every committed navigation through
 * `onChange`.
 */
export function createRouter(options: RouterOptions): RouterInstance {
  const mode = resolveMode(options.mode);
  const { routes } = options;
  const routeMatcher = matcherFor(routes);

  let currentPath = '';
  let currentRoute: RouteConfig | null = null;
  let currentParams: Record<string, string> = Object.create(null);
  let currentSearchParams = new URLSearchParams();
  const checkedNavigation = Object.freeze({});
  // The navigation state machine owns every cross-flow invariant: ticket
  // ownership (#1023 latest-wins), browser-landing dedup, the one-shot
  // guard-veto restore marker (#1036) and disposal. See navigation-state.ts.
  const navigationState = new NavigationState();
  const nativeNavigation = mode === 'history' && typeof navigation !== 'undefined'
    ? navigation
    : undefined;

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
    if (navigationState.disposed) return;
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
      // (navigationType "replace") for it; the one-shot marker armed here lets
      // onNativeNavigate recognize that event as the router's own restore
      // and intercept it without rematch/notify — an unintercepted replace
      // races the in-flight traverse and does not land. The marker is armed
      // as an absolute href so it compares directly against the navigate
      // event's already-resolved destination URL.
      navigationState.armRestore(new URL(url, location.href).href);
      history.replaceState(null, '', url);
      return;
    }
    history.replaceState(null, '', url);
  }

  async function commitNavigation(
    path: string,
    navOptions: { replace: boolean; depth?: number; restoreOnBlock?: boolean },
    ticket: NavigationTicket,
  ): Promise<void> {
    if (navigationState.disposed) return;
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
      // Latest-wins (#1023): a newer navigation already owns the outcome; a
      // superseded guard resolution must not push state. Disposal supersedes
      // every outstanding ticket, so it needs no separate check (#1343).
      if (!navigationState.owns(ticket)) return;
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

    if (!navigationState.owns(ticket)) return;
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
    navigationState.recordLanding(null);
    rematch();
    notifyChange();
  }

  function navigate(path: string): Promise<void> {
    // No onPending here: pending execution is cancelled at the ownership
    // point (guard passed, latest ticket held), never on a navigation attempt
    // a guard may still veto (#1343 review).
    return commitNavigation(path, { replace: false }, navigationState.issue('programmatic'));
  }

  function replace(path: string): Promise<void> {
    return commitNavigation(path, { replace: true }, navigationState.issue('programmatic'));
  }

  /**
   * Reconcile router state after the browser itself moved the history
   * pointer (back/forward buttons, direct hash edits). The landed URL
   * cannot be withheld the way commitNavigation withholds pushState, so
   * a rejected guard rewrites the landed entry back to the previous URL,
   * and a guard redirect replaces the landed entry with the redirect target.
   *
   * Dedup of consecutive browser events landing on the same URL (rapid
   * popstate/hashchange bursts) so guards and onChange do not run twice for
   * what is effectively a single navigation is the machine's
   * `isDuplicateLanding`/`recordLanding` pair.
   */
  async function commitBrowserNavigation(
    ticket: NavigationTicket,
    landed = readPath(),
  ): Promise<void> {
    if (navigationState.disposed) return;
    if (navigationState.isDuplicateLanding(landed)) return;
    try {
      const u = new URL(landed, location.href);
      const matched = resolveTarget(u);
      if (matched?.route.guard) {
        const result = await matched.route.guard();
        if (!navigationState.owns(ticket)) return;
        if (result === false) {
          // Blocked: restore the entry the user came from (see
          // restoreBlockedEntry for why this rewrites rather than pushes).
          restoreBlockedEntry();
          return;
        }
        if (typeof result === 'string') {
          // Latest-wins (#1023): a programmatic navigation committed while
          // the guard was pending already owns the outcome; the stale
          // redirect must not replaceState over it. The same ticket rides
          // along so the check keeps holding across the redirect target's own
          // guard await as well — a newer ticket still supersedes it there.
          if (!navigationState.owns(ticket)) return;
          await commitNavigation(result, {
            replace: true,
            depth: 1,
            restoreOnBlock: true,
          }, ticket);
          return;
        }
      }
      if (!navigationState.owns(ticket)) return;
      // Ownership point (see commitNavigation): the guard allowed this
      // traversal, so pending execution for the previous route is cancelled
      // now — and only now.
      options.onPending?.();
      rematch(landed);
      notifyChange();
    } finally {
      // Track the committed URL (restored on block, replaced on redirect) so
      // only bursts landing on the same URL are deduped, not genuine retries.
      if (navigationState.owns(ticket)) navigationState.recordLanding(currentPath);
    }
  }

  // Serialize browser-driven navigations: guards are async, and rapid
  // back/forward sequences must resolve in order against the latest URL.
  let browserNavigationQueue: Promise<void> = Promise.resolve();

  function onBrowserNavigation(): void {
    if (navigationState.disposed) return;
    // No onPending at event time: the guard in commitBrowserNavigation may
    // veto this traversal, and a veto must leave the current route's pending
    // render untouched (#1343 review).
    const ticket = navigationState.issue('browser');
    browserNavigationQueue = browserNavigationQueue
      .then(() => navigationState.owns(ticket) ? commitBrowserNavigation(ticket) : undefined)
      .catch((err) => {
        if (!navigationState.owns(ticket)) return;
        // Intentional fail-open: a rejected guard or a router error must not
        // wedge the queue or leave the UI inconsistent with the address bar,
        // so we log and converge to the real URL instead of rethrowing.
        log.error('browser navigation failed:', err);
        rematch();
        navigationState.recordLanding(currentPath);
        notifyChange();
      });
  }

  function dispose(): void {
    if (navigationState.disposed) return;
    // Supersede every guard ticket issued before disposal — browser and
    // programmatic alike (they share one sequence); browser guards use the
    // same disposed check after each await.
    navigationState.dispose();
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
    if (navigationState.restoreHref !== null) {
      // The navigate event fired by our own guard-veto replaceState: intercept
      // so the vetoed traverse stays superseded, but never rematch/notify —
      // the router state already describes the restored URL. A genuine
      // navigation clears a stale marker via the URL/type match.
      const navigationType = (event as NavigateEvent & { navigationType?: string }).navigationType;
      const restored = navigationState.consumeRestore({
        destinationHref: new URL(event.destination.url).href,
        navigationType,
        info: eventInfo,
      });
      if (restored) {
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
      // unrelated navigations or run guard. Hash-router semantics
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
    const ticket = navigationState.issue('native');
    event.signal.addEventListener('abort', () => {
      // An aborted navigation request (a newer navigation superseded this one,
      // or the user moved on) retires its ticket: the intercept handler below
      // must not commit it.
      if (navigationState.owns(ticket)) navigationState.supersede();
    }, { once: true });
    event.intercept({
      handler: async () => {
        if (event.signal.aborted || !navigationState.owns(ticket)) return;
        if (isOwn) {
          navigationState.recordLanding(null);
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
      // Mutable interface over an immutable snapshot: every reader gets its
      // own copy, so user code can never rewrite the router's canonical
      // state behind the address bar.
      return new URLSearchParams(currentSearchParams);
    },
    get params(): Record<string, string> {
      return currentParams;
    },
  };
}
