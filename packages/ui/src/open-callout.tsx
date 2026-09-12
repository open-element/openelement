/**
 * @openelement/ui - open-callout
 *
 * Callout/notice box for inline documentation alerts.
 * Supports 4 types: info, warning, danger, tip.
 * Colors use semantic tokens and respond to theme changes; the light-theme
 * warn/danger/tip backgrounds use tuned rgba tints on top of them.
 *
 * v0.44: compiled authoring (ADR-0143). The `type` attribute drives styling
 * (:host([type=...])); the label header is a compiled text sink hidden via a
 * computed flag when no label is set.
 *
 * @csspart container - The callout wrapper
 * @csspart icon - The type icon span
 * @csspart content - The content area
 *
 * Usage:
 * ```html
 * <open-callout type="info" label="Note">
 *   This is an informational callout.
 * </open-callout>
 * ```
 */
import { computed, element, OpenElement, property } from '@openelement/element';
import { CALLOUT_TYPE_ICONS, recipe } from './component-recipes.ts';

@element('open-callout', { root: 'shadow-open' })
export class OpenCallout extends OpenElement {
  static override styles = [recipe(`
    :host { display: block; }
    .callout {
      padding: var(--size-3) var(--size-4);
      margin: var(--size-3) 0;
      border-left: var(--border-size-2) solid var(--brand);
      background: var(--brand-subtle);
      border-radius: 0 var(--radius-2) var(--radius-2) 0;
    }
    :host([type='warning']) .callout { border-left-color: var(--warning); background: var(--warning-subtle); }
    :host([type='danger']) .callout { border-left-color: var(--error); background: var(--error-subtle); }
    :host([type='tip']) .callout { border-left-color: var(--success); background: var(--success-subtle); }
    :host([data-theme='light'][type='warning']) .callout { background: rgba(245,158,11,0.06); }
    :host([data-theme='light'][type='danger']) .callout { background: rgba(239,68,68,0.06); }
    :host([data-theme='light'][type='tip']) .callout { background: rgba(34,197,94,0.06); }
    .callout-header {
      display: flex; align-items: center; gap: var(--size-1); margin-bottom: var(--size-1);
    }
    .callout-header[hidden] { display: none; }
    .callout-icon { font-size: var(--font-size-0); line-height: 1; flex-shrink: 0; }
    .callout-title {
      font-size: var(--font-size-0); font-weight: var(--font-weight-6); color: var(--text-primary);
    }
    .callout-body {
      font-size: var(--font-size-1); line-height: var(--font-lineheight-4); color: var(--text-secondary);
    }
    .callout-body ::slotted(p) { margin: 0; }
  `)];

  @property({ reflect: true })
  type = 'info';

  @property({ reflect: false })
  label = '';

  /** Type icon text — derived from the `type` attribute via the shared map. */
  @property({ reflect: false, attribute: false, type: String })
  icon = computed(() => CALLOUT_TYPE_ICONS[this.type] ?? CALLOUT_TYPE_ICONS.info);

  /** True when no label is set: the header row collapses out of the layout. */
  @property({ reflect: false, attribute: false, type: Boolean })
  headerHidden = computed(() => this.label === '');

  render() {
    return (
      <div class='callout' part='container'>
        <div class='callout-header' hidden={this.headerHidden}>
          <span class='callout-icon' part='icon'>{this.icon}</span>
          <span class='callout-title'>{this.label}</span>
        </div>
        <div class='callout-body' part='content'>
          <slot></slot>
        </div>
      </div>
    );
  }
}
