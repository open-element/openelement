/**
 * @openelement/ui - open-badge
 *
 * Compact status badge themed by the shadcn role table (C3 #1506).
 * Tones read the destructive/success/warning/info roles, whose 10%
 * color-mix washes the recipes compute inline.
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
      padding: calc(var(--spacing) * 0.5) calc(var(--spacing) * 2);
      border: calc(var(--spacing) * 0.25) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-muted);
      color: var(--color-muted-foreground);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: var(--font-weight-extrabold);
      line-height: var(--leading-normal);
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
      background: color-mix(in srgb, var(--color-success) 10%, transparent);
      color: var(--color-success);
    }

    :host([tone='warning']) .badge {
      border-color: var(--color-warning);
      background: color-mix(in srgb, var(--color-warning) 10%, transparent);
      color: var(--color-warning);
    }

    :host([tone='info']) .badge {
      border-color: var(--color-info);
      background: color-mix(in srgb, var(--color-info) 10%, transparent);
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
