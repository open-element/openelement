/**
 * ref-layout — minimal application shell rendered around every route
 * (appShell: { tagName, import } in vite.config.ts). v0.44 compiled: the
 * server entry registers and renders the class; the static <slot> projects
 * the page host. No `static styles` — the shell never hydrates client-side.
 */
import { element, OpenElement } from '@openelement/element';

@element('ref-layout', { root: 'shadow-open' })
export default class RefLayout extends OpenElement {
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
