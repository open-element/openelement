/**
 * A card that shows a label and projects its children.
 *
 * Fixture for the manifest generator's generated-element branch: a real
 * default-exported function component compiled by the generated native element
 * lane. The fixture is read as text only — it is never shipped, never scanned
 * from `packages/ui/src/`, and never type-checked as part of the ui package.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'idle',
  properties: {
    label: { default: 'Untitled' },
  },
});

/** The generated lane has no authored custom-event surface: this helper must not become a CEM event. */
export function announceCardChange() {
  return new CustomEvent('card-change', { detail: { value: 1 } });
}

/**
 * A card that shows a label and projects its children.
 *
 * The second paragraph is not part of the projected summary.
 */
function FnCard(props: { label: string }) {
  return (
    <article part='container' onClick={() => undefined}>
      <slot name='header'></slot>
      <div part='body'>
        <span part='body icon'></span>
        {props.label}
        <slot></slot>
      </div>
      <slot name='footer'></slot>
    </article>
  );
}

export default FnCard;
