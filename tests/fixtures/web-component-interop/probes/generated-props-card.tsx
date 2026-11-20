/**
 * 16b-MN residual (a) — probe source for the generated-element non-primitive
 * property round-trip evidence. Lives OUTSIDE `app/` on purpose: the router
 * build and the interop qualification harness scan/build `app/`, and this probe
 * is read only by `generated-props-roundtrip.test.ts` (real compiler lane over
 * the same source a consumer would author). It must never enter a build
 * artifact.
 *
 * Rows are property-only (`attribute: false`): array/object/trustedHtml have no
 * server→client seed channel (ADR-0181 A5 boundary, unchanged).
 */
import { defineIslandConfig } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';

export const openElement = defineIslandConfig({
  hydrate: 'idle',
  root: 'shadow',
  properties: {
    events: { attribute: false, default: [{ id: 'seed', body: 'default-row' }] },
    model: { attribute: false, default: { title: 'untitled', rows: ['a'] } },
    articleHtml: { attribute: false, default: trustedHtml('<b>safe</b>') },
  },
});

export default function InteropPropsCard(props: {
  events: Array<{ id: string; body: string }>;
  model: { title: string; rows: string[] };
  articleHtml: TrustedHtml;
}) {
  return (
    <section>
      <h2>{props.model.title}</h2>
      <ul>
        {props.events.map((entry) => (
          <li key={entry.id}>{entry.body}</li>
        ))}
      </ul>
    </section>
  );
}
