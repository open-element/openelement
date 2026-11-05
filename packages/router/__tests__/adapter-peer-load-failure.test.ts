/**
 * The optional-peer adapters distinguish "not installed" from "installed but
 * failed to load": a resolved-but-broken peer must not report the MISSING
 * code (whose message tells the user to install what is already on disk).
 * The load-failure code stays classifiable and keeps the original cause.
 */
import { expect, test, vi } from 'vitest';
import { AdapterErrorCode } from '../src/internal/error-codes.ts';
import { OpenElementError } from '@openelement/protocol/errors';

const failures = vi.hoisted(() => ({
  devServer: new Error('@hono/vite-dev-server installed but its module threw'),
  hono: new Error('hono installed but its module threw'),
}));

vi.mock('@hono/vite-dev-server', () => {
  throw failures.devServer;
});
vi.mock('hono', () => {
  throw failures.hono;
});

const { lazyHonoDevServer } = await import('../src/vite/dev-server.ts');
const { createHonoAdapter } = await import('../src/hono-adapter.ts');

type AnyHook = (this: unknown, ...args: unknown[]) => Promise<unknown>;

/** Every message on the bounded cause chain (Vitest wraps the mock failure). */
function causeMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}

test('an installed dev-server peer that fails to load reports the load-failure code', async () => {
  const plugin = lazyHonoDevServer(() => ({}));
  let thrown: unknown;
  try {
    await (plugin.config as unknown as AnyHook).call(
      {},
      {},
      { command: 'serve', mode: 'development' },
    );
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual(AdapterErrorCode.HONO_DEV_SERVER_LOAD_FAILED);
  expect(error.code).not.toEqual(AdapterErrorCode.HONO_DEV_SERVER_MISSING);
  expect(error.phase).toEqual('ssr');
  expect(error.message).toContain('installed but it failed to load');
  // Vitest wraps the throwing mock factory; the original failure is still on
  // the preserved cause chain, not lost.
  expect(
    causeMessages(error).some((message) =>
      message.includes('@hono/vite-dev-server installed but its module threw'),
    ),
  ).toEqual(true);
  expect(error.cause, 'the load failure is preserved').toBeInstanceOf(Error);
});

test('an installed hono peer that fails to load reports the load-failure code', async () => {
  let thrown: unknown;
  try {
    await createHonoAdapter(() => Promise.resolve(new Response('unused')));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual(AdapterErrorCode.HONO_LOAD_FAILED);
  expect(error.code).not.toEqual(AdapterErrorCode.HONO_MISSING);
  expect(error.phase).toEqual('ssr');
  expect(error.message).toContain('installed but it failed to load');
  expect(
    causeMessages(error).some((message) => message.includes('hono installed but its module threw')),
  ).toEqual(true);
  expect(error.cause, 'the load failure is preserved').toBeInstanceOf(Error);
});
