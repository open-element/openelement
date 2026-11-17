/**
 * E2E: the generated (function-component) theme toggle, platform-level.
 *
 * `open-theme-toggle` is authored as a function component and compiled into
 * `OpenThemeToggleElement`; its class no longer exists to instantiate. This
 * suite asserts the L4 semantics that used to drive the class methods, against
 * the REAL shipped element:
 *
 *   - the initialization priority chain (attribute > document > storage > media);
 *   - per-instance independence and convergence through the document;
 *   - dual-state transitions re-applying host/document/colorScheme;
 *   - reconnect re-initializing exactly once per instance;
 *   - the attribute-driven change applying without persisting (#804).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

async function appendToggle(page: Page, theme?: 'light' | 'dark'): Promise<Locator> {
  const id = `probe-toggle-${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ theme, id }) => {
      const el = document.createElement('open-theme-toggle');
      el.id = id;
      if (theme !== undefined) el.setAttribute('theme', theme);
      document.body.append(el);
    },
    { theme, id },
  );
  const locator = page.locator(`#${id}`);
  await expect
    .poll(() => locator.evaluate((el) => el.getAttribute('data-theme')), { timeout: 10_000 })
    .toMatch(/^(light|dark)$/);
  return locator;
}

function docTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('open-theme'));
}

test.describe('open-theme-toggle (generated element)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The shipped toggle must be upgraded and initialized before a test starts.
    await expect
      .poll(
        () =>
          page
            .locator('open-theme-toggle')
            .first()
            .evaluate((el) => el.getAttribute('data-theme')),
        { timeout: 10_000 },
      )
      .toMatch(/^(light|dark)$/);
  });

  test('an explicit attribute wins over the pre-paint document theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const toggle = await appendToggle(page, 'light');
    expect(await toggle.evaluate((el) => el.getAttribute('data-theme'))).toBe('light');
    expect(
      await toggle.evaluate((el) =>
        (el as HTMLElement).shadowRoot?.querySelector('button')?.getAttribute('data-theme'),
      ),
    ).toBe('light');
    expect(await docTheme(page)).toBe('light');
  });

  test('the live document theme wins over a stale stored preference', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('open-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'light');
    });
    const toggle = await appendToggle(page);
    expect(await toggle.evaluate((el) => el.getAttribute('data-theme'))).toBe('light');
    // Init never persists: the stale stored value is untouched.
    expect(await storedTheme(page)).toBe('dark');
  });

  test('the stored preference wins over the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('open-theme', 'dark');
    });
    const toggle = await appendToggle(page);
    expect(await toggle.evaluate((el) => el.getAttribute('data-theme'))).toBe('dark');
  });

  test('the system preference decides when nothing else is present', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('open-theme');
    });
    const toggle = await appendToggle(page);
    expect(await toggle.evaluate((el) => el.getAttribute('data-theme'))).toBe('light');
  });

  test('two instances resolve independently and toggle only their own state', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // Both instances pin their own attribute: an explicit attribute outranks the
    // live document theme, so two instances can hold different states.
    const light = await appendToggle(page, 'light');
    const dark = await appendToggle(page, 'dark');

    const buttonTheme = (locator: Locator) =>
      locator.evaluate((el) =>
        (el as HTMLElement).shadowRoot?.querySelector('button')?.getAttribute('data-theme'),
      );
    // The rendered sink carries the instance's own resolved state.
    expect(await buttonTheme(light)).toBe('light');
    expect(await buttonTheme(dark)).toBe('dark');

    await light.locator('button').click();
    await expect.poll(() => buttonTheme(light), { timeout: 10_000 }).toBe('dark');
    // The other instance keeps its own state; only its host attribute follows
    // the document broadcast (the manager owns that attribute on every host).
    expect(await buttonTheme(dark)).toBe('dark');
    expect(await docTheme(page)).toBe('dark');
    expect(await storedTheme(page)).toBe('dark');

    await dark.locator('button').click();
    await expect.poll(() => buttonTheme(dark), { timeout: 10_000 }).toBe('light');
    expect(await buttonTheme(light)).toBe('dark');
    expect(await docTheme(page)).toBe('light');
    expect(await storedTheme(page)).toBe('light');
  });

  test('an explicit toggle persists and dispatches the applied theme', async ({ page }) => {
    const toggle = await appendToggle(page, 'dark');
    const detail = await page.evaluate(async () => {
      const seen: unknown[] = [];
      const listener = (event: Event) => {
        seen.push((event as CustomEvent).detail);
      };
      globalThis.addEventListener('open:theme-change', listener);
      const el = document.querySelectorAll('open-theme-toggle')[1] as HTMLElement;
      (el.shadowRoot?.querySelector('button') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      globalThis.removeEventListener('open:theme-change', listener);
      return seen;
    });
    expect(await toggle.evaluate((el) => el.getAttribute('data-theme'))).toBe('light');
    expect(detail).toEqual([{ theme: 'light' }]);
    expect(await storedTheme(page)).toBe('light');
  });

  test('an attribute-driven change applies but never persists (#804)', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('open-theme'));
    const toggle = await appendToggle(page, 'dark');
    await toggle.evaluate((el) => el.setAttribute('theme', 'light'));
    await expect
      .poll(() => toggle.evaluate((el) => el.getAttribute('data-theme')), { timeout: 10_000 })
      .toBe('light');
    expect(await docTheme(page)).toBe('light');
    expect(await storedTheme(page)).toBeNull();
    // A non-theme value resolves to dark (the only two states).
    await toggle.evaluate((el) => el.setAttribute('theme', 'blue'));
    await expect
      .poll(() => toggle.evaluate((el) => el.getAttribute('data-theme')), { timeout: 10_000 })
      .toBe('dark');
    expect(await storedTheme(page)).toBeNull();
  });

  test('reconnect re-runs initialization zero times', async ({ page }) => {
    const toggle = await appendToggle(page, 'dark');
    // Install the counter, then let the element's OWN initialization settle
    // before sampling the baseline. `appendToggle` returns as soon as the host
    // is in the DOM; the first `open:theme-change` for the explicit
    // `data-theme` attribute arrives on that element's own scheduling, so
    // sampling immediately raced it (measured as a Firefox flake: baseline 0,
    // then 1 after the late first dispatch). The row's subject is the RECONNECT
    // not adding a second one, so the baseline must be taken after the first
    // has landed.
    await page.evaluate(() => {
      const counter = { value: 0 };
      (globalThis as unknown as { __themeCount: { value: number } }).__themeCount = counter;
      globalThis.addEventListener('open:theme-change', () => {
        counter.value += 1;
      });
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (globalThis as unknown as { __themeCount: { value: number } }).__themeCount.value,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const beforeCount = await page.evaluate(
      () => (globalThis as unknown as { __themeCount: { value: number } }).__themeCount.value,
    );
    await page.evaluate(() => {
      const el = document.querySelectorAll('open-theme-toggle')[1] as HTMLElement;
      el.remove();
      document.body.append(el);
    });
    await expect
      .poll(() => toggle.evaluate((el) => el.getAttribute('data-theme')), { timeout: 10_000 })
      .toBe('dark');
    const afterCount = await page.evaluate(
      () => (globalThis as unknown as { __themeCount: { value: number } }).__themeCount.value,
    );
    // The reconnect schedules init again, but the per-instance guard keeps the
    // resolution, writes and dispatch exactly once.
    expect(afterCount).toBe(beforeCount);
  });
});
