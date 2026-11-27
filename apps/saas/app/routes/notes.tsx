/** Authenticated Notes page with enhanced creation and a Realtime subscription. */
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
    noNextPage: { attribute: false, default: true },
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
  noNextPage: boolean;
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
      <form method='get' action='/notes' hidden={props.noNextPage}>
        <input type='hidden' name='cursor' value={props.nextCursor} />
        <button id='next-notes-page' type='submit' disabled={props.noNextPage}>
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
        <a href='/upload'>Upload a file</a> · <a href='/workspaces'>Workspaces</a>
      </p>
    </main>
  );
}

export default definePage(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Notes — reference starter' },
  props: notesPageProps,
});
