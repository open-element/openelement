/**
 * M11-2 fixture E2E — a generated element page as a REAL consumer.
 *
 * The route modules (`app/routes/generated*.tsx`) import a generated function
 * island and pass it to `definePage` exactly like a compiled page class. The
 * generated island's class has no `__partProgram`; its server artifact is the
 * compiler-emitted `<Name>__ssrHost`, paired with the class by the generated
 * entry's registry guard and rendered through the element runtime's ONE
 * generated-host pair channel (root page render, same channel as nested).
 *
 * Covered consumers:
 * - SSG: `/generated` is prerendered (host tag + DSD inside the template, the
 *   loader-projected declared props both in content and as host attributes —
 *   the client claim's seed wire);
 * - request-time: `/generated-live` is served by dist/server;
 * - error: `/generated-boom` still renders the page's `error` projector at 500;
 * - not-found: a loader `notFound()` answers the 404 status page;
 * - action: a native POST re-renders the generated page with action data (422);
 * - browser claim: the SSR shadow tree is claimed without node replacement and
 *   the declared primitive props survive SSR→claim (attribute seeding), with a
 *   zero claim-period mutation count (no fake "extra write" acceptance).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

test.describe('generated element page consumers (M11-2)', () => {
  test('SSG: prerendered host + DSD + loader-projected props as attributes', async ({
    request,
  }) => {
    expect(existsSync(`${distDir}/generated/index.html`)).toBe(true);
    const response = await request.get('/generated');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<generated-page-card');
    expect(html).toContain('<template shadowrootmode="open">');
    // Authored content comes from the loader + descriptor props projector.
    expect(html).toContain('Generated page — SSG');
    expect(html).toContain('prerendered note');
    // Declared attribute-backed props travel on the host tag too: that is the
    // ONE server→client seed wire the client claim re-reads. Explicit rename,
    // number coercion and boolean presence are canonical (descriptor rows).
    expect(html).toContain('title="Generated page — SSG"');
    expect(html).toContain('data-note="prerendered note"');
    expect(html).toContain('count="2"');
    expect(html).toContain('enabled=""');
    // The declared page stylesheet is delivered INSIDE the page host template.
    expect(html).toContain('data-oe-static-styles');
  });

  test('request-time: the dynamic generated page is served by dist/server', async ({ request }) => {
    expect(existsSync(`${distDir}/generated-live/index.html`)).toBe(false);
    const response = await request.get('/generated-live');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<generated-page-live');
    expect(html).toContain('Generated page — request time');
    expect(html).toContain('served from dist/server');
  });

  test('error consumer: the error projector re-renders the generated page at 500', async ({
    request,
  }) => {
    const response = await request.get('/generated-boom');
    expect(response.status()).toBe(500);
    const html = await response.text();
    expect(html).toContain('<generated-page-boom');
    expect(html).toContain('Generated page — error boundary');
    expect(html).toContain('error projector rendered');
  });

  test('not-found consumer: a generated page loader 404 answers the status page', async ({
    request,
  }) => {
    const response = await request.get('/generated-missing');
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).toContain('404 Not Found');
    expect(html).not.toContain('<generated-page-card');
  });

  test('action consumer: native POST re-renders the generated page (422)', async ({ request }) => {
    const empty = await request.post('/generated-live', { form: { value: '' } });
    expect(empty.status()).toBe(422);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('<generated-page-live');
    expect(emptyHtml).toContain('generated action: value required');

    const filled = await request.post('/generated-live', { form: { value: 'ok' } });
    expect(filled.status()).toBe(422);
    expect(await filled.text()).toContain('generated action: ok');
  });

  test('page-root stylesheet applies without JS (declarative DSD link)', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/generated', { waitUntil: 'load' });
      const evidence = await page.evaluate(() => {
        const host = document.querySelector('generated-page-card');
        const shadow = host?.shadowRoot ?? null;
        const title = shadow?.querySelector('.generated-page-title') ?? null;
        return {
          hostFound: host !== null,
          linkCount: shadow ? shadow.querySelectorAll('link[data-oe-static-styles]').length : 0,
          color: title === null ? null : getComputedStyle(title).color,
        };
      });
      expect(evidence.hostFound).toBe(true);
      expect(evidence.linkCount).toBe(1);
      // No JavaScript ran: the color is the DSD <link>'s declarative delivery.
      expect(evidence.color).toBe('rgb(12, 34, 56)');
    } finally {
      await context.close();
    }
  });

  test('browser claim: SSR→claim props parity, no re-mount, zero claim mutations', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const TAG = 'generated-page-live';
      const capture: {
        seen: boolean;
        innerHTML: string;
        textContent: string;
        hostAttributes: Record<string, string | null> | null;
        mutations: number;
      } = {
        seen: false,
        innerHTML: '',
        textContent: '',
        hostAttributes: null,
        mutations: 0,
      };
      (globalThis as unknown as { __oePageCapture: typeof capture }).__oePageCapture = capture;
      const originalDefine = customElements.define.bind(customElements);
      customElements.define = function (name, ctor, options) {
        if (name === TAG && !capture.seen) {
          const host = document.querySelector(TAG) as HTMLElement | null;
          const shadow = host?.shadowRoot ?? null;
          if (host !== null && shadow !== null) {
            capture.seen = true;
            capture.innerHTML = shadow.innerHTML;
            capture.textContent = shadow.textContent ?? '';
            capture.hostAttributes = {
              title: host.getAttribute('title'),
              dataNote: host.getAttribute('data-note'),
              count: host.getAttribute('count'),
              enabled: host.getAttribute('enabled'),
            };
            const observer = new MutationObserver((records) => {
              capture.mutations += records.length;
            });
            observer.observe(shadow, {
              attributes: true,
              characterData: true,
              childList: true,
              subtree: true,
            });
          }
        }
        return originalDefine(name, ctor, options as ElementDefinitionOptions | undefined);
      };
    });

    // The dynamic route is served with a real per-request CSP nonce, so the
    // generated island client entry executes and the host upgrades.
    await page.goto('/generated-live', { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        customElements.get('generated-page-live') !== undefined &&
        document.querySelector('generated-page-live')?.shadowRoot !== null,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      const capture = (
        globalThis as unknown as {
          __oePageCapture: {
            seen: boolean;
            innerHTML: string;
            textContent: string;
            hostAttributes: Record<string, string | null> | null;
            mutations: number;
          };
        }
      ).__oePageCapture;
      const host = document.querySelector('generated-page-live') as
        | (HTMLElement & { title?: unknown; note?: unknown })
        | null;
      const shadow = host?.shadowRoot ?? null;
      return {
        capture,
        upgraded: host !== null && host.constructor !== HTMLElement,
        hostAttributesAfter: host
          ? {
              title: host.getAttribute('title'),
              dataNote: host.getAttribute('data-note'),
              count: host.getAttribute('count'),
              enabled: host.getAttribute('enabled'),
            }
          : null,
        propTitle: host?.title,
        propDataNote: (host as unknown as { dataNote?: unknown })?.dataNote,
        propCount: (host as unknown as { count?: unknown })?.count,
        propEnabled: (host as unknown as { enabled?: unknown })?.enabled,
        linkCount: shadow ? shadow.querySelectorAll('link[data-oe-static-styles]').length : 0,
        styleColor:
          shadow && shadow.querySelector('.generated-page-live-title')
            ? getComputedStyle(shadow.querySelector('.generated-page-live-title')!).color
            : null,
        htmlAfter: shadow?.innerHTML ?? '',
        textAfter: shadow?.textContent ?? '',
      };
    });

    expect(result.capture.seen).toBe(true);
    expect(result.upgraded).toBe(true);
    // Declared attribute-backed props are the client seed: both the host
    // attribute wire and the claim-time property value must carry the SSR value.
    expect(result.capture.hostAttributes).toEqual({
      title: 'Generated page — request time',
      dataNote: 'served from dist/server',
      count: '3',
      enabled: '',
    });
    expect(result.propTitle).toBe('Generated page — request time');
    expect(result.propDataNote).toBe('served from dist/server');
    expect(result.propCount).toBe(3);
    expect(result.propEnabled).toBe(true);
    // The page-root stylesheet stayed declarative and applied through claim.
    expect(result.linkCount).toBe(1);
    expect(result.styleColor).toBe('rgb(12, 34, 56)');
    // The claim adopts the server nodes in place and rewrites nothing: a
    // node/mutation difference here is the props-seed gap, not a pass.
    expect(result.htmlAfter).toBe(result.capture.innerHTML);
    expect(result.textAfter).toBe(result.capture.textContent);
    expect(result.capture.mutations).toBe(0);
  });
});
