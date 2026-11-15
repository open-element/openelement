/**
 * app/layout.tsx — the auto-registered layout convention (alpha15): the router
 * resolves this module to `CONVENTION_LAYOUT_TAG` (`app-layout`), so
 * vite.config.ts carries no layout option at all. The server entry registers
 * and renders the class; the static <slot> projects the page host. No
 * `static styles` — the layout never hydrates client-side.
 */
import { element, OpenElement } from '@openelement/element';

@element('app-layout', { root: 'shadow-open' })
export default class AppLayout extends OpenElement {
  render() {
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
}
