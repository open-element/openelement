/**
 * Smoke tests for the notes-live realtime island (#983): compiled SSR render
 * (through the real adapter compiler) and the injected-fetch units —
 * including the Data API reconcile pipeline (401 refresh/retry, #1153). The
 * realtime subscription wiring itself is browser-only and verified with
 * Playwright against the real project — see the issue evidence.
 *
 * v0.44: the island module's decorators are compile-time-only input, so the
 * pure logic lives in app/components/notes-live-shared.ts and the class is
 * compiled here through the real compiler before renderDsd.
 */
import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { renderDsd } from '@openelement/element';
import { compileComponentClass } from './compile-page.ts';
import {
  fetchNotesSnapshot,
  handoffRealtimeAuth,
  MAX_LIVE_EVENTS,
  MAX_RECONNECT_DELAY_MS,
  mergeLiveEvent,
  mergeReconciledEvents,
  reconnectDelayMs,
  requestNotesAccessToken,
  resolveRealtimeAuthToken,
  shouldRefreshAccessToken,
} from '../components/notes-live-shared.ts';

test('notes-live SSR render includes the status and event mount points', async () => {
  const NotesLive = await compileComponentClass('../islands/notes-live.tsx');
  const out = renderDsd('notes-live', { componentClass: NotesLive });
  expect(out.errors).toEqual([]);
  expect(
    out.html.includes("id='live-status'") || out.html.includes('id="live-status"'),
    out.html,
  ).toBeTruthy();
  expect(out.html.includes('realtime:'), out.html).toBeTruthy();
  expect(out.html.includes('live-events'), out.html).toBeTruthy();
  expect(out.html.includes('Reconnect'), out.html).toBeTruthy();
});

test('notes-live deduplicates INSERT delivery by stable row id', () => {
  const first = mergeLiveEvent([], { id: 'note-1', body: 'first' });
  expect(mergeLiveEvent(first, { id: 'note-1', body: 'duplicate payload' })).toEqual(first);
  expect(
    mergeLiveEvent(first, { id: 'note-2', body: 'same display body is allowed' }).length,
  ).toEqual(2);
});

test('notes-live retention is explicitly bounded', () => {
  let events: { id: string; body: string }[] = [];
  for (let index = 0; index < MAX_LIVE_EVENTS + 20; index++) {
    events = mergeLiveEvent(events, { id: String(index), body: String(index) });
  }
  expect(events.length).toEqual(MAX_LIVE_EVENTS);
  expect(events[0].id).toEqual(String(MAX_LIVE_EVENTS + 19));
});

test('notes-live reconciliation repairs dropped events without duplicates', () => {
  const live = [
    { id: 'note-3', body: 'delivered live' },
    { id: 'note-1', body: 'older live' },
  ];
  const newestFirstSnapshot = [
    { id: 'note-4', body: 'missed during reconnect' },
    { id: 'note-3', body: 'same durable row' },
    { id: 'note-2', body: 'missed before subscribe' },
  ];
  expect(mergeReconciledEvents(live, newestFirstSnapshot)).toEqual([
    { id: 'note-4', body: 'missed during reconnect' },
    { id: 'note-3', body: 'delivered live' },
    { id: 'note-2', body: 'missed before subscribe' },
    { id: 'note-1', body: 'older live' },
  ]);
});

test('notes-live reconnect delay is exponential, jittered and capped', () => {
  expect(reconnectDelayMs(0, () => 0.5)).toEqual(500);
  expect(reconnectDelayMs(3, () => 0.5)).toEqual(4_000);
  expect(reconnectDelayMs(99, () => 1)).toEqual(MAX_RECONNECT_DELAY_MS);
});

test('notes-live erases the SSR token only after handing it to Realtime', () => {
  const calls: string[] = [];
  const removed: string[] = [];
  const client = {
    setAuth: (token: string) => {
      calls.push(token);
      return Promise.resolve();
    },
  };
  const host = { removeAttribute: (name: string) => removed.push(name) };

  expect(handoffRealtimeAuth(client, host, 'signed-user-jwt')).toEqual(true);
  expect(calls).toEqual(['signed-user-jwt']);
  expect(removed).toEqual(['livetoken']);

  expect(handoffRealtimeAuth(null, host, 'not-yet-consumed')).toEqual(false);
  expect(removed).toEqual(['livetoken']);
});

test('notes-live retains the user JWT for clients created after reconnect', () => {
  expect(resolveRealtimeAuthToken('fresh-jwt', null)).toEqual('fresh-jwt');
  expect(resolveRealtimeAuthToken(null, 'private-memory-jwt')).toEqual('private-memory-jwt');
  expect(resolveRealtimeAuthToken(null, null)).toEqual(null);
});

test('notes-live refreshes only expired or near-expiry access tokens', () => {
  const now = 1_700_000_000_000;
  expect(shouldRefreshAccessToken(null, now)).toEqual(true);
  expect(shouldRefreshAccessToken(now / 1_000 + 30, now)).toEqual(true);
  expect(shouldRefreshAccessToken(now / 1_000 + 120, now)).toEqual(false);
});

test('notes-live renews through the same-origin cookie endpoint', async () => {
  let input: string | URL | Request = '';
  let init: RequestInit | undefined;
  const fresh = await requestNotesAccessToken((candidate, options) => {
    input = candidate;
    init = options;
    return Promise.resolve(Response.json({ accessToken: 'fresh-jwt', expiresAt: 2_000_000_000 }));
  });
  expect(input).toEqual('/api/session-token');
  expect(init?.method).toEqual('POST');
  expect(init?.credentials).toEqual('same-origin');
  expect(init?.cache).toEqual('no-store');
  expect(fresh).toEqual({ accessToken: 'fresh-jwt', expiresAt: 2_000_000_000 });
  await assertRejectsIncludes(() =>
    requestNotesAccessToken(() =>
      Promise.resolve(Response.json({ accessToken: 'fresh-jwt' }, { status: 401 })),
    ),
  );
});

test('notes-live snapshot sends the bounded RLS query and skips refresh on 200', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let refreshed = 0;
  let handedOff = 0;
  const snapshot = await fetchNotesSnapshot({
    url: 'https://project.supabase.co/',
    key: 'anon-key',
    userId: 'user-1',
    token: 'token-1',
    refreshToken: () => {
      refreshed++;
      return Promise.resolve('unused');
    },
    onRefreshed: () => {
      handedOff++;
    },
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        Response.json([
          { id: 'note-1', body: 'kept', created_at: '2026-01-01T00:00:00Z' },
          { id: 'note-2', body: 'dropped: no string created_at' },
        ]),
      );
    },
  });
  expect(calls.length).toEqual(1);
  const endpoint = new URL(calls[0].url);
  expect(`${endpoint.origin}${endpoint.pathname}`).toEqual(
    'https://project.supabase.co/rest/v1/notes',
  );
  expect(endpoint.searchParams.get('select')).toEqual('id,body,created_at');
  expect(endpoint.searchParams.get('user_id')).toEqual('eq.user-1');
  expect(endpoint.searchParams.get('order')).toEqual('created_at.desc,id.desc');
  expect(endpoint.searchParams.get('limit')).toEqual(String(MAX_LIVE_EVENTS));
  expect(calls[0].init?.cache).toEqual('no-store');
  const headers = calls[0].init?.headers as Record<string, string>;
  expect(headers.apikey).toEqual('anon-key');
  expect(headers.authorization).toEqual('Bearer token-1');
  expect(snapshot).toEqual([{ id: 'note-1', body: 'kept', createdAt: '2026-01-01T00:00:00Z' }]);
  expect({ refreshed, handedOff }).toEqual({ refreshed: 0, handedOff: 0 });
});

test('notes-live snapshot refreshes once on 401 and retries with the fresh token', async () => {
  const order: string[] = [];
  let refreshed = 0;
  const snapshot = await fetchNotesSnapshot({
    url: 'https://project.supabase.co',
    key: 'anon-key',
    userId: 'user-1',
    token: 'stale-token',
    refreshToken: () => {
      refreshed++;
      order.push('refresh');
      return Promise.resolve('fresh-token');
    },
    onRefreshed: (token) => {
      order.push(`setAuth:${token}`);
    },
    fetchImpl: (_input, init) => {
      const authorization = (init?.headers as Record<string, string>).authorization;
      order.push(`fetch:${authorization}`);
      return Promise.resolve(
        order.length === 1
          ? Response.json({ message: 'jwt expired' }, { status: 401 })
          : Response.json([{ id: 'n1', body: 'b', created_at: 'c' }]),
      );
    },
  });
  expect(order).toEqual([
    'fetch:Bearer stale-token',
    'refresh',
    'setAuth:fresh-token',
    'fetch:Bearer fresh-token',
  ]);
  expect(refreshed).toEqual(1);
  expect(snapshot).toEqual([{ id: 'n1', body: 'b', createdAt: 'c' }]);
});

test('notes-live snapshot fails closed when the 401 retry also fails', async () => {
  let fetches = 0;
  let refreshed = 0;
  const error = await assertRejectsIncludes(
    () =>
      fetchNotesSnapshot({
        url: 'https://project.supabase.co',
        key: 'anon-key',
        userId: 'user-1',
        token: 'stale-token',
        refreshToken: () => {
          refreshed++;
          return Promise.resolve('fresh-token');
        },
        onRefreshed: () => {},
        fetchImpl: () => {
          fetches++;
          return Promise.resolve(Response.json({ message: 'jwt expired' }, { status: 401 }));
        },
      }),
    Error,
  );
  expect(error.message).toEqual('Notes reconciliation failed with HTTP 401');
  expect({ fetches, refreshed }).toEqual({ fetches: 2, refreshed: 1 });
});

test('notes-live snapshot fails closed when the 401 refresh itself fails', async () => {
  const firstTry401 = () =>
    Promise.resolve(Response.json({ message: 'jwt expired' }, { status: 401 }));

  let rejectedFetches = 0;
  const rejected = await assertRejectsIncludes(
    () =>
      fetchNotesSnapshot({
        url: 'https://project.supabase.co',
        key: 'anon-key',
        userId: 'user-1',
        token: 'stale-token',
        refreshToken: () => Promise.reject(new Error('Session renewal failed (401)')),
        onRefreshed: () => {},
        fetchImpl: () => {
          rejectedFetches++;
          return firstTry401();
        },
      }),
    Error,
  );
  expect(rejected.message).toEqual('Session renewal failed (401)');
  expect(rejectedFetches).toEqual(1);

  let nullFetches = 0;
  let nullHandoff = 0;
  const nullRefresh = await assertRejectsIncludes(
    () =>
      fetchNotesSnapshot({
        url: 'https://project.supabase.co',
        key: 'anon-key',
        userId: 'user-1',
        token: 'stale-token',
        refreshToken: () => Promise.resolve(null),
        onRefreshed: () => {
          nullHandoff++;
        },
        fetchImpl: () => {
          nullFetches++;
          return firstTry401();
        },
      }),
    Error,
  );
  expect(nullRefresh.message).toEqual('Notes session renewal failed');
  expect({ nullFetches, nullHandoff }).toEqual({ nullFetches: 1, nullHandoff: 0 });
});

test('notes-live snapshot neither refreshes nor retries on non-401 failures', async () => {
  let fetches = 0;
  let refreshed = 0;
  const error = await assertRejectsIncludes(
    () =>
      fetchNotesSnapshot({
        url: 'https://project.supabase.co',
        key: 'anon-key',
        userId: 'user-1',
        token: 'token-1',
        refreshToken: () => {
          refreshed++;
          return Promise.resolve('fresh-token');
        },
        fetchImpl: () => {
          fetches++;
          return Promise.resolve(Response.json({ message: 'database error' }, { status: 500 }));
        },
      }),
    Error,
  );
  expect(error.message).toEqual('Notes reconciliation failed with HTTP 500');
  expect({ fetches, refreshed }).toEqual({ fetches: 1, refreshed: 0 });
});

test('notes-live snapshot rejects a non-array payload', async () => {
  await assertRejectsIncludes(
    () =>
      fetchNotesSnapshot({
        url: 'https://project.supabase.co',
        key: 'anon-key',
        userId: 'user-1',
        token: 'token-1',
        refreshToken: () => Promise.resolve(null),
        fetchImpl: () => Promise.resolve(Response.json({ not: 'an array' })),
      }),
    Error,
    'Notes reconciliation returned a non-array',
  );
});
