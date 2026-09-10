/**
 * /notes/:id/edit — DYNAMIC edit form pre-filled from the store via the
 * loader. POST validates like create, updates the store, and PRG-redirects
 * back to the detail page (?updated=1 flash). Unknown ids throw notFound().
 */
import {
  definePage,
  fail,
  notFound,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import NoteEditPage from '../../../components/page-note-edit.tsx';
import { exposeActionCount, type Note, noteStore } from '../../../store.ts';
import { MIN_TITLE_LENGTH } from '../new.tsx';

interface EditData {
  note: Note;
}

interface EditActionData {
  error?: string;
  title?: string;
}

export function loader(ctx: {
  params: Record<string, string>;
  responseHeaders: Headers;
}): EditData {
  exposeActionCount(ctx.responseHeaders);
  const note = noteStore.get(ctx.params.id ?? '');
  if (!note) notFound(`note not found: ${ctx.params.id ?? ''}`);
  return { note };
}

export function action(ctx: {
  params: Record<string, string>;
  formData: FormData;
  responseHeaders: Headers;
}): OpenElementActionFailure<EditActionData> {
  const intent = String(ctx.formData.get('intent') ?? '');
  noteStore.recordAction(intent);
  const id = ctx.params.id ?? '';
  const title = String(ctx.formData.get('title') ?? '').trim();
  const body = String(ctx.formData.get('body') ?? '').trim();
  if (title.length < MIN_TITLE_LENGTH) {
    return fail(
      422,
      {
        error: `title must be at least ${MIN_TITLE_LENGTH} characters`,
        title,
      } satisfies EditActionData,
    );
  }
  if (!noteStore.get(id)) notFound(`note not found: ${id}`);
  exposeActionCount(ctx.responseHeaders);
  noteStore.update(id, title, body);
  throw redirect(`/notes/${id}?updated=1`);
}

export default definePage<EditData>(NoteEditPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-native fixture — edit note' },
  props(context: PagePropsContext<EditData>) {
    const actionData = context.actionData as EditActionData | undefined;
    return {
      title: actionData?.title ?? context.data?.note.title ?? '',
      body: context.data?.note.body ?? '',
      errorText: actionData?.error ?? '',
      hasError: actionData?.error ? 1 : 0,
    };
  },
});
