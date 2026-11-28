import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'visible',
  ssr: true,
  root: 'shadow',
});

export default function DeferredCounter() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => (count.value = count.value + 1)}>
      Deferred count: {count.value}
    </button>
  );
}
