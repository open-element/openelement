/**
 * dev-island-client tests (#951).
 *
 * The dev-only plugin maps the browser-facing client entry URL to the
 * virtual client module before Vite resolves it as a file. The mapping must
 * survive the query strings browsers/Vite append on re-request (`?t=` after
 * HMR invalidation, `?import`).
 */

import { assertEquals } from '@std/assert';
import { devIslandClientPlugin } from '../src/vite/dev-island-client.ts';

type ResolveIdHook = (id: string) => unknown;

function makeResolveId(): ResolveIdHook {
  const plugin = devIslandClientPlugin({} as never, {} as never);
  return plugin.resolveId as unknown as ResolveIdHook;
}

Deno.test('dev-island-client resolveId maps the public client entry path', () => {
  const resolveId = makeResolveId();
  assertEquals(resolveId('/client/islands/client.js'), '\0virtual:open-client-entry');
  assertEquals(resolveId('/client/islands/other.js'), null);
});

Deno.test('dev-island-client resolveId tolerates query strings on the entry URL', () => {
  const resolveId = makeResolveId();
  assertEquals(
    resolveId('/client/islands/client.js?t=1723500000000'),
    '\0virtual:open-client-entry',
  );
  assertEquals(resolveId('/client/islands/client.js?import'), '\0virtual:open-client-entry');
});
