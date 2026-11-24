/**
 * /boom page element — loader always throws; the descriptor's error projector
 * maps the failure onto the numeric drivers and the compiled markup carries
 * one static Block branch per variant (ADR-0121 §7, status 500).
 *
 * GENERATED lane (F16: class → function). Both drivers stay
 * `attribute: false`: the boundary is reached by the descriptor's `error`
 * projector writing in-process, so an attribute channel would publish a
 * variant flag onto the host that nothing reads. Their class-lane defaults
 * (normal 1 / error 0) are kept twice on purpose — the sidecar row is the
 * value the shell applies before any projection, and `??` in the body keeps the
 * success render total when no projector supplied either. `root: 'shadow'`
 * reproduces `shadow-open`: the spec reads the boundary text out of the
 * response body (a DSD template), and a light root would inline it instead.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'boom-page',
  root: 'shadow',
  properties: {
    boomNormal: { attribute: false, default: 1 },
    boomError: { attribute: false, default: 0 },
  },
});

interface BoomPageProps {
  boomNormal: number;
  boomError: number;
}

export default function BoomPage(props: BoomPageProps) {
  const boomNormal = props.boomNormal ?? 1;
  const boomError = props.boomError ?? 0;
  return (
    <main>
      {boomError > 0
        ? (
          <section data-variant='error'>
            <h1 id='boundary'>boom boundary: boom-loader</h1>
          </section>
        )
        : <span data-variant='off'></span>}
      {boomNormal > 0
        ? (
          <section data-variant='normal'>
            <h1>boom page</h1>
          </section>
        )
        : <span data-variant='off'></span>}
    </main>
  );
}
