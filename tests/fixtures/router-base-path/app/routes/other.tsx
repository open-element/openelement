import { definePage } from '@openelement/router';
import '../islands/subpage-other.tsx';

export function OtherPage() {
  return <main><h1>Other route</h1><subpage-other></subpage-other></main>;
}

export default definePage(OtherPage);
