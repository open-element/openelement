/**
 * wc-open-closed — openElement child created inside a CLOSED shadow root
 * (C2 of the late-host corpus). This one must NOT activate.
 *
 * A closed root is unreachable by construction: `Element.shadowRoot` is null
 * and no standard API enumerates it, so there is nothing for the scheduler to
 * find and no monkey-patch of `attachShadow` is acceptable in a framework
 * runtime. The fixture pins the honest contract: the page still works, no
 * page error is raised, every other late host on the same page still
 * activates, and this tag is reported as a documented gap — never silently
 * converted into a pass.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` (the class lane's
 * `shadow-open`) is what the tag WOULD be, and the gap is exactly why it never
 * matters: nothing can reach this element to read either root, and the
 * qualifier asserts the tag is never registered at all.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcOpenClosed() {
  return <span id='open-closed-ready'>unreachable: created inside a closed root</span>;
}
