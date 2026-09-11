/**
 * /notes — dynamic list route: loader runs per request and exposes the
 * action-invocation counter through the ADR-0129 x-action-count channel.
 */
import { defineLitPage } from '@openelement/router/lit';
import { NotesListPage } from '../components/notes-list-page.ts';
import { exposeActionCount, type Note, notesStore } from '../store.ts';

interface NotesData {
  notes: Note[];
}

export function loader(ctx: { responseHeaders: Headers }): NotesData {
  exposeActionCount(ctx.responseHeaders);
  return { notes: notesStore.list() };
}

export default defineLitPage<NotesData>('notes-list-page', NotesListPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-lit — notes' },
  props({ data }) {
    const notes = data?.notes ?? [];
    return { notes, countText: `note-count=${notes.length}` };
  },
});
