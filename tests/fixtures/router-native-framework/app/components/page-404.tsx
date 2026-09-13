/**
 * /404 page element — styled not-found page (#923): request-time unmatched
 * paths render this page with a 404 status on both dev (hono) and build
 * (Nitro) runtimes.
 */
import { element, OpenElement } from '@openelement/element';

@element('el-404', { root: 'shadow-open' })
export default class NotFoundPage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='styled-404'>app-flow-native styled not found</h1>
        <p>The requested note or page does not exist.</p>
        <a id='back-home' href='/'>Home</a>
      </main>
    );
  }
}
