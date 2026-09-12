/**
 * Shared fetch-or-error helper for the Mastodon Desktop API clients —
 * used by both the Deno backend client (api.ts) and the browser route
 * loaders (api-client.ts) so the two cannot drift.
 */

import type { ApiResult } from './types.ts';

export async function fetchJson<T>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: { type: 'http', status: res.status, message: await res.text() },
      };
    }
    return { ok: true, data: await res.json() as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        type: 'network',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
