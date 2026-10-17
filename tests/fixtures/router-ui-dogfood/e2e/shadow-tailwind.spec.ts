/**
 * Shadow-native Tailwind acceptance (alpha15 S lane) — the RED consumer's
 * browser proof.
 *
 * The probe component (app/components/shadow-tailwind-probe.tsx) is authored
 * with Tailwind utility classes ONLY: no authored sheet, no `static styles`,
 * no manual adoption, no scan configuration. This spec pins the product
 * contract in a real browser:
 *
 *   1. the shadow tree's computed styles actually reflect the utilities
 *      (`p-8` → 32px padding, `rounded-xl` → a real radius, `text-2xl` → 24px,
 *      `bg-primary` → the document theme role's resolved colour);
 *   2. the styling survives WITHOUT client JavaScript (the probe is a static
 *      component: the assertion runs against the SSR/DSD tree);
 *   3. the delivery is a real CSS resource — no generated CSS text inline in
 *      the page and no runtime-injected style nodes.
 *
 * Run: pnpm --dir tests/fixtures/router-ui-dogfood run e2e (after `run build`)
 */
import { expect, test } from '@playwright/test';

interface ProbeStyles {
  paddingTop: string;
  borderRadius: string;
  headingFontSize: string;
  backgroundColor: string;
  shadowLinks: number;
  shadowInlineStyles: number;
}

// The product contract (alpha15 S lane), GREEN acceptance: the shadow tree's
// computed styles come from the external component stylesheet the pipeline
// emits — compiler candidates → official Tailwind compile → content-addressed
// asset → the declared `<link rel="stylesheet">` in the DSD template (and, for
// client-created components, the same asset registered as one shared
// constructable sheet). Measured here WITHOUT client JavaScript: the probe is a
// static component, so this is the SSR/DSD delivery alone.
test('a TSX-only Tailwind shadow component is styled inside its shadow root', async ({ page }) => {
  await page.goto('/tailwind-probe');
  const probe = page.locator('oe-tailwind-probe').first();
  await expect(probe).toHaveCount(1);

  const styles = await probe.evaluate((host): ProbeStyles | null => {
    const root = (host as HTMLElement).shadowRoot;
    const article = root?.querySelector('article.probe-card');
    const heading = root?.querySelector('h2');
    if (!(article instanceof HTMLElement)) return null;
    const computed = getComputedStyle(article);
    return {
      paddingTop: computed.paddingTop,
      borderRadius: computed.borderTopLeftRadius,
      backgroundColor: computed.backgroundColor,
      headingFontSize: heading instanceof HTMLElement ? getComputedStyle(heading).fontSize : '',
      shadowLinks: root?.querySelectorAll('link[rel="stylesheet"]').length ?? -1,
      shadowInlineStyles: root?.querySelectorAll('style').length ?? -1,
    };
  });
  expect(styles, 'the probe renders a DSD shadow tree').not.toBeNull();

  // The utility contract, measured in the shadow tree. `p-8` = 2rem = 32px,
  // `rounded-xl` = 0.75rem = 12px, `text-2xl` = 1.5rem = 24px.
  expect(styles!.paddingTop, 'p-8 inside the shadow root').toEqual('32px');
  expect(styles!.borderRadius, 'rounded-xl inside the shadow root').toEqual('12px');
  expect(styles!.headingFontSize, 'text-2xl inside the shadow root').toEqual('24px');
  // `bg-primary` resolves through the document theme role (violet-700 in the
  // light theme) — a real colour, not the transparent default.
  expect(styles!.backgroundColor, 'bg-primary resolves a theme colour').not.toEqual(
    'rgba(0, 0, 0, 0)',
  );
});

test('a client-created shadow component adopts the one shared sheet (no per-instance fetch)', async ({
  page,
}) => {
  // Requirements 5.1/5.2: the same stylesheet resource shares ONE constructed
  // sheet identity, and instances never re-fetch or re-parse it. The probe
  // page carries no client JavaScript, so the island client is loaded from a
  // page that hydrates, then the component is created client-side — the
  // registered sheet must be adopted, with no link/style node created at
  // runtime.
  await page.goto('/dialog');
  await page.waitForFunction(() => Boolean(globalThis.customElements.get('open-dialog')));
  const result = await page.evaluate(() => {
    const adopt = (): { sheets: CSSStyleSheet[]; links: number; styles: number } => {
      const host = document.createElement('open-dialog') as HTMLElement;
      document.body.appendChild(host);
      const root = host.shadowRoot;
      return {
        sheets: [...(root?.adoptedStyleSheets ?? [])],
        links: root?.querySelectorAll('link[rel="stylesheet"]').length ?? -1,
        styles: root?.querySelectorAll('style').length ?? -1,
      };
    };
    const first = adopt();
    const second = adopt();
    const sharedOf = (sheets: CSSStyleSheet[]): CSSStyleSheet | undefined =>
      sheets.find(
        (sheet) =>
          typeof (sheet as unknown as Record<string, unknown>).__openElementStyleSheetUrl ===
          'string',
      );
    const firstShared = sharedOf(first.sheets);
    const secondShared = sharedOf(second.sheets);
    return {
      hasComponentSheet: firstShared !== undefined,
      sameIdentity: firstShared !== undefined && firstShared === secondShared,
      links: first.links + second.links,
      styles: first.styles + second.styles,
    };
  });
  expect(result.hasComponentSheet, 'the registered component sheet is adopted').toEqual(true);
  expect(result.sameIdentity, 'one constructed sheet identity across instances').toEqual(true);
  expect(result.links, 'no runtime link nodes').toEqual(0);
  expect(result.styles, 'no runtime style nodes').toEqual(0);
});

test('the probe ships no generated inline CSS and no runtime style injection', async ({ page }) => {
  await page.goto('/tailwind-probe');
  // The RAW server response: the component stylesheet arrives as ONE declared
  // external resource inside the DSD template — never as inlined `<style>`
  // text, never created by client code (the probe hydrates no JavaScript at
  // all, so any node inside its shadow tree is exactly what the server wrote).
  const response = await page.request.get('/tailwind-probe');
  const html = await response.text();
  const probeStart = html.indexOf('<oe-tailwind-probe');
  expect(probeStart, 'the probe host exists in the served document').toBeGreaterThan(-1);
  const probeMarkup = html.slice(probeStart, html.indexOf('</oe-tailwind-probe>', probeStart));
  expect(probeMarkup, 'the probe content is server-rendered DSD').toContain('<article');
  expect(probeMarkup, 'no inline <style> inside the DSD template').not.toContain('<style');
  const declared = [
    ...probeMarkup.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g),
  ];
  expect(declared, 'exactly one declared component stylesheet').toHaveLength(1);
  expect(declared[0]![1], 'the declared href is the emitted client asset').toMatch(
    /^\/client\/assets\/[0-9a-f]{12}\.css$/,
  );

  const styles = await page
    .locator('oe-tailwind-probe')
    .first()
    .evaluate((host): ProbeStyles | null => {
      const root = (host as HTMLElement).shadowRoot;
      if (!root) return null;
      return {
        paddingTop: '',
        borderRadius: '',
        backgroundColor: '',
        headingFontSize: '',
        shadowLinks: root.querySelectorAll('link[rel="stylesheet"]').length,
        shadowInlineStyles: root.querySelectorAll('style').length,
      };
    });
  expect(styles).not.toBeNull();
  // No runtime injection: the probe carries no client JavaScript, so the node
  // count is exactly what the server emitted — one declarative link, no style
  // node.
  expect(styles!.shadowInlineStyles, 'no runtime style nodes').toEqual(0);
  expect(styles!.shadowLinks, 'one declarative stylesheet link').toEqual(1);
});
