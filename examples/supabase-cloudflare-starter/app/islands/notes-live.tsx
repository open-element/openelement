/**
 * notes-live — Realtime island (reference starter, #983), v0.44 compiled.
 *
 * Subscribes to INSERT events on public.notes via @supabase/realtime-js in
 * the browser. The page feeds it the project's public URL + anon key, the
 * signed-in user's id, and their short-lived access token through data
 * attributes from the loader (the anon key is public by design; the access
 * token scopes the realtime connection through RLS so the island only ever
 * receives rows the owner could SELECT — reinforced by the hard
 * user_id=eq.<uid> filter). No service-role key ever reaches this bundle.
 *
 * The compiled class holds only the rendered state (status + events as
 * @property fields); the connection state machine lives in
 * app/components/notes-live-shared.ts (a WeakMap keyed by this host — the
 * compiler grammar v1 admits no undecorated instance fields). The Deno tests
 * import the shared module directly; the island module is never imported
 * outside the adapter transform.
 *
 * connectedCallback subscribes; disconnectedCallback unsubscribes and
 * removes the channel — SSR never runs lifecycle callbacks (the serializer
 * emits the compiled program's initial DOM), so all browser work stays in
 * connectedCallback.
 */
import { defineIslandConfig } from '@openelement/app';
import { element, OpenElement, property } from '@openelement/element';
import {
  connectNotesLive,
  disconnectNotesLive,
  reconnectNotesLiveNow,
} from '../components/notes-live-shared.ts';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
});

@element('notes-live', { root: 'shadow-open' })
export default class NotesLive extends OpenElement {
  @property({ reflect: false, attribute: false })
  status = 'idle';

  @property({ reflect: false, attribute: false })
  events: Array<{ id: string; body: string }> = [];

  /**
   * Realtime wiring arrives as attribute-backed compiled properties (the
   * identifier-named host attributes the notes page emits). The SSR expansion
   * fails closed on host attributes that are not compiled properties, so the
   * one-shot credential handoff must be declared here. `livetoken` is erased
   * from the DOM the moment it is handed to Realtime (#1130).
   */
  @property({ reflect: false })
  liveurl = '';

  @property({ reflect: false })
  livekey = '';

  @property({ reflect: false })
  liveuserid = '';

  @property({ reflect: false })
  livetoken = '';

  @property({ reflect: false })
  livetokenexpiresat = '';

  override connectedCallback(): void {
    super.connectedCallback();
    connectNotesLive(this);
  }

  override disconnectedCallback(): void {
    disconnectNotesLive(this);
    super.disconnectedCallback();
  }

  /** Reconnect button handler (compiled event Part target). */
  reconnectNow(): void {
    reconnectNotesLiveNow(this);
  }

  render() {
    return (
      <section id='notes-live'>
        <h2>Live updates</h2>
        <p id='live-status'>realtime: {this.status}</p>
        <ul id='live-events'>
          {this.events.map((event) => <li key={event.id}>{event.body}</li>)}
        </ul>
        <button type='button' onClick={this.reconnectNow}>Reconnect</button>
      </section>
    );
  }
}
