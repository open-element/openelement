import { createNavigationApiAdapter } from './navigation-api.ts';
import { createPushstateAdapter } from './pushstate-fallback.ts';

/**
 * Browser navigation driver seam for the client router.
 *
 * One interface, two drivers (P1 — use the platform): the Navigation API
 * (navigation-api.ts, Chrome/Edge) when the platform offers it, and a
 * history/hash fallback (pushstate-fallback.ts) everywhere else. The router
 * keeps route matching, guards and its navigation state machine; a driver
 * owns only how the address bar moves and which events announce
 * browser-driven navigations.
 *
 * Paths cross this seam in router space: hash-mode drivers translate to/from
 * the URL fragment themselves, so callers never see the `#` prefix.
 */

/** Options for a router-initiated navigation commit. */
export interface NavigationCommitOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace: boolean;
  /** Driver pass-through marker identifying the router's own navigations. */
  info?: unknown;
}

/** Driver backed by the Navigation API (`window.navigation`). */
export interface NavigationApiAdapter {
  readonly kind: 'navigation-api';
  /** Commit a router-initiated navigation; resolves once it has landed. */
  navigate(path: string, options: NavigationCommitOptions): Promise<void>;
  /**
   * Rewrite the live history entry in place (guard-veto restore). The raw
   * history write is the point: the navigate event it fires is how the
   * vetoed traverse gets superseded (#1036).
   */
  rewrite(path: string): void;
  /** The current address in router space (pathname+search; hash path for hash mode). */
  current(): string;
  /** Subscribe to driver-surfaced navigations; returns the unsubscribe disposer. */
  onNavigate(handler: (event: NavigateEvent) => void): () => void;
}

/** Driver backed by history.pushState/replaceState (+ popstate/hashchange). */
export interface PushstateAdapter {
  readonly kind: 'pushstate-fallback';
  /**
   * Commit a router-initiated navigation. Synchronous by contract: the
   * router's ownership point runs immediately after the address-bar move,
   * with no await window for a newer navigation to interleave.
   */
  navigate(path: string, options: NavigationCommitOptions): void;
  /** Rewrite the live history entry in place; fires no event the driver surfaces. */
  rewrite(path: string): void;
  /** The current address in router space (pathname+search; hash path for hash mode). */
  current(): string;
  /** Subscribe to driver-surfaced navigations; returns the unsubscribe disposer. */
  onNavigate(handler: (event: PopStateEvent | HashChangeEvent) => void): () => void;
}

export type NavigationAdapter = NavigationApiAdapter | PushstateAdapter;

/**
 * Pick the driver for `mode`: hash routing is a fallback-mode shape by
 * definition (nativeNavigation is history-only), and history mode rides the
 * Navigation API wherever the platform provides it.
 */
export function createNavigationAdapter(mode: 'history' | 'hash'): NavigationAdapter {
  if (mode === 'history' && typeof navigation !== 'undefined') {
    return createNavigationApiAdapter();
  }
  return createPushstateAdapter(mode);
}
