/**
 * Navigation API driver: `window.navigation` is the platform's own navigation
 * surface (Chrome/Edge; P1 — use the platform). Programmatic commits ride
 * navigation.navigate(); browser-driven navigations arrive as navigate events
 * the router can intercept. When every engine ships this API this file is the
 * only driver and adapter.ts's feature detect disappears (P5).
 */
import type { NavigationApiAdapter, NavigationCommitOptions } from './adapter.ts';

export function createNavigationApiAdapter(): NavigationApiAdapter {
  return {
    kind: 'navigation-api',

    async navigate(path: string, options: NavigationCommitOptions): Promise<void> {
      // NavigationResult.finished is optional in the platform type; awaiting
      // undefined lands immediately — the same observable contract as the
      // inline await this driver extracted from client-router.
      await navigation.navigate(path, {
        history: options.replace ? 'replace' : 'push',
        info: options.info,
      }).finished;
    },

    rewrite(path: string): void {
      // The raw history write is deliberate: the router arms its restore
      // marker before this call, and the navigate event the write fires is
      // how the vetoed traverse gets superseded (#1036) — a
      // navigation.navigate() here would be a second full commit instead.
      history.replaceState(null, '', path);
    },

    current(): string {
      return location.pathname + location.search;
    },

    onNavigate(handler: (event: NavigateEvent) => void): () => void {
      navigation.addEventListener('navigate', handler);
      return () => navigation.removeEventListener('navigate', handler);
    },
  };
}
