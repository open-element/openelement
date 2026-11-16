import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'idle',
  styles: ['./open-fn-styled.css'],
  properties: {
    label: { default: 'Untitled' },
  },
});

/** A styled shadow card. */
function FnStyled(props: { label: string }) {
  return (
    <article part='container'>
      <slot name='header'></slot>
      <span part='body'>{props.label}</span>
    </article>
  );
}

export default FnStyled;
