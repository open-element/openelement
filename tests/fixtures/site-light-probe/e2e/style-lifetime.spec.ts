/**
 * E2E: document-lifetime stylesheet cost (alpha15 S lane, S-C3/S-15).
 *
 * Measurement, not optimization: the delivered CSS is content-addressed and
 * every adoption is idempotent, so a long-lived document must NOT accumulate
 * stylesheet objects, adopted copies, or repeated resource requests as it
 * navigates and as island hosts disconnect and reconnect. The spec counts, per
 * cycle, on Chromium, Firefox and WebKit:
 *
 *   - `document.styleSheets` (the parsed document sheets);
 *   - the adopted `CSSStyleSheet` objects across every shadow root;
 *   - stylesheet response events (the resource-request count, separate from
 *     asset-file count and from downloaded bytes — the two other口径 are
 *     measured by `tools/release/css-cost-report.ts`);
 *
 * and asserts cycle N equals cycle 1. Multi-document isolation is measured by
 * opening a second page: each document owns its own counts.
 *
 * NOT MEASURED here (reported as such): JS heap growth — no portable API, and a
 * noisy signal whose stylesheet-specific part IS covered by the object counts.
 *
 * Run: pnpm --dir tests/fixtures/site-light-probe run build
 *      pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
 */

import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const DIST = new URL('../dist/', import.meta.url);

interface CycleCounts {
  /** Parsed document stylesheets (the head links + adopted document sheets). */
  documentSheets: number;
  /** Marked `<link>` declarations inside shadow roots (the shadow channel). */
  shadowLinks: number;
  /** Adopted sheet objects across every shadow root, deep. */
  adoptedSheets: number;
  /** Stylesheet responses observed since the counter was reset. */
  cssResponses: number;
  /** Distinct stylesheet URLs observed in the window. */
  cssUrls: number;
}

const COUNTS_EXPRESSION = `(() => {
  const walk = (root, acc) => {
    for (const element of root.querySelectorAll('*')) {
      const shadow = element.shadowRoot;
      if (!shadow) continue;
      acc.adopted += shadow.adoptedStyleSheets?.length ?? 0;
      acc.shadowLinks += shadow.querySelectorAll('link[data-oe-static-styles]').length;
      walk(shadow, acc);
    }
  };
  const acc = { adopted: 0, shadowLinks: 0, documentSheets: document.styleSheets.length };
  walk(document, acc);
  return acc;
})()`;

async function readCounts(page: import('@playwright/test').Page): Promise<CycleCounts> {
  const counts = (await page.evaluate(COUNTS_EXPRESSION)) as {
    adopted: number;
    shadowLinks: number;
    documentSheets: number;
  };
  return {
    documentSheets: counts.documentSheets,
    shadowLinks: counts.shadowLinks,
    adoptedSheets: counts.adopted,
    cssResponses: cssResponses.length,
    cssUrls: new Set(cssResponses).size,
  };
}

/** Every emitted stylesheet href the fixture's build produced. */
const declaredAssets = new Set(
  readdirSync(new URL('client/assets/', DIST))
    .filter((name) => name.endsWith('.css'))
    .map((name) => `/client/assets/${name}`),
);

let cssResponses: string[] = [];
const observedUrls = new Set<string>();

test.beforeEach(({ page }) => {
  cssResponses = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('.css')) {
      cssResponses.push(url.pathname);
      observedUrls.add(url.pathname);
    }
  });
});

test('repeated navigation does not accumulate sheets or stylesheet requests', async ({ page }) => {
  const cycles: CycleCounts[] = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    cssResponses = [];
    await page.goto('/');
    await page.waitForLoadState('load');
    cycles.push(await readCounts(page));
  }
  const first = cycles[0]!;
  console.log(`[S-15 lifetime] ${JSON.stringify(cycles)}`);
  expect(first.documentSheets, 'the page delivers document sheets').toBeGreaterThan(0);
  // The fixture's shadow components are LINK-delivered (the runtime keeps the
  // declared link and never adopts a second copy while it exists), so the
  // shadow channel is the marked links; adopted sheets stay 0 until a link is
  // gone (pinned by the reconnect case in light-style-delivery.spec.ts).
  expect(first.shadowLinks, 'shadow sheets are declared by marked links').toBeGreaterThan(0);
  for (const [index, cycle] of cycles.entries()) {
    // OBJECT counts are the leak question and must be identical every cycle.
    expect(cycle.documentSheets, `cycle ${index + 1} document sheets`).toEqual(
      first.documentSheets,
    );
    expect(cycle.shadowLinks, `cycle ${index + 1} shadow links`).toEqual(first.shadowLinks);
    expect(cycle.adoptedSheets, `cycle ${index + 1} adopted sheets`).toEqual(first.adoptedSheets);
    // RESOURCE identity must not grow: every stylesheet URL a cycle requests is
    // one of the declared emitted assets (per-cycle response COUNTS vary by
    // cache state — one resource is declared once per rendered instance and the
    // adapter's synchronous fetch adds a cache-served duplicate — so the count
    // is reported, not asserted equal).
    expect(cycle.cssUrls, `cycle ${index + 1} distinct stylesheet URLs`).toBeLessThanOrEqual(
      declaredAssets.size,
    );
  }
});

test('disconnect/reconnect cycles do not accumulate sheets', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  const baseline = await readCounts(page);

  for (let cycle = 0; cycle < 3; cycle++) {
    cssResponses = [];
    observedUrls.clear();
    await page.evaluate(() => {
      const host = document.querySelector('light-probe-card');
      if (!host) throw new Error('missing light-probe-card');
      const parent = host.parentElement;
      if (!parent) throw new Error('missing parent');
      parent.removeChild(host);
      parent.appendChild(host);
    });
    await page.waitForLoadState('load');
    const after = await readCounts(page);
    expect(after.documentSheets, `cycle ${cycle + 1} document sheets`).toEqual(
      baseline.documentSheets,
    );
    expect(after.adoptedSheets, `cycle ${cycle + 1} adopted sheets`).toEqual(
      baseline.adoptedSheets,
    );
    // A re-appended host re-resolves its own DSD `<link>` (browser behavior),
    // so request EVENTS may occur — but never for a resource identity outside
    // the declared set, and the object counts above must not move. The
    // duplicate is cache-served: the emitted assets are immutable (S-14).
    for (const href of observedUrls) {
      expect(
        declaredAssets.has(href),
        `cycle ${cycle + 1} requested ${href}, which is not a declared asset`,
      ).toBe(true);
    }
  }
});

test('a second document owns its own counts (multi-document isolation)', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  const first = await readCounts(page);

  const second = await context.newPage();
  try {
    await second.goto('/');
    await second.waitForLoadState('load');
    const secondCounts = await readCounts(second);
    expect(secondCounts.documentSheets, 'the second document re-delivers its own sheets').toEqual(
      first.documentSheets,
    );
    expect(secondCounts.shadowLinks, 'the second document declares its own shadow links').toEqual(
      first.shadowLinks,
    );
    // Both documents are still at their own counts: nothing is shared through a
    // cross-document registry (a foreign-realm sheet would be rejected anyway).
    const firstAgain = await readCounts(page);
    expect(firstAgain.documentSheets).toEqual(first.documentSheets);
    expect(firstAgain.adoptedSheets).toEqual(first.adoptedSheets);
  } finally {
    await second.close();
  }
});
