import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isActionFailure, isOpenElementRedirect } from '@openelement/router';
import { compileServerComponentModule } from '@openelement/compiler';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// authoring module's compile-time-only constructs; SSR assertions compile the
// real page module through the server component compiler first.
const {
  configuredOAuthProviders,
  createLoginAction,
  createLoginLoader,
  createOAuthAction,
  loginPageProps,
} = await import('../route-logic/login.ts');
type LoginAuthClient = import('../route-logic/login.ts').LoginAuthClient;
type LoginOAuthClient = import('../route-logic/login.ts').LoginOAuthClient;

// The page component lives in its ROUTE module (D-M11: the server function page
// lane admits only a component function the route module declares itself), so
// the SSR assertions compile that module and call its render with the
// projector's rows — the same bytes the request-time handler renders. The
// emitted module imports the element server helpers and the router entry by
// bare specifier, so both are re-pointed at the workspace sources (the rewrite
// `compile-page.ts` performs for the retired class form); relative imports are
// rebased onto the route module's own directory.
const ELEMENT_SERVER_URL = import.meta.resolve('@openelement/element/server');
const ROUTER_URL = import.meta.resolve('@openelement/router');

async function renderLoginPage(props: Record<string, unknown>): Promise<string> {
  const routeUrl = new URL('../routes/login.tsx', import.meta.url);
  const compiled = compileServerComponentModule(
    await readFile(routeUrl, 'utf8'),
    routeUrl.pathname,
  );
  if (compiled === null) throw new Error('the login route module compiled to nothing');
  const rewritten = compiled.code
    .replaceAll("from '@openelement/element/server'", `from '${ELEMENT_SERVER_URL}'`)
    .replaceAll("from '@openelement/router'", `from '${ROUTER_URL}'`)
    .replaceAll(
      /from (['"])(\.[^'"]*)\1/g,
      (_match, quote: string, specifier: string) =>
        `from ${quote}${new URL(specifier, routeUrl).href}${quote}`,
    );
  const tempDir = await mkdtemp(join(tmpdir(), 'oe-saas-login-page-'));
  const tempModule = join(tempDir, 'login-page.ts');
  await writeFile(tempModule, rewritten, 'utf8');
  const mod = (await import(pathToFileURL(tempModule).href)) as Record<string, unknown>;
  await rm(tempDir, { recursive: true, force: true });
  const render = mod.LoginPage;
  if (typeof render !== 'function') throw new Error('the login route emitted no LoginPage render');
  return String((render as (pageProps: Record<string, unknown>) => unknown)(props));
}

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
  const html = await renderLoginPage(
    loginPageProps({
      data: { oauthProviders: [] },
      actionData: { error: 'x', email: 'e' },
      params: {},
      route: { path: '/login' },
      meta: {},
    }),
  );
  // The compiled render returns the serialized markup directly; a render error
  // propagates as a throw (the retired result object's `errors` field was a
  // hardcoded empty array), so reaching these assertions is the guarantee.
  expect(html.includes("id='error'") || html.includes('id="error"'), html).toBeTruthy();
  expect(html.includes('>x<'), html).toBeTruthy();
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
  const base = { actionData: undefined, params: {}, route: { path: '/login' }, meta: {} };
  const none = await renderLoginPage(loginPageProps({ ...base, data: { oauthProviders: [] } }));
  expect(none.includes('OAuth providers: not configured'), none).toBeTruthy();
  expect(!none.includes('Continue with'), none).toBeTruthy();
  const both = await renderLoginPage(
    loginPageProps({
      ...base,
      data: {
        oauthProviders: [
          { id: 'google', label: 'Google' },
          { id: 'github', label: 'GitHub' },
        ],
      },
    }),
  );
  expect(both.includes('Continue with Google'), both).toBeTruthy();
  expect(both.includes('Continue with GitHub'), both).toBeTruthy();
  expect(!both.includes('not configured'), both).toBeTruthy();
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
