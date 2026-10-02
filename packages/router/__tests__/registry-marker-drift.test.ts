/**
 * SSR registry marker drift guard (#965, #952, #1339).
 *
 * The customElements stub markers cross a module-evaluation boundary that
 * cannot share an import edge with the code that WROTE the stub: the
 * polyfill banner (ssr-polyfills.ts) writes the properties onto the registry
 * at document level, while the reader — since #1470 block e (ADR-0160 rule
 * a) — is the typed registry guard (server-runtime/security.ts) that the
 * generated entry imports. Writers and reader now share ONE import edge
 * (the canonical constants in protocol/registry-markers.ts), so the old
 * generated-string injection pins are gone; what must stay pinned here is
 * the WIRE VALUES themselves (changing them silently would break dev SSR
 * re-evaluation behavior across mixed-version chunks, because the stub
 * registry outlives module re-evaluations and no import edge can migrate
 * the old properties) and the guard's behavior against a stubbed and an
 * unstubbed registry.
 */

import { expect, test } from 'vitest';
import {
  ENTRY_REGISTRATION_OWNERS,
  SSR_REGISTRY_ORIGINAL_DEFINE,
  SSR_REGISTRY_STUB_MARKER,
} from '../src/vite/internal/protocol/registry-markers.ts';
import { generateCustomElementsPolyfill } from '../src/vite/internal/ssg/ssr-polyfills.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { installSsrRegistryGuard } from '../src/vite/internal/server-runtime/security.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

const routes: RouteEntry[] = [
  {
    path: '/drift',
    filePath: 'drift.tsx',
    type: 'page',
    varName: 'pageDrift',
    definePage: true,
  },
];

test('registry markers: wire values stay the historical contract', () => {
  expect(SSR_REGISTRY_STUB_MARKER).toEqual('__openElementSsrStub');
  expect(ENTRY_REGISTRATION_OWNERS).toEqual('__openEntryDefined');
  expect(SSR_REGISTRY_ORIGINAL_DEFINE).toEqual('__openElementOrigDefine');
});

test('registry markers: the polyfill banner injects the canonical stub marker', () => {
  const banner = generateCustomElementsPolyfill();
  expect(banner).toContain(`'${SSR_REGISTRY_STUB_MARKER}': true`);
  expect(banner).toContain('globalThis.customElements = {');
});

test('registry markers: the generated entry binds the guard seam, not marker literals', () => {
  const code = renderEntry(buildEntryDescriptor(routes));
  // #1470 block e (ADR-0160 rule a): the marker values moved behind the
  // imported typed guard; the generated entry must carry NEITHER the old
  // injected literals NOR any customElements surgery of its own — only the
  // factory-bound register call sites.
  expect(code).toContain('registerSsrComponent: __registerSsrComponent,');
  expect(code).toContain('__registerSsrComponent(');
  expect(code.includes(SSR_REGISTRY_STUB_MARKER)).toEqual(false);
  expect(code.includes(ENTRY_REGISTRATION_OWNERS)).toEqual(false);
  expect(code.includes(SSR_REGISTRY_ORIGINAL_DEFINE)).toEqual(false);
  expect(code.includes('customElements.define =')).toEqual(false);
});

test('registry guard: installs the wrapper once and keeps the TRUE original', () => {
  const fake = globalThis.customElements;
  try {
    const calls: string[] = [];
    (globalThis as { customElements?: unknown }).customElements = {
      define: (name: string) => {
        calls.push('raw:' + name);
      },
      get: () => undefined,
    };
    const guard = installSsrRegistryGuard();
    // A second install must not stack a second wrapper: the TRUE original is
    // kept on the registry (#1339), so re-registration still reaches it.
    installSsrRegistryGuard();
    const registry = globalThis.customElements as unknown as Record<string, PropertyKey>;
    expect(typeof registry[SSR_REGISTRY_ORIGINAL_DEFINE] === 'function').toBeTruthy();
    expect(calls).toEqual([]);
    guard.register('x-foo', class Foo {});
    // The wrapper forwarded to the original exactly once — through the
    // captured original, not a re-wrapped define.
    expect(calls).toEqual(['raw:x-foo']);
    expect(calls.length).toEqual(1);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});

test('registry guard: stub registry lets re-definition win, ownership tracked', () => {
  const fake = globalThis.customElements;
  try {
    const raw: Array<[string, unknown]> = [];
    const registry: Record<string, unknown> = {
      define: (name: string, ctor: unknown) => {
        raw.push([name, ctor]);
        registry['element:' + name] = ctor;
      },
      get: (name: string) => registry['element:' + name],
    };
    registry[SSR_REGISTRY_STUB_MARKER] = true;
    (globalThis as { customElements?: unknown }).customElements = registry;
    const guard = installSsrRegistryGuard();
    class Page {}
    guard.register('x-page', Page);
    expect(registry[ENTRY_REGISTRATION_OWNERS] instanceof Map).toEqual(true);
    // Same class again: define forwarded (stub registries are re-definable).
    const rawCount = raw.length;
    guard.register('x-page', Page);
    expect(raw.length).toEqual(rawCount + 1);
    // A tag the entry did NOT register stays untouched (fail-closed no-op).
    class Foreign {}
    registry['element:x-foreign'] = Foreign;
    guard.register('x-foreign', class Other {});
    expect(registry['element:x-foreign']).toEqual(Foreign);
    expect(raw.map(([name]) => name)).toEqual(expect.arrayContaining(['x-page']));
    expect(raw.some(([, ctor]) => ctor === Foreign)).toEqual(false);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});

test('registry guard: dev re-evaluation overwrites its OWN tag through the original define', () => {
  const fake = globalThis.customElements;
  try {
    const raw: Array<[string, unknown]> = [];
    const registry: Record<string, unknown> = {
      define: (name: string, ctor: unknown) => {
        raw.push([name, ctor]);
        registry['element:' + name] = ctor;
      },
      get: (name: string) => registry['element:' + name],
    };
    (globalThis as { customElements?: unknown }).customElements = registry;
    const guard = installSsrRegistryGuard();
    class Stale {}
    guard.register('x-page', Stale);
    expect(registry['element:x-page']).toEqual(Stale);
    // The registry outlives module re-evaluation: the same tag arrives with a
    // FRESH class and must win, through the TRUE original define (#1339).
    class Fresh {}
    guard.register('x-page', Fresh);
    expect(registry['element:x-page']).toEqual(Fresh);
    expect(raw.some(([, ctor]) => ctor === Fresh)).toEqual(true);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});
