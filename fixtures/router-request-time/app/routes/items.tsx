/**
 * /items — islands in a dynamic list (ADR-0121 §9). v0.44 compiled shape:
 * rows render through the compiled each-Region with per-row identity keys;
 * see page-items.tsx for the item-attribute grammar gap note.
 */
import { definePage, type PagePropsContext, redirect } from '@openelement/router';
import ItemsPage from '../components/page-items.tsx';

export function loader(ctx: { request: Request }): { items: string[] } {
  const url = new URL(ctx.request.url);
  return { items: (url.searchParams.get('items') ?? 'a,b').split(',') };
}

export function action(ctx: { formData: FormData }): never {
  const items = String(ctx.formData.get('items') ?? 'a,b');
  throw redirect(`/items?items=${encodeURIComponent('new,' + items)}`);
}

export const actions = {
  reverse(ctx: { formData: FormData }): never {
    const items = String(ctx.formData.get('items') ?? 'a,b').split(',');
    throw redirect(`/items?items=${encodeURIComponent(items.reverse().join(','))}`);
  },
};

export default definePage(ItemsPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — items' },
  props({ data }: PagePropsContext<{ items: string[] }>) {
    const items = data?.items ?? ['a', 'b'];
    return {
      rows: items.map((id) => ({ id, label: id })),
      itemsValue: items.join(','),
    };
  },
});
