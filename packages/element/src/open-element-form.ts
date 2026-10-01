/**
 * Attach ElementInternals for form-associated custom elements.
 *
 * Extracted from the base class (#904, concern: formAssociated +
 * delegatesFocus). Returns internals only when the component opted in via
 * `static formAssociated` and the runtime provides attachInternals
 * (non-browser test doubles may not).
 */
export function attachFormInternals(
  element: {
    attachInternals?: () => ElementInternals;
  },
  ctor: { formAssociated?: boolean },
): ElementInternals | undefined {
  if (ctor.formAssociated && typeof element.attachInternals === 'function') {
    return element.attachInternals();
  }
  return undefined;
}

export interface FormAssociatedHost {
  attachInternals?: () => ElementInternals;
}

export interface FormAssociatedConstructor {
  formAssociated?: boolean;
}

/**
 * Element-local form state owner for the compiled kernel. It deliberately
 * contains no renderer hook: platform form callbacks update the one internals
 * object and an element may provide its own reset/restore behavior.
 */
export class ElementFormController {
  #internals?: ElementInternals;
  #onReset?: () => void;
  #onRestore?: (state: File | string | FormData | null, mode: string) => void;

  attach(
    element: FormAssociatedHost,
    ctor: FormAssociatedConstructor,
  ): ElementInternals | undefined {
    if (this.#internals) return this.#internals;
    this.#internals = attachFormInternals(element, ctor);
    return this.#internals;
  }

  get internals(): ElementInternals | undefined {
    return this.#internals;
  }

  setFormValue(
    value: File | string | FormData | null,
    state?: File | string | FormData | null,
  ): void {
    this.#internals?.setFormValue(value, state);
  }

  setValidity(flags?: ValidityStateFlags, message?: string, anchor?: HTMLElement): void {
    if (!this.#internals) return;
    if (flags && Object.keys(flags).length > 0) this.#internals.setValidity(flags, message, anchor);
    else this.#internals.setValidity({});
  }

  onReset(callback: () => void): void {
    this.#onReset = callback;
  }

  onRestore(callback: (state: File | string | FormData | null, mode: string) => void): void {
    this.#onRestore = callback;
  }

  formResetCallback(): void {
    this.#onReset?.();
  }

  formStateRestoreCallback(state: File | string | FormData | null, mode: string): void {
    this.#onRestore?.(state, mode);
  }

  dispose(): void {
    this.#onReset = undefined;
    this.#onRestore = undefined;
    this.#internals = undefined;
  }
}

/** Short internal name used by the compiled element kernel. */
export const FormController = ElementFormController;
