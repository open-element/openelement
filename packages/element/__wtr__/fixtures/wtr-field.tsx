/**
 * WTR pilot fixture (#1333): minimal form-associated custom element (FACE).
 *
 * Distilled from third-party component package/src/open-input.tsx (the production FACE) down to
 * the pilot form contract: required/valueMissing validity mirroring,
 * setFormValue sync, and formResetCallback restore. The inner native <input>
 * lives in the shadow root, so its constraints never reach the outer form;
 * mirroring them onto the host internals is what makes the element a real
 * form citizen. Consumed only through compileElementModule; never executed
 * uncompiled.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('wtr-field', { root: 'shadow-open', formAssociated: true })
export class WtrField extends OpenElement {
  @property({ reflect: false })
  value = '';

  @property({ reflect: false })
  name = '';

  @property({ reflect: false, type: Boolean })
  required = false;

  handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // The compiled prop sink keeps the inner input in place; the signal write
    // below never replaces the focused node.
    this.value = input.value;
    this.syncForm();
  }

  override onCsrRendered(): void {
    this.syncForm();
  }

  override onDsdHydrated(): void {
    this.syncForm();
  }

  override formResetCallback(): void {
    super.formResetCallback();
    this.value = '';
    this.syncForm();
  }

  private syncForm(): void {
    const internals = this._internals;
    if (!internals) return;
    internals.setFormValue(this.value);
    if (this.required && this.value === '') {
      internals.setValidity({ valueMissing: true }, 'Please fill out this field.');
    } else {
      internals.setValidity({});
    }
  }

  render() {
    return (
      <input
        type='text'
        value={this.value}
        name={this.name}
        required={this.required}
        onInput={this.handleInput}
      />
    );
  }
}
