/**
 * The lazy dev-server proxy (item 16): every hook keeps its own parameters,
 * return value and `this`, while the optional peer is imported only when Vite
 * actually invokes a hook. The wrapper must forward the peer configureServer's
 * post hook unchanged — it is not a dispose function.
 */
import { expect, test, vi } from 'vitest';
import type { ViteDevServer } from 'vite';

const peer = vi.hoisted(() => {
  const calls: Record<string, { args: unknown[]; thisValue: unknown }> = {};
  const postHook = () => {
    calls.postHook = { args: [], thisValue: undefined };
  };
  const plugin = {
    name: 'mock-hono-dev-server',
    config(this: unknown, config: unknown, env: unknown) {
      calls.config = { args: [config, env], thisValue: this };
      return { mock: 'config' };
    },
    configResolved(this: unknown, config: unknown) {
      calls.configResolved = { args: [config], thisValue: this };
    },
    configureServer(this: unknown, server: unknown) {
      calls.configureServer = { args: [server], thisValue: this };
      return postHook;
    },
    handleHotUpdate(this: unknown, context: unknown) {
      calls.handleHotUpdate = { args: [context], thisValue: this };
      return ['module'];
    },
  };
  return { calls, postHook, plugin, factories: 0 };
});

vi.mock('@hono/vite-dev-server', () => ({
  defaultOptions: { exclude: [] },
  default: (_options: unknown) => {
    peer.factories += 1;
    return peer.plugin;
  },
}));

const { lazyHonoDevServer } = await import('../src/vite/dev-server.ts');

type AnyHook = (this: unknown, ...args: unknown[]) => Promise<unknown>;

test('the peer is imported lazily and only the served environment applies', () => {
  const plugin = lazyHonoDevServer(() => ({ entry: 'entry' }));
  expect(plugin.name).toEqual('@hono/vite-dev-server');
  expect(plugin.apply).toEqual('serve');
  expect(peer.factories, 'constructing the plugin must not resolve the peer').toEqual(0);
});

test('hook forwarding keeps each hook its arguments, return value, this, and order', async () => {
  const plugin = lazyHonoDevServer((mod) => ({ entry: 'entry', marker: mod }) as never);
  const context = { pluginContext: true };

  const configResult = await (plugin.config as AnyHook).call(
    context,
    { plugins: [] },
    { command: 'serve', mode: 'development' },
  );
  expect(configResult).toEqual({ mock: 'config' });
  expect(peer.factories).toEqual(1);
  expect(peer.calls.config.thisValue).toBe(context);
  expect(peer.calls.config.args).toEqual([
    { plugins: [] },
    { command: 'serve', mode: 'development' },
  ]);

  await (plugin.configResolved as AnyHook).call(context, { root: '/app' });
  expect(peer.calls.configResolved.thisValue).toBe(context);
  expect(peer.calls.configResolved.args).toEqual([{ root: '/app' }]);

  const hotContext = { file: '/app/page.tsx' };
  expect(await (plugin.handleHotUpdate as AnyHook).call(context, hotContext)).toEqual(['module']);
  expect(peer.calls.handleHotUpdate.thisValue).toBe(context);
  expect(peer.calls.handleHotUpdate.args).toEqual([hotContext]);

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
  const postHook = await (plugin.configureServer as AnyHook).call(context, server);
  expect(peer.calls.configureServer.thisValue).toBe(context);
  expect(peer.calls.configureServer.args).toEqual([server]);
  expect(uses, 'the dev-host delegations are installed before the peer middleware').toHaveLength(2);
  expect(postHook, 'the peer post hook is forwarded unchanged, never treated as dispose').toBe(
    peer.postHook,
  );
  (postHook as () => void)();
  expect(peer.calls.postHook).toEqual({ args: [], thisValue: undefined });
});
