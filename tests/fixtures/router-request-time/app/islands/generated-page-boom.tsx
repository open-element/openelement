/**
 * M11-2 generated element page (fixture island).
 *
 * A plain function component compiled through the generated Native Custom
 * Element lane (`root: 'shadow'`, compiler-emitted `<Name>__ssrHost`). The route
 * module imports it and passes it to `definePage` exactly like a compiled page
 * class — the public authoring API does not change. Declared primitive props
 * (`title`, `note`) are attribute-backed so the SSR/client seed parity of the
 * page host is observable.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  properties: {
    title: { default: '' },
    note: { default: '' },
  },
});

export default function GeneratedPageBoomCard(props: { title: string; note: string }) {
  return (
    <section part='generated-page-boom'>
      <h1 id='generated-page-boom-title'>{props.title}</h1>
      <p id='generated-page-boom-note'>{props.note}</p>
    </section>
  );
}
