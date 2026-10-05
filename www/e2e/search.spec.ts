import { expect, test, type Page } from '@playwright/test';

/**
 * The dynamically imported runtime chunk (Zag stack + Pagefind pipeline,
 * open-search-combobox.ts). Gating exactly this request makes the first-open
 * race deterministic; the hash changes across builds, the name prefix does
 * not.
 */
const COMBOBOX_CHUNK = '**/open-search-combobox-*.js';

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test.describe('Search', () => {
  test('pagefind index is generated and non-empty', async ({ request }) => {
    const res = await request.get('/pagefind/pagefind-entry.json');
    expect(res.ok()).toBe(true);
    const entry = (await res.json()) as {
      languages?: Record<string, { page_count: number }>;
    };
    // The index derives from the built HTML, so stale/removed routes cannot
    // appear by construction; assert coverage instead of path liveness.
    const pageCount = Object.values(entry.languages ?? {}).reduce(
      (total, lang) => total + lang.page_count,
      0,
    );
    expect(pageCount).toBeGreaterThan(0);
  });

  test('search island returns a live routing result', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));
    await page.keyboard.press('Control+K');
    const searchField = page.getByRole('combobox', { name: 'Search documentation' });
    await expect(searchField).toBeVisible();
    await searchField.pressSequentially('routing');
    // First search pays the Pagefind wasm/index load; allow extra time —
    // the full-suite run shares the static server and workers with every
    // other spec, so the wasm/index round can take far longer than solo.
    const firstResult = page
      .getByRole('listbox', { name: 'Search results' })
      .getByRole('option')
      .first();
    await expect(firstResult).toBeVisible({ timeout: 30_000 });

    const href = await firstResult.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).not.toBe('/guide/routing');
    const res = await request.get(href!);
    expect(res.ok()).toBe(true);
  });

  test('arrow keys move aria-activedescendant and Enter navigates to the highlighted hit', async ({
    page,
  }) => {
    // The combobox state machine (Zag) owns the keyboard: this is the
    // traversal contract — ArrowDown highlights, aria-activedescendant tracks
    // it on the input, Enter activates the highlighted anchor.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));
    await page.keyboard.press('Control+K');

    const searchField = page.getByRole('combobox', { name: 'Search documentation' });
    await expect(searchField).toBeFocused();
    await searchField.pressSequentially('guide');
    const listbox = page.getByRole('listbox', { name: 'Search results' });
    await expect(listbox.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
    await expect(searchField).toHaveAttribute('aria-expanded', 'true');
    await expect(searchField).toHaveAttribute('aria-controls', 'open-search-results');

    await page.keyboard.press('ArrowDown');
    const firstOption = listbox.getByRole('option').first();
    await expect(searchField).toHaveAttribute(
      'aria-activedescendant',
      (await firstOption.getAttribute('id'))!,
    );
    const firstHref = await firstOption.getAttribute('href');

    await page.keyboard.press('ArrowDown');
    const secondOption = listbox.getByRole('option').nth(1);
    await expect(searchField).toHaveAttribute(
      'aria-activedescendant',
      (await secondOption.getAttribute('id'))!,
    );
    const secondHref = await secondOption.getAttribute('href');
    expect(secondHref).not.toEqual(firstHref);

    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === secondHref);
    expect(page.url()).toContain(secondHref!);
  });

  test('search trigger focuses input and accepts real keyboard typing', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const input = page.getByRole('combobox', { name: 'Search documentation' });
    await expect(input).toBeFocused();

    await page.keyboard.type('routing');
    await expect(input).toHaveValue('routing');

    const firstResult = page
      .getByRole('listbox', { name: 'Search results' })
      .getByRole('option')
      .first();
    // First search pays the Pagefind wasm/index load; allow extra time.
    await expect(firstResult).toBeVisible({ timeout: 30_000 });
    const firstHref = await firstResult.getAttribute('href');
    expect(firstHref).toBeTruthy();
    expect(firstHref).not.toBe('/guide/routing');
  });

  test('search overlay is anchored to viewport when opened from layout header', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
    // The geometry contract lives on the backdrop container (`.overlay`):
    // it must span the viewport exactly, so the dialog never opens displaced.
    const overlay = await page.locator('open-search .overlay').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        display: style.display,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewportWidth: globalThis.innerWidth,
      };
    });

    expect(overlay.display).toBe('flex');
    expect(Math.abs(overlay.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.right - overlay.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.width - overlay.viewportWidth)).toBeLessThanOrEqual(1);
  });

  test('search positioner anchors below the input at matching width', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search' });
    const input = page.getByRole('combobox', { name: 'Search documentation' });
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    // The positioner props are re-spread when the results render, and that
    // re-sync must not disturb the placement floating-ui already computed —
    // the open-only popup never exercises that path, so the search runs first.
    await input.pressSequentially('routing');
    const firstResult = page
      .getByRole('listbox', { name: 'Search results' })
      .getByRole('option')
      .first();
    // First search pays the Pagefind wasm/index load; allow extra time —
    // the full-suite run shares the static server and workers with every
    // other spec, so the wasm/index round can take far longer than solo.
    await expect(firstResult).toBeVisible({ timeout: 30_000 });

    // Placement lands asynchronously (floating-ui positions after the popup
    // renders), so the geometry contract is retried via toPass, not sampled
    // once; both rects are read in one evaluate for a same-frame measurement.
    await expect(async () => {
      const geometry = await page.evaluate(() => {
        const panel = document.getElementById('open-search-positioner');
        const field = document.getElementById('open-search-input');
        if (!panel || !field) return null;
        const panelBox = panel.getBoundingClientRect();
        const fieldBox = field.getBoundingClientRect();
        return {
          xDelta: Math.abs(panelBox.x - fieldBox.x),
          topGap: panelBox.y - fieldBox.bottom,
          widthDelta: Math.abs(panelBox.width - fieldBox.width),
        };
      });
      expect(geometry).not.toBeNull();
      // bottom-start: the panel's left edge tracks the input's left edge.
      expect(geometry!.xDelta).toBeLessThanOrEqual(2);
      // The panel sits below the input's bottom edge at the configured
      // mainAxis offset (6px); 12px leaves room for rounding.
      expect(geometry!.topGap).toBeGreaterThanOrEqual(0);
      expect(geometry!.topGap).toBeLessThanOrEqual(12);
      // sameWidth: the panel spans the input's width.
      expect(geometry!.widthDelta).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 10_000 });
  });

  test('search initial HTML does not stringify computed signals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    // The results listbox lives inside the closed overlay — it enters the
    // accessibility tree once the user opens the search.
    await page.getByRole('button', { name: 'Search' }).click();
    const results = page.getByRole('listbox', { name: 'Search results' });
    await expect(results).toBeVisible();
    const text = await results.evaluate((el) => el.textContent ?? '');
    expect(text).not.toContain('[object Object]');
    await expect(results).toContainText('Type at least 2 characters to search');
  });

  test('search panel follows theme token changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    const dialog = page.getByRole('dialog', { name: 'Search' });
    const readPanelBackground = async () => {
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(dialog).toBeVisible();
      return await dialog.evaluate((panel) => getComputedStyle(panel).backgroundColor);
    };

    const darkBackground = await readPanelBackground();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const beforeTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    );
    const expectedTheme = beforeTheme === 'light' ? 'dark' : 'light';

    await page.getByRole('button', { name: 'Toggle theme' }).click();

    await page.waitForFunction(
      (theme) => document.documentElement.getAttribute('data-theme') === theme,
      expectedTheme,
    );
    const lightBackground = await readPanelBackground();

    expect(darkBackground).toBeTruthy();
    expect(lightBackground).toBeTruthy();
    expect(lightBackground).not.toBe(darkBackground);
  });

  test('search overlay closes when clicking the backdrop', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();

    // The backdrop (`.overlay`) covers the full viewport around the dialog;
    // a real click in its corner must dismiss the search like a user expects.
    const backdrop = page.locator('open-search .overlay');
    await backdrop.click({ position: { x: 2, y: 2 } });

    await expect(backdrop).toBeHidden();
    await expect(dialog).toBeHidden();
  });

  test('zh locale renders localized search chrome', async ({ page }) => {
    await page.goto('/zh/guide/getting-started');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => customElements.get('open-search'));

    // Integration review: the zh chrome copy is finalized by the content
    // agent; this pins the trigger label 搜索 and a working dialog.
    const trigger = page.getByRole('button', { name: '搜索' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
  });
});

/**
 * Deterministic open/search session races (#1521 items 2–4).
 *
 * Every test gates exactly one network request with page.route — the lazy
 * runtime chunk or a Pagefind resource — so the load/query continuations run
 * on demand, in a fixed order, without networkidle or wall-clock sleeps. The
 * contracts under test:
 *
 *   - a close invalidates every open/focus/load continuation captured by the
 *     closed session (controller) and every in-flight query round (runtime);
 *   - a close/reopen leaves only the newest session in charge;
 *   - a transient chunk load failure closes the failed session and leaks no
 *     error; an index load failure shows the missing-index message and the
 *     next open retries with a fresh URL;
 *   - a query round landing after its close must not write
 *     hits/skeleton/message into the newer state, whether its bytes arrive
 *     (served) or its fetch would have failed;
 *   - an index load finishing after a close may cache the module but must
 *     not start a search for the closed dialog;
 *   - a reinstall racing the same in-flight import must publish a runtime
 *     whose pipeline is alive — a search lands, it does not die silently on
 *     the pipeline-identity guard (#1531);
 *   - while the runtime chunk is still loading, Tab is not trapped: focus
 *     can leave the background trigger and reach the open dialog's input
 *     (#1533).
 */
test.describe('Search session races', () => {
  /** Open the page and wait for the island upgrade — no networkidle. */
  async function gotoHome(page: Page): Promise<void> {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!customElements.get('open-search'));
  }

  /** The per-test locators (dialog, input, results, skeleton, overlay). */
  function locators(page: Page) {
    return {
      dialog: page.getByRole('dialog', { name: 'Search' }),
      input: page.getByRole('combobox', { name: 'Search documentation' }),
      results: page.getByRole('listbox', { name: 'Search results' }),
      skeleton: page.locator('#open-search-results .skeleton'),
      empty: page.locator('#open-search-results .empty'),
      overlay: page.locator('open-search .overlay'),
    };
  }

  /** The island's session-owned view state, for equality snapshots. */
  function hostState(page: Page): Promise<{
    searching: boolean;
    hasHits: boolean;
    message: string;
    hitCount: number;
  }> {
    return page.evaluate(() => {
      const fields = document.querySelector('open-search') as unknown as {
        searching: boolean;
        hasHits: boolean;
        message: string;
        hits: unknown[];
      };
      return {
        searching: fields.searching,
        hasHits: fields.hasHits,
        message: fields.message,
        hitCount: fields.hits.length,
      };
    });
  }

  test('closing while the runtime chunk is still loading keeps the overlay closed and never steals focus', async ({
    page,
  }) => {
    const { dialog } = locators(page);
    await gotoHome(page);
    const chunk = deferred();
    let requested = false;
    await page.route(COMBOBOX_CHUNK, async (route) => {
      requested = true;
      await chunk.promise;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Release the load: the stale open continuation must not reopen the
    // dialog, focus the input, or touch the closed state.
    chunk.release();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(focusedId).not.toBe('open-search-input');
  });

  test('a close/reopen during the chunk load leaves the newest session open and focused', async ({
    page,
  }) => {
    const { dialog, input, overlay } = locators(page);
    await gotoHome(page);
    const chunk = deferred();
    let requested = false;
    await page.route(COMBOBOX_CHUNK, async (route) => {
      requested = true;
      await chunk.promise;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => requested).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Reopen while the same import is still in flight: the newest session
    // owns the outcome.
    await page.getByRole('button', { name: 'Search' }).click();
    chunk.release();
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(overlay).toBeVisible();
  });

  test('a reconnect racing the in-flight chunk import publishes a runtime that actually searches (#1531)', async ({
    page,
  }) => {
    const { dialog, input, results } = locators(page);
    await gotoHome(page);
    const chunk = deferred();
    let requested = false;
    await page.route(COMBOBOX_CHUNK, async (route) => {
      requested = true;
      await chunk.promise;
      await route.continue();
    });

    // First open starts the import (held): the stale install's connect
    // continuation now hangs on the import promise.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => requested).toBe(true);

    // Remove + reinsert the island host on the SAME element: the install is
    // torn down and a fresh state takes over the same host — while the same
    // import is still in flight.
    await page.locator('open-search').evaluate((host) => {
      const parent = host.parentNode;
      const next = host.nextSibling;
      host.remove();
      parent?.insertBefore(host, next);
    });

    // Reopen before the import resolves: the fresh install's connect
    // continuation queues behind the stale one on the same import promise.
    await page.getByRole('button', { name: 'Search' }).click();
    chunk.release();
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();

    // The discriminating assertion: the stale continuation must not have
    // created a pipeline whose deletion by its own teardown leaves the
    // published runtime dead (every query silently no-ops on the
    // pipeline-identity guard). A real query must land.
    await input.pressSequentially('ro');
    await expect(results.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
  });

  test('Tab reaches the open dialog while the runtime chunk is still loading (#1533)', async ({
    page,
  }) => {
    const { dialog, input } = locators(page);
    const trigger = page.getByRole('button', { name: 'Search' });
    await gotoHome(page);
    const chunk = deferred();
    let requested = false;
    await page.route(COMBOBOX_CHUNK, async (route) => {
      requested = true;
      await chunk.promise;
      await route.continue();
    });

    await trigger.click();
    await expect.poll(() => requested).toBe(true);
    await expect(dialog).toBeVisible();
    // The not-ready window is about focus resting on the background trigger;
    // pin the starting point explicitly (click focus is not portable across
    // engines — WebKit leaves the button unfocused).
    await trigger.focus();

    // The trap must not engage before the runtime exists: nothing in the
    // dialog owns focus yet, so Tab follows the natural order into the
    // dialog's input instead of being swallowed on the trigger.
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    // The runtime lands, the session completes, and the full modal trap is
    // back: Tab can no longer fall through.
    chunk.release();
    await expect(input).toBeFocused({ timeout: 10_000 });
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
  });

  test('a transient first-open chunk failure closes the session cleanly and leaks no errors', async ({
    page,
  }) => {
    const { dialog } = locators(page);
    await gotoHome(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.evaluate(() => {
      const state = globalThis as unknown as { __unhandledRejections?: string[] };
      state.__unhandledRejections = [];
      window.addEventListener('unhandledrejection', (event) => {
        state.__unhandledRejections!.push(String(event.reason));
      });
    });

    let attempts = 0;
    await page.route(COMBOBOX_CHUNK, (route) => {
      attempts++;
      return route.abort('failed');
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => attempts).toBe(1);
    // The failed session closes/resets instead of hanging open half-wired.
    await expect(dialog).toBeHidden();

    // The next open re-attempts the connect (the memoized rejection was
    // cleared). The browser's module map fails the exact same specifier
    // without a new network round, so the UI must fail fast and clean:
    // never hang open, never crash, never leak an unhandled rejection.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await expect(dialog).toBeHidden();

    expect(pageErrors).toEqual([]);
    const unhandled = await page.evaluate(
      () => (globalThis as unknown as { __unhandledRejections?: string[] }).__unhandledRejections,
    );
    expect(unhandled).toEqual([]);
  });

  test('a query round landing after its close leaves closed-state fields and no stale results', async ({
    page,
  }) => {
    const { dialog, input, results, skeleton, empty } = locators(page);
    await gotoHome(page);
    // Hold only the per-result fragment fetches (the round's data() calls);
    // the pagefind entry, wasm and index files pass through untouched.
    const fragments = deferred();
    await page.route('**/pagefind/**', async (route) => {
      if (!route.request().url().includes('/fragment/')) return route.continue();
      await fragments.promise;
      return route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await input.pressSequentially('routing');
    await expect(results).toBeVisible();
    await expect(skeleton).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Now release the held round: it is stale and must not re-fill anything.
    fragments.release();
    const state = await page.evaluate(() => {
      const host = document.querySelector('open-search');
      if (!host) return null;
      const fields = host as unknown as {
        searching: boolean;
        hasHits: boolean;
        hits: unknown[];
        message: string;
      };
      return {
        searching: fields.searching,
        hasHits: fields.hasHits,
        hits: fields.hits.length,
        message: fields.message,
      };
    });
    expect(state).toEqual({
      searching: false,
      hasHits: false,
      hits: 0,
      message: 'Type at least 2 characters to search',
    });
    await expect(results.getByRole('option')).toHaveCount(0);

    // Reopening shows the fresh-session guidance, never the old results.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(dialog).toBeVisible();
    await expect(results.getByRole('option')).toHaveCount(0);
    await expect(empty).toContainText('Type at least 2 characters to search');
  });

  test('a stale round landing beside the live round leaves only the live results', async ({
    page,
  }) => {
    const { dialog, input, results } = locators(page);
    await gotoHome(page);
    // Every fragment fetch from both rounds is held behind one gate and
    // released together. Pagefind serializes fragment loads on every engine,
    // so no design can land a newer round while an older one hangs; the
    // portable shape is: both rounds' bytes arrive together, and the stale
    // round's landing must be dropped by sequence ownership while the live
    // round's landing wins.
    const gate = deferred();
    await page.route('**/pagefind/**', async (route) => {
      if (!route.request().url().includes('/fragment/')) return route.continue();
      await gate.promise;
      return route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await input.pressSequentially('ro');
    // The stale round is genuinely in flight before the close invalidates it.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('open-search') as unknown as { searching: boolean }).searching,
        ),
      )
      .toBe(true);

    // Close/reopen: the close invalidates the 'ro' round's session. The
    // settle window absorbs the close/reopen's own machine churn so the
    // newer session starts from a quiesced state.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await page.waitForTimeout(300);
    await input.pressSequentially('guide');

    // Both rounds' bytes arrive together: the live round lands, the stale
    // round's landing is dropped.
    gate.release();
    await expect(results.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
    const landed = await hostState(page);
    expect(landed).toMatchObject({ searching: false, hasHits: true });
    expect(landed.hitCount).toBeGreaterThan(0);
    const hits = await results.getByRole('option').count();

    // Settle: the stale round's late continuation must not rewrite anything
    // the live round owns.
    await page.waitForTimeout(500);
    expect(await hostState(page)).toEqual(landed);
    expect(await results.getByRole('option').count()).toBe(hits);
  });

  test('an index init completing after a close caches the module but does not search the closed dialog', async ({
    page,
  }) => {
    const { dialog, input, results } = locators(page);
    await gotoHome(page);
    const entry = deferred();
    // The trailing glob covers a cache-busted retry URL (?retry=N) too.
    await page.route('**/pagefind/pagefind.js*', async (route) => {
      await entry.promise;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The load completes into the closed dialog: cache it, start nothing.
    entry.release();
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const fields = document.querySelector('open-search') as unknown as {
        searching: boolean;
        hasHits: boolean;
        hits: unknown[];
        message: string;
      };
      return {
        searching: fields.searching,
        hasHits: fields.hasHits,
        hits: fields.hits.length,
        message: fields.message,
      };
    });
    expect(state).toEqual({
      searching: false,
      hasHits: false,
      hits: 0,
      message: 'Type at least 2 characters to search',
    });

    // The cached index serves the next session.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await input.pressSequentially('routing');
    await expect(results.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
  });

  test('an index init failure shows the missing-index message and the next open retries', async ({
    page,
  }) => {
    const { dialog, input, results, empty } = locators(page);
    await gotoHome(page);
    let attempts = 0;
    // The trailing glob covers the cache-busted retry URL (?retry=N): the
    // retry must be a real network fetch — a failed dynamic import stays
    // failed in the module map for its exact specifier.
    await page.route('**/pagefind/pagefind.js*', (route) => {
      attempts++;
      if (attempts === 1) return route.abort('failed');
      return route.continue();
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await expect(empty).toContainText('Search index not found', { timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(input).toBeFocused();
    await input.pressSequentially('routing');
    await expect(results.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});
