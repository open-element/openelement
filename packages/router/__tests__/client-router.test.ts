import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  compileRouteMatcher,
  createRouter,
  matchRoute,
  type RouteConfig,
} from '../src/internal/router/client-router.ts';
import {
  RouteTable,
  type URLPatternConstructor,
  URLPatternPolyfillConstructor,
} from '../src/internal/router/route-table.ts';

const routes: RouteConfig[] = [{ path: '/items/:id', tagName: 'item-page' }];

Deno.test('client router keeps decoded path parameters separate from query', () => {
  const match = matchRoute('/items/hello%20world', '?id=query&view=full', routes);
  assertEquals(match?.params.id, 'hello world');
  assertEquals(match?.params.view, undefined);
  assertEquals(match?.searchParams.get('view'), 'full');
});

Deno.test('client router decodes query components exactly once', () => {
  const cases = [
    ['?value=%25', '%'],
    ['?value=%2525', '%25'],
    ['?value=hello+world', 'hello world'],
    ['?value=%2B', '+'],
  ] as const;
  for (const [search, expected] of cases) {
    assertEquals(matchRoute('/items/id', search, routes)?.searchParams.get('value'), expected);
  }
});

Deno.test('client router preserves malformed query escapes without aborting matching', () => {
  const match = matchRoute('/items/id', '?bad=%&also=%2&key%=value%', routes);
  assertEquals(match?.searchParams.get('bad'), '%');
  assertEquals(match?.searchParams.get('also'), '%2');
  assertEquals(match?.searchParams.get('key%'), 'value%');
});

interface ExpectedRouteMatch {
  route: string | null;
  params: Record<string, string>;
}

interface MatcherEngine {
  name: string;
  table: RouteTable<RouteConfig>;
}

function concreteMatch(
  match: { route: RouteConfig; params: Record<string, string> } | null,
): ExpectedRouteMatch {
  return match === null
    ? { route: null, params: {} }
    : { route: match.route.tagName, params: Object.fromEntries(Object.entries(match.params)) };
}

function matcherEngines(routes: RouteConfig[]): MatcherEngine[] {
  const engines: MatcherEngine[] = [{
    name: 'polyfill',
    table: new RouteTable(routes, URLPatternPolyfillConstructor),
  }];
  if (typeof globalThis.URLPattern === 'function') {
    engines.push({
      name: 'native',
      table: new RouteTable(
        routes,
        globalThis.URLPattern as unknown as URLPatternConstructor,
      ),
    });
  }
  return engines;
}

const semanticRoutes: RouteConfig[] = [
  { path: '/', tagName: 'home-page' },
  { path: '/static', tagName: 'static-page' },
  { path: '/docs/:slug', tagName: 'dynamic-doc-page' },
  { path: '/docs/new', tagName: 'static-doc-page' },
  { path: '/:locale?/guide/:page?', tagName: 'guide-page' },
  { path: '/assets/:path*', tagName: 'assets-page' },
  { path: '/assets/logo.svg', tagName: 'asset-logo-page' },
  { path: '/products/:slug{.+}', tagName: 'product-page' },
  { path: '/unicode/:value', tagName: 'unicode-page' },
  { path: '/items/:id', tagName: 'item-page' },
  { path: '/reserved/:__proto__/:prototype/:constructor', tagName: 'reserved-page' },
];

const semanticCases: Array<{
  name: string;
  pathname: string;
  search: string;
  expected: ExpectedRouteMatch;
}> = [
  { name: 'static root', pathname: '/', search: '', expected: { route: 'home-page', params: {} } },
  {
    name: 'static path',
    pathname: '/static',
    search: '',
    expected: { route: 'static-page', params: {} },
  },
  {
    name: 'declaration order keeps the earlier dynamic route',
    pathname: '/docs/new',
    search: '',
    expected: { route: 'dynamic-doc-page', params: { slug: 'new' } },
  },
  {
    name: 'named parameter',
    pathname: '/docs/start',
    search: '',
    expected: { route: 'dynamic-doc-page', params: { slug: 'start' } },
  },
  {
    name: 'optional parameters absent',
    pathname: '/guide',
    search: '',
    expected: { route: 'guide-page', params: {} },
  },
  {
    name: 'optional page parameter',
    pathname: '/guide/api',
    search: '',
    expected: { route: 'guide-page', params: { page: 'api' } },
  },
  {
    name: 'optional locale and page parameters',
    pathname: '/zh/guide/api',
    search: '',
    expected: { route: 'guide-page', params: { locale: 'zh', page: 'api' } },
  },
  {
    name: 'repeat absent',
    pathname: '/assets',
    search: '',
    expected: { route: 'assets-page', params: {} },
  },
  {
    name: 'repeat captures multiple segments',
    pathname: '/assets/icons/ui/add.svg',
    search: '',
    expected: { route: 'assets-page', params: { path: 'icons/ui/add.svg' } },
  },
  {
    name: 'declaration order keeps the earlier repeat route',
    pathname: '/assets/logo.svg',
    search: '',
    expected: { route: 'assets-page', params: { path: 'logo.svg' } },
  },
  {
    name: 'named catch-all captures encoded multi-segment value',
    pathname: '/products/a%20b/c',
    search: '',
    expected: { route: 'product-page', params: { slug: 'a b/c' } },
  },
  {
    name: 'encoded Unicode parameter',
    pathname: '/unicode/%E2%98%83',
    search: '',
    expected: { route: 'unicode-page', params: { value: '☃' } },
  },
  {
    name: 'literal Unicode parameter',
    pathname: '/unicode/東京',
    search: '',
    expected: { route: 'unicode-page', params: { value: '東京' } },
  },
  {
    name: 'malformed path escape is preserved',
    pathname: '/docs/%E0%A4%A',
    search: '',
    expected: { route: 'dynamic-doc-page', params: { slug: '%E0%A4%A' } },
  },
  {
    name: 'query decoding, repeated keys, and path precedence',
    pathname: '/items/hello%20world',
    search: '?id=query&view=first&view=last&encoded=a%2Bb+two',
    expected: {
      route: 'item-page',
      params: { id: 'hello world' },
    },
  },
  {
    name: 'malformed query escapes are preserved',
    pathname: '/items/id',
    search: '?bad=%&also=%2&key%=value%',
    expected: {
      route: 'item-page',
      params: { id: 'id' },
    },
  },
  {
    name: 'reserved parameter names are omitted safely',
    pathname: '/reserved/a/b/c',
    search: '',
    expected: { route: 'reserved-page', params: {} },
  },
  {
    name: 'trailing slash does not match',
    pathname: '/docs/new/',
    search: '',
    expected: { route: null, params: {} },
  },
  {
    name: 'repeated slash does not match',
    pathname: '/docs//new',
    search: '',
    expected: { route: null, params: {} },
  },
  {
    name: 'repeat trailing slash does not match',
    pathname: '/assets/a/',
    search: '',
    expected: { route: null, params: {} },
  },
  {
    name: 'repeat empty segment does not match',
    pathname: '/assets/a//b',
    search: '',
    expected: { route: null, params: {} },
  },
];

Deno.test('RouteTable and URLPattern engines agree on the semantic corpus', () => {
  const engines = matcherEngines(semanticRoutes);
  const compiled = compileRouteMatcher(semanticRoutes);

  for (const testCase of semanticCases) {
    const results = engines.map(({ name, table }) => ({
      name,
      result: concreteMatch(table.match(testCase.pathname, testCase.search)),
    }));
    const canonical = results[0].result;
    assertEquals(canonical, testCase.expected, `${testCase.name}: polyfill expected result`);
    for (const { name, result } of results) {
      assertEquals(result, canonical, `${testCase.name}: ${name} differs from polyfill`);
    }

    const publicResult = concreteMatch(matchRoute(
      testCase.pathname,
      testCase.search,
      semanticRoutes,
    ));
    const compiledResult = concreteMatch(compiled.match(testCase.pathname, testCase.search));
    assertEquals(publicResult, canonical, `${testCase.name}: public matchRoute differs`);
    assertEquals(compiledResult, canonical, `${testCase.name}: compiled matcher differs`);
  }
});

Deno.test('RouteTable preserves the 5,000-route static candidate regression', () => {
  const largeRoutes = Array.from({ length: 5_000 }, (_, index) => ({
    path: `/catalog/${index}/details`,
    tagName: `catalog-${index}`,
  }));
  const table = new RouteTable(largeRoutes, URLPatternPolyfillConstructor);
  const compiled = compileRouteMatcher(largeRoutes);

  const expected = { route: 'catalog-4999', params: {} };
  assertEquals(concreteMatch(table.match('/catalog/4999/details', '')), expected);
  assertEquals(concreteMatch(compiled.match('/catalog/4999/details', '')), expected);
  assertEquals(table.candidateCount('/catalog/4999/details'), 1);
  assertEquals(compiled.candidateCount('/catalog/4999/details'), 1);
});

Deno.test('RouteTable rejects malformed URLPattern patterns consistently', () => {
  const malformedPatterns = [
    '/foo/:',
    '/foo/bar?',
    '/foo/bar+',
    '/foo/(bar',
    '/foo/?bar',
    '/foo/:name{(?:a}',
  ];
  const constructors: Array<[string, URLPatternConstructor]> = [
    ['polyfill', URLPatternPolyfillConstructor],
  ];
  if (typeof globalThis.URLPattern === 'function') {
    constructors.push([
      'native',
      globalThis.URLPattern as unknown as URLPatternConstructor,
    ]);
  }

  for (const path of malformedPatterns) {
    for (const [, Pattern] of constructors) {
      assertThrows(
        () => new RouteTable([{ path, tagName: 'bad-page' }], Pattern),
        TypeError,
      );
    }
    const routes: RouteConfig[] = [{ path, tagName: 'bad-page' }];
    assertThrows(() => compileRouteMatcher(routes), TypeError);
    assertThrows(() => matchRoute('/foo/bar', '', routes), TypeError);
  }
});

Deno.test('RouteTable classifies methods, HEAD, base paths, and trailing-slash policy', () => {
  type MethodRoute = RouteConfig & { methods: readonly string[] };
  const methodRoutes: MethodRoute[] = [
    { path: '/items/:id', tagName: 'item', methods: ['GET', 'POST'] },
  ];
  const tables = [
    new RouteTable(methodRoutes, URLPatternPolyfillConstructor, {
      basePath: '/api',
      trailingSlash: 'ignore',
    }),
    ...(typeof globalThis.URLPattern === 'function'
      ? [
        new RouteTable(
          methodRoutes,
          globalThis.URLPattern as unknown as URLPatternConstructor,
          { basePath: '/api', trailingSlash: 'ignore' },
        ),
      ]
      : []),
  ];

  const expected = [
    { kind: 'match', route: 'item', params: { id: 'a b' } },
    { kind: 'match', route: 'item', params: { id: 'a b' } },
    { kind: 'match', route: 'item', params: { id: 'a b' } },
    { kind: 'method-not-allowed', allow: ['GET', 'HEAD', 'POST'] },
    { kind: 'not-found' },
  ];
  for (const table of tables) {
    const actual = [
      table.resolve('/api/items/a%20b/', '', 'GET'),
      table.resolve('/api/items/a%20b/', '', 'HEAD'),
      table.resolve('/api/items/a%20b/', '', 'POST'),
      table.resolve('/api/items/a%20b/', '', 'DELETE'),
      table.resolve('/items/a%20b/', '', 'GET'),
    ].map((resolution) =>
      resolution.kind === 'match'
        ? {
          kind: resolution.kind,
          route: resolution.route.tagName,
          params: Object.fromEntries(Object.entries(resolution.params)),
        }
        : resolution
    );
    assertEquals(actual as unknown, expected as unknown);
  }
});

Deno.test('static RouteTable lookup preserves URLPattern Unicode normalization', () => {
  const unicodeRoutes: RouteConfig[] = [{ path: '/café', tagName: 'cafe-page' }];
  for (const { table } of matcherEngines(unicodeRoutes)) {
    assertEquals(table.match('/café')?.route.tagName, 'cafe-page');
    assertEquals(table.match('/caf%C3%A9')?.route.tagName, 'cafe-page');
  }
});

Deno.test('client router dispose removes event listeners and double dispose is safe', () => {
  const original = {
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
    add: globalThis.addEventListener,
    remove: globalThis.removeEventListener,
  };
  const added: EventListener[] = [];
  const removed: EventListener[] = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      href: 'https://router.test/',
      pathname: '/',
      search: '',
      hash: '',
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { pushState() {}, replaceState() {} },
  });
  globalThis.addEventListener = ((_type: string, listener: EventListener) => {
    added.push(listener);
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((_type: string, listener: EventListener) => {
    removed.push(listener);
  }) as typeof globalThis.removeEventListener;

  try {
    const router = createRouter({ mode: 'history', routes });
    router.dispose();
    router.dispose();
    assertEquals(added.length, 1);
    assertEquals(removed, added);
  } finally {
    globalThis.addEventListener = original.add;
    globalThis.removeEventListener = original.remove;
    if (original.location) Object.defineProperty(globalThis, 'location', original.location);
    else delete (globalThis as Record<string, unknown>).location;
    if (original.history) Object.defineProperty(globalThis, 'history', original.history);
    else delete (globalThis as Record<string, unknown>).history;
  }
});

Deno.test('client router guard redirect limit rejects redirect loops', async () => {
  const loop: RouteConfig[] = [{
    path: '/loop',
    tagName: 'loop-page',
    guard: () => Promise.resolve('/loop'),
  }];
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalHistory = Object.getOwnPropertyDescriptor(globalThis, 'history');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      href: 'https://router.test/',
      pathname: '/',
      search: '',
      hash: '',
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { pushState() {}, replaceState() {} },
  });
  const router = createRouter({ mode: 'history', routes: loop });
  try {
    await assertRejects(() => router.navigate('/loop'), Error, 'redirect limit');
  } finally {
    router.dispose();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete (globalThis as Record<string, unknown>).location;
    if (originalHistory) Object.defineProperty(globalThis, 'history', originalHistory);
    else delete (globalThis as Record<string, unknown>).history;
  }
});

Deno.test('client router dispose invalidates a pending programmatic guard', async () => {
  let resolveGuard!: (value: boolean) => void;
  const guard = new Promise<boolean>((resolve) => resolveGuard = resolve);
  const browser = installFakeBrowser('/public');
  let changes = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/protected', tagName: 'protected-page', guard: () => guard },
    ],
    onChange: () => {
      changes++;
    },
  });
  try {
    const navigation = router.navigate('/protected');
    router.dispose();
    resolveGuard(true);
    await navigation;
    assertEquals(browser.applied, []);
    assertEquals(browser.path(), '/public');
    assertEquals(changes, 0);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('client router dispose invalidates a pending browser guard', async () => {
  let resolveGuard!: (value: boolean) => void;
  const guard = new Promise<boolean>((resolve) => resolveGuard = resolve);
  const browser = installFakeBrowser('/public');
  let changes = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/protected', tagName: 'protected-page', guard: () => guard },
    ],
    onChange: () => {
      changes++;
    },
  });
  try {
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    router.dispose();
    resolveGuard(true);
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/public');
    assertEquals(router.currentRoute?.tagName, 'public-page');
    assertEquals(browser.applied, []);
    assertEquals(changes, 0);
  } finally {
    router.dispose();
    browser.restore();
  }
});

// ─── Browser-driven navigation (popstate/hashchange) guard coverage ───

interface FakeBrowser {
  /** URLs passed to pushState/replaceState, in order. */
  readonly applied: string[];
  /** Move the browser itself (back/forward buttons) without pushState. */
  jumpTo(url: string): void;
  /** Dispatch a captured window listener (popstate/hashchange). */
  fire(type: string): void;
  /** The current router-visible path (hash without '#' in hash mode). */
  path(): string;
  restore(): void;
}

function installFakeBrowser(initialUrl: string): FakeBrowser {
  const descriptors = {
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
  };
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  const state = { pathname: '/', search: '', hash: '' };
  const applyUrl = (url: string): void => {
    if (url.startsWith('#')) {
      state.hash = url;
    } else {
      const u = new URL(url, 'https://router.test');
      state.pathname = u.pathname;
      state.search = u.search;
    }
  };
  applyUrl(initialUrl);
  const applied: string[] = [];
  const listeners = new Map<string, EventListener[]>();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      href: 'https://router.test/',
      get pathname() {
        return state.pathname;
      },
      get search() {
        return state.search;
      },
      get hash() {
        return state.hash;
      },
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: {
      pushState(_state: unknown, _title: string, url: string) {
        applied.push(url);
        applyUrl(url);
      },
      replaceState(_state: unknown, _title: string, url: string) {
        applied.push(url);
        applyUrl(url);
      },
    },
  });
  globalThis.addEventListener = ((type: string, listener: EventListener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((type: string, listener: EventListener) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }) as typeof globalThis.removeEventListener;
  return {
    applied,
    jumpTo: applyUrl,
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
    path() {
      return state.hash ? state.hash.replace(/^#/, '') : state.pathname + state.search;
    },
    restore() {
      globalThis.addEventListener = originalAdd;
      globalThis.removeEventListener = originalRemove;
      if (descriptors.location) Object.defineProperty(globalThis, 'location', descriptors.location);
      else delete (globalThis as Record<string, unknown>).location;
      if (descriptors.history) Object.defineProperty(globalThis, 'history', descriptors.history);
      else delete (globalThis as Record<string, unknown>).history;
    },
  };
}

/** Guards are async; let the serialized browser-navigation queue drain. */
async function flushBrowserNavigation(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test('popstate runs the guard and restores the previous entry when blocked', async () => {
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          events.push('guard');
          return Promise.resolve(false);
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    // The browser itself moved the history pointer onto /protected.
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // The guard ran, rejected the navigation, and the previous entry was
    // restored without notifying a change that never committed.
    assertEquals(events, ['guard']);
    assertEquals(router.currentPath, '/public');
    assertEquals(browser.path(), '/public');
    assertEquals(browser.applied, ['/public']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate commits the landed route when the guard allows it', async () => {
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          events.push('guard');
          return Promise.resolve(true);
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, ['guard', 'change']);
    assertEquals(router.currentPath, '/protected');
    assertEquals(router.currentRoute?.tagName, 'protected-page');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate follows a guard redirect with replace semantics', async () => {
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/protected', tagName: 'protected-page', guard: () => Promise.resolve('/login') },
      { path: '/login', tagName: 'login-page' },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, ['change']);
    assertEquals(router.currentPath, '/login');
    assertEquals(router.currentRoute?.tagName, 'login-page');
    assertEquals(browser.path(), '/login');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate follows a multi-hop guard redirect chain', async () => {
  const browser = installFakeBrowser('/public');
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/old', tagName: 'old-page', guard: () => Promise.resolve('/newer') },
      { path: '/newer', tagName: 'newer-page', guard: () => Promise.resolve('/newest') },
      { path: '/newest', tagName: 'newest-page' },
    ],
  });
  try {
    browser.jumpTo('/old');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/newest');
    assertEquals(router.currentRoute?.tagName, 'newest-page');
    assertEquals(browser.path(), '/newest');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate restores the source entry when a guard redirect target is blocked', async () => {
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/old', tagName: 'old-page', guard: () => Promise.resolve('/protected') },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          events.push('guard');
          return Promise.resolve(false);
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('/old');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // The redirect target's guard blocked, so the entry the user came from
    // was restored and no change was notified.
    assertEquals(events, ['guard']);
    assertEquals(router.currentPath, '/public');
    assertEquals(router.currentRoute?.tagName, 'public-page');
    assertEquals(browser.path(), '/public');
    assertEquals(browser.applied, ['/public']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate dedupes consecutive events landing on the same URL', async () => {
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          events.push('guard');
          return Promise.resolve(true);
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('/protected');
    browser.fire('popstate');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, ['guard', 'change']);
    assertEquals(router.currentPath, '/protected');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('hashchange runs the guard and restores the previous hash entry when blocked', async () => {
  const browser = installFakeBrowser('#/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'hash',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          events.push('guard');
          return Promise.resolve(false);
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('#/protected');
    browser.fire('hashchange');
    await flushBrowserNavigation();
    assertEquals(events, ['guard']);
    assertEquals(router.currentPath, '/public');
    assertEquals(browser.path(), '/public');
    assertEquals(browser.applied, ['#/public']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('programmatic navigations are latest-wins: a slow stale guard cannot roll back a newer navigation (#1023)', async () => {
  const browser = installFakeBrowser('/start');
  let releaseGuard!: () => void;
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/start', tagName: 'start-page' },
      {
        path: '/guarded',
        tagName: 'guarded-page',
        guard: () =>
          new Promise<boolean>((resolve) => {
            releaseGuard = () => resolve(true);
          }),
      },
      { path: '/newer', tagName: 'newer-page' },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    // First navigation suspends in its async guard.
    const stale = router.navigate('/guarded');
    // A newer navigation commits while the first guard is still pending.
    await router.navigate('/newer');
    assertEquals(router.currentPath, '/newer');
    // The stale guard resolves afterwards: it must not push state or rematch.
    releaseGuard();
    await stale;
    assertEquals(router.currentPath, '/newer');
    assertEquals(browser.path(), '/newer');
    assertEquals(browser.applied, ['/newer']);
    assertEquals(events, ['change']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate guard redirect does not override a newer programmatic navigation (#1063)', async () => {
  const browser = installFakeBrowser('/public');
  let releaseGuard!: () => void;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () =>
          new Promise<string>((resolve) => {
            releaseGuard = () => resolve('/login');
          }),
      },
      { path: '/login', tagName: 'login-page' },
      { path: '/x', tagName: 'x-page' },
    ],
  });
  try {
    // The browser itself lands on the guarded route; its guard suspends.
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // A programmatic navigation commits while the guard is still pending.
    await router.navigate('/x');
    assertEquals(router.currentPath, '/x');
    // The stale guard resolves with a redirect afterwards: it must not
    // replaceState over the newer navigation.
    releaseGuard();
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/x');
    assertEquals(router.currentRoute?.tagName, 'x-page');
    assertEquals(browser.path(), '/x');
    assertEquals(browser.applied, ['/x']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('popstate guard redirect does not override a newer programmatic navigation while the redirect target guard is pending', async () => {
  const browser = installFakeBrowser('/public');
  let releaseGuard!: () => void;
  let releaseRedirectGuard!: () => void;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () =>
          new Promise<string>((resolve) => {
            releaseGuard = () => resolve('/login');
          }),
      },
      {
        path: '/login',
        tagName: 'login-page',
        guard: () =>
          new Promise<boolean>((resolve) => {
            releaseRedirectGuard = () => resolve(true);
          }),
      },
      { path: '/x', tagName: 'x-page' },
    ],
  });
  try {
    // The browser itself lands on the guarded route; its guard suspends.
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // The guard redirects, and the redirect target's own guard suspends.
    releaseGuard();
    await flushBrowserNavigation();
    // A programmatic navigation commits while the nested guard is pending.
    await router.navigate('/x');
    assertEquals(router.currentPath, '/x');
    // The stale nested guard resolves afterwards: it must not replaceState
    // over the newer navigation's history entry.
    releaseRedirectGuard();
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/x');
    assertEquals(router.currentRoute?.tagName, 'x-page');
    assertEquals(browser.path(), '/x');
    assertEquals(browser.applied, ['/x']);
  } finally {
    router.dispose();
    browser.restore();
  }
});

// ─── Guard-veto history trap (#1036) ───────────────────────────────

/**
 * Fake browser with a truthful history model: pushState truncates the forward
 * stack and appends, replaceState rewrites the current entry, and back() moves
 * the session pointer before dispatching popstate.
 */
function installFakeHistoryStack(initialEntries: string[]) {
  const descriptors = {
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
  };
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  const entries = [...initialEntries];
  let pointer = entries.length - 1;
  const listeners = new Map<string, EventListener[]>();
  const currentUrl = () => new URL(entries[pointer], 'https://router.test');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      get href() {
        return currentUrl().href;
      },
      get pathname() {
        return currentUrl().pathname;
      },
      get search() {
        return currentUrl().search;
      },
      get hash() {
        return '';
      },
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: {
      pushState(_state: unknown, _title: string, url: string) {
        entries.length = pointer + 1;
        entries.push(url);
        pointer++;
      },
      replaceState(_state: unknown, _title: string, url: string) {
        entries[pointer] = url;
      },
    },
  });
  globalThis.addEventListener = ((type: string, listener: EventListener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((type: string, listener: EventListener) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }) as typeof globalThis.removeEventListener;
  return {
    entries,
    back() {
      if (pointer > 0) pointer--;
      for (const listener of listeners.get('popstate') ?? []) {
        listener(new Event('popstate'));
      }
    },
    path() {
      return entries[pointer];
    },
    restore() {
      globalThis.addEventListener = originalAdd;
      globalThis.removeEventListener = originalRemove;
      if (descriptors.location) Object.defineProperty(globalThis, 'location', descriptors.location);
      else delete (globalThis as Record<string, unknown>).location;
      if (descriptors.history) Object.defineProperty(globalThis, 'history', descriptors.history);
      else delete (globalThis as Record<string, unknown>).history;
    },
  };
}

Deno.test('popstate guard veto does not trap earlier history entries (#1036)', async () => {
  // /a ← /guarded ← /b: the user backs onto the vetoed /guarded entry.
  const browser = installFakeHistoryStack(['/a', '/guarded', '/b']);
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/a', tagName: 'a-page' },
      { path: '/guarded', tagName: 'guarded-page', guard: () => Promise.resolve(false) },
      { path: '/b', tagName: 'b-page' },
    ],
  });
  try {
    browser.back();
    await flushBrowserNavigation();
    // Vetoed: the router and the address bar stay on /b.
    assertEquals(router.currentPath, '/b');
    assertEquals(browser.path(), '/b');
    // The vetoed entry must not sit under the restored one forever: with
    // push-restore the next back re-landed on /guarded and bounced again,
    // leaving /a unreachable; replace-restore rewrites the vetoed entry, so
    // the next back reaches /a.
    browser.back();
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/a');
    assertEquals(browser.path(), '/a');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('back onto a veto-restored entry after a programmatic navigation re-syncs the router', async () => {
  // /a ← /guarded ← /b: the user backs onto the vetoed /guarded entry, a
  // programmatic navigation commits, then the user backs onto the /b entry
  // the veto restore rewrote.
  const browser = installFakeHistoryStack(['/a', '/guarded', '/b']);
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/a', tagName: 'a-page' },
      { path: '/guarded', tagName: 'guarded-page', guard: () => Promise.resolve(false) },
      { path: '/b', tagName: 'b-page' },
      { path: '/x', tagName: 'x-page' },
    ],
  });
  try {
    browser.back();
    await flushBrowserNavigation();
    // Vetoed: the router and the address bar stay on /b.
    assertEquals(router.currentPath, '/b');
    assertEquals(browser.path(), '/b');
    // A programmatic navigation commits; pushState does not fire popstate.
    await router.navigate('/x');
    assertEquals(router.currentPath, '/x');
    // A genuine back lands on the restored /b entry: the dedup key left
    // over from the veto restore must not swallow it, or the address bar
    // (/b) and the router (/x) diverge.
    browser.back();
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/b');
    assertEquals(browser.path(), '/b');
  } finally {
    router.dispose();
    browser.restore();
  }
});

// ─── Adversarial dispose / guard-failure coverage (#1146, area 3) ───

/**
 * Process-level unhandledRejection trap (#1146-3d).
 *
 * Must be installed BEFORE installFakeBrowser (which replaces
 * globalThis.addEventListener) so the trap lands on the real event target,
 * and restored AFTER browser.restore() puts the real functions back.
 * preventDefault keeps the run alive; the assertions report failures.
 */
function trapUnhandledRejections(): { rejections: unknown[]; restore(): void } {
  const rejections: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    rejections.push(event.reason);
    event.preventDefault();
  };
  addEventListener('unhandledrejection', onUnhandled);
  return {
    rejections,
    restore() {
      removeEventListener('unhandledrejection', onUnhandled);
    },
  };
}

Deno.test('client router dispose mid-redirect-chain commits nothing and unhooks listeners (#1146-3a/3d)', async () => {
  const trap = trapUnhandledRejections();
  const browser = installFakeBrowser('/');
  let resolveB!: (value: string) => void;
  const guardCalls: string[] = [];
  let changes = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/', tagName: 'home-page' },
      {
        path: '/a',
        tagName: 'a-page',
        guard: () => {
          guardCalls.push('a');
          return Promise.resolve('/b');
        },
      },
      {
        path: '/b',
        tagName: 'b-page',
        guard: () => {
          guardCalls.push('b');
          return new Promise<string>((resolve) => resolveB = resolve);
        },
      },
      { path: '/c', tagName: 'c-page' },
    ],
    onChange: () => {
      changes++;
    },
  });
  try {
    const navigation = router.navigate('/a');
    // Hop 1 (/a → /b) resolves; hop 2 (/b's guard) suspends.
    await flushBrowserNavigation();
    assertEquals(guardCalls, ['a', 'b']);
    // Dispose between hops, then let the stale guard resolve the chain on.
    router.dispose();
    resolveB('/c');
    await navigation;
    await flushBrowserNavigation();
    // No navigation committed: nothing pushed/replaced, router state and the
    // address bar still describe the initial entry, no change notified.
    assertEquals(browser.applied, []);
    assertEquals(browser.path(), '/');
    assertEquals(router.currentPath, '/');
    assertEquals(router.currentRoute?.tagName, 'home-page');
    assertEquals(changes, 0);
    // Listeners were removed: a browser event after dispose runs no guard.
    browser.jumpTo('/a');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(guardCalls, ['a', 'b']);
    assertEquals(router.currentPath, '/');
    assertEquals(trap.rejections, []);
  } finally {
    router.dispose();
    browser.restore();
    trap.restore();
  }
});

Deno.test('client router dispose invalidates a pending hash-mode browser guard (#1146-3b/3d)', async () => {
  const trap = trapUnhandledRejections();
  let resolveGuard!: (value: boolean) => void;
  let guardCalls = 0;
  const browser = installFakeBrowser('#/public');
  let changes = 0;
  const router = createRouter({
    mode: 'hash',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () => {
          guardCalls++;
          return new Promise<boolean>((resolve) => resolveGuard = resolve);
        },
      },
    ],
    onChange: () => {
      changes++;
    },
  });
  try {
    browser.jumpTo('#/protected');
    browser.fire('hashchange');
    await flushBrowserNavigation();
    assertEquals(guardCalls, 1);
    router.dispose();
    resolveGuard(true);
    await flushBrowserNavigation();
    // The stale guard resolution committed nothing and restored nothing.
    assertEquals(router.currentPath, '/public');
    assertEquals(router.currentRoute?.tagName, 'public-page');
    assertEquals(browser.applied, []);
    assertEquals(changes, 0);
    // The hashchange listener is gone: further hash events run no guard.
    browser.jumpTo('#/protected');
    browser.fire('hashchange');
    await flushBrowserNavigation();
    assertEquals(guardCalls, 1);
    assertEquals(trap.rejections, []);
  } finally {
    router.dispose();
    browser.restore();
    trap.restore();
  }
});

Deno.test('client router navigate rejects on a synchronously-throwing guard without corrupting state (#1146-3c/3d)', async () => {
  const trap = trapUnhandledRejections();
  const browser = installFakeBrowser('/');
  let changes = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/', tagName: 'home-page' },
      {
        path: '/boom',
        tagName: 'boom-page',
        guard: () => {
          throw new Error('guard boom');
        },
      },
      { path: '/ok', tagName: 'ok-page' },
    ],
    onChange: () => {
      changes++;
    },
  });
  try {
    // Contract: a sync-throwing guard surfaces as a rejection of the
    // navigate() promise (same as an async rejection), before any commit.
    await assertRejects(() => router.navigate('/boom'), Error, 'guard boom');
    assertEquals(browser.applied, []);
    assertEquals(router.currentPath, '/');
    assertEquals(router.currentRoute?.tagName, 'home-page');
    assertEquals(changes, 0);
    // The router is not corrupted: a later navigation still commits.
    await router.navigate('/ok');
    assertEquals(router.currentPath, '/ok');
    assertEquals(router.currentRoute?.tagName, 'ok-page');
    assertEquals(changes, 1);
    assertEquals(trap.rejections, []);
  } finally {
    router.dispose();
    browser.restore();
    trap.restore();
  }
});

Deno.test('client router popstate with a synchronously-throwing guard fails open without wedging the queue (#1146-3c/3d)', async () => {
  const trap = trapUnhandledRejections();
  const browser = installFakeBrowser('/public');
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/boom',
        tagName: 'boom-page',
        guard: () => {
          events.push('guard');
          throw new Error('guard boom');
        },
      },
    ],
    onChange: () => {
      events.push('change');
    },
  });
  try {
    browser.jumpTo('/boom');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // Documented fail-open: the queue catch logs the error, rematches to the
    // real URL and notifies — the address bar wins over the crashed guard.
    assertEquals(events, ['guard', 'change']);
    assertEquals(router.currentPath, '/boom');
    assertEquals(router.currentRoute?.tagName, 'boom-page');
    assertEquals(browser.path(), '/boom');
    // The serialized browser-navigation queue is not wedged by the throw:
    // a later popstate still processes.
    browser.jumpTo('/public');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, ['guard', 'change', 'change']);
    assertEquals(router.currentPath, '/public');
    assertEquals(router.currentRoute?.tagName, 'public-page');
    assertEquals(trap.rejections, []);
  } finally {
    router.dispose();
    browser.restore();
    trap.restore();
  }
});

// ─── Native navigation ownership: POST / fragment / reload stay browser-owned ───

interface FakeNavigateEvent {
  destination: { url: string };
  canIntercept: boolean;
  downloadRequest: unknown;
  sourceElement: { hasAttribute: (name: string) => boolean } | null;
  signal: AbortSignal;
  info: unknown;
  formData?: FormData | null;
  method?: string;
  navigationType?: string;
  intercepted: boolean;
  intercept(options: { handler: () => Promise<void> }): void;
  /** The captured intercept handler; runHandler drives it to completion. */
  runHandler(): Promise<void>;
}

function installFakeNavigation() {
  const descriptors = {
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
    navigation: Object.getOwnPropertyDescriptor(globalThis, 'navigation'),
  };
  const listeners = new Map<string, EventListener[]>();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'http:',
      origin: 'http://router.test',
      href: 'http://router.test/a',
      pathname: '/a',
      search: '',
      hash: '',
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { pushState() {}, replaceState() {} },
  });
  const fakeNavigation = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
  };
  Object.defineProperty(globalThis, 'navigation', { configurable: true, value: fakeNavigation });
  const makeEvent = (
    overrides: Partial<FakeNavigateEvent> & { destination: { url: string } },
  ): FakeNavigateEvent => ({
    canIntercept: true,
    downloadRequest: null,
    sourceElement: null,
    signal: new AbortController().signal,
    info: undefined,
    intercepted: false,
    intercept(this: FakeNavigateEvent, options: { handler: () => Promise<void> }) {
      this.intercepted = true;
      this.runHandler = () => options.handler();
    },
    runHandler: () => Promise.resolve(),
    ...overrides,
  });
  return {
    fire(event: FakeNavigateEvent) {
      for (const listener of listeners.get('navigate') ?? []) {
        (listener as (e: unknown) => void)(event);
      }
    },
    makeEvent,
    restore() {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

Deno.test('native POST with formData stays browser-owned: no pending, no intercept', () => {
  const nav = installFakeNavigation();
  let pending = 0;
  const router = createRouter({
    mode: 'history',
    routes: [{ path: '/a', tagName: 'a-page' }],
    onPending: () => pending++,
  });
  try {
    const event = nav.makeEvent({
      destination: { url: 'http://router.test/a' },
      formData: new FormData(),
    });
    nav.fire(event);
    assertEquals(event.intercepted, false);
    assertEquals(pending, 0);
    assertEquals(router.currentPath, '/a');
  } finally {
    router.dispose();
    nav.restore();
  }
});

Deno.test('native fragment-only navigation stays browser-owned without cancelling loaders', () => {
  const nav = installFakeNavigation();
  let pending = 0;
  let guards = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/a', tagName: 'a-page', guard: () => (guards++, Promise.resolve(true)) },
    ],
    onPending: () => void pending++,
    onChange: () => void pending++,
  });
  try {
    const event = nav.makeEvent({ destination: { url: 'http://router.test/a#section' } });
    nav.fire(event);
    assertEquals(event.intercepted, false);
    assertEquals(pending, 0);
    assertEquals(guards, 0);
    assertEquals(router.currentPath, '/a');
  } finally {
    router.dispose();
    nav.restore();
  }
});

Deno.test('native reload stays browser-owned', () => {
  const nav = installFakeNavigation();
  let pending = 0;
  const router = createRouter({
    mode: 'history',
    routes: [{ path: '/a', tagName: 'a-page' }],
    onPending: () => pending++,
  });
  try {
    const event = nav.makeEvent({
      destination: { url: 'http://router.test/a' },
      navigationType: 'reload',
    });
    nav.fire(event);
    assertEquals(event.intercepted, false);
    assertEquals(pending, 0);
  } finally {
    router.dispose();
    nav.restore();
  }
});

Deno.test('native same-origin GET without formData still intercepts', async () => {
  const nav = installFakeNavigation();
  let pending = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/a', tagName: 'a-page' },
      { path: '/b', tagName: 'b-page' },
    ],
    onPending: () => pending++,
  });
  try {
    const event = nav.makeEvent({ destination: { url: 'http://router.test/b' } });
    nav.fire(event);
    assertEquals(event.intercepted, true);
    // Cancellation fires at the ownership point — inside the intercepted
    // handler after the (here absent) guard resolves — not at event time, so
    // a vetoed traversal cancels nothing (#1343 review).
    assertEquals(pending, 0);
    await event.runHandler();
    assertEquals(pending, 1);
    assertEquals(router.currentPath, '/b');
  } finally {
    router.dispose();
    nav.restore();
  }
});

// #1343 review (P2): a guard-vetoed navigation never owned intent, so it must
// leave pending execution (the current route's in-flight render) untouched.
// Cancellation is retained exactly when a navigation takes ownership.

Deno.test('guard-vetoed programmatic navigation never cancels pending execution (#1343 review)', async () => {
  const browser = installFakeBrowser('/current');
  let pending = 0;
  let changes = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/current', tagName: 'current-page' },
      { path: '/blocked', tagName: 'blocked-page', guard: () => Promise.resolve(false) },
      { path: '/allowed', tagName: 'allowed-page' },
    ],
    onPending: () => {
      pending++;
    },
    onChange: () => {
      changes++;
    },
  });
  try {
    await router.navigate('/blocked');
    assertEquals(pending, 0, 'a vetoed navigation must not invalidate pending execution');
    assertEquals(changes, 0);
    assertEquals(router.currentPath, '/current');
    await router.navigate('/allowed');
    assertEquals(pending, 1, 'an ownership-taking navigation cancels pending execution once');
    assertEquals(changes, 1);
    assertEquals(router.currentPath, '/allowed');
    await router.replace('/blocked');
    assertEquals(pending, 1, 'a vetoed replace cancels nothing');
    assertEquals(router.currentPath, '/allowed');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('guard-vetoed popstate never cancels pending execution (#1343 review)', async () => {
  const browser = installFakeBrowser('/public');
  let pending = 0;
  const events: string[] = [];
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      { path: '/protected', tagName: 'protected-page', guard: () => Promise.resolve(false) },
      { path: '/open', tagName: 'open-page' },
    ],
    onPending: () => {
      pending++;
      events.push('pending');
    },
    onChange: () => {
      events.push('change');
    },
  });
  try {
    // The browser itself moved onto the guarded URL; the veto restores the
    // previous entry without cancelling the current route's pending render.
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, []);
    assertEquals(pending, 0);
    assertEquals(router.currentPath, '/public');
    assertEquals(browser.path(), '/public');
    // An allowed traversal still cancels pending execution exactly once.
    browser.jumpTo('/open');
    browser.fire('popstate');
    await flushBrowserNavigation();
    assertEquals(events, ['pending', 'change']);
    assertEquals(router.currentPath, '/open');
  } finally {
    router.dispose();
    browser.restore();
  }
});

Deno.test('guard-vetoed native traverse never cancels pending execution (#1343 review)', async () => {
  const nav = installFakeNavigation();
  let pending = 0;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/a', tagName: 'a-page' },
      { path: '/blocked', tagName: 'blocked-page', guard: () => Promise.resolve(false) },
    ],
    onPending: () => pending++,
  });
  try {
    const event = nav.makeEvent({ destination: { url: 'http://router.test/blocked' } });
    nav.fire(event);
    assertEquals(event.intercepted, true);
    await event.runHandler();
    assertEquals(pending, 0, 'a vetoed native traverse must not invalidate pending execution');
    assertEquals(router.currentPath, '/a');
  } finally {
    router.dispose();
    nav.restore();
  }
});

Deno.test('client router never leaks unhandled rejections across dispose and guard-failure storms (#1146-3d)', async () => {
  const trap = trapUnhandledRejections();
  const browser = installFakeBrowser('/public');
  let rejectBrowserGuard!: (err: Error) => void;
  let rejectChainGuard!: (err: Error) => void;
  const router = createRouter({
    mode: 'history',
    routes: [
      { path: '/public', tagName: 'public-page' },
      {
        path: '/protected',
        tagName: 'protected-page',
        guard: () =>
          new Promise<boolean>((_resolve, reject) => {
            rejectBrowserGuard = reject;
          }),
      },
      { path: '/a', tagName: 'a-page', guard: () => Promise.resolve('/b') },
      {
        path: '/b',
        tagName: 'b-page',
        guard: () =>
          new Promise<string>((_resolve, reject) => {
            rejectChainGuard = reject;
          }),
      },
    ],
  });
  try {
    // A browser-driven guard suspends...
    browser.jumpTo('/protected');
    browser.fire('popstate');
    await flushBrowserNavigation();
    // ...and a programmatic redirect chain suspends on its second hop.
    const navigation = router.navigate('/a');
    await flushBrowserNavigation();
    // Disposing invalidates both; both guards then reject late.
    router.dispose();
    rejectBrowserGuard(new Error('late browser guard failure'));
    rejectChainGuard(new Error('late chain guard failure'));
    // The browser-queue rejection is swallowed post-dispose; the navigate()
    // rejection still surfaces to its caller (handled here), so nothing is
    // left unhandled.
    await assertRejects(() => navigation, Error, 'late chain guard failure');
    await flushBrowserNavigation();
    assertEquals(router.currentPath, '/public');
    assertEquals(browser.applied, []);
    assertEquals(trap.rejections, []);
  } finally {
    router.dispose();
    browser.restore();
    trap.restore();
  }
});

Deno.test('client router searchParams are per-reader snapshots, never shared mutable state', async () => {
  const browser = installFakeBrowser('/items/1?view=full');
  const router = createRouter({
    mode: 'history',
    routes: [{ path: '/items/:id', tagName: 'item-page' }],
  });
  try {
    assertEquals(router.searchParams.get('view'), 'full');
    // Mutating a returned snapshot cannot reach the router's own state...
    const leaked = router.searchParams;
    leaked.set('view', 'hacked');
    leaked.append('injected', '1');
    assertEquals(router.searchParams.get('view'), 'full');
    assertEquals(router.searchParams.has('injected'), false);
    // ...nor the address bar...
    assertEquals(browser.path(), '/items/1?view=full');
    // ...nor the snapshots of subsequent navigations.
    await router.navigate('/items/2?view=mini');
    assertEquals(router.searchParams.get('view'), 'mini');
    assertEquals(router.searchParams.has('injected'), false);
  } finally {
    router.dispose();
    browser.restore();
  }
});
