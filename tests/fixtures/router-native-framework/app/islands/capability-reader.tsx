import { useContext } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { ITEM_LABEL } from '../capability-context.ts';

export const openElement = defineIslandConfig({
  hydrate: 'only',
  ssr: false,
  root: 'shadow',
});

export default function CapabilityReader() {
  const label = useContext(ITEM_LABEL);
  return <output>{label.value}</output>;
}
