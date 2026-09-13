/**
 * Shared service-role helpers for the starter: structured payment logs, the
 * service-role PostgREST RPC channel, and the UUID pattern used to validate
 * database ids. Extracted so the Stripe webhook route, checkout action,
 * scanner worker, and lifecycle consumers stop keeping parallel copies.
 */

// Minimal structured payment logs. The correlation key is always the provider
// event id; payloads, headers, object keys, customer data, and secrets are
// never logged.
export function logPayment(level: 'info' | 'error', fields: Record<string, unknown>): void {
  const line = JSON.stringify(fields);
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** UUID v1–v5, case-insensitive — the shape of database-generated ids. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ServiceRoleEnv {
  SUPABASE_URL?: unknown;
  SUPABASE_SERVICE_ROLE_KEY?: unknown;
}

/**
 * POST to a PostgREST RPC with the service-role key. Throws on missing
 * configuration, non-2xx status, or a fetch failure; resolves to the parsed
 * JSON body (`undefined` for 204 No Content).
 */
export async function serviceRoleRpc<T>(
  env: ServiceRoleEnv,
  name: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL : '';
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : '';
  if (!url || !key) throw new Error('service-role Supabase configuration unavailable');
  const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
