import { signal } from '@openelement/element';
import { provideContext } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { ITEM_LABEL } from '../capability-context.ts';

export const openElement = defineIslandConfig({
  hydrate: 'only',
  ssr: false,
  root: 'shadow',
});

export default function CapabilityProvider() {
  const items = signal([
    { id: 'first', name: 'First item' },
    { id: 'second', name: 'Second item' },
  ]);
  provideContext(ITEM_LABEL, () => 'Copper');
  return (
    <section>
      <button type="button" onClick={() => (items.value = items.value.toReversed())}>
        Reverse list
      </button>
      <slot></slot>
      <ul>{items.value.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
    </section>
  );
}
