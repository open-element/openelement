import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import {
  generateClientEntry,
  ELEMENT_SERVICES_RUNTIME_SPECIFIERS,
} from '../src/vite/internal/ssg/entry-client-codegen.ts';
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
// Server pins moved once more for the alpha15 R batch 3 layout rename:
// `appShellPlan:` became `layoutPlan:`, the factory destructuring
// `resolveAppShell`/`renderAppShell` became `resolveLayout`/`renderLayout`,
// and every emitted `__renderAppShell` call became `__renderLayout` (-18
// bytes each mode; the native/lit delta is unchanged at 113, so the
// cross-mode invariant holds). Diffing the dumped entries across the rename
// shows exactly those identifier lines and nothing else. Client bytes are
// untouched.
// Server pins moved once more for the alpha15 S lane: the generated entry
// carries `import 'virtual:open-element-style-links';` — the component
// stylesheet URL channel the SSG build answers (the element runtime declares
// the emitted asset as a marked `<link>` inside the DSD templates of
// components whose classes were statically admitted) (+43 bytes each mode;
// the native/lit delta stays 103, so the cross-mode invariant holds). Client
// bytes are untouched: the client entry's component-sheet registration only
// appears when the build admits shadow candidates, which this probe does not.
// Server pins moved once more for the alpha15 R batch 4 routing renames:
// `renderDsd` became `renderToString` (+5 bytes × 2 native server lines: the
// element import and the pageRuntime field), while
// `createDeferredDsdExecutor` became the byte-neutral
// `createStreamShellExecutor` (25→25) and the stream-gated
// `createDeferredPageShell`→`createStreamPageShell` (-1) does not appear in
// this stream-less probe. Native server only: 15990→16000, native/lit delta
// 113→103 (lit carries no native serializer import). Client bytes untouched.
// Server pins moved once more for alpha15 S-C1.2 (light-root CSS delivery):
// each document render now also creates its stylesheet collection
// (`const __documentStyles = createDocumentStyleResources();` beside
// `__doc`), the page renders report light-root sheets into it, and the wrap
// declares them (`styleLinks: __documentStyles.links`). Both server modes carry
// the identical four additions, so the native/lit delta stays 103 — the
// cross-mode invariant holds. Client bytes are untouched: the collection is a
// server-render channel and no client emission changed. Native server:
// 16043→16637, lit server: 16146→16740.
// Server pins moved once more for the alpha15 Q-CI layout style-sink fix:
// every emitted __renderLayout call site forwards the per-render stylesheet
// collection (`documentStyles: __documentStyles`, +34 bytes on each of the
// four layout call sites this probe emits — route success and error boundary,
// styled-404 success and error boundary), so the layout's light-root sheets
// (open-layout.css and the sheets of light roots nested inside it) reach the
// document head and the responsive rules ship with the page. Diffing the
// dumped entries across the fix shows exactly those four additions per mode
// and nothing else; the native/lit delta stays 103 — the cross-mode invariant
// holds. Client bytes are untouched. Native server: 16637→16773, lit server:
// 16740→16876.
//
// #1544/B2 re-baseline: the NATIVE client entry changed deliberately — the
// element runtime left its static graph, so the entry carries the lazy
// loader, the document-service calls it makes and the inlined logger that
// replaced the `@openelement/element/logger` import: 2004→2931 bytes. The lit
// entry is byte-IDENTICAL (3167, same hash): the renderer fork was already
// element-free and the codegen refactor is transparent to it.
//
// B2 CI re-baseline (alpha15 red A): the 2931 pin was NOT machine-independent
// — the native entry's lazy surface specifier was the wrapper's ABSOLUTE
// filesystem path, so the pin measured a 58-char checkout root while CI's
// 41-char root produced 2914 (a 17-byte delta, exactly the root-length
// difference). The specifier is now the stable virtual id
// `virtual:open-client-runtime/element-services-full.ts`, resolved to the
// wrapper by the two client-entry hosts (cli/build-client.ts,
// vite/dev-island-client.ts), so the entry text is identical in every
// checkout: 2931 (58-char root) → 2862, and the CI checkout produces this
// same 2862/hash instead of 2914. The lit entry is byte-IDENTICAL (3167,
// same hash): it carries no element-services import at all.
const expected = {
  native: {
    server: [16773, '04e5526b2999d71d4a70251bf63283d4c2191fe91850257fbd99adb628df702c'],
    client: [2862, 'e9629cded31adcb2237afa612acd50c1bd9cd8a17dbd889ab1ae46066616e5ed'],
  },
  lit: {
    server: [16876, '320a139438dc9b1d6d421c329631899eb5cff657769672ea8e45e0f30a67c724'],
    client: [3167, '7dcb18fd659ffe53b039adfc5139a2496e1b4c02b5d4322ed6c216606511f418'],
  },
} as const;

test('internal Native/Lit selection preserves the generated server/client bytes', async () => {
  for (const mode of ['native', 'lit'] as const) {
    const adapter = selectRendererAdapter(mode);
    expect(adapter.mode).toEqual(mode);
    expect(adapter.supportsCompiledStream).toEqual(mode === 'native');
    expect(adapter.hydration).toEqual(mode === 'native' ? 'compiled-hydration' : 'lit-adoption');
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
    if (mode === 'native') {
      // Red A witness: the lazy surface specifier is the stable virtual id and
      // no checkout root can appear in the entry text, which is what makes the
      // native client pin machine-independent (see the re-baseline note above).
      expect(client).toContain(`import('${ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full}')`);
      expect(client).not.toContain(process.cwd());
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
