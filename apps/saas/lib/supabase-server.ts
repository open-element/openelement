/**
 * Server-side Supabase client factory (composition boundary, #981): the
 * official client is created from server env only — the anon key never ships
 * to the client bundle (secret-boundary gate #984), and no service-role key
 * ever enters this process path.
 *
 * Session transport: @supabase/ssr's cookie adapter reads from the incoming
 * Request's Cookie header and writes through the ADR-0129 response-header
 * channel (context.responseHeaders). Every Set-Cookie carries the security
 * floor (HttpOnly; SameSite=Lax; Path=/; Secure on https).
 */
import { createServerClient } from '@supabase/ssr';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

export function createServerSupabase(
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL : '';
  const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY : '';
  if (!url || !anonKey) {
    throw new Error(
      '[reference starter] SUPABASE_URL and SUPABASE_ANON_KEY must be set in the worker env',
    );
  }
  // Secure follows the APPLICATION's origin, not the Supabase URL: the
  // cookie belongs to the app; over plain http (local/LAN) a Secure cookie
  // would be dropped by the browser and the session would vanish.
  const secure = new URL(request.url).protocol === 'https:';
  return createServerClient(url, anonKey, {
    cookies: {
      // parseCookieHeader marks value optional; GetAllCookies wants a
      // string — coerce missing values to ''.
      getAll: () =>
        parseCookieHeader(request.headers.get('cookie') ?? '').map((cookie) => ({
          name: cookie.name,
          value: cookie.value ?? '',
        })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          responseHeaders.append(
            'set-cookie',
            serializeCookieHeader(name, value, {
              ...options,
              httpOnly: true,
              path: '/',
              sameSite: 'lax',
              secure,
            }),
          );
        }
      },
    },
  });
}
