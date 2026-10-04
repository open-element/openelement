import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isOpenElementRedirect } from '@openelement/router';
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

test('callback rejects missing and expired codes without reflecting details', async () => {
  const missing = await createCallbackLoader(client())(context(''));
  expect(missing.error?.includes('Authentication could not')).toEqual(true);
  const expired = await createCallbackLoader(client({ message: 'expired code private-123' }))(
    context('?code=private-123'),
  );
  expect(JSON.stringify(expired).includes('private-123')).toEqual(false);
});
test('callback success rejects an encoded external next and redirects internally', async () => {
  const thrown = await assertRejectsIncludes(() =>
    createCallbackLoader(client())(context('?code=ok&next=%252F%252Fevil.example')),
  );
  expect(isOpenElementRedirect(thrown)).toEqual(true);
  expect((thrown as { location?: string }).location?.includes('evil.example') ?? false).toEqual(
    false,
  );
});
