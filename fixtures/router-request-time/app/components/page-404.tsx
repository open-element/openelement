/**
 * /404 page element — styled not-found page (#923): request-time unmatched
 * paths render this page with a 404 status on both dev (hono) and build
 * (Nitro) runtimes. Compiled v0.44; the path-derived tag is 'el-404'.
 */
import { element, OpenElement } from '@openelement/element';

@element('el-404', { root: 'shadow-open' })
export default class NotFoundPage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='styled-404'>styled not found</h1>
        <p>The requested page does not exist.</p>
      </main>
    );
  }
}
