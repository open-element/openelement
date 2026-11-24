/**
 * /boom page element — error-boundary parity (ADR-0121 §7), compiled v0.44.
 *
 * The legacy error() render function became the descriptor's error
 * projector: the route module maps the caught error onto the numeric
 * `boomNormal`/`boomLoader`/`boomAction` drivers, and the compiled markup
 * carries one static Block branch per variant (compiled conditional
 * branches are fully static — the boundary texts are the two constant
 * failure messages this page can raise).
 *
 * GENERATED lane (F16: class → function). The three drivers stay
 * `attribute: false`: the boundary is reached by the descriptor's `error`
 * projector writing in-process, so an attribute channel would publish a
 * variant flag onto the host that nothing reads. `boomNormal` keeps its
 * class-lane default of 1 so the success path renders without a projection.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'boom-page',
  root: 'shadow',
  properties: {
    boomNormal: { attribute: false, default: 1 },
    boomLoader: { attribute: false, default: 0 },
    boomAction: { attribute: false, default: 0 },
  },
});

interface BoomPageProps {
  boomNormal: number;
  boomLoader: number;
  boomAction: number;
}

export default function BoomPage(props: BoomPageProps) {
  return (
    <main>
      {props.boomLoader > 0
        ? (
          <section data-variant='loader'>
            <h1 id='boundary'>boom boundary: boom-loader</h1>
            <form method='post' data-open-enhance>
              <button id='boom-submit' type='submit'>Boom</button>
            </form>
          </section>
        )
        : <span data-variant='off'></span>}
      {props.boomAction > 0
        ? (
          <section data-variant='action'>
            <h1 id='boundary'>boom boundary: boom-action</h1>
            <form method='post' data-open-enhance>
              <button id='boom-submit' type='submit'>Boom</button>
            </form>
          </section>
        )
        : <span data-variant='off'></span>}
      {props.boomNormal > 0
        ? (
          <section data-variant='normal'>
            <h1>boom page</h1>
            <form method='post' data-open-enhance>
              <button id='boom-submit' type='submit'>Boom</button>
            </form>
          </section>
        )
        : <span data-variant='off'></span>}
    </main>
  );
}
