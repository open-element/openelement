/**
 * @openelement/router — page-projection prototype-pollution guard tests (#1214).
 *
 * Every page-property projection path must fail closed for dangerous keys:
 * the default projector (projectPageProps), the descriptor props/error
 * projectors, and the SPA bootstrap write boundary all route through the
 * canonical dangerous-key rule (packages/element/src/internal/core/security.ts)
 * so projected data can never mutate the host's prototype identity.
 */
import { assertEquals } from '@std/assert';
import { defineApp, definePage, type PagePropsContext, projectPageProps } from '../src/index.ts';

const HOSTILE_JSON =
  '{"__proto__": {"polluted": true}, "constructor": {"evil": true}, "prototype": {"evil": true}, "title": "legit"}';

function hostileRecord(): Record<string, unknown> {
  return JSON.parse(HOSTILE_JSON) as Record<string, unknown>;
}

function assertHostClean(host: Record<string, unknown>, baselinePrototype: object): void {
  assertEquals(Object.getPrototypeOf(host), baselinePrototype);
  assertEquals(Object.hasOwn(host, '__proto__'), false);
  assertEquals(Object.hasOwn(host, 'constructor'), false);
  assertEquals(Object.hasOwn(host, 'prototype'), false);
  assertEquals((host as { polluted?: unknown }).polluted, undefined);
  // Legitimate keys still project (observable parity).
  assertEquals(host.title, 'legit');
}

Deno.test('projectPageProps() filters dangerous keys from route params and loader data (#1214)', () => {
  const params = JSON.parse(
    '{"__proto__": "x", "constructor": "y", "prototype": "z", "id": "42"}',
  ) as Record<string, string>;
  const projected = projectPageProps({ params, data: hostileRecord() });
  assertEquals(Object.getPrototypeOf(projected), Object.prototype);
  assertEquals(Object.hasOwn(projected, '__proto__'), false);
  assertEquals(projected, { id: '42', title: 'legit' });
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
});

Deno.test('projectPageProps() keeps full parity for legitimate keys (#1214)', () => {
  assertEquals(
    projectPageProps({ params: { id: '42' }, data: { title: 'Hello', n: 1 } }),
    { id: '42', title: 'Hello', n: 1 },
  );
  assertEquals(projectPageProps({ params: { id: '7' }, data: ['a'] }), { id: '7' });
  assertEquals(projectPageProps({}), {});
});

// ─── SPA bootstrap write boundary ───────────────────────────────

function stubSpaEnvironment(root: unknown, initialPath: string) {
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
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => root, createElement: () => ({}) },
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: fakeLocation });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { pushState() {}, replaceState() {} },
  });
  globalThis.addEventListener = (() => {}) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = (() => {}) as typeof globalThis.removeEventListener;
  return {
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

async function mountAndCaptureHost(
  page: CustomElementConstructor | undefined,
  loader: () => Promise<unknown>,
): Promise<{ host: Record<string, unknown>; baseline: object }> {
  const hosts: Record<string, unknown>[] = [];
  let baseline: object;
  const root = {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(host: Record<string, unknown>) {
      hosts.push(host);
      return host;
    },
  };
  const restoreRegistry = stubRegistry(
    page ? { 'probe-page': page } : { 'probe-page': class {} },
  );
  const env = stubSpaEnvironment(root, '/');
  const app = defineApp({
    mode: 'spa',
    routerMode: 'history',
    routes: [{ path: '/', tagName: 'probe-page', loader }],
  });
  try {
    app.mount('#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    baseline = Object.getPrototypeOf(hosts[0]);
    return { host: hosts[0], baseline };
  } finally {
    app.dispose();
    env.restore();
    restoreRegistry();
  }
}

Deno.test('SPA bootstrap default projection cannot re-prototype the page host (#1214)', async () => {
  const { host, baseline } = await mountAndCaptureHost(
    undefined,
    () => Promise.resolve(hostileRecord()),
  );
  assertHostClean(host, baseline);
});

Deno.test('SPA descriptor props projector output is filtered at the write boundary (#1214)', async () => {
  const Page = definePage(class {} as unknown as CustomElementConstructor, {
    props(_context: PagePropsContext) {
      return hostileRecord();
    },
  });
  const { host, baseline } = await mountAndCaptureHost(
    Page,
    () => Promise.resolve({ ignored: true }),
  );
  assertHostClean(host, baseline);
});

Deno.test('SPA descriptor error projector output is filtered at the write boundary (#1214)', async () => {
  const Page = definePage(class {} as unknown as CustomElementConstructor, {
    error(_error: unknown, _context: PagePropsContext) {
      return hostileRecord();
    },
  });
  const { host, baseline } = await mountAndCaptureHost(
    Page,
    () => Promise.reject(new Error('boom')),
  );
  assertHostClean(host, baseline);
});
