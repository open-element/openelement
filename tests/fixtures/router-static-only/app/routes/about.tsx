/**
 * static-only about route — second route so the fixture is not a single-page
 * edge case. Same in-module function page shape as `index.tsx`.
 */
import { definePage } from '@openelement/router';

export function AboutPage() {
  return (
    <main>
      <h1 id='about-marker'>static-only fixture about</h1>
    </main>
  );
}

export default definePage(AboutPage, {
  head: { title: 'static-only fixture — about' },
});
