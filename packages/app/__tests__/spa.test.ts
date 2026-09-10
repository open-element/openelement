/**
 * @openelement/app — SPA bootstrap tests (v0.44 compiled contract).
 *
 * Page hosts are compiled elements: defineApp projects loader/action state
 * onto the page's compiled properties through the descriptor's props/error
 * projectors (or the default params+data projection), assigned as
 * pre-connect own properties that the element facade reconciles at connect.
 * The legacy definePage render-function + applyPageHostData seam is gone.
 */
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  defineApp,
  definePage,
  fail,
  notFound,
  type PagePropsContext,
  redirect,
} from '../src/index.ts';
import { assertValidTagName } from '@openelement/element';
import type { RouteConfig } from '../src/internal/router/client-router.ts';

Deno.test('SPA interface accepts custom-element routes', () => {
  const routes: RouteConfig[] = [{ path: '/', tagName: 'app-home' }];
  // Public docs derive the non-exported options type from the function
  // signature so 0.43.x does not add a new named public export.
  const options: Parameters<typeof defineApp>[0] = { mode: 'spa', routes };
  const app = defineApp(options);
  assertEquals(app.router, null);
  app.dispose();
});

Deno.test('SPA route contract rejects legacy component callbacks at type level', () => {
  const route: RouteConfig = { path: '/settings', tagName: 'app-settings' };
  assertEquals(Object.hasOwn(route, 'component'), false);
});

// ─── v0.44 page-projection test helpers ────────────────────────────

interface ProbeCalls {
  normal: PagePropsContext[];
  errors: Array<{ error: unknown; context: PagePropsContext }>;
}

/**
 * A page class carrying a recording projector pair. definePage() only
 * requires a constructor (the pipeline fail-closes on uncompiled classes at
 * render time); the SPA path exercises the descriptor seam, not the compiler.
 */
function defineProbePage(calls: ProbeCalls): CustomElementConstructor {
  const Page = class {} as unknown as CustomElementConstructor;
  return definePage(Page, {
    props(context) {
      calls.normal.push(context);
      return {
        ...context.params,
        ...(typeof context.data === 'object' && context.data !== null &&
            !Array.isArray(context.data)
          ? context.data as Record<string, unknown>
          : {}),
      };
    },
    error(error, context) {
      calls.errors.push({ error, context });
      return { errored: true };
    },
  });
}

function stubRegistry(classes: Record<string, unknown>): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: {
      get: (tag: string) => (classes as Record<string, unknown>)[tag],
      define() {},
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'customElements', descriptor);
    else delete (globalThis as Record<string, unknown>).customElements;
  };
}

Deno.test('defineApp mounts loader data and route context through the page props projector', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'article-page': Page });

  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/articles/hello?preview=yes');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: () => root,
      createElement: () => ({}),
    },
  });

  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/articles/:slug',
      tagName: 'article-page',
      loader: ({ params, searchParams }) =>
        Promise.resolve({ title: `${params.slug}:${searchParams.get('preview')}` }),
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(calls.errors, []);
    assertEquals(calls.normal.length, 1);
    const context = calls.normal[0];
    assertEquals(context.data, { title: 'hello:yes' });
    assertEquals(context.params, { slug: 'hello' });
    assertEquals(context.request?.url, 'https://example.test/articles/hello?preview=yes');
    assertEquals(context.route, { path: '/articles/:slug' });
    // The projected values landed on the host as pre-connect own properties.
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].slug, 'hello');
    assertEquals(hosts[0].preview, undefined);
    assertEquals(hosts[0].title, 'hello:yes');
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('defineApp loader searchParams is a copy: mutation cannot pollute router state or the address bar', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'article-page': Page });
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: unknown) {
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/articles/hello?preview=yes');
  let loaderParams: URLSearchParams | undefined;
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/articles/:slug',
      tagName: 'article-page',
      loader: ({ searchParams }) => {
        loaderParams = searchParams;
        searchParams.set('preview', 'hacked');
        searchParams.append('injected', '1');
        return Promise.resolve({ title: searchParams.get('preview') });
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The loader saw and used its own mutable copy.
    assertEquals(loaderParams?.get('preview'), 'hacked');
    assertEquals(calls.normal[0].data, { title: 'hacked' });
    // The router's canonical snapshot is unpolluted...
    assertEquals(app.router?.searchParams.get('preview'), 'yes');
    assertEquals(app.router?.searchParams.has('injected'), false);
    // ...and so is the address bar.
    assertEquals(env.location.search, '?preview=yes');
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('defineApp rejects missing targets and safely remounts and redisposes', () => {
  const root = { innerHTML: '', addEventListener() {}, removeEventListener() {}, appendChild() {} };
  let found = false;
  const env = stubNavigableEnvironment(root, '/');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => found ? root : null, createElement: () => ({}) },
  });
  const app = defineApp({ mode: 'spa', routes: [] });
  try {
    let message = '';
    try {
      app.mount('#missing');
    } catch (error) {
      message = String(error);
    }
    assertStringIncludes(message, 'Mount target not found');
    found = true;
    app.mount('#app');
    app.mount('#app');
    app.dispose();
    app.dispose();
    assertEquals(app.router, null);
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp action delegation handles shadow paths and action failures without crashing', async () => {
  let submit: ((event: Event) => void) | undefined;
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'home-page': Page });
  let renders = 0;
  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild() {
      renders++;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: () => Promise.resolve({ renders }),
      action: () => Promise.reject(new Error('save failed')),
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const form = { tagName: 'FORM' };
    let prevented = false;
    submit?.({
      target: { tagName: 'OPEN-BUTTON' },
      composedPath: () => [{ tagName: 'SPAN' }, form],
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(prevented, true);
    assertEquals(renders, 2);
    assertEquals(calls.normal.length, 2);
    // The action failure rides the projector's actionData channel.
    assertEquals(calls.normal[1].actionData, { error: 'Action failed' });
    assertEquals(calls.normal[0].request, calls.normal[1].request);

    // Non-form submissions and routes without an action are ignored.
    submit?.({ target: {}, composedPath: () => [], preventDefault() {} } as unknown as Event);
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('defineApp projects returned fail() data through the same action outcome as the server', async () => {
  let submit: ((event: Event) => void) | undefined;
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'home-page': Page });
  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild() {},
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: () => Promise.resolve({ page: 'home' }),
      action: () => Promise.resolve(fail(422, { field: 'required' })),
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    submit?.({
      target: { tagName: 'FORM' },
      composedPath: () => [],
      preventDefault() {},
    } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(calls.errors, []);
    assertEquals(calls.normal.length, 2);
    assertEquals(calls.normal[1].data, { page: 'home' });
    assertEquals(calls.normal[1].actionData, { field: 'required' });
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('defineApp routes loader failures to the page error projector, not the data channel (#676)', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'article-page': Page });

  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/articles/hello');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: () => root,
      createElement: () => ({}),
    },
  });

  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/articles/:slug',
      tagName: 'article-page',
      loader: () => Promise.reject(new Error('fetch failed')),
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The error projector receives the stable failure shape...
    assertEquals(calls.errors.length, 1);
    assertEquals(calls.errors[0].error, { error: 'Loader failed' });
    // ...and the data channel stays empty instead of carrying a fake shape.
    assertEquals(calls.errors[0].context.data, undefined);
    assertEquals(calls.errors[0].context.params, { slug: 'hello' });
    assertEquals(calls.normal, []);
    // The error projection landed on the host.
    assertEquals(hosts[0].errored, true);
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('assertValidTagName accepts valid tag names and rejects invalid ones (#642)', () => {
  assertValidTagName('app-home');
  assertValidTagName('a1-b2');
  assertThrows(() => assertValidTagName('x'), Error);
  assertThrows(() => assertValidTagName('Invalid'), Error);
  assertThrows(() => assertValidTagName('UPPER'), Error);
  assertThrows(() => assertValidTagName('bad_name'), Error);
  assertThrows(() => assertValidTagName(''), Error);
  assertThrows(() => assertValidTagName('with space'), Error);
});

Deno.test('unregistered tagName warns and renders nothing instead of an inert host (#642)', async () => {
  const originalCustomElements = Object.getOwnPropertyDescriptor(globalThis, 'customElements');

  const root = { innerHTML: '', addEventListener() {}, removeEventListener() {}, appendChild() {} };
  const env = stubNavigableEnvironment(root, '/');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: { get: () => undefined },
  });

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

  const app = defineApp({ mode: 'spa', routes: [{ path: '/', tagName: 'home-page' }] });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertStringIncludes(warnings.join('\n'), 'unregistered tagName: home-page');
    // Empty render: root was cleared and nothing appended.
    assertEquals(root.innerHTML, '');
  } finally {
    app.dispose();
    console.warn = originalWarn;
    env.restore();
    if (originalCustomElements) {
      Object.defineProperty(globalThis, 'customElements', originalCustomElements);
    } else delete (globalThis as Record<string, unknown>).customElements;
  }
});

// ─── #731: redirect()/notFound() in the SPA chain ──────────────

/**
 * Stub the browser environment for SPA tests. pushState/replaceState URLs are
 * applied to the fake location so the router actually lands on redirect targets.
 */
function stubNavigableEnvironment(root: unknown, initialPath: string) {
  const descriptors = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
  };
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  const initial = new URL(initialPath, 'https://example.test');
  const fakeLocation = {
    protocol: 'https:',
    pathname: initial.pathname,
    search: initial.search,
    hash: '',
    href: initial.href,
  };
  const pushed: string[] = [];
  const applyUrl = (url: string | URL | null | undefined) => {
    if (url == null) return;
    const next = new URL(String(url), fakeLocation.href);
    fakeLocation.pathname = next.pathname;
    fakeLocation.search = next.search;
    fakeLocation.hash = next.hash;
    fakeLocation.href = next.href;
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => root, createElement: () => ({}) },
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: fakeLocation });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: {
      pushState(_state: unknown, _unused: unknown, url?: string | URL | null) {
        pushed.push(String(url));
        applyUrl(url);
      },
      replaceState(_state: unknown, _unused: unknown, url?: string | URL | null) {
        applyUrl(url);
      },
    },
  });
  globalThis.addEventListener = (() => {}) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = (() => {}) as typeof globalThis.removeEventListener;
  return {
    location: fakeLocation,
    pushed,
    restore() {
      globalThis.addEventListener = originalAdd;
      globalThis.removeEventListener = originalRemove;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

Deno.test('defineApp navigates when the SPA loader throws redirect() (#731)', async () => {
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      {
        path: '/',
        tagName: 'home-page',
        loader: () => {
          redirect('/login');
        },
      },
      {
        path: '/login',
        tagName: 'login-page',
        loader: () => Promise.resolve({ page: 'login' }),
      },
    ],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The redirect navigated instead of becoming page data...
    assertEquals(env.pushed, ['/login']);
    assertEquals(app.router?.currentPath, '/login');
    // ...and the destination route rendered with its own loader data
    // (default projection: loader-data record entries land on the host).
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].page, 'login');
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp keeps current page data when a guard vetoes the loader redirect (#802)', async () => {
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      {
        path: '/',
        tagName: 'home-page',
        loader: () => Promise.resolve({ page: 'home' }),
      },
      {
        path: '/away',
        tagName: 'away-page',
        loader: () => {
          redirect('/login');
        },
      },
      {
        path: '/login',
        tagName: 'login-page',
        guard: () => Promise.resolve(false),
        loader: () => Promise.resolve({ page: 'login' }),
      },
    ],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].page, 'home');

    await app.router?.navigate('/away');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The guard vetoed the redirect target, so the navigation never
    // committed: no re-render with `data: undefined` — the current page
    // keeps its loader data (same as the action redirect path).
    assertEquals(env.pushed, ['/away']);
    assertEquals(app.router?.currentPath, '/away');
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].page, 'home');
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp keeps current page data when a guard vetoes the post-action loader redirect (#810)', async () => {
  let submit: ((event: Event) => void) | undefined;
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  let loaderCalls = 0;
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      {
        path: '/',
        tagName: 'home-page',
        loader: () => {
          loaderCalls++;
          // The loader re-run after the action redirects (e.g. the session the
          // action consumed is gone); the initial load still succeeds.
          if (loaderCalls > 1) redirect('/login');
          return Promise.resolve({ page: 'home' });
        },
        action: () => Promise.resolve({ saved: true }),
      },
      {
        path: '/login',
        tagName: 'login-page',
        guard: () => Promise.resolve(false),
        loader: () => Promise.resolve({ page: 'login' }),
      },
    ],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].page, 'home');

    submit?.({
      target: { tagName: 'FORM' },
      composedPath: () => [],
      preventDefault() {},
    } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The guard vetoed the loader's redirect, so no navigation committed and
    // no re-render happened: the current page keeps its data instead of being
    // cleared to `undefined` — the same guarantee renderRoute has (#802).
    assertEquals(env.pushed, []);
    assertEquals(app.router?.currentPath, '/');
    assertEquals(hosts.length, 1);
    assertEquals(hosts[0].page, 'home');
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp navigates when the SPA action throws redirect() (#731)', async () => {
  let submit: ((event: Event) => void) | undefined;
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      {
        path: '/',
        tagName: 'home-page',
        loader: () => Promise.resolve({ page: 'home' }),
        action: () => {
          redirect('/done');
        },
      },
      {
        path: '/done',
        tagName: 'done-page',
        loader: () => Promise.resolve({ page: 'done' }),
      },
    ],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    submit?.({
      target: { tagName: 'FORM' },
      composedPath: () => [],
      preventDefault() {},
    } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // PRG: the redirect navigated to the destination route...
    assertEquals(env.pushed, ['/done']);
    assertEquals(app.router?.currentPath, '/done');
    // ...and both renders used the data channel (default projection).
    assertEquals(hosts.map((host) => host.page), ['home', 'done']);
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp routes loader notFound() to the page error projector (#731)', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'article-page': Page });

  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
  };
  const env = stubNavigableEnvironment(root, '/articles/hello');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: () => root,
      createElement: () => ({}),
    },
  });
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/articles/:slug',
      tagName: 'article-page',
      loader: () => {
        notFound('no such article');
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The original 404 error rides the error channel (never normalized, never
    // a navigation) so the error projector can read its status/message.
    assertEquals(calls.errors.length, 1);
    assertEquals((calls.errors[0].error as Error).name, 'OpenElementNotFound');
    assertEquals((calls.errors[0].error as Error).message, 'no such article');
    assertEquals((calls.errors[0].error as { status: number }).status, 404);
    assertEquals(calls.errors[0].context.data, undefined);
    assertEquals(calls.errors[0].context.params, { slug: 'hello' });
    assertEquals(calls.normal, []);
    assertEquals(env.pushed, []);
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('defineApp routes action notFound() to the page error projector (#731)', async () => {
  let submit: ((event: Event) => void) | undefined;
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'home-page': Page });

  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild() {},
  };
  const env = stubNavigableEnvironment(root, '/');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: () => root,
      createElement: () => ({}),
    },
  });
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: () => Promise.resolve({ page: 'home' }),
      action: () => {
        notFound('cannot save');
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Initial render used the data channel, not the error channel.
    assertEquals(calls.normal.length, 1);
    assertEquals(calls.normal[0].data, { page: 'home' });
    assertEquals(calls.errors, []);
    submit?.({
      target: { tagName: 'FORM' },
      composedPath: () => [],
      preventDefault() {},
    } as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The action's notFound renders the error channel in place — no
    // navigation, no normalized action failure, loader data preserved.
    assertEquals(calls.errors.length, 1);
    assertEquals((calls.errors[0].error as Error).name, 'OpenElementNotFound');
    assertEquals((calls.errors[0].error as Error).message, 'cannot save');
    assertEquals((calls.errors[0].error as { status: number }).status, 404);
    assertEquals(calls.errors[0].context.data, { page: 'home' });
    assertEquals(env.pushed, []);
    assertEquals(app.router?.currentPath, '/');
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

// ─── Each mount gets a fresh execution controller ───

Deno.test('defineApp mount gives a live signal, dispose aborts it, remount gives a fresh live signal', async () => {
  const signals: AbortSignal[] = [];
  const root = { innerHTML: '', addEventListener() {}, removeEventListener() {}, appendChild() {} };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: ({ signal }) => {
        signals.push(signal);
        return Promise.resolve({ page: 'home' });
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(signals.length, 1);
    assertEquals(signals[0].aborted, false);
    const signal1 = signals[0];
    app.dispose();
    assertEquals(signal1.aborted, true);
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(signals.length, 2);
    const signal2 = signals[1];
    assertEquals(signal2 === signal1, false);
    assertEquals(signal2.aborted, false);
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp direct remount aborts the stale loader and never commits its late result', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => release = resolve);
  const seen: Array<{ signal: AbortSignal; value: string }> = [];
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  let first = true;
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: ({ signal }) => {
        if (first) {
          first = false;
          seen.push({ signal, value: 'stale' });
          return pending.then(() => ({ page: 'stale' }));
        }
        seen.push({ signal, value: 'fresh' });
        return Promise.resolve({ page: 'fresh' });
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Direct remount without an explicit dispose: the stale mount aborts.
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(seen.length, 2);
    assertEquals(seen[0].signal.aborted, true);
    assertEquals(seen[1].signal.aborted, false);
    assertEquals(seen[0].signal === seen[1].signal, false);
    // The stale loader resolves late: it must not overwrite the fresh render.
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.at(-1)?.page, 'fresh');
  } finally {
    app.dispose();
    env.restore();
  }
});

Deno.test('defineApp remount gives actions a fresh live signal', async () => {
  let submit: ((event: Event) => void) | undefined;
  const signals: AbortSignal[] = [];
  const root = {
    innerHTML: '',
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === 'submit') submit = listener;
    },
    removeEventListener() {},
    appendChild() {},
  };
  const env = stubNavigableEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{
      path: '/',
      tagName: 'home-page',
      loader: () => Promise.resolve({ page: 'home' }),
      action: ({ signal }) => {
        signals.push(signal);
        return Promise.resolve({ saved: true });
      },
    }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    submit?.(
      {
        target: { tagName: 'FORM' },
        composedPath: () => [],
        preventDefault() {},
      } as unknown as Event,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(signals.length, 1);
    assertEquals(signals[0].aborted, false);
    const signal1 = signals[0];
    app.dispose();
    assertEquals(signal1.aborted, true);
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    submit?.(
      {
        target: { tagName: 'FORM' },
        composedPath: () => [],
        preventDefault() {},
      } as unknown as Event,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(signals.length, 2);
    assertEquals(signals[1] === signal1, false);
    assertEquals(signals[1].aborted, false);
  } finally {
    app.dispose();
    env.restore();
  }
});

for (const operation of ['loader', 'action'] as const) {
  Deno.test(`SPA aborts superseded ${operation} and ignores its late redirect`, async () => {
    const hosts: Record<string, unknown>[] = [];
    let submit: ((event: Event) => void) | undefined;
    let release!: () => void;
    let signal: AbortSignal | undefined;
    let newSignal: AbortSignal | undefined;
    const pending = new Promise<void>((resolve) => release = resolve);
    const root = {
      innerHTML: '',
      addEventListener(type: string, handler: (event: Event) => void) {
        if (type === 'submit') submit = handler;
      },
      removeEventListener() {},
      appendChild(host: Record<string, unknown>) {
        hosts.push(host);
        return host;
      },
    };
    const env = stubNavigableEnvironment(root, '/');
    const delayed = async (context: { signal: AbortSignal }) => {
      signal = context.signal;
      await pending;
      redirect('/stale');
    };
    const app = defineApp({
      mode: 'spa',
      routerMode: 'history',
      routes: [
        { path: '/', tagName: 'home-page', [operation]: delayed },
        {
          path: '/new',
          tagName: 'new-page',
          loader: (context: { signal: AbortSignal }) => {
            newSignal = context.signal;
            return Promise.resolve({ page: 'new' });
          },
        },
        { path: '/stale', tagName: 'stale-page', loader: () => Promise.resolve({ page: 'stale' }) },
      ],
    });
    try {
      app.mount('#app');
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (operation === 'action') {
        const event = new Event('submit', { cancelable: true });
        Object.defineProperty(event, 'target', { value: { tagName: 'FORM' } });
        submit!(event);
      }
      assertEquals(signal?.aborted, false);
      await app.router!.navigate('/new');
      assertEquals(signal?.aborted, true);
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(env.pushed, ['/new']);
      assertEquals(app.router!.currentPath, '/new');
      assertEquals(hosts.at(-1)?.page, 'new');
      // The superseding navigation's loader ran on its own live signal:
      // distinct from the aborted one and never aborted by the stale
      // operation's late settlement.
      assertEquals(typeof newSignal, 'object');
      assertEquals(newSignal === signal, false);
      assertEquals(newSignal?.aborted, false);
    } finally {
      app.dispose();
      env.restore();
    }
  });
}

// ─── #1343 review (P2): vetoed navigation preserves pending renders ─────
//
// A guard-vetoed navigation never owned intent, so it must not abort the
// current route's in-flight render: cancellation happens when a navigation
// takes ownership, not when an attempt starts.

Deno.test('guard-vetoed navigation preserves the pending initial loader render (#1343 review)', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({ 'home-page': Page, 'blocked-page': Page });
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  let resolveLoader!: (value: unknown) => void;
  const loaderResult = new Promise((resolve) => {
    resolveLoader = resolve;
  });
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      { path: '/', tagName: 'home-page', loader: () => loaderResult },
      { path: '/blocked', tagName: 'blocked-page', guard: () => Promise.resolve(false) },
    ],
  });
  try {
    app.mount('#app');
    // The initial loader is pending; the vetoed navigation must not cancel it.
    await app.router!.navigate('/blocked');
    assertEquals(app.router!.currentPath, '/');
    assertEquals(hosts.length, 0, 'nothing rendered yet — the loader is still pending');
    resolveLoader({ title: 'home' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.length, 1, 'the pending initial render commits after the veto');
    assertEquals(hosts[0].title, 'home');
    assertEquals(calls.errors, []);
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});

Deno.test('guard-vetoed navigation preserves a pending subsequent render (#1343 review)', async () => {
  const calls: ProbeCalls = { normal: [], errors: [] };
  const Page = defineProbePage(calls);
  const restoreRegistry = stubRegistry({
    'home-page': Page,
    'slow-page': Page,
    'blocked-page': Page,
  });
  const hosts: Record<string, unknown>[] = [];
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const env = stubNavigableEnvironment(root, '/');
  let resolveSlow!: (value: unknown) => void;
  const slowResult = new Promise((resolve) => {
    resolveSlow = resolve;
  });
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [
      { path: '/', tagName: 'home-page', loader: () => Promise.resolve({ title: 'home' }) },
      { path: '/slow', tagName: 'slow-page', loader: () => slowResult },
      { path: '/blocked', tagName: 'blocked-page', guard: () => Promise.resolve(false) },
    ],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.length, 1, 'home rendered');
    // An ownership-taking navigation commits and starts the target's render…
    await app.router!.navigate('/slow');
    assertEquals(app.router!.currentPath, '/slow');
    // …which stays alive when a later navigation is vetoed mid-flight.
    await app.router!.navigate('/blocked');
    assertEquals(app.router!.currentPath, '/slow');
    resolveSlow({ title: 'slow' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(hosts.length, 2, 'the pending /slow render commits after the veto');
    assertEquals(hosts[1].title, 'slow');
    assertEquals(calls.errors, []);
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
});
