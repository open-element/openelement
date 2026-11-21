/**
 * Non-root-base fixture — nested LIGHT component (S-C2/S-12).
 *
 * Generated lane (2026-11-21 closeout): only the LIGHT root's sheet is a page
 * fact here. A generated component has no `static styles`, so its sheet is
 * DECLARED on the sidecar (the same `styles` list a shadow island uses), and a
 * light root's declared sheets resolve to document links — no client JavaScript
 * is needed for the styling, which is what this fixture pins.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  // The tag is DECLARED (2026-11-21): this component lives in `app/components/`,
  // which no path convention owns (an island's tag comes from its islands-dir
  // path, a package island's from its manifest), so the sidecar is the only
  // identity source — without it the page renders an unknown element.
  tag: 'subpage-note',
  root: 'light',
  styles: ['./subpage-note.css'],
});

export default function SubpageNote() {
  return <span class="subpage-note">noted</span>;
}
