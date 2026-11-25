/** Handle open-button activation and its associated form action. */
/** The generated element's declared rows, as this module reads them. */
export type ButtonHost = HTMLElement & {
  disabled: boolean;
  href: string;
  type: string;
};

function associatedForm(host: ButtonHost): HTMLFormElement | null {
  const id = host.getAttribute('form');
  if (id === null) return host.closest('form');
  const root = host.getRootNode() as Document | ShadowRoot;
  const owner = root.getElementById?.(id);
  return owner?.tagName === 'FORM' ? (owner as HTMLFormElement) : null;
}

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
  if (host.disabled || host.matches(':disabled')) {
    event.preventDefault();
    return;
  }

  // The PUBLISHER is the caller's: the manifest's event recognizer scans the
  // component module for dispatch sites, so the authored component owns the
  // `open-click` dispatch and this helper owns when it happens (after the
  // disabled guard, before the form action).
  publishClick();

  if (host.href !== '') return;

  const form = associatedForm(host);
  if (form === null) return;
  const prototype = form.ownerDocument?.defaultView?.HTMLFormElement.prototype;
  if (host.type === 'submit') submitForm(form, prototype);
  else if (host.type === 'reset') (prototype?.reset ?? form.reset).call(form);
}

/**
 * Submit `form` on behalf of the host (#637).
 *
 * `requestSubmit()` runs native constraint validation and dispatches exactly
 * one native submit event. The router's enhancement handler is attached to the
 * form's containing shadow root, so it sees that event without a synthetic
 * composed event from the custom control's separate shadow root.
 */
function submitForm(form: HTMLFormElement, prototype: HTMLFormElement | undefined): void {
  // Named form controls can mask the built-in methods.
  const requestSubmit = prototype?.requestSubmit ?? form.requestSubmit;
  if (typeof requestSubmit === 'function') {
    requestSubmit.call(form);
    return;
  }

  const reportValidity = prototype?.reportValidity ?? form.reportValidity;
  const checkValidity = prototype?.checkValidity ?? form.checkValidity;
  const validate = typeof reportValidity === 'function' ? reportValidity : checkValidity;
  if (!form.noValidate && typeof validate === 'function' && !validate.call(form)) return;
  const submit = prototype?.submit ?? form.submit;
  if (typeof submit === 'function') submit.call(form);
}
