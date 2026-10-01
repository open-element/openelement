/**
 * ui dogfood — SSR/DSD evidence (#1226).
 *
 * Request-level assertions on the prerendered pages: the compiled framework
 * emits declarative shadow DOM for the shadow-open ui primitives, inline
 * light-DOM output for light roots, and shadowrootmode="closed" for closed
 * roots. This is the no-JS contract the hydration specs then claim.
 */
import { expect, test } from '@playwright/test';

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

  test('/tabs emits open-tabs DSD with tabs/panels live in the light DOM', async ({ request }) => {
    const response = await request.get('/tabs');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<open-tabs id="main-tabs"><template shadowrootmode="open">');
    expect(html).toContain('role="tablist"');
    // The slotted children are SSR'd as-is; the runtime decorates them in place.
    expect(html).toContain('<button slot="tab" type="button">Alpha</button>');
    expect(html).toContain('<div slot="panel">Gamma panel content</div>');
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
    expect(html).toContain('<open-badge id="open-boundary" tone="brand">');
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
