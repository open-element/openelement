/**
 * notes-live shared logic (v0.44) — Realtime subscription state machine for
 * the notes-live island, plus the pure helpers the Deno tests pin.
 *
 * Compiled classes cannot hold undecorated fields (the compiler grammar v1
 * admits @property fields and methods only), so the per-instance connection
 * state lives here in a WeakMap keyed by the host — the same pattern as the
 * adapter's zag-combobox fixture (components/zag-combobox-shared.ts).
 *
 * The island receives its realtime wiring as attribute-backed compiled
 * properties (identifier-named host attributes; grammar v1 admits no dashed
 * dynamic host attributes); the only other compiled properties are the
 * rendered ones (status + events).
 */
import { type RealtimeChannel, RealtimeClient } from '@supabase/realtime-js';

export const MAX_LIVE_EVENTS = 100;
export const MAX_RECONNECT_DELAY_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 10_000;
export interface NotesAccessToken {
  accessToken: string;
  expiresAt: number | null;
}

export interface LiveNoteEvent {
  id: string;
  body: string;
  createdAt?: string;
}

/** Stable-id dedupe with an explicit DOM/memory bound. */
export function mergeLiveEvent(
  events: readonly LiveNoteEvent[],
  incoming: LiveNoteEvent,
  maximum = MAX_LIVE_EVENTS,
): LiveNoteEvent[] {
  if (events.some((event) => event.id === incoming.id)) return [...events];
  return [incoming, ...events].slice(0, Math.max(0, maximum));
}

/** Merge a newest-first Data API snapshot with possibly incomplete live events. */
export function mergeReconciledEvents(
  events: readonly LiveNoteEvent[],
  snapshot: readonly LiveNoteEvent[],
  maximum = MAX_LIVE_EVENTS,
): LiveNoteEvent[] {
  const existing = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const merged: LiveNoteEvent[] = [];
  for (const event of [...snapshot, ...events]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(existing.get(event.id) ?? event);
  }
  merged.sort((left, right) => {
    if (!left.createdAt || !right.createdAt) return 0;
    return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
  });
  return merged.slice(0, Math.max(0, maximum));
}

/** Capped exponential retry with full jitter; random is injectable for tests. */
export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const cap = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** Math.max(0, attempt));
  return Math.floor(random() * cap);
}

export function shouldRefreshAccessToken(
  expiresAtSeconds: number | null,
  nowMs = Date.now(),
): boolean {
  return (expiresAtSeconds ?? 0) * 1_000 <= nowMs + 60_000;
}

export async function requestNotesAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<NotesAccessToken> {
  const response = await fetchImpl('/api/session-token', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Session renewal failed (${response.status})`);
  return response.json() as Promise<NotesAccessToken>;
}

/**
 * Fetch the newest-first notes snapshot through the RLS Data API with a
 * bounded retry: one 401 forces a session refresh, the fresh token is handed
 * back through onRefreshed (Realtime setAuth), and the request is retried
 * exactly once. A failed refresh, a failed retry — including another 401 —
 * or any other non-2xx response throws, so the caller fails closed into its
 * degraded path instead of looping. fetchImpl is injectable for tests.
 */
export async function fetchNotesSnapshot(options: {
  url: string;
  key: string;
  userId: string;
  token: string;
  refreshToken: () => Promise<string | null>;
  onRefreshed?: (token: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<LiveNoteEvent[]> {
  const { url, key, userId, refreshToken, onRefreshed } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(`${url.replace(/\/$/, '')}/rest/v1/notes`);
  endpoint.searchParams.set('select', 'id,body,created_at');
  endpoint.searchParams.set('user_id', `eq.${userId}`);
  endpoint.searchParams.set('order', 'created_at.desc,id.desc');
  endpoint.searchParams.set('limit', String(MAX_LIVE_EVENTS));
  const reconcile = (token: string) =>
    fetchImpl(endpoint, {
      cache: 'no-store',
      headers: { apikey: key, authorization: `Bearer ${token}` },
    });
  let response = await reconcile(options.token);
  if (response.status === 401) {
    const fresh = await refreshToken();
    if (!fresh) throw new Error('Notes session renewal failed');
    await onRefreshed?.(fresh);
    response = await reconcile(fresh);
  }
  if (!response.ok) throw new Error(`Notes reconciliation failed with HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error('Notes reconciliation returned a non-array');
  const snapshot: LiveNoteEvent[] = [];
  for (const row of payload) {
    if (
      typeof row === 'object' && row !== null &&
      typeof (row as { id?: unknown }).id === 'string' &&
      typeof (row as { body?: unknown }).body === 'string' &&
      typeof (row as { created_at?: unknown }).created_at === 'string'
    ) {
      snapshot.push({
        id: (row as { id: string }).id,
        body: (row as { body: string }).body,
        createdAt: (row as { created_at: string }).created_at,
      });
    }
  }
  return snapshot;
}

/** Prefer a fresh DOM handoff, then reuse private memory for later reconnects. */
export function resolveRealtimeAuthToken(
  attributeToken: string | null,
  retainedToken: string | null,
): string | null {
  return attributeToken || retainedToken;
}

/**
 * Move the short-lived SSR credential into Realtime and erase the DOM copy.
 * A token observed before the client exists must stay in place so the connect
 * path can consume it later; removal is proof that setAuth was actually
 * invoked.
 */
export function handoffRealtimeAuth(
  client: Pick<RealtimeClient, 'setAuth'> | null,
  host: Pick<Element, 'removeAttribute'>,
  accessToken: string | null,
): boolean {
  if (!client || !accessToken) return false;
  client.setAuth(accessToken);
  host.removeAttribute('livetoken');
  return true;
}

/** The island host's compiled-property surface, consumed by the state machine. */
export interface NotesLiveHost extends HTMLElement {
  status: string;
  events: LiveNoteEvent[];
  /** Attribute-backed realtime wiring (set from the host's SSR attributes). */
  liveurl: string;
  livekey: string;
  liveuserid: string;
  livetoken: string;
  livetokenexpiresat: string;
}

/** Per-instance connection state (WeakMap: compiled classes hold no fields). */
interface NotesLiveState {
  client: RealtimeClient | null;
  channel: RealtimeChannel | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  accessTokenRefresh: Promise<string | null> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  reconnectAttempt: number;
  reconcileAttempt: number;
  connectionGeneration: number;
  onOnline: () => void;
  onOffline: () => void;
}

const states = new WeakMap<NotesLiveHost, NotesLiveState>();

function stateFor(host: NotesLiveHost): NotesLiveState {
  let state = states.get(host);
  if (!state) {
    state = {
      client: null,
      channel: null,
      accessToken: null,
      accessTokenExpiresAt: null,
      accessTokenRefresh: null,
      reconnectTimer: undefined,
      reconcileTimer: undefined,
      reconnectAttempt: 0,
      reconcileAttempt: 0,
      connectionGeneration: 0,
      onOnline: () => {
        host.status = 'connecting';
        reconnectNotesLiveNow(host);
      },
      onOffline: () => {
        clearReconcileTimer(state!);
        host.status = 'offline';
      },
    };
    states.set(host, state);
  }
  return state;
}

function clearReconcileTimer(state: NotesLiveState): void {
  if (state.reconcileTimer !== undefined) clearTimeout(state.reconcileTimer);
  state.reconcileTimer = undefined;
}

function scheduleReconcile(
  host: NotesLiveHost,
  state: NotesLiveState,
  generation: number,
  delay: number,
): void {
  if (state.reconcileTimer !== undefined || !host.isConnected) return;
  state.reconcileTimer = setTimeout(() => {
    state.reconcileTimer = undefined;
    void reconcile(host, state, generation);
  }, delay);
}

function validAccessToken(
  host: NotesLiveHost,
  state: NotesLiveState,
  force = false,
): Promise<string | null> {
  if (
    !force && state.accessToken &&
    !shouldRefreshAccessToken(state.accessTokenExpiresAt)
  ) return Promise.resolve(state.accessToken);
  if (state.accessTokenRefresh) return state.accessTokenRefresh;
  state.accessTokenRefresh = requestNotesAccessToken()
    .then((fresh) => {
      if (!host.isConnected) return null;
      state.accessToken = fresh.accessToken;
      state.accessTokenExpiresAt = fresh.expiresAt;
      return fresh.accessToken;
    })
    .finally(() => {
      state.accessTokenRefresh = null;
    });
  return state.accessTokenRefresh;
}

async function reconcile(
  host: NotesLiveHost,
  state: NotesLiveState,
  generation: number,
): Promise<void> {
  clearReconcileTimer(state);
  const url = host.liveurl;
  const key = host.livekey;
  const userId = host.liveuserid;
  const accessToken = await validAccessToken(host, state);
  if (!url || !key || !userId || !accessToken) {
    host.status = 'degraded';
    return;
  }

  host.status = 'recovering';
  try {
    const snapshot = await fetchNotesSnapshot({
      url,
      key,
      userId,
      token: accessToken,
      refreshToken: () => validAccessToken(host, state, true),
      onRefreshed: (fresh) => state.client?.setAuth(fresh),
    });
    if (!host.isConnected || generation !== state.connectionGeneration) return;
    host.events = mergeReconciledEvents(host.events, snapshot);
    state.reconcileAttempt = 0;
    host.status = 'subscribed';
    scheduleReconcile(host, state, generation, RECONCILE_INTERVAL_MS);
  } catch {
    if (!host.isConnected || generation !== state.connectionGeneration) return;
    if (globalThis.navigator?.onLine === false) {
      host.status = 'offline';
      return;
    }
    host.status = 'degraded';
    scheduleReconcile(host, state, generation, reconnectDelayMs(state.reconcileAttempt++));
  }
}

/** connectedCallback seam: subscribe to INSERT events on public.notes. */
export function connectNotesLive(host: NotesLiveHost): void {
  const state = stateFor(host);
  globalThis.addEventListener?.('online', state.onOnline);
  globalThis.addEventListener?.('offline', state.onOffline);
  if (!host.isConnected || state.channel) return;
  const url = host.liveurl;
  const key = host.livekey;
  const userId = host.liveuserid;
  state.accessToken = resolveRealtimeAuthToken(host.livetoken || null, state.accessToken);
  state.accessTokenExpiresAt = Number(host.livetokenexpiresat) || null;
  if (!url || !key || !userId) {
    host.status = 'unconfigured';
    return;
  }
  host.status = 'connecting';
  // This island only needs Realtime. Importing createClient from
  // supabase-js also bundles Auth, PostgREST, Storage, and Functions into
  // the browser chunk, duplicating server-only capabilities. Connect to
  // the same Realtime endpoint directly and keep the island single-purpose.
  const client = new RealtimeClient(`${url.replace(/\/$/, '')}/realtime/v1`, {
    params: { apikey: key },
    accessToken: () => validAccessToken(host, state),
  });
  // Hosted Realtime scopes postgres_changes by RLS: without the user's
  // short-lived access token the connection is `anon`, which has no
  // SELECT policy on notes and would receive nothing. setAuth upgrades
  // the realtime connection only — no session is persisted client-side.
  // The SSR attribute is a one-shot handoff, not durable DOM state. The
  // token remains inside the Realtime client after setAuth and is removed
  // from the browser-readable element immediately (#1130).
  // The DOM copy is one-shot, but reconnects still need the user JWT. Keep
  // it only in this element's private memory and wipe it on disconnect.
  handoffRealtimeAuth(client, host, state.accessToken);
  state.client = client;
  const generation = ++state.connectionGeneration;
  state.channel = client
    .channel('notes-live')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notes',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (!host.isConnected || generation !== state.connectionGeneration) return;
        const row = payload.new as { id?: string; body?: string; created_at?: string };
        if (typeof row.id === 'string' && typeof row.body === 'string') {
          host.events = mergeLiveEvent(host.events, {
            id: row.id,
            body: row.body,
            createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
          });
        }
      },
    )
    .subscribe((status) => {
      if (!host.isConnected || generation !== state.connectionGeneration) return;
      if (status === 'SUBSCRIBED') {
        state.reconnectAttempt = 0;
        host.status = 'recovering';
        void reconcile(host, state, generation);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        host.status = 'degraded';
        clearReconcileTimer(state);
        scheduleReconnect(host, state);
        return;
      }
    });
}

function scheduleReconnect(host: NotesLiveHost, state: NotesLiveState): void {
  if (state.reconnectTimer !== undefined || !host.isConnected) return;
  const delay = reconnectDelayMs(state.reconnectAttempt++);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void releaseChannel(state).then(
      () => connectNotesLive(host),
      () => connectNotesLive(host),
    );
  }, delay);
}

function releaseChannel(state: NotesLiveState): Promise<unknown> {
  state.connectionGeneration++;
  clearReconcileTimer(state);
  const channel = state.channel;
  const client = state.client;
  state.channel = null;
  state.client = null;
  if (!channel) return Promise.resolve();
  return client ? client.removeChannel(channel) : channel.unsubscribe();
}

/** The Reconnect button's handler (compiled event Part target). */
export function reconnectNotesLiveNow(host: NotesLiveHost): void {
  const state = stateFor(host);
  if (state.reconnectTimer !== undefined) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = undefined;
  state.reconnectAttempt = 0;
  void releaseChannel(state).then(
    () => connectNotesLive(host),
    () => connectNotesLive(host),
  );
}

/** disconnectedCallback seam: unsubscribe and wipe retained credentials. */
export function disconnectNotesLive(host: NotesLiveHost): void {
  const state = stateFor(host);
  globalThis.removeEventListener?.('online', state.onOnline);
  globalThis.removeEventListener?.('offline', state.onOffline);
  if (state.reconnectTimer !== undefined) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = undefined;
  clearReconcileTimer(state);
  void releaseChannel(state).catch(() => undefined);
  state.accessToken = null;
  state.accessTokenExpiresAt = null;
  states.delete(host);
}
