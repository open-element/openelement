/** @jsxImportSource @openelement/element */
import { defineIslandConfig } from '@openelement/router';

/**
 * interop-generated-ssr-card — the M11 generated host SSR fixture island.
 *
 * Unlike `interop-generated-host` (whose `ssr: false` is the pre-M11 client-only
 * boundary), this island is authored for the COMPLETE bounded vertical: a real
 * `ssr: true` shadow-root generated Native Custom Element whose compiler-emitted
 * `<Name>__ssrHost(props, lightChildren, attributes)` is statically imported by
 * the generated server entry, paired with the class through the one SSR registry
 * guard, and invoked by the serializer's nested-composition seam.
 *
 * The two declared properties are the fixture's typed surface; the class page
 * passes them as host attributes (a literal / static pair, the standard SSR
 * semantics), and the emitted host producer seeds the content props from those
 * canonical attribute pairs through the shell's canonical attribute conversion.
 * The `<slot name='x'>` is what projects the page's light children after the DSD
 * template — no second composition channel is invented here.
 */
export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  properties: {
    title: { default: '' },
    note: { default: '' },
  },
});

export default function InteropGeneratedSsrCard(props: { title: string; note: string }) {
  return (
    <article part='card'>
      <h2>{props.title}</h2>
      <p>{props.note}</p>
      <slot name='x'></slot>
    </article>
  );
}
