/**
 * @openelement/ui - open-callout
 *
 * Callout/notice box for inline documentation alerts.
 * Supports 4 types: info, warning, danger, tip.
 * Colors read the shadcn role table directly (C3 #1506) and respond to theme
 * changes through the roles' dark pairs; each type's wash is a 10% color-mix
 * of its own border ink.
 *
 * Experimental (owner ruling C1, #1468): no compatibility promise — may
 * change or be removed before 1.0.
 *
 * Compiled authoring. The `type` attribute drives styling
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
import {
  computed,
  element,
  OpenElement,
  property,
  type ReadonlySignal,
  type StyleSheetLike,
} from '@openelement/element';
import { CALLOUT_TYPE_ICONS, recipe } from './component-recipes.ts';

@element('open-callout', { root: 'shadow-open' })
export class OpenCallout extends OpenElement {
  static override styles: StyleSheetLike[] = [
    recipe(`
    :host { display: block; }
    .callout {
      padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
      margin: calc(var(--spacing) * 3) 0;
      border-left: calc(var(--spacing) * 0.5) solid var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 14%, transparent);
      border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    }
    :host([type='warning']) .callout { border-left-color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 10%, transparent); }
    :host([type='danger']) .callout { border-left-color: var(--color-destructive); background: color-mix(in srgb, var(--color-destructive) 10%, transparent); }
    :host([type='tip']) .callout { border-left-color: var(--color-success); background: color-mix(in srgb, var(--color-success) 10%, transparent); }
    .callout-header {
      display: flex; align-items: center; gap: calc(var(--spacing) * 1); margin-bottom: calc(var(--spacing) * 1);
    }
    .callout-header[hidden] { display: none; }
    .callout-icon { font-size: var(--text-sm); line-height: 1; flex-shrink: 0; }
    .callout-title {
      font-size: var(--text-sm); font-weight: var(--font-weight-semibold); color: var(--color-foreground);
    }
    .callout-body {
      font-size: var(--text-base); line-height: var(--leading-relaxed); color: var(--color-muted-foreground);
    }
    .callout-body ::slotted(p) { margin: 0; }
  `),
  ];

  @property({ reflect: true })
  type = 'info';

  @property({ reflect: false })
  label = '';

  /** Type icon text — derived from the `type` attribute via the shared map. */
  @property({ reflect: false, attribute: false, type: String })
  icon: ReadonlySignal<string> = computed(
    () => CALLOUT_TYPE_ICONS[this.type] ?? CALLOUT_TYPE_ICONS.info,
  );

  /** True when no label is set: the header row collapses out of the layout. */
  @property({ reflect: false, attribute: false, type: Boolean })
  headerHidden: ReadonlySignal<boolean> = computed(() => this.label === '');

  render(): unknown {
    return (
      <div class='callout' part='container'>
        <div class='callout-header' hidden={this.headerHidden}>
          <span class='callout-icon' part='icon'>
            {this.icon}
          </span>
          <span class='callout-title'>{this.label}</span>
        </div>
        <div class='callout-body' part='content'>
          <slot></slot>
        </div>
      </div>
    );
  }
}
