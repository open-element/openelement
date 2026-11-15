/**
 * M11-2 generated element page (fixture island).
 *
 * A plain function component compiled through the generated Native Custom
 * Element lane (`root: 'shadow'`, compiler-emitted `<Name>__ssrHost`). The route
 * module imports it and passes it to `definePage` exactly like a compiled page
 * class — the public authoring API does not change.
 *
 * Declared props exercise the canonical SSR→claim seed: same-name attribute
 * (`title`), explicit attribute rename (`data-note`), number coercion (`count`)
 * and boolean presence (`enabled`). The declared stylesheet is delivered INSIDE
 * the page host's DSD template through the same per-island style-link channel as
 * a nested generated host (page-root carrier proof).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  styles: ['./generated-page-card.css'],
  properties: {
    title: { default: '' },
    dataNote: { attribute: 'data-note', default: '' },
    count: { default: 0 },
    enabled: { default: false },
  },
});

export default function GeneratedPageCard(props: {
  title: string;
  dataNote: string;
  count: number;
  enabled: boolean;
}) {
  return (
    <section part='generated-page'>
      <h1 id='generated-page-title' class='generated-page-title'>
        {props.title}
      </h1>
      <p id='generated-page-note'>{props.dataNote}</p>
      <p id='generated-page-count'>{props.count}</p>
      <p id='generated-page-enabled'>{props.enabled}</p>
    </section>
  );
}
