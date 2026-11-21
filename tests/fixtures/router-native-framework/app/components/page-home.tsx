/**
 * / page element — static prerendered home (compiled). `buildCountText`
 * embeds the note count captured at BUILD time; the SSG separation e2e
 * asserts it never changes at runtime.
 *
 * GENERATED lane (F16: class → function). `buildCountText` keeps the class
 * lane's `attribute: false`: the route's `props` projector supplies it
 * in-process during prerendering, so an attribute wire would publish a
 * build-time fact onto the host where nothing reads it. The default stays on
 * the typed member (`build-count=0`) because the sidecar row's default is what
 * the shell applies before any projection, and `??` keeps the render total for
 * the unsupplied case. `root: 'shadow'` reproduces the class lane's
 * `shadow-open` so the prerendered marker stays inside the DSD template the
 * page's own output is asserted against.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'index-page',
  root: 'shadow',
  properties: {
    buildCountText: { attribute: false, default: 'build-count=0' },
  },
});

interface HomePageProps {
  buildCountText: string;
}

export default function HomePage(props: HomePageProps) {
  const buildCountText = props.buildCountText ?? 'build-count=0';
  return (
    <main>
      <h1 id='home-marker'>app-flow-native home</h1>
      <p id='build-count'>{buildCountText}</p>
      <p>This page is prerendered; /notes is rendered at request time.</p>
      <a id='notes-link' href='/notes'>Notes</a>
    </main>
  );
}
