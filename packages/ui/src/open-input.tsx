/**
 * @openelement/ui - open-input
 *
 * Minimal input field following Swiss International Style.
 * Clean borders, subtle focus states.
 *
 * v0.44: compiled authoring (ADR-0143). Attribute-backed properties drive the
 * compiled sinks (type/placeholder/label/name/value/disabled/required/error);
 * the form contract (setFormValue, validity mirroring, custom states) stays
 * imperative in methods. Per-instance ids are assigned at activation — SSG
 * renders each page in one process while hydration upgrades in arbitrary
 * order, so the two realms can never share a counter (component-recipes.ts).
 *
 * Features:
 * - Form-associated: participates in native <form> submission via
 *   ElementInternals (setFormValue), including the initial `value`
 *   attribute synced on connect
 * - Native constraint validation: required + empty value maps to
 *   valueMissing via internals.setValidity
 * - Supports label, placeholder, error, disabled, required
 * - Dispatches 'open-input' custom event on value change
 *
 * @csspart wrapper -The outer input-wrapper div
 * @csspart label -The label element
 * @csspart control -The input element
 * @csspart error -The error message small element
 *
 * Usage:
 * ```html
 * <open-input placeholder="Enter text"></open-input>
 * <open-input type="email" label="Email"></open-input>
 * <form onsubmit="console.info(new FormData(this))">
 *   <open-input name="username" label="Username"></open-input>
 *   <button type="submit">Submit</button>
 * </form>
 * ```
 */
import { computed, element, OpenElement, property } from '@openelement/element';
import { controlRecipe, nextInstanceId, recipe, syncDisabledState } from './component-recipes.ts';

@element('open-input', { root: 'shadow-open', delegatesFocus: true, formAssociated: true })
export class OpenInput extends OpenElement {
  static override styles = [
    controlRecipe,
    recipe(`
    :host {
      display: block;
    }

    .input-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--size-2);
    }

    label {
      font-size: var(--font-size-0);
      font-weight: var(--font-weight-5);
      color: var(--text-secondary);
      letter-spacing: var(--font-letterspacing-2);
    }

    label[hidden] {
      display: none;
    }

    .input {
      width: 100%;
      padding: var(--size-2) var(--size-3);
      font-family: var(--font-sans);
      font-size: var(--font-size-1);
      color: var(--ui-control-text);
      background: var(--ui-control-bg);
      border: var(--border-size-1) solid var(--ui-control-border);
      border-radius: var(--ui-control-radius);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      outline: none;
    }

    .input::placeholder {
      color: var(--text-muted);
    }

    .input:hover {
      border-color: var(--ui-control-border-hover);
    }

    .input:focus {
      border-color: var(--brand, var(--indigo-6));
      box-shadow: 0 0 0 1px var(--brand, var(--indigo-6));
    }

    .input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--bg-muted);
    }

    .input--error {
      border-color: var(--error);
    }

    :host(:state(disabled)) .input {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--bg-muted);
    }

    :host(:state(invalid)) .input {
      border-color: var(--error);
    }

    .error-message {
      font-size: var(--font-size-00);
      color: var(--error);
    }

    .error-message[hidden] {
      display: none;
    }
  `),
  ];

  @property({ reflect: false })
  type = 'text';

  @property({ reflect: false })
  placeholder = '';

  @property({ reflect: false })
  label = '';

  @property({ reflect: false })
  name = '';

  @property({ reflect: false })
  value = '';

  @property({ reflect: false, type: Boolean })
  disabled = false;

  @property({ reflect: false, type: Boolean })
  required = false;

  @property({ reflect: false })
  error = '';

  /** Assigned at activation; SSR leaves the ids unset (see header note). */
  @property({ reflect: false, attribute: false })
  inputId = '';

  @property({ reflect: false, attribute: false, type: Boolean })
  noLabel = computed(() => this.label === '');

  @property({ reflect: false, attribute: false, type: Boolean })
  noError = computed(() => this.error === '');

  @property({ reflect: false, attribute: false, type: String })
  inputClass = computed(() => this.error === '' ? 'control input' : 'control input input--error');

  @property({ reflect: false, attribute: false, type: String })
  idAttr = computed(() => this.inputId === '' ? null : this.inputId);

  @property({ reflect: false, attribute: false, type: String })
  errorIdAttr = computed(() => this.inputId === '' ? null : `${this.inputId}-error`);

  @property({ reflect: false, attribute: false, type: String })
  ariaInvalidAttr = computed(() => this.error === '' ? null : 'true');

  /** The required-marker text (' *' when required) — a computed string sink. */
  @property({ reflect: false, attribute: false, type: String })
  requiredMark = computed(() => this.required ? ' *' : '');

  @property({ reflect: false, attribute: false, type: String })
  describedByAttr = computed(() =>
    this.error === '' || this.inputId === '' ? null : `${this.inputId}-error`
  );

  render() {
    return (
      <div class='input-wrapper' part='wrapper'>
        <label part='label' for={this.idAttr} hidden={this.noLabel}>
          {this.label}
          <span class='req'>{this.requiredMark}</span>
        </label>
        <input
          id={this.idAttr}
          class={this.inputClass}
          part='control'
          type={this.type}
          placeholder={this.placeholder}
          value={this.value}
          name={this.name}
          disabled={this.disabled}
          required={this.required}
          aria-invalid={this.ariaInvalidAttr}
          aria-describedby={this.describedByAttr}
          aria-errormessage={this.describedByAttr}
          onInput={this.handleInput}
          onChange={this.handleChange}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
        />
        <small
          id={this.errorIdAttr}
          role='alert'
          class='error-message'
          part='error'
          hidden={this.noError}
        >
          {this.error}
        </small>
      </div>
    );
  }

  override onDsdHydrated(): void {
    this.activate();
  }

  override onCsrRendered(): void {
    this.activate();
  }

  /** Assign the realm-unique id once, then sync the form contract. */
  private activate(): void {
    if (this.inputId === '') this.inputId = `input-${nextInstanceId()}`;
    // The initial `value` arrives before connect (parser attributes), so the
    // form value and validity sync here rather than in attributeChangedCallback.
    this.syncFormValue();
    this.syncValidity();
    this.updateStates();
  }

  override attributeChangedCallback(name: string, old: string | null, val: string | null): void {
    super.attributeChangedCallback(name, old, val);
    if (old === val) return;
    if (name === 'value') {
      // The compiled prop sink writes the live input value in place — no
      // re-render, so a focused <input> is never replaced mid-typing (#770).
      this.syncFormValue();
      this.syncValidity();
      return;
    }
    if (name === 'disabled' || name === 'error') {
      this.updateStates();
    }
    if (name === 'required') {
      this.syncValidity();
    }
  }

  private updateStates(): void {
    if (!this._internals?.states) return;
    syncDisabledState(this._internals, this.disabled);
    if (this.error !== '') {
      this._internals.states.add('invalid');
    } else {
      this._internals.states.delete('invalid');
    }
  }

  private syncFormValue(): void {
    this._internals?.setFormValue(this.value);
  }

  /**
   * Validity basics (pilot scope): required + empty value → valueMissing.
   * The inner native <input> is inside the shadow root, so its own
   * constraints never reach the outer form; mirroring them onto the host
   * internals is what makes the custom element a real form citizen.
   * Full constraint mirroring (type=email, minlength, …) is future work.
   */
  private syncValidity(): void {
    const internals = this._internals;
    // Feature-checked: test stubs and older engines may lack setValidity.
    if (!internals || typeof internals.setValidity !== 'function') return;
    if (this.required && this.value === '') {
      // No anchor: bubble placement is UA-dependent. Reuse the inner input's
      // localized message when present.
      const inner = this.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      internals.setValidity(
        { valueMissing: true },
        inner?.validationMessage || 'Please fill out this field.',
      );
    } else {
      internals.setValidity({});
    }
  }

  private handleInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    // The value attribute is the authoritative channel (legacy parity):
    // attribute -> compiled signal -> sinks, and the morph surface stays true.
    this.setAttribute('value', input.value);
    this.syncFormValue();
    this.syncValidity();
    this.dispatchEvent(
      new CustomEvent('open-input', {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.dispatchEvent(
      new CustomEvent('open-change', {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleFocus(): void {
    this.dispatchEvent(new CustomEvent('open-focus', { bubbles: true, composed: true }));
  }

  private handleBlur(): void {
    this.dispatchEvent(new CustomEvent('open-blur', { bubbles: true, composed: true }));
  }

  override formResetCallback(): void {
    super.formResetCallback();
    this.setAttribute('value', '');
    this.removeAttribute('error');
    this.syncFormValue();
    this.syncValidity();
  }

  formDisabledCallback(disabled: boolean): void {
    // Mirror onto the property (reflect: false), not the host attribute: the
    // platform counts a form-associated custom element's own `disabled`
    // attribute toward its disabledness, so writing it here would make the
    // fieldset-driven state irreversible (#1226).
    this.disabled = disabled;
    this.updateStates();
  }
}
