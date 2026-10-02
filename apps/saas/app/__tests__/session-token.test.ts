import { expect, test } from 'vitest';
import {
  createSessionTokenHandler,
  type SessionTokenSupabaseClient,
} from '../routes/api/session-token.ts';

const request = (origin = 'https://app.test') =>
  new Request('https://app.test/api/session-token', {
    method: 'POST',
    headers: { origin },
  });

function client(
  overrides: {
    session?: { access_token: string; expires_at?: number } | null;
    user?: { id: string } | null;
    responseHeaders?: Headers;
  } = {},
): (
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

test('session-token endpoint is POST-only and rejects absent/cross-site Origin', async () => {
  const handler = createSessionTokenHandler(client());
  const get = await handler({
    request: new Request('https://app.test/api/session-token'),
    env: {},
  });
  expect(get.status).toEqual(405);
  expect(get.headers.get('allow')).toEqual('POST');

  const absent = await handler({
    request: new Request('https://app.test/api/session-token', { method: 'POST' }),
    env: {},
  });
  expect(absent.status).toEqual(403);
  expect((await handler({ request: request('https://evil.test'), env: {} })).status).toEqual(403);
});

test('session-token returns only a verified short-lived JWT and forwards rotated cookies', async () => {
  const headers = new Headers();
  headers.append('set-cookie', 'sb-auth=rotated; HttpOnly; SameSite=Lax; Secure; Path=/');
  const response = await createSessionTokenHandler(client({ responseHeaders: headers }))({
    request: request(),
    env: {},
  });
  expect(response.status).toEqual(200);
  expect(response.headers.get('cache-control')).toEqual('private, no-store');
  expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(await response.json()).toEqual({
    accessToken: 'short-lived-jwt',
    expiresAt: 2_000_000_000,
  });
});

test('session-token fails closed when refresh or user verification has no session', async () => {
  const missingSession = createSessionTokenHandler(client({ session: null }));
  expect((await missingSession({ request: request(), env: {} })).status).toEqual(401);
  const missingUser = createSessionTokenHandler(client({ user: null }));
  expect((await missingUser({ request: request(), env: {} })).status).toEqual(401);
});
