/**
 * /decoupled — regression fixture for #960 (registration decoupling), v0.44
 * compiled shape.
 *
 * The page class (components/page-decoupled.tsx, @element('decoupled-page'))
 * registers under the path-derived fallback tag and nests the compiled
 * content island <decoupled-view> (app/islands/decoupled-view.tsx). The
 * request-scoped marker flows: request -> loader-free props projector -> the
 * page's compiled `marker` property -> host attribute -> the island's
 * compiled `marker` property. Before #960 the self-registered content
 * element shadowed the page class and the request context never arrived.
 */
import { definePage, type PagePropsContext } from '@openelement/router';
import DecoupledPage from '../components/page-decoupled.tsx';

export default definePage(DecoupledPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — decoupled' },
  props(context: PagePropsContext) {
    const marker = context.request ? new URL(context.request.url).searchParams.get('marker') : null;
    return {
      marker: marker === null ? 'content element: no marker' : `content element: ${marker}`,
    };
  },
});
