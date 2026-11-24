/**
 * app/layout.tsx — the auto-registered layout convention: the router resolves
 * this module to `CONVENTION_LAYOUT_TAG` (`app-layout`), so vite.config.ts
 * carries no layout option at all. The server entry renders the host; the
 * `<slot>` projects the page host. No `styles` — the layout never hydrates
 * client-side.
 *
 * Generated-element lane (2026-11-20 migration): the class this module used to
 * declare is a function component with a sidecar. The tag is the router's
 * convention constant (D-M1), never a path derivation, and the DSD default root
 * the class spelled `shadow-open` is the sidecar's `shadow`.
 *
 * A generated LAYOUT is registered through the same host PAIR channel an island
 * uses (the entry's `__registerSsrIsland`), which is why the module needs the
 * sidecar at all: without it the module would compile as a class, and a
 * generated element has no Part Program to render.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'app-layout',
  root: 'shadow',
});

function AppLayout() {
  return (
    <div>
      <header>
        <a href='/'>OpenElement × Supabase × Cloudflare</a>
      </header>
      <slot></slot>
      <footer>Reference starter — composition only, no framework-owned auth</footer>
    </div>
  );
}

export default AppLayout;
