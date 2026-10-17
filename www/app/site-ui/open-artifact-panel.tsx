/** @jsxImportSource @openelement/element */
/** A private WWW frame for inspectable product evidence, never a UI export. */

import { element, OpenElement } from '@openelement/element';

@element('open-artifact-panel')
export default class OpenArtifactPanel extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css).
  render() {
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
}
