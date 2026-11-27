/**
 * Runtime for generated elements whose descriptors opt into native form
 * association. The shell supplies its existing internals and property channels.
 */
import { ElementFormController } from '../../../open-element-form.ts';
import type { FormMapping, NormalizedProperty } from './descriptor.ts';

interface FormHost {
  getInternals(): ElementInternals;
  getValidationRoot(): HTMLElement | ShadowRoot | null;
  readProperty(name: string): unknown;
  writeValue(value: string): void;
}

export class GeneratedElementForm {
  readonly #controller = new ElementFormController();
  #effectiveDisabled = false;
  #emailValidator?: HTMLInputElement;
  readonly #element: HTMLElement;
  readonly #mapping: FormMapping;
  readonly #host: FormHost;

  constructor(element: HTMLElement, mapping: FormMapping, host: FormHost) {
    this.#element = element;
    this.#mapping = mapping;
    this.#host = host;
  }

  attach(): void {
    this.#controller.attachWith(this.#host.getInternals);
  }

  #value(): string {
    const row = this.#mapping.value;
    const value = row === null ? undefined : this.#host.readProperty(row.name);
    return typeof value === 'string' ? value : '';
  }

  #syncValidity(): void {
    // The button shape leaves form.checkValidity() at the platform default.
    if (this.#mapping.value === null) return;
    const internals = this.#controller.internals;
    if (internals === undefined) return;
    const { required: requiredRow, type: typeRow } = this.#mapping;
    const value = this.#value();
    const required =
      requiredRow !== undefined && this.#host.readProperty(requiredRow.name) === true;
    const type = typeRow === undefined ? '' : this.#host.readProperty(typeRow.name);
    let valueMissing = required && value === '';
    let typeMismatch = false;
    let message = valueMissing ? 'Please fill out this field.' : '';
    if (
      typeof type === 'string' &&
      type.toLowerCase() === 'email' &&
      this.#host.getValidationRoot()?.querySelector('input[data-form-validation="email"]')
    ) {
      // Use the platform's email grammar, sanitization, and localized message.
      // This control stays outside the rendered tree and the outer form.
      const input = (this.#emailValidator ??= this.#element.ownerDocument.createElement('input'));
      input.type = 'email';
      input.required = required;
      input.value = value;
      valueMissing = input.validity.valueMissing;
      typeMismatch = input.validity.typeMismatch;
      message = input.validationMessage;
    }
    internals.setValidity({ valueMissing, typeMismatch }, message);
    if (valueMissing || typeMismatch) internals.states?.add('invalid');
    else internals.states?.delete('invalid');
  }

  #syncStates(): void {
    const states = this.#controller.internals?.states;
    if (states === undefined) return;
    const { disabled } = this.#mapping;
    const authorDisabled =
      disabled !== undefined && this.#host.readProperty(disabled.name) === true;
    if (authorDisabled || this.#effectiveDisabled) {
      states.delete('enabled');
      states.add('disabled');
    } else {
      states.delete('disabled');
      states.add('enabled');
    }
  }

  syncAll(): void {
    // The button shape contributes no FormData entry.
    if (this.#mapping.value !== null) this.#controller.setFormValue(this.#value());
    this.#syncValidity();
    this.#syncStates();
  }

  syncProperty(property: NormalizedProperty): void {
    if (this.#controller.internals === undefined) return;
    const { value, required, type, disabled } = this.#mapping;
    if (property.name === value?.name) this.syncAll();
    else if (property === required || property === type) this.#syncValidity();
    else if (property.name === disabled?.name) this.#syncStates();
  }

  revalidateAfterProjection(): void {
    if (this.#mapping.type !== undefined) this.#syncValidity();
  }

  reset(): void {
    this.attach();
    const { value } = this.#mapping;
    if (value === null) return;
    this.#host.writeValue(String(value.defaultValue));
    this.syncAll();
  }

  restore(restored: File | string | FormData | null): void {
    this.attach();
    if (typeof restored !== 'string') return;
    this.#host.writeValue(restored);
    this.syncAll();
  }

  setDisabled(disabled: boolean): void {
    this.attach();
    if (this.#effectiveDisabled === disabled) return;
    this.#effectiveDisabled = disabled;
    this.#syncStates();
  }
}
