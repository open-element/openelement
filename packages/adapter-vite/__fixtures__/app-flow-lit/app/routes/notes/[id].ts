/**
 * /notes/:id — dynamic detail route. Unknown ids signal notFound(); the
 * loader proves the ADR-0129 response-header channel with x-note-count.
 */
import { defineLitPage } from '@openelement/app/lit';
import { notFound, type PagePropsContext } from '@openelement/app';
import { NoteDetailPage } from '../../components/note-detail-page.ts';
import { exposeActionCount, lastActionIntent, type Note, notesStore } from '../../store.ts';

interface NoteData {
  note: Note;
}

export function loader(ctx: {
  params: Record<string, string>;
  responseHeaders: Headers;
}): NoteData {
  exposeActionCount(ctx.responseHeaders);
  const note = notesStore.get(ctx.params.id ?? '');
  if (!note) notFound(`no note with id ${ctx.params.id ?? ''}`);
  ctx.responseHeaders.set('x-note-count', String(notesStore.count()));
  return { note };
}

export default defineLitPage<NoteData>('note-detail-page', NoteDetailPage, {
  renderIntent: { mode: 'dynamic' },
  // #1326: page meaning resolves per render from the request-scoped context —
  // the title comes from loader data; canonical/alternates come from params.
  head: (context: PagePropsContext<NoteData>) => ({
    title: `app-flow-lit — ${context.data?.note.title ?? 'note'}`,
    canonical: `https://fixture.example.test/notes/${context.params.id ?? ''}`,
    alternates: [
      {
        href: `https://fixture.example.test/notes/${context.params.id ?? ''}`,
        hreflang: 'en',
      },
      {
        href: `https://fixture.example.test/zh/notes/${context.params.id ?? ''}`,
        hreflang: 'zh',
      },
    ],
  }),
  props(context: PagePropsContext<NoteData>) {
    const created = context.request
      ? new URL(context.request.url).searchParams.get('created') === '1'
      : false;
    return {
      noteId: context.data?.note.id ?? '',
      noteTitle: context.data?.note.title ?? '',
      noteBody: context.data?.note.body ?? '',
      created,
      intentText: `intent=${lastActionIntent()}`,
    };
  },
});
