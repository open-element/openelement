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

  test('FormData carries open-input values, including the activation-time initial value', async ({ page }) => {
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
    const validity = await page.evaluate(`(() => {
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

  test('disabled fieldset mirrors through formDisabledCallback and drops out of FormData', async ({ page }) => {
    const locked = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#locked')};
      const inner = host?.shadowRoot?.querySelector('input');
      return {
        stateDisabled: host?.matches(':state(disabled)') ?? false,
        innerDisabled: inner?.disabled ?? false,
      };
    })()`);
    expect(locked).toEqual({ stateDisabled: true, innerDisabled: true });
    // Disabled controls never appear in FormData.
    expect(await page.evaluate(formDataJsonExpr)).not.toHaveProperty('locked');

    // Re-enable the fieldset: the control rejoins the form (#1226: the
    // re-enable only works because formDisabledCallback mirrors onto the
    // property — an own `disabled` attribute would lock the state).
    await page.evaluate(`${deepFirstExpr('#locked-group')}?.removeAttribute('disabled')`);
    await expect
      .poll(() => page.evaluate(`${deepFirstExpr('#locked')}?.matches(':state(disabled)') ?? true`))
      .toBe(false);
    expect(await page.evaluate(formDataJsonExpr)).toHaveProperty('locked', '');
  });

  test('delegatesFocus lands host focus on the inner control; open-input fires per input', async ({ page }) => {
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
