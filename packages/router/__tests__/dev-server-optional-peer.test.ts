/**
 * Item 18: a missing optional dev-server peer is a stable, classifiable
 * diagnostic with the original resolution failure preserved as `cause`.
 */
import { expect, test, vi } from 'vitest';
import { AdapterErrorCode } from '../src/internal/error-codes.ts';
import { OpenElementError } from '@openelement/protocol/errors';

const missingPeer = vi.hoisted(() =>
  Object.assign(
    new Error("Cannot find package '@hono/vite-dev-server' imported from /app/vite.config.ts"),
    { code: 'ERR_MODULE_NOT_FOUND' },
  ),
);

vi.mock('@hono/vite-dev-server', () => {
  throw missingPeer;
});

const { lazyHonoDevServer } = await import('../src/vite/dev-server.ts');

type AnyHook = (this: unknown, ...args: unknown[]) => Promise<unknown>;

test('a missing @hono/vite-dev-server peer fails closed with its code and cause', async () => {
  const plugin = lazyHonoDevServer(() => ({}));
  let thrown: unknown;
  try {
    await (plugin.config as unknown as AnyHook).call({}, {}, { command: 'serve', mode: 'dev' });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual(AdapterErrorCode.HONO_DEV_SERVER_MISSING);
  expect(error.phase).toEqual('ssr');
  expect(error.message).toContain('@hono/vite-dev-server');
  expect(error.message).toContain('npm install --save-dev @hono/vite-dev-server');
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
  expect(deepest).toContain("'@hono/vite-dev-server'");
});
