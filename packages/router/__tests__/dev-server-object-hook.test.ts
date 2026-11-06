/**
 * Item 5 (review): the lazy dev-server proxy must preserve an OBJECT hook's
 * meta. Once the optional peer resolves, a peer hook shaped
 * `{ order, handler }` becomes the equivalent object hook
 * `{ ...meta, handler: lazyWrapper }` — a bare function would silently drop
 * Vite's `order` (the pre-phase placement the dev host relies on). Function
 * hooks stay bare functions and keep forwarding unchanged.
 */
import { expect, test, vi } from 'vitest';
import type { ViteDevServer } from 'vite';

const peer = vi.hoisted(() => {
  const calls: Record<string, { args: unknown[]; thisValue: unknown }> = {};
  const postHook = () => {
    calls.postHook = { args: [], thisValue: undefined };
  };
  const plugin = {
    name: 'mock-object-hook-peer',
    config(this: unknown, config: unknown, env: unknown) {
      calls.config = { args: [config, env], thisValue: this };
      return { mock: 'config' };
    },
    configResolved: {
      order: 'post' as const,
      handler(this: unknown, config: unknown) {
        calls.configResolved = { args: [config], thisValue: this };
      },
    },
    configureServer: {
      order: 'pre' as const,
      handler(this: unknown, server: unknown) {
        calls.configureServer = { args: [server], thisValue: this };
        return postHook;
      },
    },
    handleHotUpdate: {
      order: 'pre' as const,
      handler(this: unknown, context: unknown) {
        calls.handleHotUpdate = { args: [context], thisValue: this };
        return ['module'];
      },
    },
  };
  return { calls, postHook, plugin };
});

vi.mock('@hono/vite-dev-server', () => ({
  defaultOptions: { exclude: [] },
  default: () => peer.plugin,
}));

const { lazyHonoDevServer } = await import('../src/vite/dev-server.ts');

type AnyHook = (this: unknown, ...args: unknown[]) => Promise<unknown>;
type ObjectHook = { order?: unknown; handler: AnyHook };

function serverShape(): ViteDevServer {
  const uses: unknown[] = [];
  const server = {
    config: {
      base: '/sub/',
      root: '/app',
      publicDir: '',
      assetsInclude: () => false,
    },
    middlewares: { use: (...args: unknown[]) => uses.push(args) },
  } as unknown as ViteDevServer;
  return server;
}

test('object-hook order is preserved once the peer resolves, and handlers still forward', async () => {
  const plugin = lazyHonoDevServer(() => ({}));
  const context = { pluginContext: true };

  // Construction stays lazy and function-shaped: the peer is not resolved yet.
  expect(typeof plugin.config).toEqual('function');
  expect(typeof plugin.configResolved).toEqual('function');
  expect(typeof plugin.configureServer).toEqual('function');
  expect(typeof plugin.handleHotUpdate).toEqual('function');

  // The first real hook call resolves the peer; adoption happens before the
  // downstream hooks Vite sorts later (configResolved / configureServer /
  // handleHotUpdate).
  expect(
    await (plugin.config as unknown as AnyHook).call(
      context,
      { plugins: [] },
      { command: 'serve', mode: 'development' },
    ),
  ).toEqual({ mock: 'config' });

  // A FUNCTION peer hook keeps the bare function form.
  expect(typeof plugin.config).toEqual('function');

  const configResolved = plugin.configResolved as unknown as ObjectHook;
  expect(plugin.configResolved && typeof plugin.configResolved).toEqual('object');
  expect(configResolved.order).toEqual('post');
  await configResolved.handler.call(context, { root: '/app' });
  expect(peer.calls.configResolved.thisValue).toBe(context);
  expect(peer.calls.configResolved.args).toEqual([{ root: '/app' }]);

  const configureServer = plugin.configureServer as unknown as ObjectHook;
  expect(plugin.configureServer && typeof plugin.configureServer).toEqual('object');
  expect(configureServer.order).toEqual('pre');
  const server = serverShape();
  const postHook = await configureServer.handler.call(context, server);
  expect(peer.calls.configureServer.thisValue).toBe(context);
  expect(peer.calls.configureServer.args).toEqual([server]);
  expect(postHook, 'the peer post hook is still forwarded unchanged').toBe(peer.postHook);
  (postHook as () => void)();
  expect(peer.calls.postHook).toEqual({ args: [], thisValue: undefined });

  const hotUpdate = plugin.handleHotUpdate as unknown as ObjectHook;
  expect(plugin.handleHotUpdate && typeof plugin.handleHotUpdate).toEqual('object');
  expect(hotUpdate.order).toEqual('pre');
  expect(await hotUpdate.handler.call(context, { file: '/app/page.tsx' })).toEqual(['module']);
  expect(peer.calls.handleHotUpdate.thisValue).toBe(context);
  expect(peer.calls.handleHotUpdate.args).toEqual([{ file: '/app/page.tsx' }]);
});
