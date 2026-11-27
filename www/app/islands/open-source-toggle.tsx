/**
 * open-source-toggle — the homepage sample's disclosure and overflow cue.
 *
 * At ≤900px the sample is height-capped; this button expands it to the full
 * source view (the [data-source-expanded] attribute lifts the cap entirely).
 * A button (not a native <details>) is used because the same <pre> must stay
 * mounted and scrollable at every width — the disclosure only changes the
 * region's max-height — and because the control must expose
 * aria-expanded/aria-controls to the <pre> that already owns horizontal
 * scrolling.
 *
 * The same island owns the horizontal overflow affordance: the <pre> scrolls
 * silently otherwise, so it marks the source wrapper with data-source-overflow
 * (content wider than the box) and data-source-end (scrolled to the end) for
 * the right-edge fade and "scroll →" cue. It reads geometry only — no state is
 * copied — and re-syncs on scroll, resize and font load.
 *
 * The expanded state lives on the target element (a data-source-expanded
 * attribute) and on this button's aria-expanded; the visible label is a direct
 * DOM write because the generated lane rejects a string-valued JSX
 * conditional. Light root: document CSS owns the label, tier visibility and
 * the expanded height, matching the rest of the site chrome.
 */
import { onConnect } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { installOverflowCue } from '../site-ui/open-source-overflow.ts';

export const openElement = defineIslandConfig({
  tag: 'open-source-toggle',
  root: 'light',
  hydrate: 'visible',
  ssr: true,
  properties: {
    target: { default: '' },
    label: { default: 'View source' },
    hideLabel: { attribute: 'hide-label', default: 'Hide source' },
  },
});

function OpenSourceToggle(props: { target: string; label: string; hideLabel: string }) {
  onConnect((env) => {
    const cleanup = installOverflowCue(env.host, props.target);
    env.signal.addEventListener('abort', cleanup, { once: true });
  });

  return (
    <button
      type='button'
      class='home-source-toggle'
      aria-expanded='false'
      aria-controls={props.target}
      onClick={(event: Event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const host = button.closest('open-source-toggle');
        const doc = host?.ownerDocument ?? globalThis.document;
        const panel = props.target ? doc.getElementById(props.target) : null;
        const next = button.getAttribute('aria-expanded') !== 'true';
        if (next) panel?.setAttribute('data-source-expanded', 'true');
        else panel?.removeAttribute('data-source-expanded');
        button.setAttribute('aria-expanded', next ? 'true' : 'false');
        button.textContent = next ? props.hideLabel : props.label;
      }}
    >
      {props.label}
    </button>
  );
}

export default OpenSourceToggle;
