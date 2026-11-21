/**
 * /stream-proof-off page element — the NO-stream control for /stream-proof
 * (compiled): the same late-resolving `message` data, rendered as one complete
 * ordinary document instead of a shell flush plus a backfill frame.
 *
 * GENERATED lane (F16: class → function). `message` stays `attribute: false`
 * because the route's loader resolves it in-process and the page must render
 * the settled value in the first flush — an attribute wire would let the value
 * arrive after the element upgrade, which is exactly the difference from the
 * streamed page this fixture exists to pin. No `?? ''` fallback: the loader
 * always awaits the deferred promise before this component renders, so an
 * absent value would be a loader defect, not a renderable state.
 * `root: 'shadow'` reproduces `shadow-open`: the spec asserts the response
 * carries the text and NO stream markers, and the page host keeps the same
 * shape as its streamed twin so the pair differs only in delivery.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'stream-proof-off-page',
  root: 'shadow',
  properties: {
    message: { attribute: false, default: '' },
  },
});

interface StreamProofOffPageProps {
  message: string;
}

export default function StreamProofOffPage(props: StreamProofOffPageProps) {
  const message = props.message ?? '';
  return (
    <main>
      <h1>Stream proof</h1>
      <p id='delayed'>{message}</p>
      <form method='post' action='/stream-proof'>
        <button type='submit'>Submit</button>
      </form>
    </main>
  );
}
