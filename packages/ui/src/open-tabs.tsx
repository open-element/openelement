/**
 * @openelement/ui - open-tabs
 *
 * WAI-ARIA tabs pattern. The slotted [slot="tab"] and [slot="panel"] elements
 * stay live in the light DOM — the component decorates them with role/aria
 * wiring instead of copying textContent into the shadow root, so child markup
 * structure and event listeners are preserved.
 *
 * v0.44: compiled authoring (ADR-0143). The render is fully static (slot
 * projection); the decoration runs imperatively from an effect over the
 * compiled `active` signal, so selecting a tab re-decorates without any
 * re-render. The per-instance id prefix is assigned at activation (SSG and
 * hydration realms never share a counter — component-recipes.ts).
 *
 * Keyboard: ArrowLeft/ArrowRight move between tabs (wrapping), Home/End jump
 * to the first/last tab. Focus follows selection.
 *
 * @slot tab - Tab label element (one per panel)
 * @slot panel - Panel shown while its tab is active
 */
import { effect, element, OpenElement, property } from '@openelement/element';
import { nextInstanceId, recipe } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

@element('open-tabs', { root: 'shadow-open' })
export class OpenTabs extends OpenElement {
  static override styles = [recipe(`
    :host {
      display: block;
    }

    .tabs {
      display: flex;
      gap: var(--size-1);
      padding: var(--size-1);
      border-bottom: 1px solid var(--surface-border);
    }

    ::slotted([slot='tab']) {
      padding: var(--size-2) var(--size-4);
      border-color: transparent;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
    }

    ::slotted([slot='tab']:hover) {
      color: var(--text-primary);
    }

    ::slotted(.tab-active) {
      color: var(--text-primary);
      background: var(--brand-subtle);
      border-color: var(--surface-border-strong);
    }

    ::slotted([slot='panel']) {
      padding-block: var(--size-4);
      color: var(--text-secondary);
    }
  `)];

  /** Active tab index — compiled signal; the decorate effect subscribes. */
  @property({ reflect: false, attribute: false })
  active = 0;

  /** Realm-unique id prefix, assigned at activation. */
  @property({ reflect: false, attribute: false })
  tabsId = '';

  render() {
    return (
      <div>
        <div
          class='tabs'
          role='tablist'
          onKeydown={this.onKeydown}
        >
          <slot name='tab'></slot>
        </div>
        <slot name='panel'></slot>
      </div>
    );
  }

  override onDsdHydrated(): void {
    this.activate();
  }

  override onCsrRendered(): void {
    this.activate();
  }

  override disconnectedCallback(): void {
    readInstanceState(this, 'decorateEffect', () => undefined as undefined | (() => void))?.();
    writeInstanceState(this, 'decorateEffect', undefined);
    super.disconnectedCallback();
  }

  private activate(): void {
    if (this.tabsId === '') this.tabsId = `open-tabs-${nextInstanceId()}`;
    // The decorate effect re-runs when the compiled `active` signal changes;
    // its first synchronous run applies the initial wiring.
    const off = effect(() => {
      void this.active;
      this.decorate();
    });
    writeInstanceState(this, 'decorateEffect', off);
  }

  private tabs(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>('[slot="tab"]')];
  }

  private count(): number {
    return Math.min(this.tabs().length, this.querySelectorAll('[slot="panel"]').length);
  }

  /** Select a tab by index (the WAI-ARIA activation entry point). */
  select(idx: number): void {
    this.active = idx;
  }

  /** WAI-ARIA tabs keyboard pattern: ArrowLeft/ArrowRight/Home/End. */
  private onKeydown(e: KeyboardEvent): void {
    const count = this.count();
    if (count === 0) return;
    const key = e.key;
    const next = key === 'Home'
      ? 0
      : key === 'End'
      ? count - 1
      : key === 'ArrowLeft'
      ? (this.active - 1 + count) % count
      : key === 'ArrowRight'
      ? (this.active + 1) % count
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    this.select(next);
    // Selection follows focus: move DOM focus onto the newly active tab.
    const tab = this.tabs()[next];
    if (tab && typeof tab.focus === 'function') tab.focus();
  }

  /**
   * Decorate the light-DOM tabs/panels with the WAI-ARIA tabs wiring. The
   * effect calls this on activation and on every `active` change, so
   * aria-selected/hidden track the selection; click listeners attach once per
   * tab element (tracked in the shared instance-state module).
   */
  private decorate(): void {
    const tabs = this.tabs();
    const panels = [...this.querySelectorAll<HTMLElement>('[slot="panel"]')];
    const count = Math.min(tabs.length, panels.length);
    const active = this.active;
    const prefix = this.tabsId;
    const wired = readInstanceState(this, 'wiredTabs', () => new WeakSet<HTMLElement>());
    tabs.forEach((tab, i) => {
      const enabled = i < count;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('id', `${prefix}-tab-${i}`);
      tab.setAttribute('aria-selected', i === active && enabled ? 'true' : 'false');
      tab.setAttribute('aria-controls', `${prefix}-panel-${i}`);
      tab.setAttribute('tabindex', i === active ? '0' : '-1');
      tab.classList.toggle('tab-active', i === active);
      if (enabled) tab.removeAttribute('aria-disabled');
      else tab.setAttribute('aria-disabled', 'true');
      if (!wired.has(tab)) {
        wired.add(tab);
        tab.addEventListener('click', () => {
          const idx = this.tabs().indexOf(tab);
          if (idx >= 0 && idx < this.count()) this.select(idx);
        });
      }
    });
    panels.forEach((panel, i) => {
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', `${prefix}-panel-${i}`);
      panel.setAttribute('aria-labelledby', `${prefix}-tab-${i}`);
      if (i === active) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
  }
}
