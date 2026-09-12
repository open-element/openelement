import { assertEquals, assertRejects } from '@std/assert';
import { isOpenElementRedirect } from '@openelement/app';
// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createCallbackLoader } = await import('../route-logic/auth-callback.ts');
type CallbackAuthClient = import('../route-logic/auth-callback.ts').CallbackAuthClient;
function client(error: { message: string } | null = null): () => CallbackAuthClient {
  return () => ({ auth: { exchangeCodeForSession: () => Promise.resolve({ error }) } });
}
function context(query: string) {
  return {
    env: {},
    request: new Request(`https://app.test/auth/callback${query}`),
    responseHeaders: new Headers(),
  };
}

Deno.test('callback rejects missing and expired codes without reflecting details', async () => {
  const missing = await createCallbackLoader(client())(context(''));
  assertEquals(missing.error?.includes('Authentication could not'), true);
  const expired = await createCallbackLoader(client({ message: 'expired code private-123' }))(
    context('?code=private-123'),
  );
  assertEquals(JSON.stringify(expired).includes('private-123'), false);
});
Deno.test('callback success rejects an encoded external next and redirects internally', async () => {
  const thrown = await assertRejects(() =>
    createCallbackLoader(client())(context('?code=ok&next=%252F%252Fevil.example'))
  );
  assertEquals(isOpenElementRedirect(thrown), true);
  assertEquals(
    (thrown as { location?: string }).location?.includes('evil.example') ?? false,
    false,
  );
});
