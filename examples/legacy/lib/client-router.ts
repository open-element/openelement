/**
 * Shared client-side router reference for SPA navigation in the desktop
 * examples (deno-desktop-mastodon and deno-desktop-reader). Each example
 * instantiates it with its own log tag in its local router.ts.
 */
import type { SpaAppInstance } from '@openelement/app';

type RouterInstance = NonNullable<SpaAppInstance['router']>;

export function createRouterRef(logTag: string): {
  setRouter: (router: RouterInstance | null) => void;
  navigate: (path: string) => void;
} {
  let _router: RouterInstance | null = null;

  return {
    setRouter(router) {
      _router = router;
    },
    navigate(path) {
      if (_router) {
        void _router.navigate(path);
        return;
      }
      console.warn(`[${logTag}] navigate called before router is mounted:`, path);
    },
  };
}
