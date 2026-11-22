/**
 * Element browser conformance fixture (#1333): shadow-root event source.
 *
 * The composed-event suite drives this as a REAL open shadow root (a click
 * inside the shadow tree must cross the boundary as a composed event and the
 * host's `count` must reflect). It is authored in the shipped generated lane:
 * the sidecar pins `root: 'shadow'` and the reflected `count` row, and the
 * function component renders the button the old fixture's `render()` returned.
 *
 * WHY `useHost()`. The click handler must write the element's own `count`
 * property — that is the platform fact the suite asserts (property write,
 * reflection to the attribute, and the text binding re-running). A function
 * component has no `this`, so the write goes through the host element the
 * generated class owns.
 */
import { defineIslandConfig } from '@openelement/router';
import { useHost } from '@openelement/element/lifecycle';

export const openElement = defineIslandConfig({
  root: 'shadow',
  properties: { count: { reflect: true, default: 0 } },
});

function WtrShadowButton(props: { count: number }) {
  // The handler writes the element's own declared `count` row (the platform
  // fact the suite asserts); the cast names that row on the owning element.
  const host = useHost() as HTMLElement & { count: number };
  return (
    <button type='button' onClick={() => { host.count++; }}>
      Clicks: {props.count}
    </button>
  );
}

export default WtrShadowButton;
