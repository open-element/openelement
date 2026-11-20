/**
 * /notes page element (v0.44 compiled). Request-time rendered; the props
 * projector lives in app/route-logic/notes.ts. Anonymous requests redirect to
 * /login from the loader, so this page always renders the authenticated
 * variant.
 *
 * The create form opts into data-open-enhance, so duplicate submission
 * behavior is explicit: the enhancement layer ignores a second submit of the
 * same form while one is in flight (#564), turning a double-click into
 * exactly one INSERT. Without JavaScript the form degrades to a native POST
 * whose PRG redirect guards refresh resubmission only — rapid native retries
 * create one row each (the create path is not idempotent).
 *
 * The notes-live island host carries its realtime wiring as compiled
 * island properties (identifier-named host prop Parts — grammar v1 admits no
 * dashed dynamic host attributes); the island's attribute-backed @property
 * fields receive them through the SSR expansion and the client claim.
 */
import { defineIslandConfig, definePage } from '@openelement/router';
import {
  createNoteAction,
  createNotesLoader,
  logoutAction,
  notesPageProps,
} from '../route-logic/notes.ts';

export const loader = createNotesLoader();

export const actions = {
  create: createNoteAction(),
  logout: logoutAction,
};

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself.
 *
 * Generated-element lane (2026-11-20 migration): the class this module used to
 * import is a function component with a sidecar. The `notes-live` island host in
 * its markup is a DASH tag, so the SSR producer routes it through the render's
 * nested-host expander — it expands to DSD exactly as it did under the class
 * lane, and an un-admitted tag would keep its literal bytes.
 */
export const openElement = defineIslandConfig({
  tag: 'notes-page',
  root: 'shadow',
  properties: {
    whoText: { attribute: false, default: '' },
    errorText: { attribute: false, default: '' },
    actionErrorText: { attribute: false, default: '' },
    titleEcho: { attribute: false, default: '' },
    bodyEcho: { attribute: false, default: '' },
    noteRows: { attribute: false, default: [] },
    nextCursor: { attribute: false, default: '' },
    liveUrl: { attribute: false, default: '' },
    liveAnonKey: { attribute: false, default: '' },
    liveUserId: { attribute: false, default: '' },
    liveAccessToken: { attribute: false, default: '' },
    liveAccessTokenExpiresAt: { attribute: false, default: '' },
  },
});

export function NotesPage(props: {
  whoText: string;
  errorText: string;
  actionErrorText: string;
  titleEcho: string;
  bodyEcho: string;
  noteRows: Array<{ id: string; line: string }>;
  nextCursor: string;
  liveUrl: string;
  liveAnonKey: string;
  liveUserId: string;
  liveAccessToken: string;
  liveAccessTokenExpiresAt: string;
}) {
  return (
    <main>
      <h1>Notes</h1>
      <p id='who'>{props.whoText}</p>
      <p id='error'>{props.errorText}</p>
      <p id='action-error'>{props.actionErrorText}</p>
      <form method='post' action='/notes?/create' data-open-enhance>
        <p>
          <label>
            Title <input name='title' maxlength={120} value={props.titleEcho} required />
          </label>
        </p>
        <p>
          <label>
            Body{' '}
            <textarea name='body' maxlength={10000}>
              {props.bodyEcho}
            </textarea>
          </label>
        </p>
        <button type='submit'>Create note</button>
      </form>
      <ul id='notes'>
        {props.noteRows.map((note) => (
          <li key={note.id}>{note.line}</li>
        ))}
      </ul>
      <form method='get' action='/notes'>
        <input type='hidden' name='cursor' value={props.nextCursor} />
        <button id='next-notes-page' type='submit'>
          {'Next page'}
        </button>
      </form>
      <notes-live
        liveurl={props.liveUrl}
        livekey={props.liveAnonKey}
        liveuserid={props.liveUserId}
        livetoken={props.liveAccessToken}
        livetokenexpiresat={props.liveAccessTokenExpiresAt}
      ></notes-live>
      <form method='post' action='/notes?/logout'>
        <button type='submit'>Sign out</button>
      </form>
      <p>
        <a href='/upload'>Upload a file</a>
      </p>
    </main>
  );
}

export default definePage(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Notes — reference starter' },
  props: notesPageProps,
});
