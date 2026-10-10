import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import { generateClientEntry } from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { selectRendererAdapter } from '../src/vite/internal/ssg/renderer-adapter.ts';

const routes: RouteEntry[] = [
  {
    path: '/',
    filePath: 'index.ts',
    type: 'page',
    varName: 'pageIndex',
  },
];

// Pins verified byte-exact. The server pins moved from the #1470-block-c
// values (17478/4bfb796b…, 17018/8ed50861…) to the #1470-block-e values
// below: the entry was reduced to imports + descriptor data + one
// createGeneratedApp call — the Hono app/bridge, the handler exports, the
// client-script plumbing, the registry guard, the stream assertions, and the
// page-render wiring are the imported factory; the serialized
// __DANGEROUS_KEYS/body-limit copies were deleted (the factory imports the
// canonical /authoring policy constants). Server bytes moved once more for
// S4b (#1471): the document-resolution call sites pass the client-script
// descriptors and every document wrap reads `scripts:
// __doc.clientScripts || []` (+108 bytes each mode) — the script tags are
// rendered from the resolved document at document time, no post-build
// injection. Client bytes moved once from the pre-lane baseline
// (1983/3138) for the S4 idle-fallback wiring: the __schedule deps carry the
// IDLE_FALLBACK_TIMEOUT_MS policy constant serialized at build time
// (ADR-0160 admitted output delta).
// Server pins moved from the 8b75ebdc8 values (14249/6f7c0d86…, 14362/b8d1cb02…)
// to the values below: that commit dropped the ' (ADR-0160 rule a)' segment
// from the emitted 'Generated-app assembly' comment (-18 bytes each mode) and
// did not re-pin. Diffing the full dumped entries across d94b0af5e..current
// shows exactly that one comment line per mode and nothing else; the later
// comment-only sweep commits regenerate byte-identical entries to 8b75ebdc8.
// Pins moved once more for #1560: the generated server entry composes on the
// internal WinterCG layer — the built-in middleware imports moved from the
// hono/* subpaths to @openelement/router/server-runtime factories, the
// middleware-scope registration lost its adapter shim, the wildcard
// dispatcher became `app.use('*', __routeMiddleware)`, and the route chains
// bind `c` through `__requestScope` (+69 bytes each mode; the native/lit
// delta is unchanged at 113, so the cross-mode invariant holds). Client
// bytes are untouched.
// Server pins moved once more for the per-property og dedup wiring: every
// page GET/POST handler gains the __routeOgOwned/__routeHeadExtras statement
// pair at its two route-meta-serializing wraps (success + error-boundary
// re-render), so a route-declared og: property no longer duplicates the
// baked site default (+1720 bytes each mode; the native/lit delta is
// unchanged at 113, so the cross-mode invariant holds). Client bytes are
// untouched.
const expected = {
  native: {
    server: [16008, 'f58b2285eb17db28284adf0125bbe2af17963b44e8fba6564c3799e9d0265314'],
    client: [2004, 'dbd5414e1f2a392a26e98cdce1a2b7c2dc69d4305228c6b7d199b4af6ce00d6f'],
  },
  lit: {
    server: [16121, '2bca8403fbd5a7c65a02bf23cf2c762eff6a907f2308d053bc538622a4729d59'],
    client: [3167, '7dcb18fd659ffe53b039adfc5139a2496e1b4c02b5d4322ed6c216606511f418'],
  },
} as const;

test('internal Native/Lit selection preserves the generated server/client bytes', async () => {
  for (const mode of ['native', 'lit'] as const) {
    const adapter = selectRendererAdapter(mode);
    expect(adapter.mode).toEqual(mode);
    expect(adapter.supportsCompiledStream).toEqual(mode === 'native');
    expect(adapter.hydration).toEqual(mode === 'native' ? 'compiled-claim' : 'lit-adoption');
    const descriptor = buildEntryDescriptor(routes, { renderer: mode });
    const server = renderEntry(descriptor);
    const client = generateClientEntry(
      [
        {
          tagName: 'x-probe',
          modulePath: '/app/islands/x.ts',
          strategy: 'load',
          ssr: true,
          dsd: true,
        },
      ],
      { renderer: mode },
    );
    for (const [kind, text] of [
      ['server', server],
      ['client', client],
    ] as const) {
      const bytes = new TextEncoder().encode(text);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      expect(bytes.length).toEqual(expected[mode][kind][0]);
      expect(hash).toEqual(expected[mode][kind][1]);
    }
    expect(descriptor.imports.some((entry) => entry.from === '@openelement/element')).toEqual(
      mode === 'native',
    );
    expect(
      descriptor.imports.some((entry) => entry.from === '@openelement/router/lit-ssr'),
    ).toEqual(mode === 'lit');
  }
  expect(selectRendererAdapter(undefined).mode).toEqual('native');
  assertThrowsIncludes(
    () => selectRendererAdapter('future'),
    Error,
    "renderer must be 'native' or 'lit'",
  );
});
