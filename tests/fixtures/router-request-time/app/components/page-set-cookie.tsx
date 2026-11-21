/**
 * /set-cookie page element — edge-case probe page (compiled, v0.44). The
 * action lives in the route module.
 *
 * GENERATED lane (F16: class → function). The page carries no props by design:
 * the route's action returns a raw Response that the request-time entry passes
 * through untouched, so the page body only ever proves the probe renders.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'set-cookie', root: 'shadow' });

export default function SetCookiePage() {
  return (
    <main>
      <h1>set-cookie probe</h1>
    </main>
  );
}
