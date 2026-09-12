import { assertEquals } from '@std/assert';
import {
  createSessionTokenHandler,
  type SessionTokenSupabaseClient,
} from '../routes/api/session-token.ts';

const request = (origin = 'https://app.test') =>
  new Request('https://app.test/api/session-token', {
    method: 'POST',
    headers: { origin },
  });

function client(overrides: {
  session?: { access_token: string; expires_at?: number } | null;
  user?: { id: string } | null;
  responseHeaders?: Headers;
} = {}): (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => SessionTokenSupabaseClient {
  const {
    session = { access_token: 'short-lived-jwt', expires_at: 2_000_000_000 },
    user = {
      id: 'user-1',
    },
  } = overrides;
  return (_env, _request, responseHeaders) => {
    for (const cookie of overrides.responseHeaders?.getSetCookie() ?? []) {
      responseHeaders.append('set-cookie', cookie);
    }
    return {
      auth: {
        refreshSession: () => Promise.resolve({ data: { session }, error: null }),
        getUser: () => Promise.resolve({ data: { user }, error: null }),
      },
    };
  };
}

Deno.test('session-token endpoint is POST-only and rejects absent/cross-site Origin', async () => {
  const handler = createSessionTokenHandler(client());
  const get = await handler({
    request: new Request('https://app.test/api/session-token'),
    env: {},
  });
  assertEquals(get.status, 405);
  assertEquals(get.headers.get('allow'), 'POST');

  const absent = await handler({
    request: new Request('https://app.test/api/session-token', { method: 'POST' }),
    env: {},
  });
  assertEquals(absent.status, 403);
  assertEquals((await handler({ request: request('https://evil.test'), env: {} })).status, 403);
});

Deno.test('session-token returns only a verified short-lived JWT and forwards rotated cookies', async () => {
  const headers = new Headers();
  headers.append('set-cookie', 'sb-auth=rotated; HttpOnly; SameSite=Lax; Secure; Path=/');
  const response = await createSessionTokenHandler(client({ responseHeaders: headers }))({
    request: request(),
    env: {},
  });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'private, no-store');
  assertEquals(response.headers.getSetCookie(), headers.getSetCookie());
  assertEquals(await response.json(), {
    accessToken: 'short-lived-jwt',
    expiresAt: 2_000_000_000,
  });
});

Deno.test('session-token fails closed when refresh or user verification has no session', async () => {
  const missingSession = createSessionTokenHandler(client({ session: null }));
  assertEquals((await missingSession({ request: request(), env: {} })).status, 401);
  const missingUser = createSessionTokenHandler(client({ user: null }));
  assertEquals((await missingUser({ request: request(), env: {} })).status, 401);
});
