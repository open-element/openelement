/**
 * E2E: router guards on browser-driven navigation (back/forward buttons).
 *
 * The unit suite covers popstate/hashchange against a shimmed history; this
 * suite proves the same contract in a real browser with a real history
 * stack: walking back into a guarded route re-runs its guard, a rejected
 * guard restores the entry the user came from, and a guard redirect
 * replaces the landed entry with the redirect target.
 *
 * The router module is not shipped with the built site, so the real source
 * is bundled in memory (see browser-bundle.ts) and imported from a Blob URL
 * inside the page — the same probe philosophy as hydration-behavior.spec.ts.
 */

import { expect, type Page, test } from '@playwright/test';
import { bundleModuleForBrowser } from './browser-bundle.ts';

const ROUTER_ENTRY = new URL(
  '../../packages/app/src/internal/router/client-router.ts',
  import.meta.url,
);

/** The router module surface used by the probes. */
interface RouterModule {
  createRouter(options: {
    mode: 'history' | 'hash';
    routes: Array<{
      path: string;
      tagName: string;
      guard?: () => Promise<boolean | string>;
    }>;
    onChange?: () => void;
  }): {
    navigate(path: string): Promise<void>;
    dispose(): void;
    readonly currentPath: string;
  };
}

interface GuardProbeOutcome {
  events: string[];
  pushes: string[];
  replaces: string[];
  pathname: string;
  hash: string;
  currentPath: string;
}

/**
 * Shared probe scenario: sign in, push a real history entry for /protected,
 * navigate home, sign out, then walk back into the protected entry with the
 * browser's own history traversal. Returns the observed event sequence and
 * the history mutations after the guard settled.
 */
async function runGuardOnBack(
  page: Page,
  options: { mode: 'history' | 'hash'; blocked: boolean },
): Promise<GuardProbeOutcome> {
  const bundle = await bundleModuleForBrowser(ROUTER_ENTRY);
  await page.goto('/');
  return await page.evaluate(async ({ code, mode, blocked }) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = (await import(url)) as unknown as RouterModule;
    URL.revokeObjectURL(url);

    // Record history mutations so the blocked-restore/redirect-replace
    // landing point is observable without polling races.
    const pushes: string[] = [];
    const replaces: string[] = [];
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = ((state: unknown, title: string, nextUrl?: string | URL | null) => {
      pushes.push(String(nextUrl));
      return originalPush(state, title, nextUrl);
    }) as typeof history.pushState;
    history.replaceState = ((state: unknown, title: string, nextUrl?: string | URL | null) => {
      replaces.push(String(nextUrl));
      return originalReplace(state, title, nextUrl);
    }) as typeof history.replaceState;
    // With the Navigation API active the router commits programmatic
    // navigations through navigation.navigate() and restores vetoed entries
    // through navigation.updateCurrentEntry(); neither reaches the legacy
    // history spies above, so observe them at the API surface instead.
    const nav = (window as unknown as {
      navigation?: {
        navigate(url: string, options?: { history?: string }): unknown;
        updateCurrentEntry(options: { url: string }): unknown;
      };
    }).navigation;
    const originalApiNavigate = nav?.navigate.bind(nav);
    const originalApiUpdate = nav?.updateCurrentEntry.bind(nav);
    if (nav && originalApiNavigate && originalApiUpdate) {
      nav.navigate = (url: string, options?: { history?: string }) => {
        (options?.history === 'replace' ? replaces : pushes).push(String(url));
        return originalApiNavigate(url, options);
      };
      nav.updateCurrentEntry = (options: { url: string }) => {
        replaces.push(String(options.url));
        return originalApiUpdate(options);
      };
    }

    const waitFor = async (condition: () => boolean): Promise<void> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('router probe condition timed out');
    };

    const events: string[] = [];
    let loggedIn = true;
    const router = mod.createRouter({
      mode,
      routes: [
        { path: '/', tagName: 'home-page' },
        {
          path: '/protected',
          tagName: 'protected-page',
          guard: () => {
            events.push('guard:/protected');
            if (loggedIn) return Promise.resolve(true);
            return Promise.resolve(blocked ? false : '/login');
          },
        },
        { path: '/login', tagName: 'login-page' },
      ],
      onChange: () => {
        events.push(`change:${router.currentPath}`);
      },
    });

    try {
      // Signed in: push a real entry for /protected, then head home.
      await router.navigate('/protected');
      await router.navigate('/');
      // Sign out and walk back into the protected entry via the browser.
      loggedIn = false;
      history.back();
      // Deterministic settle: the guard outcome (restore replace or redirect
      // replace) is the last history mutation of the blocked walk.
      const mutationsBefore = pushes.length + replaces.length;
      await waitFor(() => pushes.length + replaces.length > mutationsBefore);
      return {
        events,
        pushes,
        replaces,
        pathname: location.pathname,
        hash: location.hash,
        currentPath: router.currentPath,
      };
    } finally {
      router.dispose();
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      if (nav && originalApiNavigate && originalApiUpdate) {
        nav.navigate = originalApiNavigate;
        nav.updateCurrentEntry = originalApiUpdate;
      }
    }
  }, { code: bundle, mode: options.mode, blocked: options.blocked });
}

test.describe('router guards on browser history traversal', () => {
  test('back into a guarded route re-runs the guard and restores the entry when rejected', async ({ page }) => {
    const outcome = await runGuardOnBack(page, { mode: 'history', blocked: true });

    // The guard ran both for the explicit navigate and for the browser's
    // walk back; the blocked walk produced no change notification.
    expect(outcome.events).toEqual([
      'guard:/protected',
      'change:/protected',
      'change:/',
      'guard:/protected',
    ]);
    // The rejected walk replaced the landed /protected entry with the one
    // the user came from (replaceState, not pushState — #1036: pushing left
    // the vetoed entry below the restored copy and trapped every earlier
    // entry behind the guard on the next back).
    expect(outcome.pushes).toEqual(['/protected', '/']);
    expect(outcome.replaces).toEqual(['/']);
    expect(outcome.pathname).toBe('/');
    expect(outcome.currentPath).toBe('/');
  });

  test('back into a guarded route follows the guard redirect with replace semantics', async ({ page }) => {
    const outcome = await runGuardOnBack(page, { mode: 'history', blocked: false });

    expect(outcome.events).toEqual([
      'guard:/protected',
      'change:/protected',
      'change:/',
      'guard:/protected',
      'change:/login',
    ]);
    // The landed /protected entry was replaced by the redirect target.
    expect(outcome.pushes).toEqual(['/protected', '/']);
    expect(outcome.replaces).toEqual(['/login']);
    expect(outcome.pathname).toBe('/login');
    expect(outcome.currentPath).toBe('/login');
  });

  test('hash-mode back into a guarded route restores the previous hash entry when rejected', async ({ page }) => {
    const outcome = await runGuardOnBack(page, { mode: 'hash', blocked: true });

    expect(outcome.events).toEqual([
      'guard:/protected',
      'change:/protected',
      'change:/',
      'guard:/protected',
    ]);
    expect(outcome.pushes).toEqual(['#/protected', '#/']);
    expect(outcome.replaces).toEqual(['#/']);
    expect(outcome.hash).toBe('#/');
    expect(outcome.currentPath).toBe('/');
  });
});
