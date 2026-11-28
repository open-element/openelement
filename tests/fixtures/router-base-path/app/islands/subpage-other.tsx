import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ root: 'shadow' });

export default function SubpageOther() {
  const count = signal(0);
  return <button type="button" onClick={() => count.value++}>Other {count.value}</button>;
}
