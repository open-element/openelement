/**
 * Item 18: the Hono adapter's missing optional peer is classifiable by code
 * and keeps the original resolution failure as `cause`.
 */
import { expect, test, vi } from 'vitest';
import { AdapterErrorCode } from '../src/internal/error-codes.ts';
import { OpenElementError } from '@openelement/protocol/errors';

const missingPeer = vi.hoisted(() =>
  Object.assign(new Error("Cannot find package 'hono' imported from /app/src/server.ts"), {
    code: 'ERR_MODULE_NOT_FOUND',
  }),
);

vi.mock('hono', () => {
  throw missingPeer;
});

const { createHonoAdapter } = await import('../src/hono-adapter.ts');

test('a missing hono peer fails closed with its code, install hint and cause', async () => {
  let thrown: unknown;
  try {
    await createHonoAdapter(() => Promise.resolve(new Response('unused')));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual(AdapterErrorCode.HONO_MISSING);
  expect(error.phase).toEqual('ssr');
  expect(error.message).toContain('hono');
  expect(error.message).toContain('"hono": "^4.12"');
  expect(error.cause, 'the resolution failure is preserved').toBeInstanceOf(Error);
  // Vitest wraps a throwing mock factory once; the original failure remains
  // reachable at the end of the cause chain. The classifier walked that chain
  // to produce the MISSING code rather than the installed-but-broken one.
  let current: unknown = error.cause;
  let deepest = '';
  while (current instanceof Error) {
    deepest = current.message;
    current = current.cause;
  }
  expect(deepest).toContain("'hono'");
});
