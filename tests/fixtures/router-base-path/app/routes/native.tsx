import { definePage } from '@openelement/router';
import '../islands/subpage-native.ts';

export function NativePage() {
  return <main><h1>Native route</h1><subpage-native></subpage-native></main>;
}

export default definePage(NativePage);
