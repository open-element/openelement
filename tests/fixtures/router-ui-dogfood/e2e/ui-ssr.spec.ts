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
    // The atomic facts, not an attribute-order literal: the native dialog
    // element carries the documented `overlay` part (its class list is the
    // alpha15 utility authoring, which may grow).
    expect(html).toMatch(/<dialog [^>]*part="overlay"/);
    expect(html).toContain('aria-label="Dogfood dialog"');
    // Trigger/footer slots stay in the light DOM (slot projection).
    expect(html).toContain('<button slot="trigger" id="dialog-trigger" type="button">');
    // The SSR-open dialog: host `open` attribute + bool sink opened the inner
    // dialog at render time (#1030 choreography input state).
    expect(html).toContain('<open-dialog id="ssr-open-dialog" open="" label="SSR open dialog">');
    expect(html).toMatch(/<dialog [^>]*part="overlay"[^>]*open[^>]*aria-label="SSR open dialog"/);
  });

  test('/dropdown emits open-dropdown DSD with a native popover content block', async ({
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
 * Tailwind entry delivery over compiled DSD (the C-seam integration proof).
 *
 * The fixture is preset-ON with `injectDsdLinks` explicitly false — the
 * exact-claim contract: the compiled bundle reaches the document through the
 * head link, every DSD template stays byte-exact Part Program children (the
 * compiled-hydration walk fails closed on an injected node), and shadow trees
 * take the theme through CSS custom property inheritance. Verified here end
 * to end: SSR bytes, then real hydration on the prerendered page.
 */
test.describe('tailwind entry delivery (entry-on + compiled DSD)', () => {
  /** The compiled document stylesheet: a content-hashed client asset. */
  const BUNDLE_HREF = /^\/client\/assets\/.+\.css$/;

  test('the document stylesheet is head-linked exactly once and no DSD template carries an injected link', async ({
    request,
  }) => {
    const response = await request.get('/dialog');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    // Document adoption: exactly one compiled-stylesheet link in the HEAD.
    // (Shadow templates carry their own marked links — see the loop below.)
    const head = html.slice(0, html.indexOf('</head>'));
    const headStylesheetHrefs = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(
      headStylesheetHrefs.filter((href) => BUNDLE_HREF.test(href)),
      `exactly one document stylesheet link, got ${headStylesheetHrefs.join(', ')}`,
    ).toHaveLength(1);
    expect(html).toMatch(/<head>[\s\S]*?<link rel="stylesheet" href="\/client\/assets\//);
    // Shadow adoption: every DSD template link must be the framework's MARKED
    // component-stylesheet declaration (alpha15 S lane) — a declarative
    // external resource the serializer wrote, never an unmarked node and never
    // a runtime-injected one. Unmarked links in templates stay structural
    // drift.
    for (const match of html.matchAll(/<template shadowrootmode=[^>]*>([\s\S]*?)<\/template>/g)) {
      for (const link of match[1].matchAll(/<link\b[^>]*>/g)) {
        expect(link[0], 'a DSD template link must be the marked stylesheet').toContain(
          'data-oe-static-styles',
        );
        expect(link[0], 'a DSD template link must be a stylesheet reference').toContain(
          'rel="stylesheet"',
        );
      }
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
    const inherited = await page.evaluate<{ card: string; border: string } | null>(`(() => {
      const host = ${deepFirstExpr('open-dialog')};
      const inner = host?.shadowRoot?.querySelector('dialog');
      if (!inner) return null;
      const style = getComputedStyle(inner);
      return {
        card: style.getPropertyValue('--color-card').trim(),
        border: style.getPropertyValue('--color-border').trim(),
      };
    })()`);
    expect(inherited, 'the dialog shadow tree resolved').not.toBeNull();
    expect(inherited!.card).not.toBe('');
    expect(inherited!.border).not.toBe('');
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
