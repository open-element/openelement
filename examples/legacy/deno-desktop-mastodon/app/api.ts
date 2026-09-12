/**
 * Mastodon Desktop — fixture-backed API client.
 *
 * The client is dual-mode:
 *   - In fixture mode (default for alpha.7) it returns local JSON fixtures so
 *     the dogfood can run without a network account.
 *   - In live mode it calls the public Mastodon REST API (read-only endpoints).
 *
 * All methods return `ApiResult<T>` to force callers to handle errors at the
 * boundary.
 */

import { fetchJson } from './fetch-json.ts';
import type {
  ApiResult,
  MastodonAccount,
  MastodonStatus,
  ProfileRequest,
  StatusRequest,
  TimelineRequest,
} from './types.ts';

function useFixtures(): boolean {
  return Deno.env.get('MASTODON_LIVE') !== 'true';
}

const FIXTURES_BASE = new URL(/* @vite-ignore */ '../fixtures/', import.meta.url);

function fixturePath(name: string): URL {
  return new URL(`./${name}.json`, FIXTURES_BASE);
}

async function readFixture<T>(name: string): Promise<ApiResult<T>> {
  try {
    const text = await Deno.readTextFile(fixturePath(name));
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        type: 'configuration',
        message: err instanceof Error ? err.message : `Failed to load fixture ${name}`,
      },
    };
  }
}

function normalizeInstance(instance: string): string {
  let url = instance.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, '');
}

export async function fetchPublicTimeline(
  req: TimelineRequest,
): Promise<ApiResult<MastodonStatus[]>> {
  if (useFixtures()) {
    return readFixture<MastodonStatus[]>('timeline');
  }

  const base = normalizeInstance(req.instance);
  const path = req.timeline === 'local'
    ? '/api/v1/timelines/public?local=true'
    : '/api/v1/timelines/public';
  const url = new URL(path, base);
  if (req.maxId) url.searchParams.set('max_id', req.maxId);
  if (req.sinceId) url.searchParams.set('since_id', req.sinceId);
  if (req.limit) url.searchParams.set('limit', String(req.limit));

  return await fetchJson<MastodonStatus[]>(url.toString());
}

export async function fetchAccount(
  req: ProfileRequest,
): Promise<ApiResult<MastodonAccount>> {
  if (useFixtures()) {
    return readFixture<MastodonAccount>('account');
  }

  const base = normalizeInstance(req.instance);
  const url = new URL(`/api/v1/accounts/lookup?acct=${encodeURIComponent(req.acct)}`, base);

  return await fetchJson<MastodonAccount>(url.toString());
}

export async function fetchAccountStatuses(
  req: ProfileRequest,
): Promise<ApiResult<MastodonStatus[]>> {
  if (useFixtures()) {
    return readFixture<MastodonStatus[]>('account-statuses');
  }

  const base = normalizeInstance(req.instance);
  const lookup = await fetchAccount(req);
  if (!lookup.ok) return lookup;

  const url = new URL(`/api/v1/accounts/${lookup.data.id}/statuses`, base);
  return await fetchJson<MastodonStatus[]>(url.toString());
}

export async function fetchStatus(
  req: StatusRequest,
): Promise<ApiResult<MastodonStatus>> {
  if (useFixtures()) {
    return readFixture<MastodonStatus>('status');
  }

  const base = normalizeInstance(req.instance);
  const url = new URL(`/api/v1/statuses/${encodeURIComponent(req.id)}`, base);

  return await fetchJson<MastodonStatus>(url.toString());
}

export async function fetchStatusContext(
  req: StatusRequest,
): Promise<ApiResult<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>> {
  if (useFixtures()) {
    return readFixture<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>(
      'status-context',
    );
  }

  const base = normalizeInstance(req.instance);
  const url = new URL(`/api/v1/statuses/${encodeURIComponent(req.id)}/context`, base);

  return await fetchJson<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>(
    url.toString(),
  );
}
