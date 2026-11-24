/**
 * @openelement/ui - open-button click choreography (helper).
 *
 * The generated element owns the compiled template (the two branches, the slots
 * and the disabled sinks); this module owns the two things a compiled sink
 * cannot express: the composed `open-click` dispatch and the form
 * submit/reset choreography (#637, 异味③).
 *
 * THE FORM LOOKUP IS `closest('form')` ON THE HOST, not `internals.form`. The
 * class lane read `internals.form` first because that is the authoritative
 * association; the generated lane's one-shot internals record is the shell's
 * (a compiled component never sees it). Both agree for every in-tree consumer:
 * the only submitting usage is a host nested inside its own `<form>`, and the
 * `form=<id>` external association — the one case where they differ — has zero
 * consumers in the repository. The gap is recorded with the host-access
 * prerequisite in `m09-2d-forms.md`; when that prerequisite lands, this helper
 * is where the authoritative read plugs in.
 */

/** The generated element's declared rows, as this module reads them. */
export type ButtonHost = HTMLElement & {
  disabled: boolean;
  href: string;
  type: string;
};

/**
 * Dispatch the composed `open-click` and run the control's action.
 *
 * Disabled guard (#757): the anchor branch and a programmatic `click()` both
 * reach this handler, so a disabled open-button must not fire `open-click`,
 * navigate, or submit. The anchor's own `href` is already dropped by the
 * compiled sink; this covers the rest.
 *
 * The anchor branch is a navigation control and never submits or resets a form
 * (异味③, #637): only the `<button>` branch continues past the `open-click`.
 */
export function activateButton(host: ButtonHost, event: Event, publishClick: () => void): void {
  if (host.disabled) {
    event.preventDefault();
    return;
  }

  // The PUBLISHER is the caller's: the manifest's event recognizer scans the
  // component module for dispatch sites, so the authored component owns the
  // `open-click` dispatch and this helper owns when it happens (after the
  // disabled guard, before the form action).
  publishClick();

  if (host.href !== '') return;

  const form = typeof host.closest === 'function' ? host.closest('form') : null;
  if (form === null) return;
  if (host.type === 'submit') submitForm(form);
  else if (host.type === 'reset') form.reset();
}

/**
 * Submit `form` on behalf of the host (#637).
 *
 * `requestSubmit()` runs native constraint validation and dispatches exactly
 * one native submit event. The router's enhancement handler is attached to the
 * form's containing shadow root, so it sees that event without a synthetic
 * composed event from the custom control's separate shadow root.
 */
export function submitForm(form: HTMLFormElement): void {
  const formEl = form as HTMLFormElement & {
    requestSubmit?: () => void;
    reportValidity?: () => boolean;
    checkValidity?: () => boolean;
    submit: () => void;
  };

  const validForSubmit = (): boolean => {
    if (form.noValidate) return true;
    if (typeof formEl.reportValidity === 'function') return formEl.reportValidity();
    if (typeof formEl.checkValidity === 'function') return formEl.checkValidity();
    return true;
  };

  const submitWithoutEvent = (): void => {
    // A control named "submit" masks the form's method on the instance. Call
    // the platform method from the prototype when it is available.
    const prototypeSubmit = Object.getPrototypeOf(form)?.submit as
      | ((this: HTMLFormElement) => void)
      | undefined;
    const submit = typeof prototypeSubmit === 'function' ? prototypeSubmit : formEl.submit;
    if (typeof submit === 'function') submit.call(form);
  };

  if (typeof formEl.requestSubmit === 'function') {
    formEl.requestSubmit.call(form);
    return;
  }
  if (validForSubmit()) submitWithoutEvent();
}
