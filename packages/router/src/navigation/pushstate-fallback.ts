/**
 * History/hash fallback driver: history.pushState/replaceState with popstate
 * (history mode) or hashchange (hash mode) announcing browser-driven
 * navigations.
 *
 * ─── RETIREMENT CONDITION (P5 — designed for deletion) ───
 * Delete this file when Safari and Firefox ship the Navigation API:
 * createNavigationAdapter's feature detect then always selects
 * navigation-api.ts, and client-router needs no change. This driver is the
 * only piece of platform debt in the navigation seam.
 */
import type { NavigationCommitOptions, PushstateAdapter } from './adapter.ts';

/** Router-space path → browser URL: hash mode rides the URL fragment. */
function toBrowserUrl(mode: 'history' | 'hash', path: string): string {
  if (mode !== 'hash') return path;
  return '#' + (path.startsWith('#') ? path.slice(1) : path);
}

export function createPushstateAdapter(mode: 'history' | 'hash'): PushstateAdapter {
  const eventType = mode === 'hash' ? 'hashchange' : 'popstate';

  return {
    kind: 'pushstate-fallback',

    navigate(path: string, { replace }: NavigationCommitOptions): void {
      const url = toBrowserUrl(mode, path);
      if (replace) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    },

    rewrite(path: string): void {
      // Fires no popstate/hashchange — exactly the property the guard-veto
      // restore relies on outside the Navigation API (#1036).
      history.replaceState(null, '', toBrowserUrl(mode, path));
    },

    current(): string {
      if (mode === 'hash') {
        return location.hash.replace(/^#/, '') || '/';
      }
      return location.pathname + location.search;
    },

    onNavigate(handler: (event: PopStateEvent | HashChangeEvent) => void): () => void {
      addEventListener(eventType, handler as EventListener);
      return () => removeEventListener(eventType, handler as EventListener);
    },
  };
}
