import { definePage, type PagePropsContext } from '@openelement/router';
import PanelDynamicPage from '../components/page-panel-dynamic.tsx';

interface PanelData { id: string }

export function loader(ctx: { request: Request }): PanelData {
  return { id: new URL(ctx.request.url).searchParams.get('id') ?? '' };
}

export default definePage<PanelData>(PanelDynamicPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'panel dynamic' },
  props(context: PagePropsContext<PanelData>) {
    return { idText: `id=${context.data?.id ?? ''}` };
  },
});
