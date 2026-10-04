import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';
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
// Pins moved once more for the alpha8 emitted-comment restatement: the server
// entry's '// v0.17.4: SSR admission plan' header dropped its version tag
// (-9 bytes each mode) and the native client header's retired
// '(defineIsland() registers on module evaluation)' parenthetical was
// restated as '(island modules register on evaluation)' (-8 bytes; the lit
// client header never carried it, so lit client bytes are unchanged).
const expected = {
  native: {
    server: [14222, '29d0b971ebb8a3610ee59d186f5396140882a13727cce56edb9222fa71360548'],
    client: [2004, 'dbd5414e1f2a392a26e98cdce1a2b7c2dc69d4305228c6b7d199b4af6ce00d6f'],
  },
  lit: {
    server: [14335, 'ea611d2d6c1bc4bbf616ec6fd70a73a17c53f9b91864e5a17de155c435ab11b2'],
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
