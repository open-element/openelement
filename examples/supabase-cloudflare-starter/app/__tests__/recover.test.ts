import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementRedirect } from '@openelement/app';

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

Deno.test('recover rejects a Cloudflare rate-limit denial before auth', async () => {
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
  assert(isActionFailure(result));
  assertEquals(result.status, 429);
  assertEquals(called, false);
});

Deno.test('recover rejects a missing email', async () => {
  const result = await createRecoverAction(client())(context());
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
});

Deno.test('recover sanitizes provider failures', async () => {
  const result = await createRecoverAction(
    client({ message: 'private provider diagnostic eyJsecret' }),
  )(context(email()));
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals(JSON.stringify(result.data).includes('eyJsecret'), false);
});

Deno.test('recover success redirects to the sent confirmation with PRG (#1060)', async () => {
  const error = await assertRejects(() => createRecoverAction(client())(context(email())));
  assert(isOpenElementRedirect(error));
  assertEquals((error as { location?: string }).location, '/recover?sent=1');
});

Deno.test('recover loader exposes the sent confirmation state from the query', () => {
  assertEquals(recoverLoader({ request: new Request('https://app.test/recover?sent=1') }), {
    sent: true,
  });
  assertEquals(recoverLoader({ request: new Request('https://app.test/recover') }), {
    sent: false,
  });
});
