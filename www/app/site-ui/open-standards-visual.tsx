/** @jsxImportSource @openelement/element */
/**
 * www/app/site-ui - open-standards-visual
 *
 * Product-art diagrams for the openElement standards lab website.
 *
 * Presentation is authored as Tailwind utilities on this markup (alpha15
 * utility-first migration); the sheet keeps only the host box, the package
 * bar pseudo-element (base + state inks) and the package lift animation with
 * its keyframes and opt-outs — each with its reason in
 * open-standards-visual.css.
 *
 * The emphasis variant is expressed on the wrapper as a host-attribute
 * utility (`[open-standards-visual[emphasis=high]_&]:`): `emphasis` is a
 * reflected host attribute, so the variant is a stable selector subject and
 * the wrapper's class list stays one static literal.
 */

import { computed, element, OpenElement, property } from '@openelement/element';

/** Compiled computed fields expose their derived value through the class facade. */
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('open-standards-visual')
export default class OpenStandardsVisual extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css).
  @property({ reflect: true })
  variant = 'packages';
  @property({ reflect: true })
  motion = 'auto';
  @property({ reflect: true })
  emphasis = 'normal';
  @property({ reflect: false, attribute: false, type: Number })
  showPackages = computed(() => (this.variant === 'packages' ? 1 : 0)) as CompiledComputed<number>;

  render() {
    return (
      <div class='grid gap-4 text-foreground [open-standards-visual[emphasis=high]_&]:gap-5'>
        {this.showPackages > 0 ? (
          <div class='grid gap-3' aria-label='Package graph'>
            <div class='package package--success relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
              <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-success'>
                Elements
              </span>
              <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
                custom elements, DSD rendering, and component contracts
              </span>
            </div>
            <div class='package relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
              <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-primary'>
                UI
              </span>
              <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
                Open Props primitives used by this website and consumers
              </span>
            </div>
            <div class='package package--warning relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
              <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-warning'>
                Framework
              </span>
              <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
                routes, layouts, content, islands, i18n, and router build
              </span>
            </div>
            <div class='package relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
              <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-primary'>
                Protocols
              </span>
              <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
                public boundary declarations and package compatibility language
              </span>
            </div>
          </div>
        ) : (
          <span hidden aria-hidden='true'></span>
        )}
      </div>
    );
  }
}
