import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isActionFailure, isOpenElementRedirect } from '@openelement/router';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createMagicLinkAction, magicLinkLoader } = await import('../route-logic/magic-link.ts');
type MagicLinkAuthClient = import('../route-logic/magic-link.ts').MagicLinkAuthClient;

function client(error: { message: string } | null = null): () => MagicLinkAuthClient {
  return () => ({ auth: { signInWithOtp: () => Promise.resolve({ error }) } });
}
function context(formData = new FormData(), env: Record<string, unknown> = {}) {
  return {
    formData,
    env,
    request: new Request('https://app.test/magic-link', {
      headers: { 'cf-connecting-ip': '192.0.2.1' },
    }),
    responseHeaders: new Headers(),
  };
}
function email(value = 'user@example.com') {
  const data = new FormData();
  data.set('email', value);
  return data;
}

test('magic-link rejects a Cloudflare rate-limit denial before auth', async () => {
  let called = false;
  const action = createMagicLinkAction(() => {
    called = true;
    return client()();
  });
  const result = await action(
    context(email(), {
      AUTH_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    }),
  );
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(429);
  expect(called).toEqual(false);
});

test('magic-link rejects a missing email', async () => {
  const result = await createMagicLinkAction(client())(context());
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});

test('magic-link sanitizes provider failures', async () => {
  const result = await createMagicLinkAction(
    client({ message: 'private provider diagnostic eyJsecret' }),
  )(context(email()));
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(JSON.stringify(result.data).includes('eyJsecret')).toEqual(false);
});

test('magic-link success redirects to the sent confirmation with PRG (#1060)', async () => {
  const error = await assertRejectsIncludes(() =>
    createMagicLinkAction(client())(context(email())),
  );
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect((error as { location?: string }).location).toEqual('/magic-link?sent=1');
});

test('magic-link loader exposes the sent confirmation state from the query', () => {
  expect(magicLinkLoader({ request: new Request('https://app.test/magic-link?sent=1') })).toEqual({
    sent: true,
  });
  expect(magicLinkLoader({ request: new Request('https://app.test/magic-link') })).toEqual({
    sent: false,
  });
});
