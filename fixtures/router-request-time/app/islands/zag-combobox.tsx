/**
 * zag-combobox — #1149 spike island (shadow/DSD variant), v0.44 compiled.
 *
 * The compiled kernel owns SSR (DSD), the shadow render root, and the
 * lifecycle; the Zag machine starts only after activation (onDsdHydrated on
 * the claim path, onCsrRendered on the fresh-creation path) and stops in
 * disconnectedCallback. Zag scopes itself to this island's ShadowRoot via
 * getRootNode, so two instances on one page cannot query or collide with
 * each other. Machine state lives in zag-combobox-shared.ts (a WeakMap keyed
 * by host): compiled classes carry only @property fields + methods.
 *
 * The structure below is fully static by design — the compiled grammar v1 has
 * no per-item attribute slots, so the five combobox items are literal markup;
 * Zag drives all per-item behavior (hidden, data-highlighted, ARIA) after
 * activation.
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import {
  resetZagComboboxDom,
  startZagCombobox,
  stopZagCombobox,
  zagComboboxSetControlledValue,
  zagComboboxShadowStyles,
  type ZagComboboxSnapshot,
  zagComboboxSnapshot,
} from '../components/zag-combobox-shared.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('zag-combobox', { root: 'shadow-open' })
export default class ZagCombobox extends OpenElement {
  @property({ reflect: false })
  machineId = '';

  static styles = zagComboboxShadowStyles;

  onDsdHydrated(): void {
    this.startMachine();
  }

  onCsrRendered(): void {
    this.startMachine();
  }

  disconnectedCallback(): void {
    // Compiled-kernel ownership: restore the program's static structure before
    // teardown so a reconnect re-claims cleanly (Zag's spreadProps attribute
    // writes are not part of the program).
    const root = this.shadowRoot;
    if (root) resetZagComboboxDom(root);
    stopZagCombobox(this);
    super.disconnectedCallback();
  }

  /** Start the Zag machine against the claimed/created shadow DOM. */
  startMachine(): void {
    const root = this.shadowRoot;
    if (!root) return;
    startZagCombobox(this, {
      id: this.machineId || 'zag-combobox',
      partsRoot: root,
      getRootNode: () => root,
    });
  }

  /** e2e hook for the controlled-prop evidence path (machine.updateProps). */
  demoSetControlledValue(value: string): void {
    zagComboboxSetControlledValue(this, value);
  }

  /** e2e hook: machine-state snapshot after controlled updates. */
  demoSnapshot(): ZagComboboxSnapshot | null {
    return zagComboboxSnapshot(this);
  }

  render() {
    return (
      <div class='zag-combobox' data-part='root'>
        <label class='zag-combobox-label' data-part='label'>Shadow fruit</label>
        <div class='zag-combobox-control' data-part='control'>
          <input
            class='zag-combobox-input'
            data-part='input'
            type='text'
            placeholder='Type or pick a fruit'
            autocomplete='off'
          />
          <button class='zag-combobox-trigger' data-part='trigger' type='button'>▾</button>
        </div>
        <div class='zag-combobox-positioner' data-part='positioner'>
          <ul class='zag-combobox-content' data-part='content'>
            <li class='zag-combobox-item' data-part='item' data-value='apple'>Apple</li>
            <li class='zag-combobox-item' data-part='item' data-value='banana'>Banana</li>
            <li class='zag-combobox-item' data-part='item' data-value='cherry' data-disabled=''>
              Cherry
            </li>
            <li class='zag-combobox-item' data-part='item' data-value='mango'>Mango</li>
            <li class='zag-combobox-item' data-part='item' data-value='orange'>Orange</li>
          </ul>
        </div>
      </div>
    );
  }
}
