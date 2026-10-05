/**
 * E2E: Browser activation behavior in a real browser.
 *
 * The element/ui unit suites run on a hand-written DOM shim whose semantics
 * diverge from a real browser (shim attachShadow throws, no closest()). This
 * suite guards the activation contract in real Chromium against the built site
 * site:
 *
 *   1. A compiled property/event binding patches a shipped SSR node in place.
 *   2. A browser controller activates against existing light-root SSR nodes.
 *   3. Controller cleanup and reconnect preserve those nodes and behavior.
 *   4. open-button form piercing: a click on the shadow-DOM <button> reaches
 *      the outer <form> as a composed submit event.
 */

import { expect, type Page, test } from '@playwright/test';

/** Result shape returned by probe-based page evaluations. */
interface ProbeError {
  error: string;
}

function isProbeError(result: unknown): result is ProbeError {
  return typeof result === 'object' && result !== null && 'error' in result;
}

/**
 * Wait until the compiled light-root layout and search island are active.
 * Their SSR DOM remains in the light tree and browser behavior is installed
 * by the island controller after custom-element upgrade.
 */
async function waitForHydratedSearch(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(
    () => !!customElements.get('open-search') && !!customElements.get('open-theme-toggle'),
  );
  // Role locators pierce the open shadow roots natively; the accessible name
  // is the user-visible contract, not an implementation class.
  await expect(page.getByRole('button', { name: 'Search' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeAttached();
}

test.describe('compiled activation on shipped islands', () => {
  test('theme binding patches the existing DSD node in place', async ({ page }) => {
    await waitForHydratedSearch(page);

    const button = page.getByRole('button', { name: 'Toggle theme' });
    const ssrButton = await button.elementHandle();
    expect(ssrButton).not.toBeNull();
    const initialTheme = await button.getAttribute('data-theme');

    await button.click();
    await expect(button).not.toHaveAttribute('data-theme', initialTheme ?? '');

    const activatedButton = await button.elementHandle();
    expect(activatedButton).not.toBeNull();
    expect(
      await ssrButton!.evaluate((node, candidate) => node === candidate, activatedButton),
    ).toBe(true);
  });

  test('search controller activates against the existing SSR nodes', async ({ page }) => {
    await waitForHydratedSearch(page);

    const trigger = page.getByRole('button', { name: 'Search' });
    // Node identity is asserted on the SSR overlay element: the dialog role
    // only enters the accessibility tree once the overlay opens, so the
    // hidden-state node reference must come from the structural host scope.
    const overlay = page.locator('open-search .overlay');
    const ssrOverlay = await overlay.elementHandle();
    expect(ssrOverlay).not.toBeNull();

    await expect(overlay).toBeHidden();
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();

    const activatedOverlay = await overlay.elementHandle();
    expect(activatedOverlay).not.toBeNull();
    expect(
      await ssrOverlay!.evaluate((node, candidate) => node === candidate, activatedOverlay),
    ).toBe(true);
  });

  test('search controller reconnects without replacing its SSR nodes', async ({ page }) => {
    await waitForHydratedSearch(page);

    const search = page.locator('open-search');
    const overlay = search.locator('.overlay');
    const ssrOverlay = await overlay.elementHandle();
    expect(ssrOverlay).not.toBeNull();

    await search.evaluate((host) => {
      const parent = host.parentNode;
      const next = host.nextSibling;
      host.remove();
      parent?.insertBefore(host, next);
    });
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();

    const reconnectedOverlay = await overlay.elementHandle();
    expect(reconnectedOverlay).not.toBeNull();
    expect(
      await ssrOverlay!.evaluate((node, candidate) => node === candidate, reconnectedOverlay),
    ).toBe(true);
  });

  test('a runtime import pending across remove/reinsert does not open the reinstalled island', async ({
    page,
  }) => {
    await waitForHydratedSearch(page);

    // Hold the lazily imported runtime chunk so the first open's connect
    // continuation is still pending when the host is torn down.
    let chunkRequested = false;
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    await page.route('**/open-search-combobox-*.js', async (route) => {
      chunkRequested = true;
      await chunkGate;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => chunkRequested).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();

    // Same-turn remove + reinsert: uninstallSearch tears the install down and
    // the reinstalled island gets a fresh state; the pending import from the
    // removed install must publish nowhere and open nothing.
    await page.locator('open-search').evaluate((host) => {
      const parent = host.parentNode;
      const next = host.nextSibling;
      host.remove();
      parent?.insertBefore(host, next);
    });
    releaseChunk();
    await page.waitForTimeout(300);

    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();

    // The reinstalled island is fully functional on its own.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();
  });

  test('an open session does not survive a reconnect; the reinstalled island reopens cleanly', async ({
    page,
  }) => {
    await waitForHydratedSearch(page);

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();

    // Remove + reinsert while the dialog is open: the old session closes and
    // every machine-written attribute is stripped by teardown; the fresh
    // install must be able to open again from the SSR markup.
    await page.locator('open-search').evaluate((host) => {
      const parent = host.parentNode;
      const next = host.nextSibling;
      host.remove();
      parent?.insertBefore(host, next);
    });
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search documentation' })).toBeFocused();
  });
});

test.describe('open-button form piercing', () => {
  test('shadow-DOM submit click reaches the outer form as a composed submit event', async ({
    page,
  }) => {
    await waitForHydratedSearch(page);

    const result = await page.evaluate(async () => {
      // open-button is not used by the homepage, so load its island chunk
      // directly. The chunk URL hash is discovered from the island loader
      // source to survive rebuilds. Package islands group under the island
      // naming (`island-<tag>-<hash>.js`, #1471 exact identity join); the
      // unprefixed shape stays tolerated for a module that ends up unnamed.
      const loaderSource = await (await fetch('/client/islands/client.js')).text();
      const chunkMatch = loaderSource.match(
        /(?:\.\/|islands\/)((?:island-)?open-button-[\w-]+\.js)/,
      );
      if (!chunkMatch) return { error: 'open-button chunk URL not found in island loader' };

      const mod = (await import(`/client/islands/${chunkMatch[1]}`)) as Record<string, unknown>;
      // Island chunks wrapped by the runtime expose a `.t` namespace (the same
      // unwrap the island loader applies); plain ui-package chunks export the
      // class directly.
      const ns = mod.t as
        | (Record<string, CustomElementConstructor | undefined> & {
            default?: CustomElementConstructor;
          })
        | undefined;
      // #638: package island chunks dropped `export default`; the constructor
      // is exported under the CEM class name `OpenButton`.
      const ButtonCtor =
        (mod as Record<string, CustomElementConstructor | undefined>).OpenButton ??
        ns?.OpenButton ??
        ns?.default ??
        (mod.default as CustomElementConstructor | undefined);
      if (!ButtonCtor) return { error: 'open-button chunk has no OpenButton export' };
      if (!customElements.get('open-button')) {
        customElements.define('open-button', ButtonCtor);
      }

      const form = document.createElement('form');
      const host = document.createElement('open-button') as HTMLElement & {
        _internals?: { form: HTMLFormElement | null };
      };
      host.setAttribute('type', 'submit');
      host.textContent = 'Go';
      form.appendChild(host);
      document.body.appendChild(form);

      let submitEvent: { composed: boolean; bubbles: boolean } | null = null;
      form.addEventListener('submit', (event) => {
        // Prevent the follow-up requestSubmit() navigation; the assertion is
        // about the composed event crossing the shadow boundary.
        event.preventDefault();
        submitEvent = { composed: event.composed, bubbles: event.bubbles };
      });
      let openClickSeen = false;
      host.addEventListener('open-click', () => {
        openClickSeen = true;
      });

      const inner = host.shadowRoot?.querySelector('button');
      if (!inner) return { error: 'open-button shadow button not rendered' };
      inner.click();

      const outcome = {
        submitEvent,
        openClickSeen,
        internalsFormIsOuterForm: host._internals?.form === form,
      };
      form.remove();
      return outcome;
    });

    if (isProbeError(result)) throw new Error(result.error);

    // The inner shadow button's native submit behavior cannot cross the
    // shadow boundary; _handleClick re-dispatches a composed submit event...
    expect(result.submitEvent).toEqual({ composed: true, bubbles: true });
    // ...and still fires the component's own open-click event.
    expect(result.openClickSeen).toBe(true);
    // In a real browser the form association comes from ElementInternals.
    expect(result.internalsFormIsOuterForm).toBe(true);
  });
});
