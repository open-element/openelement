/**
 * /404 page element — styled not-found page (#923): request-time unmatched
 * paths render this page with a 404 status on both dev (hono) and build
 * (Nitro) runtimes.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`, and the tag is authored because this module sits outside
 * `app/islands/`: the path convention that names generated islands only covers
 * that directory, so `el-404` has no derivable source and a page the build
 * cannot resolve registers nothing. The spelling is the class lane's, so the
 * unmatched-path response keeps the host its suite reads.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'el-404', root: 'shadow' });

export default function NotFoundPage() {
  return (
    <main>
      <h1 id='styled-404'>app-flow-native styled not found</h1>
      <p>The requested note or page does not exist.</p>
      <a id='back-home' href='/'>Home</a>
    </main>
  );
}
