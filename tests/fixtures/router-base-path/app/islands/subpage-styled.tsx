import { defineIslandConfig } from '@openelement/router';
import { styledLabel } from '../native/styled-label.ts';

export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'only' });

export default function SubpageStyled() {
  const label = styledLabel();
  return <button type="button">{label}</button>;
}
