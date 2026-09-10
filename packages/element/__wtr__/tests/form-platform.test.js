/**
 * WTR platform matrix (#1339 §5, Beta.2.2): the real-browser form/platform
 * contract rows that the pilot (form-contract.test.js) does not already
 * cover. Every case runs the compiled FACE (generated/wtr-field.ts) inside a
 * real form in Chromium, Firefox and WebKit:
 *
 *   1. formnovalidate on a submitter bypasses the constraint validation that
 *      blocks the plain submitter on the same form.
 *   2. requestSubmit(faceHost) — a FACE host is NOT a native submit button;
 *      the platform rejects it (asserted per engine, message recorded).
 *   3. Enter-key implicit submission on a text input fires submit through
 *      the default submitter (first submit button in tree order) — the
 *      submitter actually landing in FormData is asserted, not assumed.
 *   4. Repeated names + <select multiple>: exact FormData entry-list order
 *      and getAll contents (tree order, FACE included).
 *   5. A File chosen via DataTransfer lands in FormData with its filename.
 *   6. action/method/enctype/target IDL vs attribute resolution, including
 *      submitter formaction/formmethod/formenctype/formtarget overrides
 *      (IDL reads the document URL when the attribute is absent — #576).
 *   7. Restore-reason path: the component (like packages/ui open-input.tsx)
 *      implements formResetCallback only; the inherited
 *      formStateRestoreCallback is a safe no-op because no restore hook is
 *      registered. Only what the component implements is asserted.
 *
 * Style: no sleeps; async settling is awaited through waitFor predicates.
 */
import { assert } from 'chai';
import { sendKeys } from '@web/test-runner-commands';
import { WtrField } from '../generated/wtr-field.ts';

customElements.define('wtr-field', WtrField);
await customElements.whenDefined('wtr-field');

/** Poll a predicate on animation frames; fail with a label on timeout. */
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** form > wtr-field(name=q) + caller-supplied extra controls; connected. */
function setup({ required = true } = {}) {
  const form = document.createElement('form');
  const field = document.createElement('wtr-field');
  field.setAttribute('name', 'q');
  if (required) field.setAttribute('required', '');
  form.appendChild(field);
  document.body.appendChild(form);
  return { form, field };
}

function makeSubmitter(name, value, attrs = {}) {
  const button = document.createElement('button');
  button.type = 'submit';
  button.name = name;
  button.value = value;
  for (const [attr, attrValue] of Object.entries(attrs)) {
    button.setAttribute(attr, attrValue);
  }
  return button;
}

/** Simulate typing: set the inner control's value and dispatch input. */
function typeInto(field, value) {
  const input = field.shadowRoot.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Count submit/invalid events; submits are always canceled in-page. */
function watch(form) {
  const events = { submits: [], invalids: 0 };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    events.submits.push(event);
  });
  form.addEventListener('invalid', () => events.invalids++, true);
  return events;
}

describe('form/platform matrix', () => {
  it('1. formnovalidate submitter bypasses the validation that blocks the plain submitter', () => {
    // The required FACE (added by setup) carries the valueMissing constraint.
    const { form } = setup();
    const plain = makeSubmitter('intent', 'save');
    const noValidate = makeSubmitter('intent', 'draft', { formnovalidate: '' });
    form.append(plain, noValidate);
    const events = watch(form);

    // The plain submitter is blocked by the FACE valueMissing constraint.
    form.requestSubmit(plain);
    assert.strictEqual(events.submits.length, 0, 'plain submit blocked by valueMissing');
    assert.strictEqual(events.invalids, 1, 'interactive validation fired invalid');

    // The formnovalidate submitter skips constraint validation entirely.
    form.requestSubmit(noValidate);
    assert.strictEqual(events.submits.length, 1, 'formnovalidate submission proceeds');
    assert.strictEqual(events.submits[0].submitter, noValidate, 'submitter identity preserved');
    assert.strictEqual(events.invalids, 1, 'no second validation pass');

    const body = new FormData(form, events.submits[0].submitter);
    assert.strictEqual(body.get('q'), '', 'empty FACE value travels on the bypassed submit');
    assert.strictEqual(body.get('intent'), 'draft', 'the bypassing submitter is in the body');

    form.remove();
  });

  it('2. requestSubmit(faceHost) rejects: a FACE is not a native submit button', () => {
    const { form, field } = setup();
    const plain = makeSubmitter('intent', 'save');
    form.appendChild(plain);
    const events = watch(form);

    let thrown = null;
    try {
      form.requestSubmit(field);
    } catch (error) {
      thrown = error;
    }
    // Per the HTML spec (requestSubmit steps), a non-submit-button argument
    // throws a TypeError; the message text is engine-specific and recorded.
    assert.isNotNull(thrown, 'the platform rejects a FACE host as submitter');
    assert.instanceOf(thrown, TypeError, 'rejection is a TypeError');
    console.log(
      `[case2] ${navigator.userAgent.includes('Firefox') ? 'firefox' : 'other'}: ${thrown.message}`,
    );
    assert.strictEqual(events.submits.length, 0, 'no submission happened');
    assert.strictEqual(events.invalids, 0, 'no validation pass ran for the rejected call');

    // The same form still submits normally with a real submit button.
    typeInto(field, 'hello');
    form.requestSubmit(plain);
    assert.strictEqual(events.submits.length, 1, 'native submitter still works');

    form.remove();
  });

  it('3. Enter on a text input implicitly submits via the default submitter', async () => {
    const { form, field } = setup();
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'title';
    // Two named submitters: implicit submission must pick the FIRST submit
    // button in tree order (the default button), never the second.
    const first = makeSubmitter('intent', 'first');
    const second = makeSubmitter('intent', 'second');
    form.prepend(input);
    form.append(first, second);
    const events = watch(form);

    typeInto(field, 'typed');
    input.value = 'enter-title';
    input.focus();
    await sendKeys({ press: 'Enter' });

    await waitFor(() => events.submits.length === 1, 'implicit submission submit event');
    const submit = events.submits[0];
    assert.strictEqual(submit.submitter, first, 'default submitter is the first submit button');

    const body = new FormData(form, submit.submitter);
    assert.strictEqual(body.get('title'), 'enter-title');
    assert.strictEqual(body.get('q'), 'typed', 'FACE value travels on implicit submission');
    assert.strictEqual(body.get('intent'), 'first', 'the default submitter lands in FormData');
    assert.strictEqual(body.getAll('intent').length, 1, 'exactly one submitter entry');

    form.remove();
  });

  it('4. repeated names and <select multiple> keep exact entry-list order', () => {
    const { form, field } = setup({ required: false });
    const dupA = document.createElement('input');
    dupA.name = 'dup';
    dupA.value = 'a';
    const dupB = document.createElement('input');
    dupB.name = 'dup';
    dupB.value = 'b';
    const select = document.createElement('select');
    select.name = 'sel';
    select.multiple = true;
    for (const [value, selected] of [['v1', true], ['v2', false], ['v3', true]]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = selected;
      select.appendChild(option);
    }
    // Tree order: dup(a), FACE(q), dup(b), select.
    form.prepend(dupA);
    form.append(dupB, select);
    typeInto(field, 'middle');

    const body = new FormData(form);
    assert.deepEqual(
      [...body.entries()],
      [['dup', 'a'], ['q', 'middle'], ['dup', 'b'], ['sel', 'v1'], ['sel', 'v3']],
      'the entry list is tree order; selected options follow option order',
    );
    assert.deepEqual(body.getAll('dup'), ['a', 'b']);
    assert.deepEqual(body.getAll('sel'), ['v1', 'v3']);
    assert.strictEqual(body.get('sel'), 'v1', 'get() returns the first matching entry');

    form.remove();
  });

  it('5. a File selected via DataTransfer lands in FormData with its filename', async () => {
    const { form, field } = setup({ required: false });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'upload';
    form.appendChild(fileInput);
    typeInto(field, 'with-file');

    const transfer = new DataTransfer();
    transfer.items.add(new File(['hello world'], 'hello.txt', { type: 'text/plain' }));
    fileInput.files = transfer.files;
    assert.strictEqual(fileInput.files.length, 1, 'the file list took the DataTransfer file');

    const body = new FormData(form);
    const entry = body.get('upload');
    assert.instanceOf(entry, File, 'the entry is a File, not a string');
    assert.strictEqual(entry.name, 'hello.txt', 'the filename travels');
    assert.strictEqual(entry.type, 'text/plain');
    assert.strictEqual(await entry.text(), 'hello world', 'the file bytes travel');
    assert.strictEqual(body.get('q'), 'with-file', 'FACE coexists with the file entry');

    form.remove();
  });

  it('6. action/method/enctype/target IDL resolve against attributes and submitter overrides', () => {
    const { form } = setup({ required: false });
    const submitter = makeSubmitter('intent', 'save');
    form.appendChild(submitter);

    // Missing attributes: IDL falls back to the document URL / default
    // keywords (#576) while the content attributes stay absent.
    assert.strictEqual(form.getAttribute('action'), null);
    assert.strictEqual(form.action, document.URL, 'missing action -> document URL');
    assert.strictEqual(form.method, 'get', 'missing method -> get');
    assert.strictEqual(form.enctype, 'application/x-www-form-urlencoded');
    assert.strictEqual(form.target, '', 'missing target -> empty string');

    assert.strictEqual(submitter.formAction, document.URL, 'missing formaction -> document URL');
    // Unlike form.method, the SUBMITTER reflection of formmethod/formenctype
    // has the empty string as its missing-value default (the form's own
    // defaults apply at submission time instead) — identical in all engines.
    assert.strictEqual(submitter.formMethod, '', 'missing formmethod -> empty string');
    assert.strictEqual(submitter.formEnctype, '', 'missing formenctype -> empty string');
    assert.strictEqual(submitter.formTarget, '', 'missing formtarget -> empty string');

    // Present attributes: IDL resolves relative to the document; the raw
    // attribute is untouched.
    form.setAttribute('action', 'next-page');
    assert.strictEqual(form.getAttribute('action'), 'next-page');
    assert.strictEqual(
      form.action,
      new URL('next-page', document.URL).href,
      'IDL resolves the attribute against the document URL',
    );
    form.setAttribute('method', 'POST');
    assert.strictEqual(form.method, 'post', 'IDL normalizes the keyword case');
    form.setAttribute('method', 'bogus');
    assert.strictEqual(form.method, 'get', 'unknown keyword falls back to get');
    form.setAttribute('enctype', 'multipart/form-data');
    assert.strictEqual(form.enctype, 'multipart/form-data');
    form.setAttribute('enctype', 'bogus');
    assert.strictEqual(
      form.enctype,
      'application/x-www-form-urlencoded',
      'unknown enctype falls back to urlencoded',
    );
    form.setAttribute('target', '_blank');
    assert.strictEqual(form.target, '_blank');

    // Submitter overrides resolve the same way.
    submitter.setAttribute('formaction', '?/named');
    assert.strictEqual(
      submitter.formAction,
      new URL('?/named', document.URL).href,
      'submitter formaction overrides the form action',
    );
    submitter.setAttribute('formmethod', 'post');
    assert.strictEqual(submitter.formMethod, 'post');
    submitter.setAttribute('formenctype', 'multipart/form-data');
    assert.strictEqual(submitter.formEnctype, 'multipart/form-data');
    submitter.setAttribute('formtarget', '_blank');
    assert.strictEqual(submitter.formTarget, '_blank');

    form.remove();
  });

  it('7. the inherited formStateRestoreCallback is a safe no-op (no restore hook implemented)', () => {
    const { form, field } = setup();
    typeInto(field, 'keep-me');

    // open-input.tsx (and this distilled fixture) implement formResetCallback
    // only; the base class forwards formStateRestoreCallback to a kernel
    // restore hook that the component never registers, so a platform restore
    // callback must neither throw nor mutate the control.
    assert.strictEqual(typeof field.formStateRestoreCallback, 'function');
    field.formStateRestoreCallback('restored-value', 'restore');
    field.formStateRestoreCallback(null, 'autocomplete');
    assert.strictEqual(field.value, 'keep-me', 'no restore hook: state is ignored');
    assert.strictEqual(field.matches(':valid'), true, 'validity untouched by the no-op');

    // The implemented channel (reset) still restores through
    // formResetCallback — the full reset contract lives in
    // form-contract.test.js; here only the contrast with restore matters.
    form.reset();
    assert.strictEqual(field.value, '', 'reset restores via formResetCallback');

    form.remove();
  });
});
