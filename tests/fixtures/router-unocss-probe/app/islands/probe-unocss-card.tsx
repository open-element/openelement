/**
 * The shadow-root half of the UnoCSS probe.
 *
 * Its control surface is authored as `tailwind4`-dialect utilities on the host
 * element's shadow tree; the compiler collects those static tokens, and the
 * build's COMPONENT sheet compiles them through UnoCSS and delivers one shared
 * `CSSStyleSheet` the shadow root adopts. Nothing in this module knows which
 * engine compiled it — the class strings are the whole contract.
 *
 * The rules that stay in CSS are the host-attribute-scoped branches, exactly
 * as the UI package justifies them (CUSTOMIZATION.md → "Why the residue is
 * CSS"): a utility spelling exists for each, and the authored rule is smaller
 * and more legible.
 */
import '@openelement/element';
import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import cardStyles from './probe-shadow-card.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('probe-unocss-card', { root: 'shadow-open' })
export default class ProbeUnocssCard extends OpenElement {
  static override styles = [cardStyles];

  render() {
    return (
      <article class="card inline-flex items-center gap-2 rounded-lg bg-primary/14 px-3 py-2 text-foreground font-semibold">
        <span class="probe-marker size-4">◆</span>
        <span>The shadow control compiles through UnoCSS.</span>
      </article>
    );
  }
}
