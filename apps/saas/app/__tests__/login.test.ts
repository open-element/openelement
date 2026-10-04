import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isActionFailure, isOpenElementRedirect } from '@openelement/router';
import { renderDsd } from '@openelement/element';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// authoring module's compile-time-only decorators; SSR assertions compile the
// real page class through the adapter compiler first.
import { compileComponentClass } from './compile-page.ts';
const {
  configuredOAuthProviders,
  createLoginAction,
  createLoginLoader,
  createOAuthAction,
  loginPageProps,
} = await import('../route-logic/login.ts');
type LoginAuthClient = import('../route-logic/login.ts').LoginAuthClient;
type LoginOAuthClient = import('../route-logic/login.ts').LoginOAuthClient;

function client(error: { message: string } | null = null): () => LoginAuthClient {
  return () => ({ auth: { signInWithPassword: () => Promise.resolve({ error }) } });
}
function context(formData = new FormData(), env: Record<string, unknown> = {}) {
  return {
    formData,
    env,
    request: new Request('https://app.test/login', {
      headers: { 'cf-connecting-ip': '192.0.2.1' },
    }),
    responseHeaders: new Headers(),
  };
}
function credentials(email = 'user@example.com', password = 'password') {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

test('login rejects a Cloudflare rate-limit denial before auth', async () => {
  let called = false;
  const action = createLoginAction(() => {
    called = true;
    return client()();
  });
  const result = await action(
    context(credentials(), {
      AUTH_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    }),
  );
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(429);
  expect(called).toEqual(false);
});
test('login rejects missing credentials', async () => {
  const result = await createLoginAction(client())(context());
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});
test('login sanitizes provider failures', async () => {
  const result = await createLoginAction(
    client({ message: 'private provider diagnostic eyJsecret' }),
  )(context(credentials()));
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(JSON.stringify(result.data).includes('eyJsecret')).toEqual(false);
});
test('login success redirects with PRG', async () => {
  const error = await assertRejectsIncludes(() =>
    createLoginAction(client())(context(credentials())),
  );
  expect(isOpenElementRedirect(error)).toBeTruthy();
});

test('login SSR includes the action error mount point contract', async () => {
  const LoginPage = await compileComponentClass('../components/page-login.tsx');
  const out = renderDsd('login-page', {
    componentClass: LoginPage,
    props: loginPageProps({
      data: { oauthProviders: [] },
      actionData: { error: 'x', email: 'e' },
      params: {},
      route: { path: '/login' },
      meta: {},
    }),
  });
  expect(out.errors).toEqual([]);
  expect(out.html.includes("id='error'") || out.html.includes('id="error"'), out.html).toBeTruthy();
  expect(out.html.includes('>x<'), out.html).toBeTruthy();
});

function oauthClient(
  result: { url?: string | null; error?: { message: string } | null } = {},
  calls: { provider: string; redirectTo: string }[] = [],
): () => LoginOAuthClient {
  return () => ({
    auth: {
      signInWithOAuth: (credentials: { provider: string; options: { redirectTo: string } }) => {
        calls.push({ provider: credentials.provider, redirectTo: credentials.options.redirectTo });
        return Promise.resolve({
          data: result.url === undefined ? null : { url: result.url },
          error: result.error ?? null,
        });
      },
    },
  });
}

test('oauth providers are configured only by an explicit true flag', () => {
  expect(configuredOAuthProviders({})).toEqual([]);
  expect(configuredOAuthProviders({ SUPABASE_OAUTH_GOOGLE_ENABLED: 'false' })).toEqual([]);
  expect(configuredOAuthProviders({ SUPABASE_OAUTH_GOOGLE_ENABLED: '1' })).toEqual([]);
  expect(configuredOAuthProviders({ SUPABASE_OAUTH_GOOGLE_ENABLED: 'true' })).toEqual([
    { id: 'google', label: 'Google' },
  ]);
  expect(
    configuredOAuthProviders({
      SUPABASE_OAUTH_GOOGLE_ENABLED: 'true',
      SUPABASE_OAUTH_GITHUB_ENABLED: 'true',
    }),
  ).toEqual([
    { id: 'google', label: 'Google' },
    { id: 'github', label: 'GitHub' },
  ]);
});

test('login loader exposes only the configured oauth providers', async () => {
  expect(await createLoginLoader()({ env: { SUPABASE_OAUTH_GITHUB_ENABLED: 'true' } })).toEqual({
    oauthProviders: [{ id: 'github', label: 'GitHub' }],
  });
});

test('login projects the not-configured placeholder without any provider flag', () => {
  const props = loginPageProps({
    data: { oauthProviders: [] },
    actionData: undefined,
    params: {},
    route: { path: '/login' },
    meta: {},
  });
  expect(props.oauthNone).toEqual(1);
  expect(props.oauthGoogle).toEqual(0);
  expect(props.oauthGithub).toEqual(0);
});

test('login projects one flag per configured provider instead of the placeholder', () => {
  const props = loginPageProps({
    data: {
      oauthProviders: [
        { id: 'google', label: 'Google' },
        { id: 'github', label: 'GitHub' },
      ],
    },
    actionData: undefined,
    params: {},
    route: { path: '/login' },
    meta: {},
  });
  expect(props.oauthGoogle).toEqual(1);
  expect(props.oauthGithub).toEqual(1);
  expect(props.oauthNone).toEqual(0);
});

test('login SSR renders the provider branches and placeholder from the projection', async () => {
  const LoginPage = await compileComponentClass('../components/page-login.tsx');
  const base = { actionData: undefined, params: {}, route: { path: '/login' }, meta: {} };
  const none = renderDsd('login-page', {
    componentClass: LoginPage,
    props: loginPageProps({ ...base, data: { oauthProviders: [] } }),
  });
  expect(none.html.includes('OAuth providers: not configured'), none.html).toBeTruthy();
  expect(!none.html.includes('Continue with'), none.html).toBeTruthy();
  const both = renderDsd('login-page', {
    componentClass: LoginPage,
    props: loginPageProps({
      ...base,
      data: {
        oauthProviders: [
          { id: 'google', label: 'Google' },
          { id: 'github', label: 'GitHub' },
        ],
      },
    }),
  });
  expect(both.html.includes('Continue with Google'), both.html).toBeTruthy();
  expect(both.html.includes('Continue with GitHub'), both.html).toBeTruthy();
  expect(!both.html.includes('not configured'), both.html).toBeTruthy();
});

test('oauth action fails closed without 500 when the provider is not configured', async () => {
  let called = false;
  const action = createOAuthAction(() => {
    called = true;
    return oauthClient()();
  });
  const data = new FormData();
  data.set('provider', 'google');
  const result = await action(context(data));
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(called).toEqual(false);
});

test('oauth action redirects to the provider url when configured', async () => {
  const calls: { provider: string; redirectTo: string }[] = [];
  const data = new FormData();
  data.set('provider', 'google');
  const thrown = await assertRejectsIncludes(() =>
    createOAuthAction(
      oauthClient({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }, calls),
    )(context(data, { SUPABASE_OAUTH_GOOGLE_ENABLED: 'true' })),
  );
  expect(isOpenElementRedirect(thrown)).toBeTruthy();
  expect((thrown as { location?: string }).location).toEqual(
    'https://accounts.google.com/o/oauth2/v2/auth?x=1',
  );
  expect(calls).toEqual([
    {
      provider: 'google',
      redirectTo: 'https://app.test/auth/callback',
    },
  ]);
});

test('oauth action sanitizes provider failures and missing urls', async () => {
  const data = new FormData();
  data.set('provider', 'github');
  const env = { SUPABASE_OAUTH_GITHUB_ENABLED: 'true' };
  const errored = await createOAuthAction(
    oauthClient({ url: null, error: { message: 'provider diagnostic eyJsecret' } }),
  )(context(data, env));
  expect(isActionFailure(errored)).toBeTruthy();
  expect(errored.status).toEqual(422);
  expect(JSON.stringify(errored.data).includes('eyJsecret')).toEqual(false);
  const noUrl = await createOAuthAction(oauthClient({ url: null }))(context(data, env));
  expect(isActionFailure(noUrl)).toBeTruthy();
  expect(noUrl.status).toEqual(422);
});

test('oauth action rejects a Cloudflare rate-limit denial before auth', async () => {
  let called = false;
  const action = createOAuthAction(() => {
    called = true;
    return oauthClient()();
  });
  const data = new FormData();
  data.set('provider', 'google');
  const result = await action(
    context(data, {
      SUPABASE_OAUTH_GOOGLE_ENABLED: 'true',
      AUTH_RATE_LIMITER: { limit: () => Promise.resolve({ success: false }) },
    }),
  );
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(429);
  expect(called).toEqual(false);
});
