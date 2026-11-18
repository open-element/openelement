/**
 * @openelement/ui - open-dropdown
 * Popover-API dropdown with CSS Anchor Positioning placement.
 * The content is a native popover (top layer, built-in light dismiss and
 * focus return); placement anchors to the host, no hand-rolled fallback.
 *
 * Experimental (owner ruling C1, #1468): no compatibility promise — may
 * change or be removed before 1.0.
 *
 * Generated authoring. The compiled template carries the trigger span and the
 * native popover content; the realm-unique anchor-name assignment and the
 * cross-shadow focus-return restoration stay imperative in the
 * dropdown-machine module helper, run from the lifecycle intrinsics.
 * The class lane's `anchorStyle` readonly signal — a derived
 * `position-anchor: ${anchorName}` — is retired with the class export: the
 * activation helper applies both anchor halves imperatively, and a consumer
 * who needs the value derives it from the declared `anchorName` property.
 *
 * @slot trigger - Control used to toggle the dropdown
 * @slot - Dropdown content
 * @csspart trigger - Trigger wrapper
 * @csspart content - Popover content
 */
import { onConnect, onDispose, onPropertyChange } from '@openelement/element';

import { defineComponentConfig } from './component-config.ts';
import {
  activateDropdown,
  clearDropdownPositionAnchor,
  disposeDropdownFocusWiring,
  recordDropdownPointerDown,
  syncDropdownAnchor,
  toggleDropdown,
  type DropdownHost,
} from './dropdown-machine.ts';

/**
 * Platform facts for the generated element: shadow root, the authored
 * package stylesheets, and the property-only `anchorName` row (the anchor
 * identity is assigned at activation, never spelled as an attribute).
 */
export const openElement = defineComponentConfig({
  root: 'shadow',
  styles: ['./overlay-recipe.css', './open-dropdown.css'],
  properties: { anchorName: { default: '', attribute: false } },
});

/** Popover-API dropdown with CSS Anchor Positioning placement. */
// The declared `anchorName` row rides the change channel and the template
// needs no prop read; the parameter stays because it is the compiler's
// props-gate face (the cross-check against the sidecar table).
// oxlint-disable-next-line no-unused-vars
function OpenDropdown(props: { anchorName: string }) {
  /** The host the inline handler's currentTarget belongs to. */
  const hostOf = (event: Event): DropdownHost =>
    ((event.currentTarget as HTMLElement).getRootNode() as ShadowRoot).host as DropdownHost;

  onConnect((env) => {
    // The hooks run before the template's nodes exist, so activation wires
    // everything on the HOST synchronously (see dropdown-machine): the anchor
    // name and its host half apply here, the focus-return listeners delegate
    // to the content's bubbled events, and the content's `position-anchor`
    // half applies at `beforetoggle` — before any open can be observed. A
    // frame of deferral would lose the first-open capture (#1226) to an
    // interaction in the mount frame.
    const host = env.host as DropdownHost;
    activateDropdown(host);
  });
  onDispose((env) => {
    // Element-lifetime teardown: drop the runtime content anchor (a reconnect
    // re-claim sees exactly the compiled static seeds) and remove every
    // focus-return listener this module wired on the retained root. Both
    // helpers are idempotent. A disconnect that keeps the element alive is
    // covered by the connect path: the retained root and nodes survive, so the
    // next open's beforetoggle re-applies the content half and the next
    // closed flip clears it.
    const host = env.host as DropdownHost;
    clearDropdownPositionAnchor(host);
    disposeDropdownFocusWiring(host);
  });
  onPropertyChange((event) => {
    if (event.name !== 'anchorName') return;
    // An author-assigned anchor name re-syncs both halves; the sync is
    // idempotent (the instance-assigned name re-applies the same values).
    syncDropdownAnchor(event.host as DropdownHost);
  });

  return (
    <div>
      {/* Presentation is Tailwind utilities (alpha15 S lane); the sheet keeps
          only the coupled anchor-positioning block for the content. The
          content's `position-anchor` style is applied imperatively at
          activation (the SSR markup stays unpositioned, exactly like the
          class lane's empty signal sink). */}
      <span
        class='trigger contents'
        part='trigger'
        onPointerDown={(event: Event) => recordDropdownPointerDown(hostOf(event))}
        onClick={(event: Event) => toggleDropdown(hostOf(event))}
      >
        <slot name='trigger'></slot>
      </span>
      <div class='overlay content min-w-48 p-2 font-sans' part='content' popover='auto'>
        <slot></slot>
      </div>
    </div>
  );
}

export default OpenDropdown;
