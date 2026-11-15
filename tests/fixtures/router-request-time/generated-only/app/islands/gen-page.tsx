/** @jsxImportSource @openelement/element */
/**
 * The fixture's only island: a generated Native Custom Element page root
 * (`root: 'shadow'`, compiler-emitted host producer). It carries no authored
 * stylesheet so the check focuses on the executor lane fact, not the style
 * carrier.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
});

export default function GenPage() {
  return (
    <article class='gen-page'>
      <h1>generated page</h1>
      <p>executor-free generated client entry</p>
    </article>
  );
}
