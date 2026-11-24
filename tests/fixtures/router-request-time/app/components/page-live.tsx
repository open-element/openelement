/**
 * /live page element — request-time rendered (renderIntent mode 'dynamic').
 *
 * The loader derives data from the incoming request (query param `x`) and a
 * per-process counter, so two requests must never return identical HTML. The route
 * module's props projector maps that data onto the `xText`/`nonceText` props; the
 * component only reads props. A live-counter island verifies hydration behaves the
 * same as on static pages.
 *
 * GENERATED lane (F16: class → function).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'live-page',
  root: 'shadow',
  properties: {
    xText: { attribute: false, default: 'x=' },
    nonceText: { attribute: false, default: 'nonce=0' },
  },
});

interface LivePageProps {
  xText: string;
  nonceText: string;
}

export default function LivePage(props: LivePageProps) {
  return (
    <main>
      <h1>request-time live</h1>
      <p id="x-value">{props.xText}</p>
      <p id="nonce">{props.nonceText}</p>
      <live-counter></live-counter>
    </main>
  );
}
