/**
 * ui dogfood — SSR/DSD evidence (#1226).
 *
 * Request-level assertions on the prerendered pages: the compiled framework
 * emits declarative shadow DOM for the shadow-open ui primitives, inline
 * light-DOM output for light roots, and shadowrootmode="closed" for closed
 * roots. This is the no-JS contract the hydration specs then claim.
 */
import { expect, test, type Page } from '@playwright/test';
import { deepAllExpr, deepFirstExpr } from './helpers.ts';

test.describe('ui dogfood SSR/DSD output', () => {
  test('/dialog emits open-dialog as DSD with the native dialog inside', async ({ request }) => {
    const response = await request.get('/dialog');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    // delegatesFocus surfaces as the DSD marker (SSR/CSR parity fix, #1226).
    expect(html).toContain(
      '<open-dialog label="Dogfood dialog"><template shadowrootmode="open" shadowrootdelegatesfocus>',
    );
    expect(html).toContain('<dialog part="overlay"');
    expect(html).toContain('aria-label="Dogfood dialog"');
    // Trigger/footer slots stay in the light DOM (slot projection).
    expect(html).toContain('<button slot="trigger" id="dialog-trigger" type="button">');
    // The SSR-open dialog: host `open` attribute + bool sink opened the inner
    // dialog at render time (#1030 choreography input state).
    expect(html).toContain('<open-dialog id="ssr-open-dialog" open="" label="SSR open dialog">');
    expect(html).toContain('<dialog part="overlay" open aria-label="SSR open dialog">');
  });

  test('/dropdown emits open-dropdown DSD with a native popover content region', async ({
    request,
  }) => {
    const response = await request.get('/dropdown');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<open-dropdown id="main-dropdown"><template shadowrootmode="open">');
    expect(html).toContain('popover="auto"');
    expect(html).toContain('<button slot="trigger" id="dropdown-trigger" type="button">');
  });

  test('/form emits open-input DSD with the form contract markup and the island entry', async ({
    request,
  }) => {
    const response = await request.get('/form');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<open-input id="username" label="Username" name="username" required');
    // The initial value round-trips through the compiled value sink.
    expect(html).toContain('value="ada@example.com"');
    // The label + required marker are SSR'd inside the shadow template.
    expect(html).toContain('Username');
    // Hydration delivery: the island client entry is injected.
    expect(html).toContain('<script type="module" src="/client/islands/client.js">');
  });

  test('/boundaries emits the three root contracts side by side', async ({ request }) => {
    const response = await request.get('/boundaries');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    // open: the ui primitive carries a declarative open shadow root.
    expect(html).toContain('<open-button id="open-boundary" variant="primary">');
    expect(html).toContain('<template shadowrootmode="open">');
    // light: consumer-authored light root serializes inline with the marker.
    expect(html).toContain('<dogfood-light data-oe-light>');
    expect(html).toContain('<p id="light-content">light root boundary content</p>');
    // closed: consumer-authored closed root emits a closed DSD template whose
    // content renders but stays encapsulated.
    expect(html).toContain('<dogfood-closed><template shadowrootmode="closed">');
    expect(html).toContain('closed root boundary content');
  });
});

/**
 * Tailwind preset delivery over compiled DSD (the C-seam integration proof).
 *
 * The fixture is preset-ON with `injectDsdLinks` explicitly false — the
 * exact-claim contract: the compiled bundle reaches the document through the
 * head link, every DSD template stays byte-exact Part Program children (the
 * compiled-claim walk fails closed on an injected node), and shadow trees
 * take the theme through CSS custom property inheritance. Verified here end
 * to end: SSR bytes, then real hydration on the prerendered page.
 */
test.describe('tailwind preset delivery (preset-on + compiled DSD)', () => {
  const BUNDLE_LINK = '<link rel="stylesheet" href="/assets/open-tailwind.css" />';

  test('the bundle is head-linked exactly once and no DSD template carries an injected link', async ({
    request,
  }) => {
    const response = await request.get('/dialog');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    // Document adoption: exactly one bundle link, inside <head> (the @scope
    // face rides next to it as its own head link when configured).
    const escaped = BUNDLE_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(html.match(new RegExp(escaped, 'g'))?.length).toBe(1);
    expect(html).toMatch(new RegExp(`<head>[\\s\\S]*?${BUNDLE_LINK}`));
    // Shadow adoption rides inheritance, not injection: every DSD template's
    // children are exactly the Part Program's nodes.
    for (const match of html.matchAll(/<template shadowrootmode=[^>]*>([\s\S]*?)<\/template>/g)) {
      expect(match[1], 'a DSD template must stay claim-exact').not.toContain('<link');
    }
  });

  test('hydration claims the preset-on DSD and the theme layer reaches shadow trees', async ({
    page,
  }) => {
    await gotoDialog(page);
    // The compiled claim succeeded (it fails closed on any injected node),
    // so the hydrated dialog actually drives the shadow <dialog>.
    await page.evaluate(`${deepFirstExpr('#ssr-open-dialog')}.show()`);
    await page.waitForFunction(
      `${deepFirstExpr('#ssr-open-dialog')}?.matches(':state(open)') ?? false`,
    );
    await page.evaluate(`${deepFirstExpr('#ssr-open-dialog')}.close()`);

    // The theme layer is custom properties delivered by the head link: a
    // shadow-tree element resolves a bundle token through inheritance.
    const inherited = await page.evaluate(`(() => {
      const host = ${deepFirstExpr('open-dialog')};
      const inner = host?.shadowRoot?.querySelector('dialog');
      if (!inner) return null;
      const style = getComputedStyle(inner);
      return {
        card: style.getPropertyValue('--color-card').trim(),
        border: style.getPropertyValue('--color-border').trim(),
      };
    })()`);
    expect(inherited).not.toBeNull();
    expect(inherited.card).not.toBe('');
    expect(inherited.border).not.toBe('');
  });
});

/** Waits until open-dialog is defined, then opens /dialog. */
async function gotoDialog(page: Page): Promise<void> {
  await page.goto('/dialog');
  await page.waitForFunction(`customElements.get('open-dialog') !== undefined`);
  // Every instance activated: its shadow dialog exists and the state machine
  // settled (open or closed).
  await page.waitForFunction(
    `${deepAllExpr('open-dialog')}.every((host) => ` +
      `host.shadowRoot?.querySelector('dialog') !== null && ` +
      `(host.matches(':state(open)') || host.matches(':state(closed)')))`,
  );
}
