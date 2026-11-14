/**
 * Fixture for the manifest generator's generated-element branch: a shadow-root
 * function component whose island sidecar declares the platform property table
 * (reflect/default/attribute channels), `root: 'shadow'` and `delegatesFocus`.
 *
 * No JSDoc summary: the projection must report an absent description rather
 * than invent one.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  root: 'shadow',
  delegatesFocus: true,
  properties: {
    label: { reflect: true, attribute: 'data-label', default: 'Untitled' },
    count: { default: 0 },
    padding: { attribute: false },
  },
});

function FnPanel(props: { label: string; count: number; padding: number }) {
  return (
    <section part='panel'>
      {props.label}
      <slot></slot>
    </section>
  );
}

export default FnPanel;
