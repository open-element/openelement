// /styled/:id — ordinary request-time route (renderIntent 'dynamic').
import { defineIslandConfig, definePage, type PagePropsContext } from '@openelement/router';
// Server-only LIGHT page (S-C1.4, #1609): nothing but this route imports it, so
// every sheet below must be discovered from the SERVER-rendered module graph. The
// nested badge is reached through the package.json `imports` alias `#app/*`.
import '#app/islands/styled-badge.tsx';

/**
 * A SERVER FUNCTION PAGE that DECLARES its own sheet (F16).
 *
 * The class form was `@element('styled-page', { root: 'light' })` — a LIGHT page
 * root. A generated page ROOT must be a shadow root (classification requires the
 * compiler-emitted DSD host producer, and a light root has none), but this route
 * exists to prove light-root document delivery. The server function page form is
 * the honest shape: its output IS document content, and its declared sheet is
 * registered unscoped and seeded into the route's document link list.
 */
export const openElement = defineIslandConfig({
  tag: 'styled-page',
  root: 'light',
  styles: ['../../components/page-styled.css'],
});

interface StyledData {
  id: string;
}

export function loader(ctx: { params: Record<string, string> }): StyledData {
  return { id: ctx.params.id ?? '' };
}

export function StyledPage(props: { idText: string }) {
  return (
    <main id="styled-page-main" class="styled-page">
      <h1>styled page host</h1>
      <p id="styled-page-id" class="styled-shared">
        {props.idText}
      </p>
      <styled-badge></styled-badge>
    </main>
  );
}

// Bare call on purpose: the page-component scanner
// (packages/router/src/vite/internal/ssg/static-component-scanner.ts) matches a
// BARE identifier call, so `definePage<Data>(Component, …)` is unmatchable and
// the page root gets no host producer. The loader/props typing lives on the
// annotations instead.
export default definePage(StyledPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — styled' },
  props(context: PagePropsContext<StyledData>) {
    return { idText: `id=${context.data?.id ?? ''}` };
  },
});
