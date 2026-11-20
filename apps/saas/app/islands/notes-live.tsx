/**
 * notes-live — Realtime island (reference starter, #983).
 *
 * Subscribes to INSERT events on public.notes via @supabase/realtime-js in the
 * browser. The page feeds it the project's public URL + anon key, the
 * signed-in user's id, and their short-lived access token through host
 * attributes from the loader (the anon key is public by design; the access
 * token scopes the realtime connection through RLS so the island only ever
 * receives rows the owner could SELECT — reinforced by the hard
 * user_id=eq.<uid> filter). No service-role key ever reaches this bundle.
 *
 * Generated authoring (alpha16): the component is a function whose compiled
 * sinks render `status` and `events`; the connection state machine stays in
 * `app/components/notes-live-shared.ts` (a WeakMap keyed by the host) because it
 * owns timers, a socket and a channel — none of which belong to a render pass.
 *
 * `connectNotesLive(host)` receives the HOST element, and every field it reads
 * or writes is that element's own property (`status`, `events`, the five
 * `live*` wiring rows), so no component-private channel is needed: the compiled
 * class's property setters are the same surface the class lane exposed.
 */
import { onConnect, onDispose } from '@openelement/element';
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
    // The rendered list. `attribute: false` puts it on the JSON seed channel
    // (ADR-0182 D-18c), so the server-rendered rows survive the claim instead
    // of the instance reverting to an empty array.
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
    // The shared state machine owns its own listeners and timers; teardown is
    // the element-lifetime signal, so a disconnect cleans up exactly once.
    connectNotesLive(env.host as NotesLiveHost);
  });
  onDispose((env) => {
    disconnectNotesLive(env.host as NotesLiveHost);
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
          // The button lives inside the shadow tree; the host is the root node.
          // The class lane's `reconnectNow` was a compiled event target; the
          // function lane calls the same shared helper directly.
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
