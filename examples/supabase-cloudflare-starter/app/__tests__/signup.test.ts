import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementRedirect } from '@openelement/app';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createSignupAction, signupLoader } = await import('../route-logic/signup.ts');
type SignupAuthClient = import('../route-logic/signup.ts').SignupAuthClient;

function client(
  result: { session?: unknown; error?: { message: string } | null } = {},
): () => SignupAuthClient {
  return () => ({
    auth: {
      signUp: () =>
        Promise.resolve({
          data: { session: result.session ?? null },
          error: result.error ?? null,
        }),
    },
  });
}
function context(formData = new FormData(), env: Record<string, unknown> = {}) {
  return {
    formData,
    env,
    request: new Request('https://app.test/signup', {
      headers: { 'cf-connecting-ip': '192.0.2.1' },
    }),
    responseHeaders: new Headers(),
  };
}
function credentials(email = 'user@example.com', password = 'password-8') {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

Deno.test('signup rejects a Cloudflare rate-limit denial before auth', async () => {
  let called = false;
  const action = createSignupAction(() => {
    called = true;
    return client()();
  });
  const result = await action(
    context(credentials(), {
      AUTH_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    }),
  );
  assert(isActionFailure(result));
  assertEquals(result.status, 429);
  assertEquals(called, false);
});

Deno.test('signup rejects missing credentials and short passwords', async () => {
  const result = await createSignupAction(client())(context());
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  const short = await createSignupAction(client())(context(credentials('user@example.com', 'x')));
  assert(isActionFailure(short));
  assertEquals(short.status, 422);
});

Deno.test('signup sanitizes provider failures', async () => {
  const result = await createSignupAction(
    client({ error: { message: 'private provider diagnostic eyJsecret' } }),
  )(context(credentials()));
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals(JSON.stringify(result.data).includes('eyJsecret'), false);
});

Deno.test('signup with an immediate session redirects to next', async () => {
  const error = await assertRejects(() =>
    createSignupAction(client({ session: { access_token: 'token' } }))(context(credentials()))
  );
  assert(isOpenElementRedirect(error));
  assertEquals((error as { location?: string }).location, '/notes');
});

Deno.test('signup success redirects to the sent confirmation with PRG (#1060)', async () => {
  const error = await assertRejects(() => createSignupAction(client())(context(credentials())));
  assert(isOpenElementRedirect(error));
  assertEquals((error as { location?: string }).location, '/signup?sent=1');
});

Deno.test('signup loader exposes the sent confirmation state from the query', () => {
  assertEquals(signupLoader({ request: new Request('https://app.test/signup?sent=1') }), {
    sent: true,
  });
  assertEquals(signupLoader({ request: new Request('https://app.test/signup') }), { sent: false });
});
