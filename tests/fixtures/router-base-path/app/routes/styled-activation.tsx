import { definePage } from '@openelement/router';
import '../islands/subpage-styled.tsx';

export function StyledActivationPage() {
  return <main><h1>Styled activation</h1><subpage-styled></subpage-styled></main>;
}

export default definePage(StyledActivationPage);
