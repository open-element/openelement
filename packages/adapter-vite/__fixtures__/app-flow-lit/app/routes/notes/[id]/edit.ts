/**
 * /notes/:id/edit — pre-filled edit form; success updates the store and PRGs
 * back to the detail page.
 */
import { defineLitPage } from '@openelement/app/lit';
import { notFound, type PagePropsContext, redirect } from '@openelement/app';
import { NoteEditPage } from '../../../components/note-edit-page.ts';
import { type Note, notesStore, recordActionInvocation } from '../../../store.ts';

interface EditData {
  note: Note;
}

export function loader(ctx: { params: Record<string, string> }): EditData {
  const note = notesStore.get(ctx.params.id ?? '');
  if (!note) notFound(`no note with id ${ctx.params.id ?? ''}`);
  return { note };
}

export function action(ctx: {
  params: Record<string, string>;
  formData: FormData;
}): void {
  recordActionInvocation();
  const title = String(ctx.formData.get('title') ?? '').trim();
  const body = String(ctx.formData.get('body') ?? '').trim();
  const note = notesStore.update(ctx.params.id ?? '', { title, body });
  if (!note) notFound(`no note with id ${ctx.params.id ?? ''}`);
  throw redirect(`/notes/${note.id}`);
}

export default defineLitPage<EditData>('note-edit-page', NoteEditPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-lit — edit note' },
  props(context: PagePropsContext<EditData>) {
    return {
      noteId: context.data?.note.id ?? '',
      noteTitle: context.data?.note.title ?? '',
      noteBody: context.data?.note.body ?? '',
    };
  },
});
