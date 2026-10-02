/**
 * E2E: Theme System
 *
 * Verifies the dark/light theme toggle:
 *   - Theme toggle element is present
 *   - Clicking toggle switches theme
 *   - Theme state is persisted to localStorage
 *   - Initial theme follows prefers-color-scheme when nothing is saved
 *   - data-theme attribute is updated on document
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * The toggle button is the user-visible control ("Toggle theme"); Playwright
 * role locators pierce the open shadow roots of open-layout and
 * open-theme-toggle natively, so no ad-hoc shadow walking is needed.
 */
async function clickThemeToggle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Toggle theme' }).click();
}

async function waitForThemeChange(page: Page, before: string | null): Promise<void> {
  await page.waitForFunction((prev) => {
    return document.documentElement.getAttribute('data-theme') !== prev;
  }, before);
}

/**
 * Wait for <open-theme-toggle> to be fully upgraded:
 * DSD hydration + _initTheme() must complete before clicks work.
 * The host carries a data-theme attribute once _initTheme() ran during
 * onDsdHydrated().
 */
async function waitForToggleReady(page: Page): Promise<void> {
  await expect(page.locator('open-theme-toggle')).toHaveAttribute('data-theme', /^(light|dark)$/, {
    timeout: 10000,
  });
}

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForToggleReady(page);
  });

  test('theme toggle button is exposed with an accessible name', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });

  test('theme toggle has shadow root', async ({ page }) => {
    const hasShadowRoot = await page
      .locator('open-theme-toggle')
      .evaluate((el) => el.shadowRoot !== null);
    expect(hasShadowRoot).toBe(true);
  });

  test('clicking theme toggle changes data-theme on document', async ({ page }) => {
    const themeBefore = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });

    await clickThemeToggle(page);

    await waitForThemeChange(page, themeBefore);
    const themeAfter = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter).not.toBe(themeBefore);
  });

  test('theme is persisted to localStorage after toggle', async ({ page }) => {
    await clickThemeToggle(page);

    // Check localStorage
    const stored = await page.evaluate(() => {
      return localStorage.getItem('open-theme');
    });
    expect(stored).toMatch(/^(light|dark)$/);
  });

  test('multiple toggles cycle between dark and light', async ({ page }) => {
    const themeBefore = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });

    await clickThemeToggle(page);
    await waitForThemeChange(page, themeBefore);
    const themeAfter1 = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter1).not.toBe(themeBefore);

    await clickThemeToggle(page);
    await waitForThemeChange(page, themeAfter1);
    const themeAfter2 = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(themeAfter2).toBe(themeBefore);
  });

  test('homepage surface colors follow the active theme', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      globalThis.dispatchEvent(
        new CustomEvent('open:theme-change', {
          detail: { theme: 'dark' },
        }),
      );
    });

    const dark = await page.evaluate(() => {
      return {
        canvas: getComputedStyle(document.body).backgroundImage,
        surface: getComputedStyle(document.body).backgroundColor,
      };
    });

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      globalThis.dispatchEvent(
        new CustomEvent('open:theme-change', {
          detail: { theme: 'light' },
        }),
      );
    });

    const light = await page.evaluate(() => {
      return {
        canvas: getComputedStyle(document.body).backgroundImage,
        surface: getComputedStyle(document.body).backgroundColor,
      };
    });

    expect(dark.canvas).not.toBe(light.canvas);
    expect(dark.surface).not.toBe(light.surface);
  });
});

test.describe('Theme initialization', () => {
  // theme-init.js runs synchronously in <head> before first paint: with no
  // saved theme the initial data-theme must follow prefers-color-scheme
  // exactly. A dark first paint that later flips to light is the FOUC this
  // contract exists to prevent, so both directions are asserted strictly.
  test('initial theme is light when prefers-color-scheme is light and nothing is saved', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const theme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(theme).toBe('light');
    // theme-init.js must have run synchronously before first paint.
    const themeInit = await page.evaluate(() => {
      return document.documentElement.dataset.themeInit;
    });
    expect(themeInit).toBe('1');
  });

  test('initial theme is dark when prefers-color-scheme is dark and nothing is saved', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const theme = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    expect(theme).toBe('dark');
    // theme-init.js must have run synchronously before first paint.
    const themeInit = await page.evaluate(() => {
      return document.documentElement.dataset.themeInit;
    });
    expect(themeInit).toBe('1');
  });
});

/**
 * The @theme role sheet (alpha9 C1, #1504) as shipped in the document head.
 * Its dark union carries THREE signals — html[data-theme="dark"] (the www
 * mechanism), .dark (shadcn convention) and :host([data-theme="dark"]) (the
 * open-element-theme.ts broadcast channel) — and its forced-colors tier must
 * outrank the dark pair. Values are read as computed custom properties:
 * unregistered custom properties keep their token stream verbatim, so the
 * assertions compare the authored hsl() strings directly.
 */
test.describe('@theme role sheet', () => {
  const LIGHT = 'hsl(0 0% 100%)';
  const DARK = 'hsl(240 10% 3.9%)';
  const ROLE = '--color-background';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  function roleOn(page: Page, selector: string): Promise<string> {
    return page.evaluate(
      ([role, sel]) => {
        const el = document.querySelector(sel) ?? document.documentElement;
        return getComputedStyle(el).getPropertyValue(role).trim();
      },
      [ROLE, selector],
    );
  }

  test('the shipped head style carries the @layer theme sheet with light defaults', async ({
    page,
  }) => {
    const inHead = await page.evaluate(() => {
      return [...document.querySelectorAll('style')].some(
        (s) =>
          (s.textContent ?? '').includes('@layer theme') &&
          (s.textContent ?? '').includes('--color-background'),
      );
    });
    expect(inHead, '@layer theme tokens must ship in the document head').toBe(true);
    expect(await roleOn(page, 'html')).toBe(LIGHT);
  });

  test('html[data-theme="dark"] flips roles on the document and reaches shadow hosts', async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect(await roleOn(page, 'html')).toBe(DARK);
    // open-element-theme.ts broadcasts the attribute onto OE hosts; the dark
    // values reach the shadow tree by custom-property inheritance.
    await page.waitForFunction(() => {
      return document.querySelector('open-theme-toggle')?.getAttribute('data-theme') === 'dark';
    });
    expect(await roleOn(page, 'open-theme-toggle')).toBe(DARK);
  });

  test('the shadcn .dark class flips roles on its own', async ({ page }) => {
    // Isolate the class channel: no data-theme attribute anywhere.
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.add('dark');
    });
    expect(await roleOn(page, 'html')).toBe(DARK);
  });

  test('the :host([data-theme="dark"]) broadcast form works inside a shadow root', async ({
    page,
  }) => {
    // Adopt the page's own SHIPPED (minified) head style into a fresh shadow
    // root — the same sheet a registerGlobalStyles consumer would adopt — and
    // flip the host attribute exactly like the themeManager broadcast does.
    const result = await page.evaluate(
      ([role]) => {
        const cssText = [...document.querySelectorAll('style')]
          .map((s) => s.textContent ?? '')
          .find((text) => text.includes('--color-background'));
        if (cssText === undefined) return null;
        const host = document.createElement('div');
        document.body.append(host);
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        const root = host.attachShadow({ mode: 'open' });
        root.adoptedStyleSheets = [sheet];
        const probe = document.createElement('span');
        root.append(probe);
        const before = getComputedStyle(host).getPropertyValue(role).trim();
        host.setAttribute('data-theme', 'dark');
        const afterHost = getComputedStyle(host).getPropertyValue(role).trim();
        const afterInner = getComputedStyle(probe).getPropertyValue(role).trim();
        host.remove();
        return { before, afterHost, afterInner };
      },
      [ROLE],
    );
    expect(result, 'the shipped head style must be adoptable').not.toBeNull();
    expect(result!.before).toBe(LIGHT);
    expect(result!.afterHost, ':host([data-theme="dark"]) must flip the host').toBe(DARK);
    expect(result!.afterInner, 'the flip must inherit into the shadow tree').toBe(DARK);
  });

  test('forced colors outrank the dark pair in both themes', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect(await roleOn(page, 'html')).toBe('Canvas');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    expect(await roleOn(page, 'html')).toBe('Canvas');
  });
});
