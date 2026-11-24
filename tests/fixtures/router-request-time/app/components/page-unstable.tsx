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
 *
 * GENERATED lane (F16: class → function). The body stays static because the
 * page must never render: the loader throws first, so any markup here would be
 * dead code that the #943 rows could not distinguish from a working render.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'unstable-page', root: 'shadow' });

export default function UnstablePage() {
  return (
    <main>
      <h1>unstable page</h1>
    </main>
  );
}
