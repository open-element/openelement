/**
 * @openelement/ui - open-badge
 *
 * Compact status badge backed by @theme semantic role tokens.
 * Compiled authoring. Variant styling follows the
 * reflected `tone`/`size` host attributes (:host([...]) selectors).
 *
 * @csspart badge - The badge span
 */
import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';
import { recipe } from './component-recipes.ts';

@element('open-badge', { root: 'shadow-open' })
export class OpenBadge extends OpenElement {
  static override styles: StyleSheetLike[] = [
    recipe(`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: calc(var(--spacing) * 6);
      padding: 2px calc(var(--spacing) * 2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-muted);
      color: var(--color-muted-foreground);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: var(--font-weight-extrabold);
      line-height: 1.5;
      letter-spacing: 0;
      white-space: nowrap;
    }

    :host([tone='brand']) .badge {
      border-color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 14%, transparent);
      color: var(--color-primary);
    }

    :host([tone='success']) .badge {
      border-color: var(--color-success);
      background: var(--color-success-subtle);
      color: var(--color-success);
    }

    :host([tone='warning']) .badge {
      border-color: var(--color-warning);
      background: var(--color-warning-subtle);
      color: var(--color-warning);
    }

    :host([tone='info']) .badge {
      border-color: var(--color-info);
      background: var(--color-info-subtle);
      color: var(--color-info);
    }

    :host([size='sm']) .badge {
      min-height: calc(var(--spacing) * 5);
      padding-inline: calc(var(--spacing) * 2);
    }
  `),
  ];

  @property({ reflect: true })
  tone = 'neutral';

  @property({ reflect: true })
  size = 'md';

  render(): unknown {
    return (
      <span class='badge' part='badge'>
        <slot></slot>
      </span>
    );
  }
}
