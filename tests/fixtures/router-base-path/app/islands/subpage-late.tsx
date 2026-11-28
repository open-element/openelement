import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'only', root: 'shadow' });

export default function SubpageLate() {
  const count = signal(0);
  return <button type="button" onClick={() => count.value++}>Nested {count.value}</button>;
}
