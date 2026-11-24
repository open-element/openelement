/**
 * /404 page element — styled not-found page (#923): request-time unmatched
 * paths render this page with a 404 status on both dev (hono) and build
 * (Nitro) runtimes. Compiled v0.44; the path-derived tag is 'el-404'.
 *
 * GENERATED lane (F16: class → function). The tag stays spelled out because it
 * does not follow the file-path convention: the not-found route resolves its
 * page by module identity, and an undeclared tag would let the build derive
 * 'page-404' and register a tag no response ever carries.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'el-404', root: 'shadow' });

export default function NotFoundPage() {
  return (
    <main>
      <h1 id='styled-404'>styled not found</h1>
      <p>The requested page does not exist.</p>
    </main>
  );
}
