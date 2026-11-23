import { definePage, type PagePropsContext } from '@openelement/router';
import PanelDynamicPage from '../components/page-panel-dynamic.tsx';

interface PanelData { id: string }

export function loader(ctx: { request: Request }): PanelData {
  return { id: new URL(ctx.request.url).searchParams.get('id') ?? '' };
}

// Bare call on purpose: the page-component scanner
// (packages/router/src/vite/internal/ssg/static-component-scanner.ts) matches a
// BARE identifier call, so `definePage<Data>(Component, …)` is unmatchable and
// the page root gets no host producer. The loader/props typing lives on the
// annotations instead.
export default definePage(PanelDynamicPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'panel dynamic' },
  props(context: PagePropsContext<PanelData>) {
    return { idText: `id=${context.data?.id ?? ''}` };
  },
});
