/**
 * ui dogfood — open-input's control surface, measured in a browser.
 *
 * The alpha15 S-lane migration left open-input.css selecting `.control` while
 * the markup carried `input`: every rule the sheet owns for the control — the
 * resting popover/border surface, the violet hover border, the focus ring and
 * the disabled/invalid treatments — was dead inside the shadow root. Those
 * rules are exactly the ones a utility cannot replace (derived two-colour
 * mixes and `:host(:state(...))`), so nothing else could have covered for them:
 * with `outline-none` in the class list, the sheet's focus ring IS the focus
 * affordance.
 *
 * Everything here is an OBSERVED computed style on the compiled framework in a
 * real browser — never the presence of a CSS file, and never a `padding`-only
 * probe. Role colours are compared against the engine's own resolution of the
 * role variable (a probe element reading `var(--color-*)`), so the assertions
 * hold whatever colour space each engine reports.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { deepFirstExpr } from './helpers.ts';

/** Resolves a role to the colour this engine computes for it. */
const roleColourExpr = (role: string): string => `(() => {
  const probe = document.createElement('div');
  probe.style.color = 'var(--${role})';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
})()`;

/**
 * The control's computed surface, read from inside the host's shadow root.
 *
 * The shared walker matches one selector per root, so `#username input` cannot
 * cross the second shadow boundary: the host is resolved with the walker and
 * the control is then queried inside its own shadow root.
 */
const controlStyleExpr = (host: string, properties: readonly string[]): string => `(() => {
  const control = ${deepFirstExpr(host)}?.shadowRoot?.querySelector('input');
  if (!control) return null;
  const style = getComputedStyle(control);
  return Object.fromEntries(${JSON.stringify(properties)}.map((property) => [
    property,
    style[property],
  ]));
})()`;

const SURFACE = [
  'backgroundColor',
  'borderTopColor',
  'borderTopWidth',
  'borderTopStyle',
  'boxShadow',
  'outlineStyle',
  'opacity',
  'cursor',
] as const;

async function hostSurface(page: Page, host: string): Promise<Record<string, string>> {
  const surface = await page.evaluate(controlStyleExpr(host, SURFACE));
  expect(surface, `${host} must have a reachable inner control`).not.toEqual(null);
  return surface as Record<string, string>;
}

/** Types a string into the control and leaves the pointer away from it. */
async function typeInto(page: Page, control: Locator, text: string): Promise<void> {
  await control.focus();
  await page.keyboard.type(text);
}

test.describe('open-input control surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/form');
    // The DSD markup exists before JavaScript, but the surface assertions need
    // the page shell's shadow root parsed and the control queryable.
    await page.waitForFunction(
      `${deepFirstExpr('#username')}?.shadowRoot?.querySelector('input') !== null`,
    );
  });

  test('the sheet rule reaches the control: resting surface, not a bare UA input', async ({
    page,
  }) => {
    const surface = await hostSurface(page, '#username');
    const popover = await page.evaluate(roleColourExpr('color-popover'));

    // The resting border is the derived border/primary mix — a real border the
    // UA default (a 2px inset ridge) can never produce.
    expect(surface.borderTopStyle, 'border-style must be the sheet solid').toBe('solid');
    expect(parseFloat(surface.borderTopWidth), 'border-width must be the sheet 1px').toBeCloseTo(
      1,
      1,
    );
    expect(
      surface.borderTopColor,
      'resting border must differ from the transparent default',
    ).not.toBe('rgba(0, 0, 0, 0)');
    // The resting background is the popover/transparent mix, so it is neither
    // fully transparent nor the popover role itself.
    expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(surface.backgroundColor).not.toBe(popover);
    // `outline-none` is a utility: the sheet's box-shadow is the only focus
    // affordance left, and at rest there is no ring.
    expect(surface.outlineStyle).toBe('none');
    expect(surface.boxShadow).toBe('none');
  });

  test('hover moves the border to the derived violet mix', async ({ page }) => {
    const resting = await hostSurface(page, '#username');

    // A real pointer move, not locator.hover(): WebKit's actionability check
    // hit-tests `<form-page>` (the shadow HOST) at the control's coordinates
    // and reports "intercepts pointer events", so the locator can never hover
    // an element two shadow roots deep. The browser's own hit-testing does
    // descend into the shadow tree, so page.mouse.move reaches the control —
    // and `:hover` on the control is asserted first, so a platform that failed
    // to hover it would fail here as a hover defect, never as a colour one.
    const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
      const control = ${deepFirstExpr('#username')}?.shadowRoot?.querySelector('input');
      if (!control) return null;
      control.scrollIntoView({ block: 'center' });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    expect(point, 'the control must be measurable').not.toEqual(null);
    await page.mouse.move(point!.x, point!.y);
    await expect
      .poll(() =>
        page.evaluate(
          `${deepFirstExpr('#username')}?.shadowRoot?.querySelector('input')?.matches(':hover') ?? false`,
        ),
      )
      .toBe(true);

    await expect
      .poll(async () => (await hostSurface(page, '#username')).borderTopColor)
      .not.toBe(resting.borderTopColor);
  });

  test('keyboard focus is visible: the sheet ring appears and the border turns to primary', async ({
    page,
  }) => {
    const resting = await hostSurface(page, '#username');
    const primary = await page.evaluate(roleColourExpr('color-primary'));
    await page.locator('#username input').focus();

    // `transition-[border-color,box-shadow] duration-200` is part of the
    // authored treatment, so the settled value is the one that counts.
    await expect
      .poll(async () => (await hostSurface(page, '#username')).borderTopColor)
      .toBe(primary);
    const focused = await hostSurface(page, '#username');

    // outline-none retires the UA outline, so the ring must be the sheet's.
    expect(focused.outlineStyle).toBe('none');
    expect(focused.boxShadow, 'a focused control must carry the focus ring').not.toBe('none');
    expect(focused.boxShadow).not.toBe(resting.boxShadow);
  });

  test('the native disabled attribute and a disabled fieldset both land, with different triggers', async ({
    page,
  }) => {
    const muted = await page.evaluate(roleColourExpr('color-muted'));
    const native = await hostSurface(page, '#native-disabled');
    const fromFieldset = await hostSurface(page, '#locked');

    for (const [name, surface] of [
      ['native disabled', native],
      ['fieldset disabled', fromFieldset],
    ] as const) {
      expect(surface.opacity, `${name}: the sheet's disabled opacity`).toBe('0.5');
      expect(surface.cursor, `${name}: the sheet's not-allowed cursor`).toBe('not-allowed');
      expect(surface.backgroundColor, `${name}: the muted role replaces the surface`).toBe(muted);
    }

    // The two triggers are genuinely different states: the fieldset drives the
    // form-associated `:state(disabled)`, the attribute the native `:disabled`.
    const triggers = await page.evaluate<{
      nativeState: boolean;
      nativeInnerDisabled: boolean;
      fieldsetState: boolean;
      fieldsetHasAttribute: boolean;
    }>(`(() => {
      const native = ${deepFirstExpr('#native-disabled')};
      const fieldset = ${deepFirstExpr('#locked')};
      return {
        nativeState: native?.matches(':state(disabled)') ?? false,
        nativeInnerDisabled: native?.shadowRoot?.querySelector('input')?.disabled ?? false,
        fieldsetState: fieldset?.matches(':state(disabled)') ?? false,
        fieldsetHasAttribute: fieldset?.hasAttribute('disabled') ?? true,
      };
    })()`);
    expect(triggers.nativeState).toBe(true);
    expect(triggers.nativeInnerDisabled).toBe(true);
    expect(triggers.fieldsetState).toBe(true);
    expect(
      triggers.fieldsetHasAttribute,
      'the fieldset-driven state must not be written back as an own attribute (#1226)',
    ).toBe(false);
  });

  test('the error state seats the border, and the ARIA wiring points at the message', async ({
    page,
  }) => {
    const destructive = await page.evaluate(roleColourExpr('color-destructive'));
    const resting = await hostSurface(page, '#username');
    // The invalid state seats at activation (the error attribute is SSR'd, the
    // `:state(invalid)` guest is added when the element upgrades), so the
    // border transitions into place — assert the settled value.
    await expect
      .poll(async () => (await hostSurface(page, '#invalid')).borderTopColor)
      .toBe(destructive);
    const invalid = await hostSurface(page, '#invalid');
    expect(invalid.borderTopColor).not.toBe(resting.borderTopColor);

    const wiring = await page.evaluate<{
      invalid: string | null;
      describedBy: string | null;
      errorMessage: string | null;
      errorId: string | null;
      role: string | null;
      hidden: boolean;
      text: string | null;
    }>(`(() => {
      const host = ${deepFirstExpr('#invalid')};
      const input = host?.shadowRoot?.querySelector('input');
      const error = host?.shadowRoot?.querySelector('[part=error]');
      return {
        invalid: input?.getAttribute('aria-invalid') ?? null,
        describedBy: input?.getAttribute('aria-describedby') ?? null,
        errorMessage: input?.getAttribute('aria-errormessage') ?? null,
        errorId: error?.id ?? null,
        role: error?.role ?? null,
        hidden: error?.hasAttribute('hidden') ?? true,
        text: error?.textContent ?? null,
      };
    })()`);
    expect(wiring.invalid).toBe('true');
    expect(wiring.describedBy, 'the message must be reachable by id').toBe(wiring.errorId);
    expect(wiring.errorMessage).toBe(wiring.errorId);
    expect(wiring.errorId, 'the message needs the id the ARIA links name').not.toBe(null);
    expect(wiring.role).toBe('alert');
    expect(wiring.hidden, 'an error message must not stay hidden').toBe(false);
    expect(wiring.text).toBe('Required field');

    // The state is live in both directions, not just an SSR snapshot.
    const cleared = await page.evaluate<{
      state: boolean;
      invalid: string | null;
      describedBy: string | null;
      hidden: boolean;
    }>(`(() => {
      const host = ${deepFirstExpr('#invalid')};
      host.removeAttribute('error');
      const input = host.shadowRoot.querySelector('input');
      const error = host.shadowRoot.querySelector('[part=error]');
      return {
        state: host.matches(':state(invalid)'),
        invalid: input?.getAttribute('aria-invalid') ?? null,
        describedBy: input?.getAttribute('aria-describedby') ?? null,
        hidden: error?.hasAttribute('hidden') ?? false,
      };
    })()`);
    expect(cleared.state).toBe(false);
    expect(cleared.invalid).toBe(null);
    expect(cleared.describedBy).toBe(null);
    expect(cleared.hidden).toBe(true);
  });

  test('part=control is the customization surface: a consumer rule reaches the inner input', async ({
    page,
  }) => {
    // The host lives inside the page shell's shadow root, so the consumer rule
    // must be seated in that same tree — exactly where a ::part() rule applies.
    await page.evaluate(`(() => {
      const host = ${deepFirstExpr('#username')};
      const scope = host.getRootNode();
      const style = document.createElement('style');
      style.textContent = 'open-input::part(control) { border-top-color: rgb(1, 2, 3); }';
      scope.appendChild(style);
    })()`);
    await expect
      .poll(async () => (await hostSurface(page, '#username')).borderTopColor)
      .toBe('rgb(1, 2, 3)');
  });

  test('dark mode re-seats the surface through the shared role table', async ({ page }) => {
    const light = await hostSurface(page, '#username');
    const lightMuted = await page.evaluate(roleColourExpr('color-muted'));
    await page.evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`);
    const darkMuted = await page.evaluate(roleColourExpr('color-muted'));

    expect(darkMuted, 'the dark seats must move the role itself').not.toBe(lightMuted);
    // The border transition again: wait for the settled dark value.
    await expect
      .poll(async () => (await hostSurface(page, '#username')).borderTopColor)
      .not.toBe(light.borderTopColor);
    const dark = await hostSurface(page, '#username');
    expect(dark.backgroundColor, 'the control surface must follow the theme').not.toBe(
      light.backgroundColor,
    );
    expect(parseFloat(dark.borderTopWidth), 'the dark border must still be a border').toBeCloseTo(
      1,
      1,
    );
  });

  test('the value round-trips through the host attribute and the form contract', async ({
    page,
  }) => {
    await typeInto(page, page.locator('#username input'), 'ada');
    const state = await page.evaluate<{
      attribute: string | null;
      formValue: FormDataEntryValue | undefined;
    }>(`(() => {
      const host = ${deepFirstExpr('#username')};
      return {
        attribute: host.getAttribute('value'),
        formValue: Object.fromEntries(new FormData(${deepFirstExpr('#dogfood-form')}).entries())
          .username,
      };
    })()`);
    expect(state.attribute).toBe('ada');
    expect(state.formValue).toBe('ada');
  });
});
