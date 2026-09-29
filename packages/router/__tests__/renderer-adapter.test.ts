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

// Pins verified byte-exact. The server pins moved from the #1470-block-c
// values (17478/4bfb796b…, 17018/8ed50861…) to the #1470-block-e values
// below: the entry was reduced to imports + descriptor data + one
// createGeneratedApp call — the Hono app/bridge, the handler exports, the
// client-script plumbing, the registry guard, the stream assertions, and the
// page-render wiring are the imported factory; the serialized
// __DANGEROUS_KEYS/body-limit copies were deleted (the factory imports the
// canonical /authoring policy constants). Client bytes are untouched by the
// migration — their hashes still match the pre-lane baseline.
const expected = {
  native: {
    server: [14141, '299c20285aa0817b925c23a7511b0c54dfb0e2da3095ef43fd353ea02405c7b1'],
    client: [1983, 'e3ea822d06ec4f70fbf67a073f9a10e3eac4e41efb897b0bb2fbd561b3da91a6'],
  },
  lit: {
    server: [14254, '69d620f6de4d25279055d8a7ccbcc532054ba77887bacdc23c237b261e9cddc9'],
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
