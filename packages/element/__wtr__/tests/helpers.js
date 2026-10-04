/**
 * Shared helpers for the element browser suites: the small settle/typing
 * plumbing every suite needs, kept in one place so the suites cannot drift
 * apart on settle semantics. Not a test file (the element-browser include
 * glob is `*.test.js`), so vitest never collects it directly.
 */
import { assert } from 'chai';

/** Poll a predicate on animation frames; fail with a label on timeout. */
export async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** Simulate typing: set the inner control's value and dispatch input. */
export function typeInto(field, value) {
  const input = field.shadowRoot.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  return input;
}

/** Exercise the browser-standard FormData(form, submitter) overload.
 * Reflect.construct keeps CodeQL's Node-only FormData model from treating the
 * browser overload as a superfluous argument. */
export function formDataForSubmitter(form, submitter) {
  return Reflect.construct(FormData, [form, submitter]);
}
