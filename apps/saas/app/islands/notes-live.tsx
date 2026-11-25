/**
 * notes-live — Realtime island (reference starter, #983).
 *
 * Subscribes to INSERT events on public.notes. The loader supplies the
 * project's public URL and anon key, user ID, and short-lived access token.
 * Realtime uses that token for RLS and filters the subscription by user ID.
 */
import { onConnect } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';

import {
  connectNotesLive,
  disconnectNotesLive,
  reconnectNotesLiveNow,
  type NotesLiveHost,
} from '../components/notes-live-shared.ts';

export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'load',
  ssr: true,
  dsd: true,
  properties: {
    status: { default: 'idle' },
    // Preserve server-rendered rows through claim via the JSON seed.
    events: { attribute: false, default: [] },
    // One-shot credential handoff (the identifier-named host attributes the
    // notes page emits). `livetoken` is erased from the DOM the moment it is
    // handed to Realtime (#1130).
    liveurl: { default: '' },
    livekey: { default: '' },
    liveuserid: { default: '' },
    livetoken: { default: '' },
    livetokenexpiresat: { default: '' },
  },
});

/** Realtime status + the live event list, with a reconnect control. */
function NotesLive(props: {
  status: string;
  events: Array<{ id: string; body: string }>;
  liveurl: string;
  livekey: string;
  liveuserid: string;
  livetoken: string;
  livetokenexpiresat: string;
}) {
  onConnect((env) => {
    const host = env.host as NotesLiveHost;
    // Claim the SSR status and event list before the connection changes them.
    globalThis.queueMicrotask(() => {
      if (!env.signal.aborted) connectNotesLive(host);
    });
    env.signal.addEventListener('abort', () => disconnectNotesLive(host), { once: true });
  });

  return (
    <section id='notes-live'>
      <h2>Live updates</h2>
      <p id='live-status'>realtime: {props.status}</p>
      <ul id='live-events'>
        {props.events.map((event) => (
          <li key={event.id}>{event.body}</li>
        ))}
      </ul>
      <button
        type='button'
        onClick={(event: Event) => {
          const host = (event.currentTarget as HTMLElement).getRootNode() as ShadowRoot;
          reconnectNotesLiveNow(host.host as NotesLiveHost);
        }}
      >
        {'Reconnect'}
      </button>
    </section>
  );
}

export default NotesLive;
