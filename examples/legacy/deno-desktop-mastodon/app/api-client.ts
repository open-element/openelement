/**
 * Mastodon Desktop — browser-safe cached API client used by route loaders.
 *
 * Talks to the local backend endpoints served by `main.ts`:
 *   /api/timeline
 *   /api/profile/:acct
 *   /api/profile/:acct/statuses
 *   /api/status/:id
 *   /api/status/:id/context
 *
 * The backend decides whether to return fixtures or call live Mastodon APIs,
 * so the client does not need Deno APIs and can run in the desktop webview.
 */

import { getCache, setCache } from './cache.ts';
import { fetchJson } from './fetch-json.ts';
import { loadSettings } from './settings.ts';
import type {
  ApiResult,
  MastodonAccount,
  MastodonStatus,
  ProfileRequest,
  StatusRequest,
  TimelineRequest,
} from './types.ts';

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes

function currentInstance(): string {
  if (typeof document !== 'undefined') {
    return loadSettings().instanceUrl;
  }
  return 'mastodon.social';
}

function encodeAcct(acct: string): string {
  return encodeURIComponent(acct);
}

export async function getTimeline(
  options: Partial<Omit<TimelineRequest, 'instance'>> & { ttlMs?: number } = {},
): Promise<ApiResult<MastodonStatus[]>> {
  const { ttlMs = DEFAULT_TTL_MS, ...req } = options;
  const request: TimelineRequest = {
    ...req,
    instance: currentInstance(),
    timeline: req.timeline ?? 'public',
    limit: req.limit ?? 20,
  };
  const cacheKey = `timeline:${request.instance}:${request.timeline}:${request.maxId ?? ''}:${
    request.sinceId ?? ''
  }:${request.limit ?? 20}`;
  const cached = getCache<MastodonStatus[]>(cacheKey, ttlMs);
  if (cached) return { ok: true, data: cached };

  const params = new URLSearchParams();
  params.set('instance', request.instance);
  params.set('local', String(request.timeline === 'local'));
  if (request.maxId) params.set('maxId', request.maxId);
  if (request.sinceId) params.set('sinceId', request.sinceId);
  params.set('limit', String(request.limit));

  const result = await fetchJson<MastodonStatus[]>(`/api/timeline?${params.toString()}`);
  if (result.ok) setCache(cacheKey, result.data);
  return result;
}

export async function getProfile(
  acct: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ApiResult<MastodonAccount>> {
  const request: ProfileRequest = { instance: currentInstance(), acct };
  const cacheKey = `profile:${request.instance}:${acct}`;
  const cached = getCache<MastodonAccount>(cacheKey, ttlMs);
  if (cached) return { ok: true, data: cached };

  const params = new URLSearchParams();
  params.set('instance', request.instance);

  const result = await fetchJson<MastodonAccount>(
    `/api/profile/${encodeAcct(acct)}?${params.toString()}`,
  );
  if (result.ok) setCache(cacheKey, result.data);
  return result;
}

export async function getProfileStatuses(
  acct: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ApiResult<MastodonStatus[]>> {
  const request: ProfileRequest = { instance: currentInstance(), acct };
  const cacheKey = `profile-statuses:${request.instance}:${acct}`;
  const cached = getCache<MastodonStatus[]>(cacheKey, ttlMs);
  if (cached) return { ok: true, data: cached };

  const params = new URLSearchParams();
  params.set('instance', request.instance);

  const result = await fetchJson<MastodonStatus[]>(
    `/api/profile/${encodeAcct(acct)}/statuses?${params.toString()}`,
  );
  if (result.ok) setCache(cacheKey, result.data);
  return result;
}

export async function getStatus(
  id: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ApiResult<MastodonStatus>> {
  const request: StatusRequest = { instance: currentInstance(), id };
  const cacheKey = `status:${request.instance}:${id}`;
  const cached = getCache<MastodonStatus>(cacheKey, ttlMs);
  if (cached) return { ok: true, data: cached };

  const params = new URLSearchParams();
  params.set('instance', request.instance);

  const result = await fetchJson<MastodonStatus>(
    `/api/status/${encodeURIComponent(id)}?${params.toString()}`,
  );
  if (result.ok) setCache(cacheKey, result.data);
  return result;
}

export async function getStatusContext(
  id: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ApiResult<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>> {
  const request: StatusRequest = { instance: currentInstance(), id };
  const cacheKey = `status-context:${request.instance}:${id}`;
  const cached = getCache<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>(
    cacheKey,
    ttlMs,
  );
  if (cached) return { ok: true, data: cached };

  const params = new URLSearchParams();
  params.set('instance', request.instance);

  const result = await fetchJson<{ ancestors: MastodonStatus[]; descendants: MastodonStatus[] }>(
    `/api/status/${encodeURIComponent(id)}/context?${params.toString()}`,
  );
  if (result.ok) setCache(cacheKey, result.data);
  return result;
}
