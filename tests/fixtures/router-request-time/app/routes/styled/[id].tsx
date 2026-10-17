// /styled/:id — ordinary request-time route (renderIntent 'dynamic').
import { definePage, type PagePropsContext } from '@openelement/router';
import StyledPage from '../../components/page-styled.tsx';

interface StyledData {
  id: string;
}

export function loader(ctx: { params: Record<string, string> }): StyledData {
  return { id: ctx.params.id ?? '' };
}

export default definePage<StyledData>(StyledPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — styled' },
  props(context: PagePropsContext<StyledData>) {
    return { idText: `id=${context.data?.id ?? ''}` };
  },
});
