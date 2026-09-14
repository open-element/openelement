/**
 * SSR registry marker drift guard (#965, #952, #1339).
 *
 * The customElements stub markers cross a module-evaluation boundary that
 * cannot share an import edge with generated entry code. The canonical names
 * live in src/vite/internal/protocol/registry-markers.ts; writers import them
 * and the entry generator injects them into the generated strings. This test
 * pins the wire values (changing them silently would break dev SSR
 * re-evaluation behavior across mixed-version chunks) and proves the
 * generated artifacts actually carry the injected values.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  ENTRY_REGISTRATION_OWNERS,
  SSR_REGISTRY_ORIGINAL_DEFINE,
  SSR_REGISTRY_STUB_MARKER,
} from '../src/vite/internal/protocol/registry-markers.ts';
import { generateCustomElementsPolyfill } from '../src/vite/internal/ssg/ssr-polyfills.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
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

Deno.test('registry markers: wire values stay the historical contract', () => {
  assertEquals(SSR_REGISTRY_STUB_MARKER, '__openElementSsrStub');
  assertEquals(ENTRY_REGISTRATION_OWNERS, '__openEntryDefined');
  assertEquals(SSR_REGISTRY_ORIGINAL_DEFINE, '__openElementOrigDefine');
});

Deno.test('registry markers: the polyfill banner injects the canonical stub marker', () => {
  const banner = generateCustomElementsPolyfill();
  assertStringIncludes(banner, `'${SSR_REGISTRY_STUB_MARKER}': true`);
  assertStringIncludes(banner, 'globalThis.customElements = {');
});

Deno.test('registry markers: generated entry code injects every canonical marker', () => {
  const code = renderEntry(buildEntryDescriptor(routes));
  assertStringIncludes(code, `customElements.${SSR_REGISTRY_ORIGINAL_DEFINE}`);
  assertStringIncludes(code, `customElements.${SSR_REGISTRY_STUB_MARKER}`);
  assertStringIncludes(code, `customElements.${ENTRY_REGISTRATION_OWNERS}`);
});
