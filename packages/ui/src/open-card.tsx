/**
 * @openelement/ui - open-card
 *
 * Minimal card container with optional header and footer.
 * Swiss International Style: borders are whispers, not shouts.
 *
 * v0.44: compiled authoring (ADR-0143). The `variant` attribute styles the
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
import { element, OpenElement, property } from '@openelement/element';
import { recipe, surfaceRecipe } from './component-recipes.ts';

@element('open-card', { root: 'shadow-open' })
export class OpenCard extends OpenElement {
  static override styles = [
    surfaceRecipe,
    recipe(`
    :host {
      display: block;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--violet-1) 14%, transparent), transparent 48%),
        var(--bg-card);
      color: var(--text-primary);
      border: var(--border-size-1) solid var(--border);
      border-radius: var(--card-radius);
      overflow: hidden;
      transition: border-color var(--ease-3) var(--duration-2), background var(--ease-3) var(--duration-2), box-shadow var(--ease-3) var(--duration-2);
    }

    :host([variant='elevated']) {
      box-shadow: 0 var(--size-2) var(--size-8) color-mix(in srgb, var(--brand) 8%, transparent);
      border-color: var(--border);
    }

    :host([variant='elevated']:hover) {
      border-color: var(--brand);
    }

    :host([variant='borderless']) {
      border-color: transparent;
    }

    :host([variant='muted']) {
      background: var(--bg-surface);
    }

    :host([variant='artifact']) {
      background: var(--bg-code, var(--gray-11));
      color: var(--gray-2);
      border-color: var(--code-border, var(--gray-8));
    }

    ::slotted([slot='header']) {
      padding: var(--size-4) var(--size-5);
      border-bottom: var(--border-size-1) solid var(--border);
      font-size: var(--font-size-2);
      font-weight: var(--font-weight-6);
      color: var(--text-primary);
      margin: 0;
    }

    .card-body {
      padding: var(--size-5);
    }

    ::slotted([slot='footer']) {
      padding: var(--size-3) var(--size-5);
      border-top: var(--border-size-1) solid var(--border);
      font-size: var(--font-size-0);
      color: var(--text-muted);
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

  render() {
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
