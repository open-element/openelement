/**
 * Zag composition spike E2E (issue #1149).
 *
 * Proves the Zag Vanilla + Open Props + OpenElement composition against the
 * request-time fixture's real SSR -> hydration pipeline:
 *
 *   1. SSR: Zag packages are imported server-side (the request-time server
 *      bundle inlines them) and /combobox renders readable, form-meaningful
 *      markup before any JS runs (raw-HTML assertions).
 *   2. ShadowRoot scoping: two zag-combobox instances on one page; driving
 *      one never touches the other (each machine's getRootNode is its own
 *      island ShadowRoot).
 *   3. Keyboard / typeahead / Escape / blur / focus restoration / disabled
 *      options / ARIA contract on the shadow island.
 *   4. Light-mode qualification composing with ADR-0142 (#1148): the light
 *      island's chunk is held while the user types and focuses; after the
 *      delayed upgrade the same input node, its value, and focus survive,
 *      and the machine binds to that surviving DOM.
 *   5. Same-turn DOM move + disconnect/reconnect: no duplicated listeners —
 *      one option-select fires onValueChange exactly once per gesture.
 *   6. Controlled prop updates (machine.updateProps) and native form POST
 *      semantics (the light island's input shares the page tree, so the POST
 *      body carries the selected fruit).
 *   7. Document scope: a light island created at document.body works with
 *      getRootNode() === document.
 *
 * A real screen reader is out of scope; the ARIA attribute contract is
 * asserted instead (recorded INCONCLUSIVE-with-reason for the literal
 * screen-reader part in the evidence doc).
 *
 * WebKit note: pointer clicks on inputs inside the doubly-nested DSD shadow
 * roots (page > island > input) trip a WebKit elementsFromPoint quirk (the
 * stack is headed by the outer page host), which fails Playwright's
 * actionability hit-test. Real pointer dispatch is unaffected (singular
 * elementFromPoint returns the input). Those steps therefore use DOM
 * focus()/keyboard — the Zag behavior under assertion is identical.
 */

import { expect, test } from '@playwright/test';

const LIGHT_CHUNK_PATTERN = '**/client/islands/island-zag-combobox-light-*.js';

function shadowHost(machineId: string) {
  return `zag-combobox[machine-id="${machineId}"]`;
}

/** Deep active element data-part, piercing every open shadow root. */
function deepActivePart(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active?.getAttribute('data-part') ?? null;
  });
}

function selectCounts(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    (globalThis as { __zagSelectCounts?: Record<string, number> }).__zagSelectCounts ?? {}
  );
}

test.describe('zag combobox spike (#1149)', () => {
  test('SSR imports Zag server-side and renders readable, form-meaningful markup before JS', async ({ request }) => {
    // A 200 here is itself evidence item 1: the request-time server bundle
    // inlines @zag-js/combobox + @zag-js/vanilla (the route imports the
    // islands), so rendering succeeded with no browser globals available.
    const response = await request.get('/combobox');
    expect(response.ok()).toBe(true);
    const html = await response.text();

    // Shadow islands: DSD templates with the full readable structure inside.
    expect(html).toContain('<zag-combobox machine-id="shadow-a"');
    expect(html).toContain('<zag-combobox machine-id="shadow-b"');
    expect(html.match(/<zag-combobox[^>]*>\s*<template shadowrootmode="open">/g)?.length).toBe(2);

    // Light island: ADR-0142 provenance marker + form-meaningful input.
    expect(html).toMatch(/<zag-combobox-light[^>]*data-oe-light/);
    expect(html).toContain('name="fruit"');
    expect(html).toContain('<form id="fruit-form" method="post">');

    // Readable list content before JS: labels and item markup are present.
    expect(html).toContain('data-part="label">Shadow fruit</label>');
    expect(html).toContain('data-part="label">Fruit</label>');
    for (const label of ['Apple', 'Banana', 'Cherry', 'Mango', 'Orange']) {
      expect(html).toMatch(new RegExp(`data-part="item"[^>]*>${label}\\s*</li>`));
    }
  });

  test('page works with JavaScript disabled (SSR content only)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/combobox');
    const lightInput = page.locator('zag-combobox-light input[data-part="input"]');
    await expect(lightInput).toBeVisible();
    await expect(lightInput).toHaveAttribute('name', 'fruit');
    // Items are plain readable list items before hydration.
    await expect(page.locator('zag-combobox-light [data-part="item"]')).toHaveCount(5);
    await context.close();
  });

  test('two shadow instances are scoped: interacting with one leaves the other untouched', async ({ page }) => {
    await page.goto('/combobox');
    const aInput = page.locator(`${shadowHost('shadow-a')} input[data-part="input"]`);
    const bInput = page.locator(`${shadowHost('shadow-b')} input[data-part="input"]`);
    await expect(aInput).toBeVisible();
    await expect(bInput).toBeVisible();

    // Zag assigned per-machine ids scoped by machine-id.
    await expect(aInput).toHaveId('combobox:shadow-a:input');
    await expect(bInput).toHaveId('combobox:shadow-b:input');

    await aInput.focus(); // DOM focus, not click — see WebKit note above.
    await aInput.pressSequentially('an');
    await expect(aInput).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    // Zag highlights asynchronously (raf): wait for the highlight to land.
    await expect(aInput).toHaveAttribute(
      'aria-activedescendant',
      'combobox:shadow-a:option:banana',
    );
    await page.keyboard.press('Enter');
    await expect(aInput).toHaveValue('Banana');

    // Instance B never opened, never changed.
    await expect(bInput).toHaveValue('');
    await expect(bInput).toHaveAttribute('aria-expanded', 'false');
    const bContent = page.locator(`${shadowHost('shadow-b')} [data-part="content"]`);
    await expect(bContent).toBeHidden();
  });

  test('keyboard, typeahead, escape, blur, focus restoration, disabled option, ARIA contract', async ({ page }) => {
    await page.goto('/combobox');
    const host = shadowHost('shadow-a');
    const input = page.locator(`${host} input[data-part="input"]`);
    const content = page.locator(`${host} [data-part="content"]`);
    const item = (value: string) =>
      page.locator(`${host} [data-part="item"][data-value="${value}"]`);

    // ARIA contract after hydration (screen-reader proxy assertions).
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-autocomplete', /^(list|both)$/);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveAttribute('aria-controls', 'combobox:shadow-a:content');

    // Typeahead filters and opens.
    await input.focus(); // DOM focus, not click — see WebKit note above.
    await input.pressSequentially('an');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(content).toHaveAttribute('role', 'listbox');
    await expect(item('banana')).toHaveAttribute('role', 'option');
    await expect(item('apple')).toBeHidden(); // filtered out
    await expect(item('banana')).toBeVisible();
    await expect(item('mango')).toBeVisible();

    // Disabled option carries the ARIA/data contract.
    await input.fill('');
    await input.pressSequentially('e'); // Cherry, Orange, Apple visible
    await expect(item('cherry')).toBeVisible();
    await expect(item('cherry')).toHaveAttribute('aria-disabled', 'true');
    await expect(item('cherry')).toHaveAttribute('data-disabled', /.*/);

    // ArrowDown skips the disabled option (Cherry sorts between Banana? no —
    // with filter 'e' the visible order is Apple, Cherry, Orange; highlight
    // must never land on Cherry).
    await input.fill('');
    await page.keyboard.press('ArrowDown'); // opens, highlights first item (Apple)
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const highlighted = await input.getAttribute('aria-activedescendant');
    expect(highlighted).toBe('combobox:shadow-a:option:apple');
    await expect(item('apple')).toHaveAttribute('data-highlighted', /.*/);

    // Enter selects, closes, and restores focus to the input.
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Apple');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => deepActivePart(page)).toBe('input');

    // Escape closes without selecting.
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    // Clicking the disabled option does not select it (reset the typeahead
    // filter first so Cherry is visible: after the Enter selection the
    // filter is 'Apple').
    await input.fill('');
    await input.pressSequentially('e');
    await expect(item('cherry')).toBeVisible();
    // Synthetic click (no hit-test): Zag's onClick guard must ignore the
    // disabled option (itemState.disabled -> no ITEM.CLICK sent).
    await item('cherry').dispatchEvent('click');
    await expect(input).not.toHaveValue('Cherry');
    expect((await selectCounts(page))['shadow-a'] ?? 0).toBe(1); // only the Enter selection

    // Blur closes the content.
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await page.locator('h1').click();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('light-mode in-place activation composes with ADR-0142 (node identity, value, focus)', async ({ page }) => {
    const mismatchWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('SSR/hydration mismatch')) {
        mismatchWarnings.push(msg.text());
      }
    });

    // Hold only the light island chunk: client.js evaluates (click capture
    // installed, shadow islands hydrate) while zag-combobox-light stays
    // undefined. client.js statically imports island-live-counter-*.js and
    // the light chunk imports island-zag-combobox-*.js — neither is held.
    let chunkRequested = false;
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    await page.route(LIGHT_CHUNK_PATTERN, async (route) => {
      chunkRequested = true;
      await chunkGate;
      await route.continue();
    });

    try {
      // domcontentloaded, not load: WebKit holds the load event while the
      // dynamic import of the held chunk is pending.
      await page.goto('/combobox', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => chunkRequested).toBe(true);

      const host = page.locator('zag-combobox-light');
      await expect(host).toHaveAttribute('data-oe-light', '');
      const input = page.locator('zag-combobox-light input[data-part="input"]');
      await expect(input).toBeVisible();
      expect(await page.evaluate(() => customElements.get('zag-combobox-light') === undefined))
        .toBe(true);

      // Shadow islands hydrate normally while the light chunk is held.
      await expect(page.locator(`${shadowHost('shadow-a')} input[data-part="input"]`))
        .toHaveAttribute('role', 'combobox');

      // Capture node identity, then type + focus before the upgrade.
      await page.evaluate(() => {
        const host = document.querySelector('combobox-page')!.shadowRoot!.querySelector(
          'zag-combobox-light',
        )!;
        (window as unknown as { __pre: { host: Element; input: HTMLInputElement } }).__pre = {
          host,
          input: host.querySelector('input[data-part="input"]') as HTMLInputElement,
        };
      });
      await input.pressSequentially('typed-before-upgrade');
      await input.focus();

      releaseChunk();
      await page.waitForFunction(() => customElements.get('zag-combobox-light') !== undefined);

      // In-place activation: same nodes, preserved value and focus.
      const post = await page.evaluate(() => {
        const pre = (window as unknown as { __pre: { host: Element; input: HTMLInputElement } })
          .__pre;
        const host = document.querySelector('combobox-page')!.shadowRoot!.querySelector(
          'zag-combobox-light',
        );
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return {
          sameHost: pre.host === host,
          sameInput: pre.input === host?.querySelector('input[data-part="input"]'),
          noShadowRoot: host?.shadowRoot === null,
          stillMarked: host?.hasAttribute('data-oe-light') ?? false,
          inputValue: pre.input.value,
          inputFocused: active === pre.input,
        };
      });
      expect(post).toEqual({
        sameHost: true,
        sameInput: true,
        noShadowRoot: true,
        stillMarked: true,
        inputValue: 'typed-before-upgrade',
        inputFocused: true,
      });

      // The machine bound to the surviving DOM: full keyboard flow works.
      await expect(input).toHaveAttribute('role', 'combobox');
      await input.fill('');
      await input.pressSequentially('ma');
      await page.keyboard.press('ArrowDown');
      await expect(input).toHaveAttribute(
        'aria-activedescendant',
        'combobox:light-fruit:option:mango',
      );
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('Mango');

      expect(mismatchWarnings).toEqual([]);
    } finally {
      releaseChunk();
    }
  });

  test('same-turn DOM move and disconnect/reconnect do not duplicate listeners', async ({ page }) => {
    await page.goto('/combobox');
    const host = shadowHost('shadow-a');
    const input = page.locator(`${host} input[data-part="input"]`);
    await expect(input).toHaveAttribute('role', 'combobox');

    // Baseline selection: exactly one onValueChange. Typeahead narrows to a
    // single item; Zag highlights asynchronously (raf), so wait for the
    // highlight before pressing Enter.
    await input.focus(); // DOM focus, not click — see WebKit note above.
    await input.pressSequentially('appl');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:shadow-a:option:apple',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Apple');
    expect((await selectCounts(page))['shadow-a']).toBe(1);

    // Same-turn move into #move-target (synchronous disconnect + reconnect).
    await page.evaluate(() => {
      const pageRoot = document.querySelector('combobox-page')!.shadowRoot!;
      const hostEl = pageRoot.querySelector('zag-combobox[machine-id="shadow-a"]')!;
      pageRoot.querySelector('#move-target')!.appendChild(hostEl);
    });
    await expect(input).toHaveAttribute('role', 'combobox');

    // One selection gesture after the move increments the counter once.
    await input.focus();
    await input.fill('');
    await input.pressSequentially('ban');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:shadow-a:option:banana',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Banana');
    expect((await selectCounts(page))['shadow-a']).toBe(2);

    // Full disconnect, then reconnect in a later task.
    await page.evaluate(() => {
      const pageRoot = document.querySelector('combobox-page')!.shadowRoot!;
      const hostEl = pageRoot.querySelector('zag-combobox[machine-id="shadow-a"]')!;
      (window as unknown as { __detached: Element }).__detached = hostEl;
      hostEl.remove();
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const pageRoot = document.querySelector('combobox-page')!.shadowRoot!;
      const hostEl = (window as unknown as { __detached: Element }).__detached;
      pageRoot.querySelector('#move-target')!.appendChild(hostEl);
    });
    await expect(input).toHaveAttribute('role', 'combobox');

    await input.focus();
    await input.fill('');
    await input.pressSequentially('appl');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:shadow-a:option:apple',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Apple');
    expect((await selectCounts(page))['shadow-a']).toBe(3);
  });

  test('controlled prop update flows through the machine and reflects in the DOM', async ({ page }) => {
    await page.goto('/combobox');
    const bInput = page.locator(`${shadowHost('shadow-b')} input[data-part="input"]`);
    await expect(bInput).toHaveAttribute('role', 'combobox');

    const snapshot = await page.evaluate(() => {
      const hostEl = document.querySelector('combobox-page')!.shadowRoot!.querySelector(
        'zag-combobox[machine-id="shadow-b"]',
      ) as unknown as {
        demoSetControlledValue(value: string): void;
        demoSnapshot(): { value: string[]; valueAsString: string; inputValue: string };
      };
      hostEl.demoSetControlledValue('mango');
      return hostEl.demoSnapshot();
    });
    // Controlled props reached the machine.
    expect(snapshot).toEqual({
      value: ['mango'],
      valueAsString: 'Mango',
      inputValue: 'Mango',
      open: false,
      highlightedValue: null,
      collectionValues: ['apple', 'banana', 'cherry', 'mango', 'orange'],
    });

    // The live input text follows on the machine's next syncInputValue
    // transition (Zag spreads defaultValue, not value — see shared module).
    // openOnClick is false by default, so open with ArrowDown; the Escape
    // close transition runs syncInputValue and repaints the input.
    await bInput.focus(); // DOM focus, not click — see WebKit note above.
    await page.keyboard.press('ArrowDown');
    await expect(bInput).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(bInput).toHaveValue('Mango');
  });

  test('form POST carries the selected value (native, unenhanced)', async ({ page }) => {
    await page.goto('/combobox');
    const input = page.locator('zag-combobox-light input[data-part="input"]');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('name', 'fruit');

    await input.click();
    await input.pressSequentially('or');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:light-fruit:option:orange',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Orange');

    await page.locator('#submit-fruit').click();
    await page.waitForURL('**/combobox?selected=Orange');
    await expect(page.locator('#selected-echo')).toHaveText('selected=Orange');
  });

  test('a light island created at document scope works (getRootNode = Document)', async ({ page }) => {
    await page.goto('/combobox');
    // Wait until the light island class is defined (chunk loaded on load strategy).
    await page.waitForFunction(() => customElements.get('zag-combobox-light') !== undefined);
    await page.evaluate(() => {
      const hostEl = document.createElement('zag-combobox-light');
      hostEl.setAttribute('machine-id', 'light-document');
      document.body.appendChild(hostEl);
    });
    const input = page.locator('body > zag-combobox-light input[data-part="input"]');
    await expect(input).toHaveAttribute('role', 'combobox');
    await input.click();
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:light-document:option:apple',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Apple');
    expect((await selectCounts(page))['light-document']).toBe(1);
  });
});
