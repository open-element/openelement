import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, expect, type WebSocketRoute } from '@playwright/test';

const dist = new URL('../dist/', import.meta.url);
const { default: render } = (await import(new URL('server/index.js', dist).href)) as {
  default(event: { req: Request; env: Record<string, string> }): Promise<Response>;
};

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'notes@example.test' };
const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expiresAt })}.fixture`;
const cookie = `base64-${encode({
  access_token: token,
  refresh_token: 'fixture-refresh',
  expires_at: expiresAt,
  expires_in: 3_600,
  token_type: 'bearer',
  user,
})}`;

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', origin);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    let response: Response;
    if (url.pathname === '/auth/v1/user' || url.pathname === '/rest/v1/notes') {
      response =
        headers.get('authorization') === `Bearer ${token}`
          ? Response.json(url.pathname.endsWith('/user') ? user : [])
          : new Response('Unauthorized', { status: 401 });
    } else if (/^\/(client|island-manifests)\//.test(url.pathname)) {
      const asset = await readFile(new URL(url.pathname.slice(1), dist));
      const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'application/json';
      response = new Response(new Uint8Array(asset), { headers: { 'content-type': type } });
    } else {
      const method = incoming.method ?? 'GET';
      const body = method === 'POST' ? (await Array.fromAsync(incoming)).join('') : undefined;
      response = await render({
        req: new Request(url, { method, headers, body }),
        env: {
          SUPABASE_URL: origin,
          SUPABASE_ANON_KEY: 'fixture-anon-key',
        },
      });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500);
    outgoing.end(String(error));
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

type Binding = { event: string; schema: string; table: string; filter: string };
let socket: WebSocketRoute | undefined;
let subscription: { join: string; topic: string } | undefined;
const joins: Binding[][] = [];
let leaves = 0;

try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.context().addCookies([{ name: 'sb-127-auth-token', value: cookie, url: origin }]);
    await page.routeWebSocket('**/realtime/v1/websocket?*', (connection) => {
      connection.onMessage((message) => {
        const [join, ref, topic, event, payload] = JSON.parse(String(message)) as [
          string,
          string,
          string,
          string,
          { config?: { postgres_changes: Binding[] }; access_token?: string },
        ];
        let changes: Array<Binding & { id: number }> | undefined;
        if (event === 'phx_join') {
          assert(
            payload.access_token === token,
            'Realtime must receive the SSR or renewed user token',
          );
          const bindings = payload.config!.postgres_changes;
          joins.push(bindings);
          changes = bindings.map((binding) => ({ ...binding, id: 1 }));
          socket = connection;
          subscription = { join, topic };
        }
        if (event === 'phx_leave') leaves++;
        connection.send(
          JSON.stringify([
            join,
            ref,
            topic,
            'phx_reply',
            {
              status: 'ok',
              response: changes ? { postgres_changes: changes } : {},
            },
          ]),
        );
      });
    });

    let releaseLoader!: () => void;
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });
    await page.route('**/client/islands/client.js', async (route) => {
      await loaderGate;
      await route.continue();
    });
    const response = await page.goto(`${origin}/notes`, { waitUntil: 'commit' });
    assert(response?.ok());
    const host = page.locator('notes-live');
    const status = host.locator('#live-status');
    await expect(status).toHaveText('realtime: idle');
    assert((await host.getAttribute('livetoken')) === token, 'SSR delivers one token handoff');
    const ssrNode = await status.elementHandle();
    assert(ssrNode);
    releaseLoader();

    await expect(status).toHaveText('realtime: subscribed');
    await expect(host).not.toHaveAttribute('livetoken', /.+/);
    assert(await status.evaluate((node, first) => node === first, ssrNode));
    assert.deepEqual(joins[0], [
      { schema: 'public', table: 'notes', event: 'INSERT', filter: `user_id=eq.${user.id}` },
    ]);
    assert(socket && subscription);
    const { join, topic } = subscription;
    const now = new Date().toISOString();
    const insert = JSON.stringify([
      join,
      null,
      topic,
      'postgres_changes',
      {
        ids: [1],
        data: {
          schema: 'public',
          table: 'notes',
          type: 'INSERT',
          commit_timestamp: now,
          columns: [],
          record: { id: 'fixture-note', body: 'Realtime note', created_at: now },
        },
      },
    ]);
    socket.send(insert);
    socket.send(insert);
    await expect(host.locator('#live-events li')).toHaveText(['Realtime note']);

    await host.getByRole('button', { name: 'Reconnect' }).click();
    await expect.poll(() => joins.length).toBe(2);
    await expect(status).toHaveText('realtime: subscribed');
    await expect(host.locator('#live-events li')).toHaveText(['Realtime note']);
    await host.evaluate((element) => element.remove());
    await expect.poll(() => leaves).toBe(2);
    await page.getByRole('textbox', { name: 'Title' }).fill(' ');
    const submit = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/notes?/create'),
    );
    await page.getByRole('button', { name: 'Create note' }).click();
    assert.equal((await submit).headers()['x-openelement-action'], 'enhance');
    await expect(page.locator('#action-error')).toHaveText('title is required');

    console.log(
      'notes-live: SSR claim, scoped Realtime delivery, deduplication, reconnect, teardown and enhanced form validation passed',
    );
  } finally {
    await browser.close();
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
