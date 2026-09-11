/**
 * / — STATIC home page (default renderIntent): prerendered at build time.
 *
 * The loader runs ONCE during prerendering (entry-render-ssg renderRoute),
 * capturing the seed note count into the static artifact. Runtime mutations
 * of the store never reach this page — the e2e asserts build-count=2 even
 * after requests have created more notes.
 */
import { definePage, type PagePropsContext } from '@openelement/router';
import HomePage from '../components/page-home.tsx';
import { noteStore } from '../store.ts';

interface HomeData {
  noteCount: number;
}

export function loader(): HomeData {
  return { noteCount: noteStore.count() };
}

export default definePage<HomeData>(HomePage, {
  // #1326: a static head object still works; the canonical is emitted at SSG
  // time into the prerendered HTML.
  head: {
    title: 'app-flow-native fixture — home',
    canonical: 'https://fixture.example.test/',
  },
  props({ data }: PagePropsContext<HomeData>) {
    return { buildCountText: `build-count=${data?.noteCount ?? 0}` };
  },
});
