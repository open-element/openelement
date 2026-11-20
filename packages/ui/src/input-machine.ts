/**
 * @openelement/ui - open-input activation + form-surface choreography (helper).
 *
 * The generated element owns the compiled template and the declared rows; the
 * shell owns the FORM CONTRACT (value publish, required validity, reset/restore,
 * fieldset states - M09-2d). This module only projects the surfaces the compiled
 * sinks cannot express on their own: the control's LIVE PROPERTY (`value`, which
 * has no attribute wire) and `disabled` (which composes the author row with the
 * fieldset state the shell seats as `:state(disabled)`).
 *
 * IDS ARE STATIC. A shadow root is its own id scope, so the label/control/error
 * pair can spell the SAME ids in every instance; nothing outside the root can
 * observe them. The class lane used a realm-unique counter because SSR and CSR
 * had to agree on one document-wide identity — with the ids inside the shadow
 * tree that constraint is gone, and a static spelling also means the ids are
 * part of the compiled attribute seed instead of a post-claim write (a runtime
 * write would fail the claim's static-seed check).
 *
 * Functions take the host explicitly - the same host the lifecycle `env`
 * provides - so the unit harness drives them without connecting an element.
 */

/** The generated element's declared rows, as this module reads them. */
export type InputHost = HTMLElement & {
  value: string;
  error: string;
  disabled: boolean;
};

function innerControl(host: InputHost): HTMLInputElement | null {
  const input = host.shadowRoot?.querySelector('[part=control]');
  return (input as HTMLInputElement | null) ?? null;
}

/**
 * Project the declared `value` row onto the control's LIVE property, skipping a
 * write the control already satisfies so a user's typing is never clobbered.
 */
export function syncInputValue(host: InputHost): void {
  const control = innerControl(host);
  if (control === null || control.value === host.value) return;
  control.value = host.value;
}

/* There is deliberately no `syncInputError` here.
 *
 * The `error` row's whole projection (the message text, the two `hidden` flags
 * and the three ARIA attributes) is authored as INLINE JSX expressions in
 * open-input.tsx, so the compiler derives `error` as their dependency and emits
 * one refresh per sink bound to it. A helper projecting the same rows would be a
 * SECOND writer of facts the compiled refresh already owns — and it cannot be
 * the only writer either: the ARIA attributes must exist in the DSD output,
 * where no lifecycle hook has run yet.
 */

/**
 * Keep the control's `disabled` in step with the author row and the platform's
 * fieldset state (which reaches this leaf only as the shell's
 * `:state(disabled)`).
 */
export function syncInputDisabled(host: InputHost): void {
  const control = innerControl(host);
  if (control === null) return;
  let fieldsetDisabled = false;
  try {
    fieldsetDisabled = host.matches(':state(disabled)') && !host.disabled;
  } catch {
    fieldsetDisabled = false;
  }
  const next = host.disabled || fieldsetDisabled;
  if (control.disabled === next) return;
  control.disabled = next;
}

/** The live value channel: write the declared row. */
export function writeInputValue(host: InputHost, event: Event): void {
  const control = event.target as HTMLInputElement;
  host.value = control.value;
}
