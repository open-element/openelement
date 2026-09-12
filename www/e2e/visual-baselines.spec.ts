import { expect, test } from '@playwright/test';
import process from 'node:process';

// Pixel baselines are authored and reviewed on a stable workstation image.
// Linux CI still runs the complete semantic/functional E2E suite, but does not
// compare macOS font rasterization artifacts. Release and intentional visual
// review invoke this suite explicitly with OPEN_VISUAL_REGRESSION=1.
test.skip(
  !!process.env.CI && process.env.OPEN_VISUAL_REGRESSION !== '1',
  'Pixel baselines are an explicit visual-review gate, not a cross-OS push gate.',
);

const currentRoutes = [
  '/',
  '/docs',
  '/apilist',
  '/roadmap',
  '/changelog',
  '/contributing',
  '/404',
  '/blog',
  '/blog/0001-keep-hono-vite-dev-server',
  '/architecture/architecture',
  '/architecture/dsd',
  '/architecture/islands',
  '/architecture/islands-deep',
  '/architecture/design-system',
  '/architecture/comparison',
  '/architecture/package-compatibility',
  '/architecture/standards-registry',
  '/architecture/benchmark',
  '/guide/getting-started',
  '/guide/core-concepts',
  '/guide/architecture',
  '/guide/comparison',
  '/guide/routing-and-data',
  '/guide/mdx',
  '/guide/api',
  '/guide/configuration',
  '/guide/error-handling',
  '/guide/islands-and-ssr',
  '/guide/deployment',
  '/guide/testing',
];

const viewports = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

// These locale pairs were byte-identical when #993 was audited; both locale
// journeys still execute and intentionally compared against one reviewed
// image. That premise is dead: zh translations now ship per-route (a 2026-08
// audit of dist HTML found every formerly-shared route rendering distinct
// zh content — docs ~11%, comparison ~65%), so each locale owns its own
// reviewed baseline. A route whose en/zh renders ever converge again can
// rejoin a shared set deliberately, not by tolerance accident.
//
// /contributing left the shared set (#1307): the page now ships a real zh
// translation, so en/zh render distinctly and each locale owns a baseline.
const sharedLocaleBaselines = new Set<string>([]);

// #1317 closure: the route sweep above screenshots only the initial viewport
// (fullPage: false keeps the baseline stable across long pages and the
// cinematic scroll surfaces), which is exactly how the page-bottom footer
// regression shipped green. Dedicated chrome element snapshots close that
// gap: the docs sidebar (desktop reading layouts) owns a reviewed baseline
// per reading route — its section filtering makes each route's chrome
// distinct. The footer is route-invariant chrome, so it owns ONE baseline
// per locale x theme x viewport (shot on the home route); per-route footer
// snapshots are byte-identical and fail the exact-duplicate baseline gate.
const chromeRoutes = [
  { route: '/', sidebar: false, footer: true },
  { route: '/guide/getting-started', sidebar: true, footer: false },
  { route: '/architecture/dsd', sidebar: true, footer: false },
] as const;

for (const locale of ['en', 'zh'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    for (const viewport of viewports) {
      test(`${locale} ${theme} ${viewport.name} site chrome`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium owns the committed visual baseline.');
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript((value) => localStorage.setItem('open-theme', value), theme);
        for (const { route, sidebar, footer } of chromeRoutes) {
          const localized = locale === 'en'
            ? route
            : route === '/'
            ? `/${locale}/`
            : `/${locale}${route}`;
          await page.goto(localized, { waitUntil: 'networkidle' });
          await expect(page.locator('open-layout')).toBeVisible();
          const routeName = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
          const chromeKey = `${locale}-${theme}-${viewport.name}-${routeName}`;
          if (footer) {
            const footerLoc = page.locator('.app-footer');
            await footerLoc.scrollIntoViewIfNeeded();
            await expect(footerLoc).toHaveScreenshot(`${chromeKey}-footer.png`, {
              animations: 'disabled',
              caret: 'hide',
            });
          }
          // The sidebar is a desktop layout element; mobile collapses it into
          // the native disclosure covered semantically by site-chrome.spec.ts.
          // Its labels come from the untranslated generated nav, so the
          // sidebar pixels are locale-invariant: the baseline is shot on the
          // en locale only, keyed by theme x viewport x route.
          if (sidebar && viewport.name === 'desktop' && locale === 'en') {
            const sidebarNav = page.locator('.docs-sidebar');
            await expect(sidebarNav).toBeVisible();
            await expect(sidebarNav).toHaveScreenshot(
              `${theme}-${viewport.name}-${routeName}-sidebar.png`,
              { animations: 'disabled', caret: 'hide' },
            );
          }
        }
      });
    }
  }
}

for (const locale of ['en', 'zh'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    for (const viewport of viewports) {
      test(`${locale} ${theme} ${viewport.name} current surface`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium owns the committed visual baseline.');
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript((value) => localStorage.setItem('open-theme', value), theme);
        for (const route of currentRoutes) {
          const localized = locale === 'en'
            ? route
            : route === '/'
            ? `/${locale}/`
            : `/${locale}${route}`;
          await page.goto(localized, { waitUntil: 'networkidle' });
          await expect(page.locator('open-layout')).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          const routeName = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
          const baselineKey = `${theme}-${viewport.name}-${routeName}`;
          const baselineLocale = sharedLocaleBaselines.has(baselineKey) ? 'shared' : locale;
          await expect(page).toHaveScreenshot(
            `${baselineLocale}-${baselineKey}.png`,
            {
              fullPage: false,
              animations: 'disabled',
              caret: 'hide',
            },
          );
        }
      });
    }
  }
}
