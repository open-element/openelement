/**
 * / — static home route (default renderIntent 'static'): prerendered at build
 * time, the note count is build-time data.
 */
import { defineLitPage } from '@openelement/router/lit';
import { HomePage } from '../components/home-page.ts';
import { notesStore } from '../store.ts';

interface HomeData {
  noteCount: number;
}

export function loader(): HomeData {
  return { noteCount: notesStore.count() };
}

export default defineLitPage<HomeData>('home-page', HomePage, {
  // #1326: a static head object still works; the canonical is emitted at SSG
  // time into the prerendered HTML.
  head: {
    title: 'app-flow-lit — home',
    canonical: 'https://fixture.example.test/',
  },
  props({ data }) {
    return { noteCount: data?.noteCount ?? 0 };
  },
});
