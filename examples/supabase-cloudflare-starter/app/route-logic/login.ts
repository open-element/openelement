/**
 * /login route logic (v0.44): email+password sign-in (#983) plus optional
 * OAuth providers (#998). Plain module so Deno tests never evaluate the
 * compiled page class; the route module (app/routes/login.tsx) is the thin
 * wrapper.
 *
 * OAuth providers: a provider button renders only when its env flag is
 * explicitly enabled (`SUPABASE_OAUTH_<PROVIDER>_ENABLED=true`); with no
 * provider enabled the page renders an explicit "OAuth providers: not
 * configured" placeholder so Tier-2 evidence can assert the absence is
 * deliberate. The oauth action fails closed (422, never a 500) when the
 * requested provider is not enabled, and the shared PKCE /auth/callback
 * already renders provider/exchange failures as data.
 */
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { publicAuthError } from '../../lib/auth-security.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import { authRequestAllowed, type RateLimitEnv } from '../../lib/rate-limit.ts';

export interface LoginActionData {
  error?: string;
  email?: string;
}

export interface OAuthProvider {
  id: 'google' | 'github';
  label: string;
}

const OAUTH_PROVIDERS: readonly (OAuthProvider & { envFlag: string })[] = [
  { id: 'google', label: 'Google', envFlag: 'SUPABASE_OAUTH_GOOGLE_ENABLED' },
  { id: 'github', label: 'GitHub', envFlag: 'SUPABASE_OAUTH_GITHUB_ENABLED' },
];

/**
 * A provider counts as configured only on an explicit `true` (the
 * STRIPE_LIVEMODE convention): absence, empty strings, and `false` all mean
 * "not configured", so a copied-out flag can never enable a provider whose
 * dashboard/client credentials were never set up.
 */
export function configuredOAuthProviders(env: Record<string, unknown>): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => env[provider.envFlag] === 'true')
    .map(({ id, label }) => ({ id, label }));
}

export interface LoginLoaderData {
  oauthProviders: OAuthProvider[];
}

export function createLoginLoader() {
  return function loader(ctx: { env: Record<string, unknown> }): LoginLoaderData {
    return { oauthProviders: configuredOAuthProviders(ctx.env) };
  };
}

export interface LoginAuthClient {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export type LoginClientFactory = (
  env: RateLimitEnv,
  request: Request,
  responseHeaders: Headers,
) => LoginAuthClient;

export function createLoginAction(createClient: LoginClientFactory = createServerSupabase) {
  return async function action(ctx: {
    formData: FormData;
    env: RateLimitEnv;
    request: Request;
    responseHeaders: Headers;
  }): Promise<OpenElementActionFailure<LoginActionData>> {
    if (!(await authRequestAllowed(ctx.env, ctx.request, 'login'))) {
      return fail(429, { error: 'too many attempts; retry later' });
    }
    const email = String(ctx.formData.get('email') ?? '').trim();
    const password = String(ctx.formData.get('password') ?? '');
    if (!email || !password) {
      return fail(422, { error: 'email and password are required', email });
    }
    const client = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return fail(422, { error: publicAuthError(error), email });
    throw redirect('/notes');
  };
}

export interface LoginOAuthClient {
  auth: {
    signInWithOAuth(credentials: {
      provider: OAuthProvider['id'];
      options: { redirectTo: string };
    }): PromiseLike<{
      data: { url?: string | null } | null;
      error: { message: string } | null;
    }>;
  };
}

export type LoginOAuthClientFactory = (
  env: RateLimitEnv,
  request: Request,
  responseHeaders: Headers,
) => LoginOAuthClient;

export function createOAuthAction(createClient: LoginOAuthClientFactory = createServerSupabase) {
  return async function oauth(ctx: {
    formData: FormData;
    env: RateLimitEnv;
    request: Request;
    responseHeaders: Headers;
  }): Promise<OpenElementActionFailure<LoginActionData>> {
    if (!(await authRequestAllowed(ctx.env, ctx.request, 'login'))) {
      return fail(429, { error: 'too many attempts; retry later' });
    }
    const provider = String(ctx.formData.get('provider') ?? '');
    const configured = configuredOAuthProviders(ctx.env).find((entry) => entry.id === provider);
    // Fail closed: an unconfigured provider is a client error, never a 500.
    if (!configured) return fail(422, { error: 'oauth provider is not configured' });
    const client = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: configured.id,
      options: { redirectTo: new URL('/auth/callback', ctx.request.url).toString() },
    });
    if (error || typeof data?.url !== 'string' || !data.url) {
      return fail(422, { error: publicAuthError(error) });
    }
    // External redirect to the provider consent screen; the PKCE verifier
    // cookie already went out through the ADR-0129 response-header channel.
    throw redirect(data.url);
  };
}

/**
 * Request scope → compiled page properties (app/components/page-login.tsx).
 * The OAuth provider list projects onto one numeric flag per known provider
 * (the compiler grammar v1 renders them as fully static conditional Region
 * branches) plus an explicit not-configured flag for the placeholder.
 */
export function loginPageProps(
  context: PagePropsContext<LoginLoaderData>,
): Record<string, unknown> {
  const result = context.actionData as LoginActionData | undefined;
  const providers = context.data?.oauthProviders ?? [];
  return {
    errorText: result?.error ?? '',
    email: result?.email ?? '',
    oauthGoogle: providers.some((provider) => provider.id === 'google') ? 1 : 0,
    oauthGithub: providers.some((provider) => provider.id === 'github') ? 1 : 0,
    oauthNone: providers.length === 0 ? 1 : 0,
  };
}
