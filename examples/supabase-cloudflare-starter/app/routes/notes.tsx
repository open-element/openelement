/**
 * /notes — RLS-protected resource (reference starter, #983). Thin wrapper:
 * the compiled page element lives in app/components/page-notes.tsx, the
 * loader/action logic in app/route-logic/notes.ts. The notes-live island is
 * registered by the generated entries (no side-effect import here).
 */
import { definePage } from '@openelement/app';
import NotesPage from '../components/page-notes.tsx';
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

export default definePage(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Notes — reference starter' },
  props: notesPageProps,
});
