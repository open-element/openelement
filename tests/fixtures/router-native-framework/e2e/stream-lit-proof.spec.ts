import { expect, test } from '@playwright/test';

const MESSAGE = 'Lit pill survived the late frame';
const SLOT_LABEL = 'Server-born pill label';

/**
 * #1451 T2 qualification probe: a Lit custom element (<stream-lit-pill>) on an
 * opted-in streamed route (/stream-lit-proof, ADR-0158/0159).
 *
 * Placement contract: the stream frame policy fails closed on foreign
 * custom-element tags inside backfilled ranges (build manifest, deferred
 * executor, and browser installer all reject them), so the pill is server-born
 * in the streamed SHELL next to the deferred Part, with its slot child born on
 * the server. The probe pins that the stream + backfill path leaves exactly one
 * instance which upgrades, keeps its server-born slot child, and stays
 * interactive.
 */

test('streamed shell carries the Lit pill and its server-born slot child before the late frame', async ({ request }) => {
  const response = await request.get('/stream-lit-proof?delay=100');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain('stream-lit-proof-page');
  expect(text).toContain('data-oe-stream-request=');
  expect(text).toContain('<stream-lit-pill');
  expect(text).toContain(SLOT_LABEL);
  expect(text).toContain(MESSAGE);
  // Shell flush order: the pill and its slot child are serialized in the shell,
  // strictly before the backfill frame and the arrival-order noscript tail.
  const pillIndex = text.indexOf('<stream-lit-pill');
  const frameIndex = text.indexOf('data-oe-frame=');
  const tailIndex = text.indexOf('<noscript>');
  expect(pillIndex).toBeLessThan(frameIndex);
  expect(text.indexOf(SLOT_LABEL)).toBeLessThan(frameIndex);
  expect(frameIndex).toBeLessThan(tailIndex);
  expect(text.indexOf(MESSAGE)).toBeGreaterThan(frameIndex);
});

test('with JavaScript the pill upgrades after the backfill without duplication or loss', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // commit resolves on the shell flush; the frame is held back by ?delay.
  await page.goto('/stream-lit-proof?delay=3000', { waitUntil: 'commit' });

  // Pre-backfill shell window: shell marker and the pill with its server-born
  // slot child are already parsed, while the deferred Part is still pending
  // (no noscript tail in the document yet).
  await expect(page.locator('stream-lit-proof-page #shell-marker')).toBeVisible();
  await expect(page.locator('stream-lit-pill')).toHaveCount(1);
  await expect(page.locator('stream-lit-pill #pill-slot-label')).toHaveText(SLOT_LABEL);
  await expect(page.locator('stream-lit-proof-page #delayed')).toBeEmpty();
  await expect(page.locator('noscript')).toHaveCount(0);

  // The backfill fills only the owning Part range.
  await expect(page.locator('stream-lit-proof-page #delayed')).toHaveText(MESSAGE);
  await expect(page.locator('noscript')).toHaveCount(1);

  // The pill upgrades after the stream ends (client modules ride the document
  // suffix): registered, real shadow root with the button inside.
  await expect.poll(() =>
    page.evaluate(() => {
      const pill = document.querySelector('stream-lit-proof-page')?.shadowRoot
        ?.querySelector('stream-lit-pill');
      const ctor = customElements.get('stream-lit-pill');
      return !!ctor && !!pill && pill instanceof ctor &&
        !!pill.shadowRoot?.querySelector('#pill-button');
    })
  ).toBe(true);

  // Post-backfill integrity: exactly one instance, no duplicate shadow root,
  // slot child preserved and projected. (The compiled page HOST itself is not
  // part of the client bundle in this architecture — the framework installer
  // owns the deferred range against the declarative shadow root; only islands
  // hydrate.) `ShadowRoot.host` is the spec-defined owner of the root, so a
  // `host === pill` equality would be tautological and pins nothing — real
  // identity evidence here is the single upgraded instance with its
  // server-born slot child still assigned.
  await expect(page.locator('stream-lit-pill')).toHaveCount(1);
  const integrity = await page.evaluate(() => {
    const pageHost = document.querySelector('stream-lit-proof-page');
    const pill = pageHost?.shadowRoot?.querySelector('stream-lit-pill');
    const pillCtor = customElements.get('stream-lit-pill');
    const slot = pill?.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="label"]');
    return {
      pageHostPresent: !!pageHost?.shadowRoot,
      pillUpgraded: !!pillCtor && !!pill && pill instanceof pillCtor,
      slotChildPreserved: pill?.querySelector('#pill-slot-label')?.textContent ===
        'Server-born pill label',
      slotChildProjected: (slot?.assignedNodes().length ?? 0) > 0,
    };
  });
  expect(integrity).toEqual({
    pageHostPresent: true,
    pillUpgraded: true,
    slotChildPreserved: true,
    slotChildProjected: true,
  });

  // Interaction survives the stream + backfill path.
  await page.locator('stream-lit-pill #pill-button').click();
  await expect(page.locator('stream-lit-pill #pill-button')).toHaveText('pill: 1');
  await page.locator('stream-lit-pill #pill-button').click();
  await expect(page.locator('stream-lit-pill #pill-button')).toHaveText('pill: 2');

  expect(errors).toEqual([]);
});

test('settled streamed page holds exactly one upgraded pill and loses no shell content', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/stream-lit-proof?delay=100');
  await expect(page.locator('stream-lit-proof-page #delayed')).toHaveText(MESSAGE);
  // The backfill did not clobber shell content: #shell-marker is server-born
  // in the streamed shell and the streamed route emits islands as opaque empty
  // hosts, so #shell-marker (not the island's paragraph) is the shell-survival
  // evidence.
  await expect(page.locator('stream-lit-proof-page #shell-marker')).toHaveText(
    'shell flush precedes the late frame',
  );

  // The island's status paragraph is CLIENT-rendered at island activation, so
  // its visibility proves island hydration ran — never shell survival.
  await expect(page.locator('stream-lit-proof-page #lit-loader #lit-loader-status')).toBeVisible();

  // Exactly one instance, upgraded, server-born slot child intact.
  await expect(page.locator('stream-lit-pill')).toHaveCount(1);
  await expect(page.locator('stream-lit-pill #pill-slot-label')).toHaveText(SLOT_LABEL);
  await expect(page.locator('stream-lit-pill #pill-button')).toHaveText('pill: 0');

  await page.locator('stream-lit-pill #pill-button').click();
  await expect(page.locator('stream-lit-pill #pill-button')).toHaveText('pill: 1');
  expect(errors).toEqual([]);
});

test('streamed Part remains readable without JavaScript while the pill light child survives', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/stream-lit-proof?delay=100');
    // ADR-0159: arrival-order noscript tail carries the settled content; the
    // in-place Part stays empty.
    await expect.poll(() => page.locator('body').innerText()).toContain(MESSAGE);
    await expect(page.locator('stream-lit-proof-page #delayed')).toBeEmpty();
    // T0 baseline: server-born light children are readable before any
    // definition; with JS off the pill never upgrades (no shadow button).
    await expect(page.locator('stream-lit-pill #pill-slot-label')).toHaveText(SLOT_LABEL);
    await expect(page.locator('stream-lit-pill #pill-button')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
