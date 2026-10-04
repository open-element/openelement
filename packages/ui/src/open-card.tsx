/**
 * @openelement/ui - open-card
 *
 * Minimal card container with optional header and footer.
 * Swiss International Style: borders are whispers, not shouts.
 *
 * Experimental (owner ruling C1, #1468): no compatibility promise — may
 * change or be removed before 1.0.
 *
 * Compiled authoring. The `variant` attribute styles the
 * host directly (:host([variant=...])) — the card's render is fully static.
 *
 * @csspart container - The article wrapper
 * @csspart body - The card body content area
 *
 * Usage:
 * ```html
 * <open-card>
 *   <h3 slot="header">Card Title</h3>
 *   <p>Card content goes here.</p>
 * </open-card>
 *
 * <open-card variant="elevated">
 *   <p>Elevated card with shadow.</p>
 * </open-card>
 * ```
 */
import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';
import { recipe, surfaceRecipe } from './component-recipes.ts';

@element('open-card', { root: 'shadow-open' })
export class OpenCard extends OpenElement {
  static override styles: StyleSheetLike[] = [
    surfaceRecipe,
    recipe(`
    :host {
      display: block;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--color-secondary) 14%, transparent), transparent 48%),
        var(--color-card);
      color: var(--color-foreground);
      border: calc(var(--spacing) * 0.25) solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
      transition: border-color var(--ease-out) var(--default-transition-duration), background var(--ease-out) var(--default-transition-duration), box-shadow var(--ease-out) var(--default-transition-duration);
    }

    :host([variant='elevated']) {
      box-shadow: 0 calc(var(--spacing) * 2) calc(var(--spacing) * 8) color-mix(in srgb, var(--color-primary) 8%, transparent);
      border-color: var(--color-border);
    }

    :host([variant='elevated']:hover) {
      border-color: var(--color-primary);
    }

    :host([variant='borderless']) {
      border-color: transparent;
    }

    :host([variant='muted']) {
      background: var(--color-muted);
    }

    /* Artifact: a permanently-dark code panel in BOTH themes (the same static
       zinc surface open-code-block paints), so ink/border are static ramp
       steps — theme-flipping inks would invert against the fixed surface. */
    :host([variant='artifact']) {
      background: var(--color-zinc-950);
      color: var(--color-zinc-200);
      border-color: var(--color-zinc-700);
    }

    ::slotted([slot='header']) {
      padding: calc(var(--spacing) * 4) calc(var(--spacing) * 5);
      border-bottom: calc(var(--spacing) * 0.25) solid var(--color-border);
      font-size: var(--text-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-foreground);
      margin: 0;
    }

    .card-body {
      padding: calc(var(--spacing) * 5);
    }

    ::slotted([slot='footer']) {
      padding: calc(var(--spacing) * 3) calc(var(--spacing) * 5);
      border-top: calc(var(--spacing) * 0.25) solid var(--color-border);
      font-size: var(--text-sm);
      color: var(--color-muted-foreground);
      margin: 0;
    }
  `),
  ];

  /**
   * The card's public `variant` attribute. Render stays fully static — styles
   * read the host attribute directly (:host([variant=...])) — but the
   * attribute is part of the package's published contract (manifest), so it
   * is a declared compiled property.
   */
  @property({ reflect: false })
  variant = '';

  render(): unknown {
    return (
      <article class='surface' part='container'>
        <slot name='header'></slot>
        <div class='card-body' part='body'>
          <slot></slot>
        </div>
        <slot name='footer'></slot>
      </article>
    );
  }
}
