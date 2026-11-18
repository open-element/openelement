/** @jsxImportSource @openelement/element */
/** A private WWW frame for inspectable product evidence, never a UI export. */

import { defineIslandConfig } from '@openelement/router';

/**
 * Authored identity for a page-local component.
 *
 * `app/site-ui/` is neither the islands directory (whose tag is the file path's
 * convention) nor a package (whose tag is its manifest declaration), so this
 * module has no tag source at all unless it declares one. `tag` is that authored
 * fact: it is what admits the module to the generated-element lane. The emitted
 * descriptor still takes its tag from the host's site fact, so a committed
 * element and its registration cannot disagree.
 *
 * `root: 'light'` is the ROOT this component already had. The class lane
 * rendered it in the document tree, `www/site-chrome.css` selects
 * `open-artifact-panel .panel::before` there, and the built page carries
 * `data-oe-light`. Declaring `shadow` would be a behaviour change dressed as a
 * migration.
 */
export const openElement = defineIslandConfig({
  root: 'light',
  tag: 'open-artifact-panel',
});

/**
 * Presentation is authored as Tailwind utilities on this markup; the linked
 * document stylesheet (`www/site-chrome.css`) keeps only the host box and the
 * `.panel::before` pseudo-element — a pseudo box plus its mask/background stack
 * is the irreducible part markup cannot address. One owner per property:
 * nothing in the sheet is also a utility here.
 *
 * The component has no property rows: every caller supplies content through the
 * `label`, `meta` and default slots, so there is no reactive surface to bind.
 */
function OpenArtifactPanel() {
  return (
    <section class='panel relative min-h-[var(--artifact-min-height,220px)] overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--color-border)_74%,var(--color-primary))] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-popover)_94%,var(--color-secondary)),var(--color-muted))] p-5 shadow-[inset_0_1px_0_var(--edge-highlight)]'>
      <header class='relative flex items-baseline justify-between gap-3 border-b border-border pb-4'>
        <p class='m-0 font-mono text-(length:--text-xs) leading-[1.3] text-primary font-extrabold uppercase'>
          <slot name='label'></slot>
        </p>
        <p class='m-0 font-mono text-(length:--text-xs) leading-[1.3] text-muted-foreground text-end uppercase'>
          <slot name='meta'></slot>
        </p>
      </header>
      <div class='relative pt-5'>
        <slot></slot>
      </div>
    </section>
  );
}

export default OpenArtifactPanel;
