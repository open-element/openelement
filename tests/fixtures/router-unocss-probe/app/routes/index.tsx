// Root route of the UnoCSS probe fixture.
import { definePage } from '@openelement/router';
import ProbeUnocssPage from '../components/probe-page.tsx';

export default definePage(ProbeUnocssPage, {
  head: {
    title: 'openElement × UnoCSS probe',
    description: 'The UnoCSS engine probe: real engine, independent token source, shadow + document delivery.',
    canonical: 'https://fixture.example.test/',
  },
});
