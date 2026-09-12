import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementRedirect } from '@openelement/app';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createMagicLinkAction, magicLinkLoader } = await import(
  '../route-logic/magic-link.ts'
);
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

Deno.test('magic-link rejects a Cloudflare rate-limit denial before auth', async () => {
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
  assert(isActionFailure(result));
  assertEquals(result.status, 429);
  assertEquals(called, false);
});

Deno.test('magic-link rejects a missing email', async () => {
  const result = await createMagicLinkAction(client())(context());
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
});

Deno.test('magic-link sanitizes provider failures', async () => {
  const result = await createMagicLinkAction(
    client({ message: 'private provider diagnostic eyJsecret' }),
  )(context(email()));
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals(JSON.stringify(result.data).includes('eyJsecret'), false);
});

Deno.test('magic-link success redirects to the sent confirmation with PRG (#1060)', async () => {
  const error = await assertRejects(() => createMagicLinkAction(client())(context(email())));
  assert(isOpenElementRedirect(error));
  assertEquals((error as { location?: string }).location, '/magic-link?sent=1');
});

Deno.test('magic-link loader exposes the sent confirmation state from the query', () => {
  assertEquals(magicLinkLoader({ request: new Request('https://app.test/magic-link?sent=1') }), {
    sent: true,
  });
  assertEquals(magicLinkLoader({ request: new Request('https://app.test/magic-link') }), {
    sent: false,
  });
});
