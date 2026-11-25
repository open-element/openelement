import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'open-counter',
  root: 'shadow',
  hydrate: 'visible',
  ssr: true,
  properties: { label: { default: 'Count:' } },
});

export default function OpenCounter(props: { label: string }) {
  const count = signal(0);
  return (
    <button
      type='button'
      part='button'
      onClick={() => {
        count.value = count.value + 1;
      }}
    >
      <span aria-live='polite'>{props.label + ' ' + count.value}</span>
    </button>
  );
}
