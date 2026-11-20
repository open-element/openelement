/**
 * M11-2 generated page island for the request-time/claim host. Same declared
 * prop shape as the SSG island (same-name, explicit rename, number, boolean)
 * plus its own declared stylesheet for the JS-enabled page-root style proof.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  styles: ['./generated-page-live.css'],
  properties: {
    title: { default: '' },
    dataNote: { attribute: 'data-note', default: '' },
    count: { default: 0 },
    enabled: { default: false },
  },
});

export default function GeneratedPageLiveCard(props: {
  title: string;
  dataNote: string;
  count: number;
  enabled: boolean;
}) {
  return (
    <section part='generated-page-live'>
      <h1 id='generated-page-live-title' class='generated-page-live-title'>
        {props.title}
      </h1>
      <p id='generated-page-live-note'>{props.dataNote}</p>
      <p id='generated-page-live-count'>{props.count}</p>
      <p id='generated-page-live-enabled'>{props.enabled}</p>
    </section>
  );
}
