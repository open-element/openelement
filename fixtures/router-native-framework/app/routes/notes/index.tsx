/**
 * /notes — DYNAMIC list (renderIntent mode 'dynamic'): the loader lists all
 * notes from the module-level store on every request. Rows carry per-item
 * href slots (compiled each-Region iattr grammar, alpha.8) linking to the
 * detail pages; a note-counter island proves activation on dynamic pages.
 */
import { definePage, type PagePropsContext } from '@openelement/router';
import NotesPage from '../../components/page-notes-index.tsx';
import { exposeActionCount, noteStore } from '../../store.ts';

interface NotesData {
  rows: Array<{ id: string; title: string; href: string }>;
  count: number;
}

export function loader(ctx: { responseHeaders: Headers }): NotesData {
  exposeActionCount(ctx.responseHeaders);
  const notes = noteStore.list();
  return {
    rows: notes.map((note) => ({
      id: note.id,
      title: note.title,
      href: `/notes/${note.id}`,
    })),
    count: notes.length,
  };
}

export default definePage<NotesData>(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — notes' },
  props({ data }: PagePropsContext<NotesData>) {
    return {
      rows: data?.rows ?? [],
      countText: `note-count=${data?.count ?? 0}`,
      intentText: `intent=${noteStore.lastIntent()}`,
    };
  },
});
