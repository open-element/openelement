/**
 * @openelement/ui - open-badge
 *
 * Compact status badge backed by Open Props semantic tokens.
 * v0.44: compiled authoring (ADR-0143). Variant styling follows the
 * reflected `tone`/`size` host attributes (:host([...]) selectors).
 *
 * @csspart badge - The badge span
 */
import { element, OpenElement, property } from '@openelement/element';
import { recipe } from './component-recipes.ts';

@element('open-badge', { root: 'shadow-open' })
export class OpenBadge extends OpenElement {
  static override styles = [recipe(`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: var(--size-6);
      padding: var(--badge-padding-y) var(--badge-padding-x);
      border: var(--border-size-1) solid var(--border);
      border-radius: var(--badge-radius);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: var(--badge-font-size);
      font-weight: var(--font-weight-8);
      line-height: var(--font-lineheight-3);
      letter-spacing: 0;
      white-space: nowrap;
    }

    :host([tone='brand']) .badge {
      border-color: var(--brand);
      background: var(--brand-subtle);
      color: var(--brand);
    }

    :host([tone='success']) .badge {
      border-color: var(--success);
      background: var(--success-subtle);
      color: var(--success);
    }

    :host([tone='warning']) .badge {
      border-color: var(--warning);
      background: var(--warning-subtle);
      color: var(--warning);
    }

    :host([tone='info']) .badge {
      border-color: var(--info);
      background: var(--info-subtle);
      color: var(--info);
    }

    :host([size='sm']) .badge {
      min-height: var(--size-5);
      padding-inline: var(--size-2);
    }
  `)];

  @property({ reflect: true })
  tone = 'neutral';

  @property({ reflect: true })
  size = 'md';

  render() {
    return (
      <span class='badge' part='badge'>
        <slot></slot>
      </span>
    );
  }
}
