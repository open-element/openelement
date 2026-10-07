/**
 * @openelement/router - navigation driver seam tests (#1561).
 *
 * The adapter is the address-bar transport seam between client-router and
 * the platform: the Navigation API driver (Chrome/Edge) and the history/hash
 * fallback. The tests pin the two contracts the router depends on — commit
 * semantics (native awaits the finished promise, fallback is synchronous)
 * and the event class that announces browser-driven navigations.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createNavigationAdapter,
  type NavigationApiAdapter,
  type PushstateAdapter,
} from '../src/navigation/adapter.ts';
import { createNavigationApiAdapter } from '../src/navigation/navigation-api.ts';
import { createPushstateAdapter } from '../src/navigation/pushstate-fallback.ts';

interface Originals {
  navigation?: PropertyDescriptor | undefined;
  location?: PropertyDescriptor | undefined;
  history?: PropertyDescriptor | undefined;
  add: typeof globalThis.addEventListener;
  remove: typeof globalThis.removeEventListener;
}

function grabOriginals(): Originals {
  return {
    navigation: Object.getOwnPropertyDescriptor(globalThis, 'navigation'),
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
    add: globalThis.addEventListener,
    remove: globalThis.removeEventListener,
  };
}

function restoreOriginals(original: Originals): void {
  for (const key of ['navigation', 'location', 'history'] as const) {
    const descriptor = original[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  globalThis.addEventListener = original.add;
  globalThis.removeEventListener = original.remove;
}

/** A fake `window.navigation` with listener capture and a controllable finished promise. */
function stubNativeNavigation() {
  const navigateCalls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const listeners = new Map<string, Set<EventListener>>();
  let resolveFinished: (() => void) | undefined;
  const fake = {
    navigate: (url: string, options: Record<string, unknown>) => {
      navigateCalls.push({ url, options });
      return {
        finished: new Promise<void>((resolve) => {
          resolveFinished = resolve;
        }),
      };
    },
    addEventListener: (type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    fake,
    navigateCalls,
    listeners,
    land: () => resolveFinished?.(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createNavigationAdapter', () => {
  test('history mode with the Navigation API present picks the native driver', () => {
    const original = grabOriginals();
    const { fake } = stubNativeNavigation();
    Object.defineProperty(globalThis, 'navigation', { configurable: true, value: fake });
    try {
      const adapter = createNavigationAdapter('history');
      expect(adapter.kind).toEqual('navigation-api');
    } finally {
      restoreOriginals(original);
    }
  });

  test('history mode without the Navigation API falls back to pushstate', () => {
    const original = grabOriginals();
    delete (globalThis as Record<string, unknown>).navigation;
    try {
      expect(createNavigationAdapter('history').kind).toEqual('pushstate-fallback');
    } finally {
      restoreOriginals(original);
    }
  });

  test('hash mode is fallback-only even when the Navigation API exists', () => {
    // Hash-router semantics are separate: the fragment, not the history
    // pointer, carries the route, so the native driver never serves it.
    const original = grabOriginals();
    const { fake } = stubNativeNavigation();
    Object.defineProperty(globalThis, 'navigation', { configurable: true, value: fake });
    try {
      expect(createNavigationAdapter('hash').kind).toEqual('pushstate-fallback');
    } finally {
      restoreOriginals(original);
    }
  });
});

describe('navigation-api driver', () => {
  test('navigate rides navigation.navigate and resolves on finished', async () => {
    const original = grabOriginals();
    const native = stubNativeNavigation();
    Object.defineProperty(globalThis, 'navigation', {
      configurable: true,
      value: native.fake,
    });
    try {
      const adapter: NavigationApiAdapter = createNavigationApiAdapter();
      let landed = false;
      const done = adapter.navigate('/a?b=1', { replace: false, info: { marker: 1 } }).then(() => {
        landed = true;
      });
      // The driver must not resolve before the platform navigation lands.
      await Promise.resolve();
      expect(landed).toEqual(false);
      expect(native.navigateCalls).toEqual([
        { url: '/a?b=1', options: { history: 'push', info: { marker: 1 } } },
      ]);
      native.land();
      await done;
      expect(landed).toEqual(true);
    } finally {
      restoreOriginals(original);
    }
  });

  test('navigate replace option maps to history "replace"', async () => {
    const original = grabOriginals();
    const native = stubNativeNavigation();
    Object.defineProperty(globalThis, 'navigation', {
      configurable: true,
      value: native.fake,
    });
    try {
      const adapter = createNavigationApiAdapter();
      const done = adapter.navigate('/b', { replace: true });
      expect(native.navigateCalls[0]?.options.history).toEqual('replace');
      native.land();
      await done;
    } finally {
      restoreOriginals(original);
    }
  });

  test('rewrite is the raw history write that fires the interceptable navigate event', () => {
    const original = grabOriginals();
    const replaceCalls: string[] = [];
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: { replaceState: (_a: unknown, _b: string, url: string) => replaceCalls.push(url) },
    });
    try {
      const adapter = createNavigationApiAdapter();
      adapter.rewrite('/restored');
      expect(replaceCalls).toEqual(['/restored']);
    } finally {
      restoreOriginals(original);
    }
  });

  test('current reads pathname+search', () => {
    const original = grabOriginals();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/guide/x', search: '?page=2', hash: '' },
    });
    try {
      expect(createNavigationApiAdapter().current()).toEqual('/guide/x?page=2');
    } finally {
      restoreOriginals(original);
    }
  });

  test('onNavigate subscribes to navigate events and the disposer unsubscribes', () => {
    const original = grabOriginals();
    const native = stubNativeNavigation();
    Object.defineProperty(globalThis, 'navigation', {
      configurable: true,
      value: native.fake,
    });
    try {
      const handler = () => {};
      const unsubscribe = createNavigationApiAdapter().onNavigate(handler);
      expect(native.listeners.get('navigate')?.has(handler as EventListener)).toEqual(true);
      unsubscribe();
      expect(native.listeners.get('navigate')?.has(handler as EventListener)).toEqual(false);
    } finally {
      restoreOriginals(original);
    }
  });
});

describe('pushstate fallback driver', () => {
  test('history mode: navigate pushes or replaces through history', () => {
    const original = grabOriginals();
    const pushCalls: string[] = [];
    const replaceCalls: string[] = [];
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: {
        pushState: (_a: unknown, _b: string, url: string) => pushCalls.push(url),
        replaceState: (_a: unknown, _b: string, url: string) => replaceCalls.push(url),
      },
    });
    try {
      const adapter: PushstateAdapter = createPushstateAdapter('history');
      adapter.navigate('/a', { replace: false });
      adapter.navigate('/b', { replace: true });
      expect(pushCalls).toEqual(['/a']);
      expect(replaceCalls).toEqual(['/b']);
    } finally {
      restoreOriginals(original);
    }
  });

  test('hash mode: navigate rides the URL fragment and current strips it', () => {
    const original = grabOriginals();
    const pushCalls: string[] = [];
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: { pushState: (_a: unknown, _b: string, url: string) => pushCalls.push(url) },
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/', search: '', hash: '#/spa/route' },
    });
    try {
      const adapter = createPushstateAdapter('hash');
      adapter.navigate('/spa/route', { replace: false });
      adapter.navigate('#/already-hashed', { replace: false });
      expect(pushCalls).toEqual(['#/spa/route', '#/already-hashed']);
      expect(adapter.current()).toEqual('/spa/route');
    } finally {
      restoreOriginals(original);
    }
  });

  test('hash mode: an empty fragment reads as the root route', () => {
    const original = grabOriginals();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/', search: '', hash: '' },
    });
    try {
      expect(createPushstateAdapter('hash').current()).toEqual('/');
    } finally {
      restoreOriginals(original);
    }
  });

  test('history mode current reads pathname+search; hash mode never does', () => {
    const original = grabOriginals();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/items/2', search: '?view=full', hash: '#ignore' },
    });
    try {
      expect(createPushstateAdapter('history').current()).toEqual('/items/2?view=full');
    } finally {
      restoreOriginals(original);
    }
  });

  test('onNavigate subscribes to popstate (history) or hashchange (hash)', () => {
    const original = grabOriginals();
    const added: Array<{ type: string; listener: EventListener }> = [];
    const removed: EventListener[] = [];
    globalThis.addEventListener = ((type: string, listener: EventListener) => {
      added.push({ type, listener });
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((_type: string, listener: EventListener) => {
      removed.push(listener);
    }) as typeof globalThis.removeEventListener;
    try {
      const handler = () => {};
      const unsubscribe = createPushstateAdapter('history').onNavigate(handler);
      expect(added).toEqual([{ type: 'popstate', listener: handler as EventListener }]);
      unsubscribe();
      expect(removed).toEqual([handler as EventListener]);

      added.length = 0;
      removed.length = 0;
      const hashUnsubscribe = createPushstateAdapter('hash').onNavigate(handler);
      expect(added).toEqual([{ type: 'hashchange', listener: handler as EventListener }]);
      hashUnsubscribe();
      expect(removed).toEqual([handler as EventListener]);
    } finally {
      restoreOriginals(original);
    }
  });

  test('navigate is synchronous by contract (no await window for the router)', () => {
    const original = grabOriginals();
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      value: { pushState() {}, replaceState() {} },
    });
    try {
      const adapter = createPushstateAdapter('history');
      // The router relies on the address-bar move and its state commit
      // running in one turn; the driver must not hand back a pending promise.
      expect(adapter.navigate('/a', { replace: false })).toEqual(undefined);
    } finally {
      restoreOriginals(original);
    }
  });
});
