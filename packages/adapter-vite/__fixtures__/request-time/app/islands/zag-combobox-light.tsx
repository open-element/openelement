/**
 * zag-combobox-light — #1149 spike island (light-mode variant), v0.44
 * compiled (default light root).
 *
 * Light-mode qualification path composing with ADR-0142 (#1148): the SSR'd
 * light subtree carries data-oe-light and is claimed in place — node
 * identity, focus, and the pre-upgrade input value survive, and the Zag
 * machine then binds to that surviving DOM (seeding defaultInputValue from
 * the live input, see zag-combobox-shared.ts). Form participation is real
 * here: the input lives in the same tree as the page's <form>, so a native
 * POST carries the selected value.
 *
 * Light mode has no shadow style scope, so the Open Props / --oe-* sheet is
 * SSR'd as a compiled static <style> node scoped to the component root class.
 */
import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import {
  resetZagComboboxDom,
  startZagCombobox,
  stopZagCombobox,
  zagComboboxLightStyles,
  zagComboboxSetControlledValue,
  type ZagComboboxSnapshot,
  zagComboboxSnapshot,
} from '../components/zag-combobox-shared.ts';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('zag-combobox-light')
export default class ZagComboboxLight extends OpenElement {
  @property({ reflect: false })
  machineId = '';

  static styles = zagComboboxLightStyles;

  onDsdHydrated(): void {
    this.startMachine();
  }

  onCsrRendered(): void {
    this.startMachine();
  }

  disconnectedCallback(): void {
    // Compiled-kernel ownership: see the shadow variant's note.
    resetZagComboboxDom(this);
    stopZagCombobox(this);
    super.disconnectedCallback();
  }

  /** Start the Zag machine against the claimed/created light DOM. */
  startMachine(): void {
    startZagCombobox(this, {
      id: this.machineId || 'zag-combobox-light',
      name: 'fruit',
      partsRoot: this,
      // Light mode: the part ids live in the host's root node — a ShadowRoot
      // when nested inside a page, the Document for a top-level host.
      getRootNode: () => this.getRootNode(),
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
      <div class='zag-combobox-light'>
        <div class='zag-combobox' data-part='root'>
          <label class='zag-combobox-label' data-part='label'>Fruit</label>
          <div class='zag-combobox-control' data-part='control'>
            <input
              class='zag-combobox-input'
              data-part='input'
              type='text'
              name='fruit'
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
      </div>
    );
  }
}
