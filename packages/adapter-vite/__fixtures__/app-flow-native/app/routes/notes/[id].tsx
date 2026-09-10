/**
 * /notes/:id — DYNAMIC detail page (#556 param route).
 *
 * - Unknown ids throw notFound() from the loader: the generated entry answers
 *   status 404 carrying the notFound message (#922 channel).
 * - The loader appends x-note-count through the ADR-0129 responseHeaders
 *   channel (see set-header.tsx in the request-time fixture).
 * - The PRG flashes (?created=1 / ?updated=1) are projected onto compiled
 *   properties, replacing the legacy render-scope hooks.
 */
import { definePage, notFound, type PagePropsContext } from '@openelement/app';
import NoteDetailPage from '../../components/page-note-detail.tsx';
import { exposeActionCount, type Note, noteStore } from '../../store.ts';

interface DetailData {
  note: Note;
}

export function loader(ctx: {
  params: Record<string, string>;
  responseHeaders: Headers;
}): DetailData {
  exposeActionCount(ctx.responseHeaders);
  const note = noteStore.get(ctx.params.id ?? '');
  if (!note) notFound(`note not found: ${ctx.params.id ?? ''}`);
  ctx.responseHeaders.set('x-note-count', String(noteStore.count()));
  return { note };
}

export default definePage<DetailData>(NoteDetailPage, {
  renderIntent: { mode: 'dynamic' },
  // #1326: page meaning resolves per render from the request-scoped context —
  // the title comes from loader data; canonical/alternates come from params.
  head: (context: PagePropsContext<DetailData>) => ({
    title: `app-flow-native fixture — ${context.data?.note.title ?? 'note'}`,
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
  props(context: PagePropsContext<DetailData>) {
    const created = context.request
      ? new URL(context.request.url).searchParams.get('created')
      : undefined;
    const updated = context.request
      ? new URL(context.request.url).searchParams.get('updated')
      : undefined;
    const note = context.data?.note;
    return {
      idText: `id=${note?.id ?? ''}`,
      titleText: note?.title ?? '',
      bodyText: note?.body ?? '',
      editHref: `/notes/${note?.id ?? ''}/edit`,
      createdText: `created=${created ?? ''}`,
      updatedText: `updated=${updated ?? ''}`,
      intentText: `intent=${noteStore.lastIntent()}`,
    };
  },
});
