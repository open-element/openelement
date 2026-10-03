/**
 * dev-island-client tests (#951).
 *
 * The dev-only plugin maps the browser-facing client entry URL to the
 * virtual client module before Vite resolves it as a file. The mapping must
 * survive the query strings browsers/Vite append on re-request (`?t=` after
 * HMR invalidation, `?import`).
 */

import { expect, test } from 'vitest';
import { devIslandClientPlugin } from '../src/vite/dev-island-client.ts';

type ResolveIdHook = (id: string) => unknown;

function makeResolveId(): ResolveIdHook {
  const plugin = devIslandClientPlugin({} as never, {} as never);
  return plugin.resolveId as unknown as ResolveIdHook;
}

test('dev-island-client resolveId maps the public client entry path', () => {
  const resolveId = makeResolveId();
  expect(resolveId('/client/islands/client.js')).toEqual('\0virtual:open-client-entry');
  expect(resolveId('/client/islands/other.js')).toEqual(null);
});

test('dev-island-client resolveId tolerates query strings on the entry URL', () => {
  const resolveId = makeResolveId();
  expect(resolveId('/client/islands/client.js?t=1723500000000')).toEqual(
    '\0virtual:open-client-entry',
  );
  expect(resolveId('/client/islands/client.js?import')).toEqual('\0virtual:open-client-entry');
});
