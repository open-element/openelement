/**
 * /unstable page element — render-time failure channel (#943 amendment
 * regression), compiled v0.44.
 *
 * v0.44: compiled pages have no render-time code path (render() is the
 * compiled Part Program), so the failure moved into the route module's
 * LOADER — the response-shape contract is identical: 404 (default) throws
 * notFound(), ?kind=redirect throws redirect('/live'), and every
 * error/redirect response keeps the no-store baseline because the loader
 * throws before the render succeeds.
 */
import { element, OpenElement } from '@openelement/element';

@element('unstable-page', { root: 'shadow-open' })
export default class UnstablePage extends OpenElement {
  render() {
    return (
      <main>
        <h1>unstable page</h1>
      </main>
    );
  }
}
