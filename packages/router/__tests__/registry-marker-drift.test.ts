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
  SSR_REGISTRY_GENERATED_HOSTS,
  SSR_REGISTRY_ORIGINAL_DEFINE,
  SSR_REGISTRY_STUB_MARKER,
} from '@openelement/protocol/registry-markers';
import { generateCustomElementsPolyfill } from '../src/vite/internal/ssg/ssr-polyfills.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { installSsrRegistryGuard } from '../src/vite/internal/server-runtime/security.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

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
  // M11 complete vertical: the generated-host pairing table marker. It crosses
  // the same wire boundary (the generated entry's guard writes it, Element's
  // server serializer reads it), so its value is pinned here like the others.
  expect(SSR_REGISTRY_GENERATED_HOSTS).toEqual('__openElementGeneratedHosts');
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

test('registry markers: the generated entry binds the host pairing seam, not literals', () => {
  const desc = buildEntryDescriptor(routes, {
    islandTagNames: ['profile-card'],
    islandFiles: ['profile-card.tsx'],
    islandMeta: {
      'profile-card': {
        generatedElementHost: {
          kind: 'producer',
          component: 'ProfileCard',
          ssrHostExport: 'ProfileCard__ssrHost',
        },
      },
    },
  });
  const code = renderEntry(desc);
  // The entry hands the compiler-owned host renderer to the guard seam; it never
  // spells the registry marker itself.
  expect(code).toContain('  registerSsrIsland: __registerSsrIsland,');
  expect(code).toContain(
    '__registerSsrIsland("profile-card", __island_component_profile_card, __ssrhost_profile_card)',
  );
  expect(code.includes(SSR_REGISTRY_GENERATED_HOSTS)).toEqual(false);
});

test('registry guard: a class-only re-registration clears the stale host pair (B1)', () => {
  // Dev re-evaluation order: the island used to have a host producer, then the
  // authored module loses it and the entry falls back to `registerSsrComponent`.
  // The stale renderer must NOT stay paired with the fresh class.
  const fake = globalThis.customElements;
  try {
    const registry: Record<string, unknown> = {
      define: (name: string, ctor: unknown) => {
        registry['element:' + name] = ctor;
      },
      get: (name: string) => registry['element:' + name],
    };
    registry[SSR_REGISTRY_STUB_MARKER] = true;
    (globalThis as { customElements?: unknown }).customElements = registry;
    const guard = installSsrRegistryGuard();
    class WithProducer {}
    guard.registerIsland('x-card', WithProducer, () => '<x-card></x-card>');
    const hosts = registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown>;
    expect(hosts.has('x-card')).toBe(true);
    // The same entry now registers the class only (no producer fact).
    class WithoutProducer {}
    guard.register('x-card', WithoutProducer);
    expect(registry['element:x-card']).toBe(WithoutProducer);
    expect(hosts.has('x-card')).toBe(false);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});

test('registry guard: a lost ownership conflict clears the stale host pair (B1)', () => {
  // A foreign (entry-unowned) registration takes the tag over: the old pair
  // belonged to the class this entry no longer owns, so it must not survive to
  // be read against the foreign class.
  const fake = globalThis.customElements;
  try {
    const registry: Record<string, unknown> = {
      define: (name: string, ctor: unknown) => {
        registry['element:' + name] = ctor;
      },
      get: (name: string) => registry['element:' + name],
    };
    (globalThis as { customElements?: unknown }).customElements = registry;
    const guard = installSsrRegistryGuard();
    class EntryOwned {}
    guard.registerIsland('x-card', EntryOwned, () => '<x-card></x-card>');
    const hosts = registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown>;
    expect(hosts.has('x-card')).toBe(true);
    // A foreign class now owns the tag; the entry's next re-registration is a
    // fail-closed no-op and its stale pair must be cleared.
    class Foreign {}
    registry['element:x-card'] = Foreign;
    class FreshEntryClass {}
    guard.registerIsland('x-card', FreshEntryClass, () => '<x-card>fresh</x-card>');
    expect(registry['element:x-card']).toBe(Foreign);
    expect(hosts.has('x-card')).toBe(false);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});

test('registry guard: a stub-registry foreign conflict also clears the stale pair (B1)', () => {
  // The dev SSR stub registry can also be taken over between evaluations (a
  // route module self-registers the tag). The entry's next pairing attempt loses
  // ownership and must drop its old pair instead of leaving it readable.
  const fake = globalThis.customElements;
  try {
    const registry: Record<string, unknown> = {
      define: (name: string, ctor: unknown) => {
        registry['element:' + name] = ctor;
      },
      get: (name: string) => registry['element:' + name],
    };
    registry[SSR_REGISTRY_STUB_MARKER] = true;
    (globalThis as { customElements?: unknown }).customElements = registry;
    const guard = installSsrRegistryGuard();
    class EntryOwned {}
    guard.registerIsland('x-card', EntryOwned, () => '<x-card></x-card>');
    const hosts = registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown>;
    expect(hosts.has('x-card')).toBe(true);
    // A foreign (route self-registered) class now occupies the stub tag while
    // the entry's ownership map still names the old class.
    class Foreign {}
    registry['element:x-card'] = Foreign;
    class FreshEntryClass {}
    guard.registerIsland('x-card', FreshEntryClass, () => '<x-card>fresh</x-card>');
    expect(registry['element:x-card']).toBe(Foreign);
    expect(hosts.has('x-card')).toBe(false);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
});

test('registry guard: registerIsland pairs the emitted renderer under the marker', () => {
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
    class Island {}
    const host = () => '<x-island></x-island>';
    guard.registerIsland('x-island', Island, host);
    expect(registry['element:x-island']).toBe(Island);
    const hosts = registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown>;
    expect(hosts instanceof Map).toEqual(true);
    expect(hosts.get('x-island')).toBe(host);
    // Dev re-evaluation replaces BOTH halves together.
    class Fresh {}
    const freshHost = () => '<x-island>fresh</x-island>';
    guard.registerIsland('x-island', Fresh, freshHost);
    expect(registry['element:x-island']).toBe(Fresh);
    expect(hosts.get('x-island')).toBe(freshHost);
    // A non-function renderer is refused before any mutation.
    expect(() => guard.registerIsland('x-other', Fresh, undefined)).toThrow(/host renderer/i);
    expect(registry['element:x-other']).toBeUndefined();
    expect(hosts.has('x-other')).toEqual(false);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = fake;
  }
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
