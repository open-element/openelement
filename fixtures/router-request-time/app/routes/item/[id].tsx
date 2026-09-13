/**
 * /item/:id — request-time param route (#556).
 *
 * Proves the generated host matcher dispatches concrete pathnames ('/item/42')
 * to the ':param' route pattern: the loader echoes params.id per request, and
 * the action exercises the full protocol on a parameterized URL — empty note
 * -> fail(422) re-render; valid note -> 303 PRG back to the same item.
 * v0.44: markup compiled in components/page-item.tsx; the descriptor
 * projector replaces the render-scope useActionData() hook.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import ItemPage from '../../components/page-item.tsx';

interface ItemData {
  id: string;
}

interface ItemActionData {
  error?: string;
  note?: string;
}

export function loader(ctx: { params: Record<string, string> }): ItemData {
  return { id: ctx.params.id ?? '' };
}

export function action(ctx: {
  params: Record<string, string>;
  formData: FormData;
}): OpenElementActionFailure<ItemActionData> {
  const note = String(ctx.formData.get('note') ?? '').trim();
  if (!note) {
    return fail(422, { error: 'note is required', note } satisfies ItemActionData);
  }
  throw redirect(`/item/${encodeURIComponent(ctx.params.id)}?noted=${encodeURIComponent(note)}`);
}

export default definePage<ItemData>(ItemPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — item' },
  props(context: PagePropsContext<ItemData>) {
    const actionData = context.actionData as ItemActionData | undefined;
    const noted = context.request
      ? new URL(context.request.url).searchParams.get('noted')
      : undefined;
    return {
      idText: `id=${context.data?.id ?? ''}`,
      note: actionData?.note ?? '',
      notedText: `noted=${noted ?? ''}`,
      hasError: actionData?.error ? 1 : 0,
    };
  },
});
