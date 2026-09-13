/**
 * Same-origin access-token renewal for the Realtime reference island.
 *
 * @supabase/ssr rotates the session through HttpOnly cookies. This endpoint
 * returns only the new short-lived access token and expiry; the refresh token
 * never enters island state, DOM attributes, localStorage, or response JSON.
 */
import { createServerSupabase } from '../../../lib/supabase-server.ts';

interface ApiContext {
  request: Request;
  env: Record<string, unknown>;
}

export interface SessionTokenSupabaseClient {
  auth: {
    refreshSession(): Promise<{
      data: { session: { access_token: string; expires_at?: number } | null };
      error: { message: string } | null;
    }>;
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error?: { message: string } | null;
    }>;
  };
}

export type SessionTokenClientFactory = (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => SessionTokenSupabaseClient;

export function isSameOriginCredentialRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status: number, responseHeaders: Headers): Response {
  responseHeaders.set('cache-control', 'private, no-store');
  responseHeaders.set('vary', 'cookie, origin');
  return Response.json(body, { status, headers: responseHeaders });
}

export function createSessionTokenHandler(
  createClient: SessionTokenClientFactory = createServerSupabase,
) {
  return async function sessionToken({ request, env }: ApiContext): Promise<Response> {
    const responseHeaders = new Headers();
    if (request.method !== 'POST') {
      responseHeaders.set('allow', 'POST');
      return jsonResponse({ error: 'method not allowed' }, 405, responseHeaders);
    }
    if (!isSameOriginCredentialRequest(request)) {
      return jsonResponse({ error: 'forbidden' }, 403, responseHeaders);
    }

    const supabase = createClient(env, request, responseHeaders);
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      return jsonResponse({ error: 'session unavailable' }, 401, responseHeaders);
    }
    const verified = await supabase.auth.getUser();
    if (verified.error || !verified.data.user) {
      return jsonResponse({ error: 'session unavailable' }, 401, responseHeaders);
    }

    return jsonResponse(
      {
        accessToken: refreshed.data.session.access_token,
        expiresAt: refreshed.data.session.expires_at ?? null,
      },
      200,
      responseHeaders,
    );
  };
}

export default createSessionTokenHandler();
