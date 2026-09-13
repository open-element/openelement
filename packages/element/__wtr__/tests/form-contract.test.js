/**
 * Element browser conformance (#1333): form contract slice on the compiled side, against real
 * browser form semantics: required controls, reset/restore, and submitter
 * name/value.
 *
 * The component is a minimal FACE (form-associated custom element) compiled
 * through the official path; its inner native <input> lives in the shadow
 * root, so constraint/validity mirroring onto the host internals is what
 * makes it a form citizen. The submitter is a NATIVE button — the maturation
 * map explicitly warns not to assume a FACE element is accepted as a
 * requestSubmit(submitter) submitter.
 *
 * Assertions go through platform-observable channels only: form.elements
 * listing, form.checkValidity(), :invalid/:valid matching, the invalid event,
 * and the FormData entry list. (The validity/checkValidity members of a FACE
 * live on its ElementInternals, not on the host element — probed in Chromium
 * during this suite; see README.)
 */
import { assert } from 'chai';
import { WtrField } from '../generated/wtr-field.ts';

customElements.define('wtr-field', WtrField);
await customElements.whenDefined('wtr-field');

function setup() {
  const form = document.createElement('form');
  const field = document.createElement('wtr-field');
  field.setAttribute('name', 'q');
  field.setAttribute('required', '');
  const submitter = document.createElement('button');
  submitter.type = 'submit';
  submitter.name = 'intent';
  submitter.value = 'save';
  submitter.textContent = 'Save';
  form.append(field, submitter);
  document.body.appendChild(form);
  return { form, field, submitter };
}

/** Simulate typing: set the inner control's value and dispatch input. */
function typeInto(field, value) {
  const input = field.shadowRoot.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  return input;
}

/** Exercise the browser-standard FormData(form, submitter) overload.
 * Reflect.construct keeps CodeQL's Node-only FormData model from treating the
 * browser overload as a superfluous argument. */
function formDataForSubmitter(form, submitter) {
  return Reflect.construct(FormData, [form, submitter]);
}

describe('compiled FACE form contract', () => {
  it('the form lists the FACE and counts its required/valueMissing constraint', () => {
    const { form, field, submitter } = setup();

    assert.strictEqual(
      form.elements.namedItem('q'),
      field,
      'the platform lists the form-associated element',
    );
    assert.strictEqual(field.matches(':invalid'), true, 'host mirrors valueMissing (:invalid)');
    assert.strictEqual(form.checkValidity(), false, 'the form counts the FACE constraint');

    const events = { invalid: 0, submit: 0 };
    field.addEventListener('invalid', () => events.invalid++);
    form.addEventListener('submit', (event) => {
      events.submit++;
      event.preventDefault();
    });
    form.requestSubmit(submitter);

    assert.strictEqual(events.invalid, 1, 'interactive validation fires invalid on the host');
    assert.strictEqual(events.submit, 0, 'valueMissing blocks the submission');

    form.remove();
  });

  it('a typed value validates, submits, and the submitter lands in FormData', () => {
    const { form, field, submitter } = setup();
    typeInto(field, 'hello');

    assert.strictEqual(field.value, 'hello', 'input event drives the property');
    assert.strictEqual(field.matches(':valid'), true, 'constraint cleared after typing');
    assert.strictEqual(form.checkValidity(), true);

    let captured = null;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      captured = formDataForSubmitter(form, event.submitter);
    });
    form.requestSubmit(submitter);

    assert.isNotNull(captured, 'submission proceeds once valid');
    assert.strictEqual(captured.get('q'), 'hello', 'FACE value is in the entry list');
    assert.strictEqual(
      captured.get('intent'),
      'save',
      'submitter name/value lands in FormData',
    );

    form.remove();
  });

  it('form reset restores the control via formResetCallback', () => {
    const { form, field } = setup();
    const input = typeInto(field, 'hello');
    assert.strictEqual(field.value, 'hello');

    form.reset();

    assert.strictEqual(field.value, '', 'formResetCallback restored the property');
    assert.strictEqual(input.value, '', 'the compiled prop sink cleared the inner input');
    assert.strictEqual(
      field.matches(':invalid'),
      true,
      'validity re-synced to the restored (empty) value',
    );
    assert.strictEqual(
      field.shadowRoot.querySelector('input'),
      input,
      'reset updated in place; the focused control was never replaced',
    );

    form.remove();
  });
});
