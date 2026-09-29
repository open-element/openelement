import { assertEquals, assertThrows } from '@std/assert';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';
import { generateClientEntry } from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { selectRendererAdapter } from '../src/vite/internal/ssg/renderer-adapter.ts';

const routes: RouteEntry[] = [{
  path: '/',
  filePath: 'index.ts',
  type: 'page',
  varName: 'pageIndex',
}];

// Pins verified byte-exact. The server pins moved from the b22a3c7c3
// banner-de-versioning values (27507/d3ad3394…, 25562/412be26c…) to the
// #1470-block-a values below: the response-header channel runtime
// (__mergeChannelHeaders / __streamHeaderChannel bodies) and the CSP nonce
// expressions were replaced by imports of @openelement/router/server-runtime
// (ADR-0160 rule a, admitted output delta). Client bytes are untouched by
// the migration — their hashes still match the pre-lane baseline.
const expected = {
  native: {
    server: [27032, 'd7f1af80f31a19ee760de15edeadd435bbcbcf3ed6eeecc61ec7098f11185597'],
    client: [1983, 'e3ea822d06ec4f70fbf67a073f9a10e3eac4e41efb897b0bb2fbd561b3da91a6'],
  },
  lit: {
    server: [25087, 'cda7b4182512ff51b6c4c655116668811b3fd2e5bd38cb2f9443db393853c177'],
    client: [3138, 'ec06ba0190166c71ccd692e29b35e2990f7ef555804308d420e51478d8feecd1'],
  },
} as const;

Deno.test('internal Native/Lit selection preserves the generated server/client bytes', async () => {
  for (const mode of ['native', 'lit'] as const) {
    const adapter = selectRendererAdapter(mode);
    assertEquals(adapter.mode, mode);
    assertEquals(adapter.supportsCompiledStream, mode === 'native');
    assertEquals(adapter.hydration, mode === 'native' ? 'compiled-claim' : 'lit-adoption');
    const descriptor = buildEntryDescriptor(routes, { renderer: mode });
    const server = renderEntry(descriptor);
    const client = generateClientEntry(
      [{
        tagName: 'x-probe',
        modulePath: '/app/islands/x.ts',
        strategy: 'load',
        ssr: true,
        dsd: true,
      }],
      { renderer: mode },
    );
    for (const [kind, text] of [['server', server], ['client', client]] as const) {
      const bytes = new TextEncoder().encode(text);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      assertEquals(bytes.length, expected[mode][kind][0]);
      assertEquals(hash, expected[mode][kind][1]);
    }
    assertEquals(
      descriptor.imports.some((entry) => entry.from === '@openelement/element'),
      mode === 'native',
    );
    assertEquals(
      descriptor.imports.some((entry) => entry.from === '@openelement/router/lit-ssr'),
      mode === 'lit',
    );
  }
  assertEquals(selectRendererAdapter(undefined).mode, 'native');
  assertThrows(() => selectRendererAdapter('future'), Error, "renderer must be 'native' or 'lit'");
});
