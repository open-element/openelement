/**
 * ui dogfood — open-input/open-button form participation evidence (#1226).
 *
 * Observed in a real browser on the compiled framework:
 * - form association: FormData carries open-input values (including the
 *   initial value synced at activation);
 * - constraint validation: required + empty -> valueMissing on the host;
 * - formResetCallback clears values; formDisabledCallback mirrors a disabled
 *   fieldset (and the control drops out of FormData);
 * - open-button type="submit" runs the composed-submit choreography;
 * - delegatesFocus moves host focus onto the inner control; the open-input
 *   custom event fires per input.
 *
 * The page shell is a shadow-open DSD element, so document-level queries go
 * through the shadow-walker helpers (helpers.ts).
 */
import { expect, type Page, test } from '@playwright/test';
import { deepFirstExpr } from './helpers.ts';

/** Waits until the ui elements and the form-probe island are live. */
async function waitForForm(page: Page): Promise<void> {
  await page.waitForFunction(
    `customElements.get('open-input') !== undefined && ` +
      `customElements.get('open-button') !== undefined && ` +
      `${deepFirstExpr('form-probe')}` +
      `?.shadowRoot?.querySelector('#probe-status')?.textContent === 'probe-wired'`,
  );
}

/** FormData entries of #dogfood-form as a plain object (page context). */
const formDataJsonExpr = `(() => {
  const form = ${deepFirstExpr('#dogfood-form')};
  return form ? Object.fromEntries(new FormData(form).entries()) : null;
})()`;

test.describe('open-input / open-button form participation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/form');
    await waitForForm(page);
  });

  test('FormData carries open-input values, including the activation-time initial value', async ({
    page,
  }) => {
    // syncFormValue ran at activation: the SSR'd initial value participates
    // without any typing.
    expect(await page.evaluate(formDataJsonExpr)).toEqual({
      username: '',
      email: 'ada@example.com',
    });

    await page.locator('#username input').fill('ada');
    expect(await page.evaluate(formDataJsonExpr)).toEqual({
      username: 'ada',
      email: 'ada@example.com',
    });
  });

  test('open-button type=submit submits the form with the ui values', async ({ page }) => {
    await page.locator('#username input').fill('ada');
    await page.locator('#submit-open button').click();
    // The probe preventDefaults and echoes FormData: no navigation happens.
    await expect(page).toHaveURL(/\/form$/);
    await expect(page.locator('#form-output')).toHaveText(
      '{"username":"ada","email":"ada@example.com"}',
    );
  });

  test('required + empty maps to valueMissing and blocks native submission', async ({ page }) => {
    await page.locator('#submit-native').click();
    const validity = await page.evaluate<{ invalid: boolean; formValid: boolean }>(`(() => {
      const host = ${deepFirstExpr('#username')};
      const form = ${deepFirstExpr('#dogfood-form')};
      return {
        invalid: host?.matches(':invalid') ?? false,
        formValid: form?.checkValidity() ?? true,
      };
    })()`);
    expect(validity.invalid).toBe(true);
    expect(validity.formValid).toBe(false);
    // The blocked submission never reached the probe.
    await expect(page.locator('#form-output')).toHaveText('');
  });

  test('form reset clears values through formResetCallback', async ({ page }) => {
    await page.locator('#username input').fill('ada');
    await page.locator('#reset-native').click();
    await expect(page.locator('#form-output')).toHaveText('{"username":"","email":""}');
    await expect(page.locator('#username input')).toHaveValue('');
    expect(await page.evaluate(formDataJsonExpr)).toEqual({ username: '', email: '' });
  });

  test('a disabled fieldset seats the effective state, refuses input, and drops out of FormData', async ({
    page,
  }) => {
    const locked = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#locked')};
      const inner = host?.shadowRoot?.querySelector('input');
      return {
        stateDisabled: host?.matches(':state(disabled)') ?? false,
        authorDisabled: host?.disabled ?? null,
        // The class lane mirrored the lock onto the inner control; the
        // generated lane's shell owns the internals record and never touches
        // the component's DOM, so the inner control stays as authored and the
        // the lock reaches COMPONENT CODE through the custom state only
        // (m09-2d-forms.md "the consumable effective-disabled channel").
        innerDisabled: inner?.disabled ?? null,
      };
    })()`);
    expect(locked).toEqual({ stateDisabled: true, authorDisabled: false, innerDisabled: false });

    // The two things a consumer can actually observe:
    // 1. the entry never appears in FormData;
    expect(await page.evaluate(formDataJsonExpr)).not.toHaveProperty('locked');
    // 2. typing is REFUSED — the guard reads the same custom state at the
    //    interaction, and the value row is not written. Without it a locked
    //    field accepts keystrokes and publishes them (measured before the
    //    guard existed), which is a behaviour regression from the class lane.
    await page.locator('#locked input').focus();
    await page.keyboard.type('hacked');
    const afterTyping = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#locked')};
      return {
        hostValue: host?.value ?? null,
        inputValue: host?.shadowRoot?.querySelector('input')?.value ?? null,
      };
    })()`);
    expect(afterTyping, 'a locked field must not accept or publish input').toEqual({
      hostValue: '',
      inputValue: '',
    });

    // Re-enable the fieldset: the control rejoins the form (#1226: the
    // re-enable only works because the effective state stays separate from the
    // author property — an own `disabled` attribute would lock the state).
    await page.evaluate(`${deepFirstExpr('#locked-group')}?.removeAttribute('disabled')`);
    await expect
      .poll(() => page.evaluate(`${deepFirstExpr('#locked')}?.matches(':state(disabled)') ?? true`))
      .toBe(false);
    expect(await page.evaluate(formDataJsonExpr)).toHaveProperty('locked', '');
    // …and the control accepts input again.
    await page.locator('#locked input').focus();
    await page.keyboard.type('ok');
    expect(await page.evaluate(`${deepFirstExpr('#locked')}?.value ?? null`)).toBe('ok');
  });

  test('delegatesFocus lands host focus on the inner control; open-input fires per input', async ({
    page,
  }) => {
    await page.evaluate(`(() => {
      const w = window;
      w.__inputEvents = [];
      document.addEventListener('open-input', (event) => {
        w.__inputEvents.push(String(event.detail?.value));
      });
      ${deepFirstExpr('#username')}.focus();
    })()`);
    const focusedTag = await page.evaluate(
      `${deepFirstExpr('#username')}?.shadowRoot?.activeElement?.tagName ?? ''`,
    );
    expect(focusedTag).toBe('INPUT');

    await page.keyboard.type('abc');
    const events = await page.evaluate(`window.__inputEvents`);
    expect(events).toEqual(['a', 'ab', 'abc']);
  });
});
