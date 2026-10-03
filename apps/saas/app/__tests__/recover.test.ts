import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isActionFailure, isOpenElementRedirect } from '@openelement/router';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createRecoverAction, recoverLoader } = await import('../route-logic/recover.ts');
type RecoverAuthClient = import('../route-logic/recover.ts').RecoverAuthClient;

function client(error: { message: string } | null = null): () => RecoverAuthClient {
  return () => ({ auth: { resetPasswordForEmail: () => Promise.resolve({ error }) } });
}
function context(formData = new FormData(), env: Record<string, unknown> = {}) {
  return {
    formData,
    env,
    request: new Request('https://app.test/recover', {
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

test('recover rejects a Cloudflare rate-limit denial before auth', async () => {
  let called = false;
  const action = createRecoverAction(() => {
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

test('recover rejects a missing email', async () => {
  const result = await createRecoverAction(client())(context());
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});

test('recover sanitizes provider failures', async () => {
  const result = await createRecoverAction(
    client({ message: 'private provider diagnostic eyJsecret' }),
  )(context(email()));
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(JSON.stringify(result.data).includes('eyJsecret')).toEqual(false);
});

test('recover success redirects to the sent confirmation with PRG (#1060)', async () => {
  const error = await assertRejectsIncludes(() => createRecoverAction(client())(context(email())));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect((error as { location?: string }).location).toEqual('/recover?sent=1');
});

test('recover loader exposes the sent confirmation state from the query', () => {
  expect(recoverLoader({ request: new Request('https://app.test/recover?sent=1') })).toEqual({
    sent: true,
  });
  expect(recoverLoader({ request: new Request('https://app.test/recover') })).toEqual({
    sent: false,
  });
});
