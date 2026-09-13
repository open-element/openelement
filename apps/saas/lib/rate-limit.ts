export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type RateLimitEnv = Record<string, unknown> & {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  AUTH_RATE_LIMITER?: RateLimitBinding;
};

/** Cloudflare binding in production; absence is explicit local/test behavior. */
export async function authRequestAllowed(
  env: RateLimitEnv,
  request: Request,
  scope: string,
): Promise<boolean> {
  const binding = env.AUTH_RATE_LIMITER;
  if (!binding) return true;
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  try {
    return (await binding.limit({ key: `${scope}:${address}` })).success;
  } catch {
    // Production abuse controls fail closed: a binding outage must not turn
    // into an unlimited Auth endpoint or leak provider diagnostics.
    return false;
  }
}
