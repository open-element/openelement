import { definePage } from '@openelement/router';
import SubpageHome from '../components/subpage-home.tsx';

export default definePage(SubpageHome, {
  head: { title: 'base-path fixture' },
});
