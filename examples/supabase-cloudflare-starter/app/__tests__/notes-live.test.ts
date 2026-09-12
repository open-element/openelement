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
import { assert, assertEquals, assertRejects } from '@std/assert';
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

Deno.test('notes-live SSR render includes the status and event mount points', async () => {
  const NotesLive = await compileComponentClass('../islands/notes-live.tsx');
  const out = renderDsd('notes-live', { componentClass: NotesLive });
  assertEquals(out.errors, []);
  assert(out.html.includes("id='live-status'") || out.html.includes('id="live-status"'), out.html);
  assert(out.html.includes('realtime:'), out.html);
  assert(out.html.includes('live-events'), out.html);
  assert(out.html.includes('Reconnect'), out.html);
});

Deno.test('notes-live deduplicates INSERT delivery by stable row id', () => {
  const first = mergeLiveEvent([], { id: 'note-1', body: 'first' });
  assertEquals(mergeLiveEvent(first, { id: 'note-1', body: 'duplicate payload' }), first);
  assertEquals(
    mergeLiveEvent(first, { id: 'note-2', body: 'same display body is allowed' }).length,
    2,
  );
});

Deno.test('notes-live retention is explicitly bounded', () => {
  let events: { id: string; body: string }[] = [];
  for (let index = 0; index < MAX_LIVE_EVENTS + 20; index++) {
    events = mergeLiveEvent(events, { id: String(index), body: String(index) });
  }
  assertEquals(events.length, MAX_LIVE_EVENTS);
  assertEquals(events[0].id, String(MAX_LIVE_EVENTS + 19));
});

Deno.test('notes-live reconciliation repairs dropped events without duplicates', () => {
  const live = [
    { id: 'note-3', body: 'delivered live' },
    { id: 'note-1', body: 'older live' },
  ];
  const newestFirstSnapshot = [
    { id: 'note-4', body: 'missed during reconnect' },
    { id: 'note-3', body: 'same durable row' },
    { id: 'note-2', body: 'missed before subscribe' },
  ];
  assertEquals(mergeReconciledEvents(live, newestFirstSnapshot), [
    { id: 'note-4', body: 'missed during reconnect' },
    { id: 'note-3', body: 'delivered live' },
    { id: 'note-2', body: 'missed before subscribe' },
    { id: 'note-1', body: 'older live' },
  ]);
});

Deno.test('notes-live reconnect delay is exponential, jittered and capped', () => {
  assertEquals(reconnectDelayMs(0, () => 0.5), 500);
  assertEquals(reconnectDelayMs(3, () => 0.5), 4_000);
  assertEquals(reconnectDelayMs(99, () => 1), MAX_RECONNECT_DELAY_MS);
});

Deno.test('notes-live erases the SSR token only after handing it to Realtime', () => {
  const calls: string[] = [];
  const removed: string[] = [];
  const client = {
    setAuth: (token: string) => {
      calls.push(token);
      return Promise.resolve();
    },
  };
  const host = { removeAttribute: (name: string) => removed.push(name) };

  assertEquals(handoffRealtimeAuth(client, host, 'signed-user-jwt'), true);
  assertEquals(calls, ['signed-user-jwt']);
  assertEquals(removed, ['livetoken']);

  assertEquals(handoffRealtimeAuth(null, host, 'not-yet-consumed'), false);
  assertEquals(removed, ['livetoken']);
});

Deno.test('notes-live retains the user JWT for clients created after reconnect', () => {
  assertEquals(resolveRealtimeAuthToken('fresh-jwt', null), 'fresh-jwt');
  assertEquals(resolveRealtimeAuthToken(null, 'private-memory-jwt'), 'private-memory-jwt');
  assertEquals(resolveRealtimeAuthToken(null, null), null);
});

Deno.test('notes-live refreshes only expired or near-expiry access tokens', () => {
  const now = 1_700_000_000_000;
  assertEquals(shouldRefreshAccessToken(null, now), true);
  assertEquals(shouldRefreshAccessToken(now / 1_000 + 30, now), true);
  assertEquals(shouldRefreshAccessToken(now / 1_000 + 120, now), false);
});

Deno.test('notes-live renews through the same-origin cookie endpoint', async () => {
  let input: string | URL | Request = '';
  let init: RequestInit | undefined;
  const fresh = await requestNotesAccessToken((candidate, options) => {
    input = candidate;
    init = options;
    return Promise.resolve(Response.json({ accessToken: 'fresh-jwt', expiresAt: 2_000_000_000 }));
  });
  assertEquals(input, '/api/session-token');
  assertEquals(init?.method, 'POST');
  assertEquals(init?.credentials, 'same-origin');
  assertEquals(init?.cache, 'no-store');
  assertEquals(fresh, { accessToken: 'fresh-jwt', expiresAt: 2_000_000_000 });
  await assertRejects(() =>
    requestNotesAccessToken(() =>
      Promise.resolve(Response.json({ accessToken: 'fresh-jwt' }, { status: 401 }))
    )
  );
});

Deno.test('notes-live snapshot sends the bounded RLS query and skips refresh on 200', async () => {
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
      return Promise.resolve(Response.json([
        { id: 'note-1', body: 'kept', created_at: '2026-01-01T00:00:00Z' },
        { id: 'note-2', body: 'dropped: no string created_at' },
      ]));
    },
  });
  assertEquals(calls.length, 1);
  const endpoint = new URL(calls[0].url);
  assertEquals(
    `${endpoint.origin}${endpoint.pathname}`,
    'https://project.supabase.co/rest/v1/notes',
  );
  assertEquals(endpoint.searchParams.get('select'), 'id,body,created_at');
  assertEquals(endpoint.searchParams.get('user_id'), 'eq.user-1');
  assertEquals(endpoint.searchParams.get('order'), 'created_at.desc,id.desc');
  assertEquals(endpoint.searchParams.get('limit'), String(MAX_LIVE_EVENTS));
  assertEquals(calls[0].init?.cache, 'no-store');
  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers.apikey, 'anon-key');
  assertEquals(headers.authorization, 'Bearer token-1');
  assertEquals(snapshot, [{ id: 'note-1', body: 'kept', createdAt: '2026-01-01T00:00:00Z' }]);
  assertEquals({ refreshed, handedOff }, { refreshed: 0, handedOff: 0 });
});

Deno.test('notes-live snapshot refreshes once on 401 and retries with the fresh token', async () => {
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
  assertEquals(order, [
    'fetch:Bearer stale-token',
    'refresh',
    'setAuth:fresh-token',
    'fetch:Bearer fresh-token',
  ]);
  assertEquals(refreshed, 1);
  assertEquals(snapshot, [{ id: 'n1', body: 'b', createdAt: 'c' }]);
});

Deno.test('notes-live snapshot fails closed when the 401 retry also fails', async () => {
  let fetches = 0;
  let refreshed = 0;
  const error = await assertRejects(() =>
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
    }), Error);
  assertEquals(error.message, 'Notes reconciliation failed with HTTP 401');
  assertEquals({ fetches, refreshed }, { fetches: 2, refreshed: 1 });
});

Deno.test('notes-live snapshot fails closed when the 401 refresh itself fails', async () => {
  const firstTry401 = () =>
    Promise.resolve(Response.json({ message: 'jwt expired' }, { status: 401 }));

  let rejectedFetches = 0;
  const rejected = await assertRejects(() =>
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
    }), Error);
  assertEquals(rejected.message, 'Session renewal failed (401)');
  assertEquals(rejectedFetches, 1);

  let nullFetches = 0;
  let nullHandoff = 0;
  const nullRefresh = await assertRejects(() =>
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
    }), Error);
  assertEquals(nullRefresh.message, 'Notes session renewal failed');
  assertEquals({ nullFetches, nullHandoff }, { nullFetches: 1, nullHandoff: 0 });
});

Deno.test('notes-live snapshot neither refreshes nor retries on non-401 failures', async () => {
  let fetches = 0;
  let refreshed = 0;
  const error = await assertRejects(() =>
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
    }), Error);
  assertEquals(error.message, 'Notes reconciliation failed with HTTP 500');
  assertEquals({ fetches, refreshed }, { fetches: 1, refreshed: 0 });
});

Deno.test('notes-live snapshot rejects a non-array payload', async () => {
  await assertRejects(
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
