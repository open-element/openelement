/** @jsxImportSource @openelement/element */
import { definePage } from '@openelement/router';

export default definePage({
  route: { path: '/' },
  head: {
    title: 'OpenElement v0.44 interoperability corpus',
  },
  renderIntent: { mode: 'static', streaming: 'auto' },
  render() {
    return <v044-interop-fixture />;
  },
});
