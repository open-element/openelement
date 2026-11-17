/**
 * ui dogfood — open-button's shipped surface, measured in a browser.
 *
 * open-button migrated to the generated lane (it was the last class-authored ui
 * component). These rows assert the contract on REAL server-rendered entities,
 * never on a clone: a client-created generated host deliberately carries no
 * adoptable sheet yet (the Alpha17 adoption slice; the generated lane delivers
 * declared sheets through the SSR DSD `<link>` channel), so a cloned subject
 * would measure an unstyled control and report the modelling gap as a component
 * defect.
 *
 * The rows cover what the migration could plausibly have broken:
 *
 * - the sheet reaches the shadow root and styles the control (border, layout);
 * - the two branches: a native `<button>` and a navigable `<a>`, one control
 *   element each, with the slot text reaching the visible one;
 * - `disabled` seats its visual + interaction contract on BOTH branches
 *   (`opacity`, `pointer-events`, and the link's dropped `href`);
 * - `open-click` fires on an enabled press and NOT on a disabled one (#757);
 * - `::part(control)` is the customization surface on both branches.
 */
import { expect, type Page, test } from '@playwright/test';
import { deepFirstExpr } from './helpers.ts';

/** The control's computed surface, read from inside the host's shadow root. */
const controlStyleExpr = (host: string, properties: readonly string[]): string => `(() => {
  const control = ${deepFirstExpr(host)}?.shadowRoot?.querySelector('[part=control]');
  if (!control) return null;
  const style = getComputedStyle(control);
  return Object.fromEntries(${JSON.stringify(properties)}.map((property) => [
    property,
    style[property],
  ]));
})()`;

const SURFACE = ['borderTopStyle', 'borderTopWidth', 'opacity', 'pointerEvents'] as const;

async function controlSurface(page: Page, host: string): Promise<Record<string, string>> {
  const surface = await page.evaluate(controlStyleExpr(host, SURFACE));
  expect(surface, `${host} must have a reachable control`).not.toEqual(null);
  return surface as Record<string, string>;
}

test.describe('open-button shipped surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/form');
    await page.waitForFunction(
      `${deepFirstExpr('#button-enabled')}?.shadowRoot?.querySelector('[part=control]') !== null`,
    );
  });

  test('the declared sheet reaches the shadow root and styles the control', async ({ page }) => {
    const shell = await page.evaluate<{ links: number; styles: number }>(`(() => {
      const root = ${deepFirstExpr('#button-enabled')}?.shadowRoot;
      return {
        links: root?.querySelectorAll('link[rel="stylesheet"]').length ?? -1,
        styles: root?.querySelectorAll('style').length ?? -1,
      };
    })()`);
    // The generated lane delivers the component sheet as a real external
    // resource inside the DSD template — never an inline style block.
    expect(shell.links, 'the component sheet is link-delivered').toBeGreaterThan(0);
    expect(shell.styles, 'no inline style node').toBe(0);

    // The sheet's own rules (border, and the disabled treatments below) are
    // what this row measures. `inline-flex` comes from the authored Tailwind
    // utility and lands in the DOCUMENT/component stylesheet, not in the
    // shadow-scoped sheet this component declares — a shadow root cannot see
    // the document sheet, so `display` here is the platform default and is
    // deliberately not asserted. The layout contract is pinned by the www
    // matrix against the shipped page.
    const surface = await controlSurface(page, '#button-enabled');
    expect(surface.borderTopStyle, 'the sheet border, not the UA default').toBe('solid');
    expect(parseFloat(surface.borderTopWidth), 'the sheet 1px border').toBeCloseTo(1, 1);
  });

  test('the two branches render one control each, and the slot reaches the visible one', async ({
    page,
  }) => {
    const branches = await page.evaluate<{
      nativeTag: string | null;
      nativeText: string;
      linkTag: string | null;
      linkText: string;
      linkHref: string | null;
      controlsPerHost: number[];
    }>(`(() => {
      const button = ${deepFirstExpr('#button-enabled')};
      const link = ${deepFirstExpr('#link-disabled')};
      const controls = (host) => host?.shadowRoot?.querySelectorAll('[part=control]').length ?? -1;
      const control = (host) => host?.shadowRoot?.querySelector('[part=control]') ?? null;
      // The authored text is LIGHT-DOM children, so it reaches the visible
      // control through the slot's assignment — never through the shadow tree's
      // own textContent.
      const slotted = (host) => {
        const slot = host?.shadowRoot?.querySelector('slot');
        if (!slot) return '';
        const assigned = slot.assignedNodes({ flatten: true });
        return assigned.map((node) => node.textContent ?? '').join('');
      };
      return {
        nativeTag: control(button)?.tagName ?? null,
        nativeText: slotted(button),
        linkTag: control(link)?.tagName ?? null,
        linkText: slotted(link),
        linkHref: control(link)?.getAttribute('href') ?? null,
        controlsPerHost: [controls(button), controls(link)],
      };
    })()`);
    // Exactly ONE control per host: the single-slot branch removed the
    // same-name slot competition the old two-sibling shape had (PR #1611).
    expect(branches.controlsPerHost, 'one control element per host').toEqual([1, 1]);
    expect(branches.nativeTag).toBe('BUTTON');
    expect(branches.linkTag).toBe('A');
    // The authored text reaches the VISIBLE control in both branches.
    expect(branches.nativeText).toBe('Enabled');
    expect(branches.linkText).toBe('Disabled link');
  });

  test('disabled seats its visual and interaction contract on the native branch', async ({
    page,
  }) => {
    const disabled = await controlSurface(page, '#button-disabled');
    const enabled = await controlSurface(page, '#button-enabled');
    expect(disabled.opacity, 'the disabled control dims').toBe('0.5');
    expect(disabled.pointerEvents, 'the disabled control is inert to the pointer').toBe('none');
    expect(enabled.opacity, 'the enabled control does not dim').toBe('1');
    expect(enabled.pointerEvents).not.toBe('none');

    // The declared `disabled` row reaches the inner control as a real attribute
    // (the compiled sink), which is what makes the platform treat it as inert.
    const inner = await page.evaluate<{ attribute: boolean; property: boolean }>(`(() => {
      const control = ${deepFirstExpr('#button-disabled')}?.shadowRoot?.querySelector('[part=control]');
      return { attribute: control?.hasAttribute('disabled') ?? false, property: control?.disabled ?? false };
    })()`);
    expect(inner).toEqual({ attribute: true, property: true });
  });

  test('disabled drops the link target and marks it aria-disabled (#757/#1061)', async ({
    page,
  }) => {
    const link = await page.evaluate<{
      href: string | null;
      aria: string | null;
      surface: { opacity: string; pointerEvents: string };
    }>(`(() => {
      const host = ${deepFirstExpr('#link-disabled')};
      const control = host?.shadowRoot?.querySelector('[part=control]');
      const style = control ? getComputedStyle(control) : null;
      return {
        href: control?.getAttribute('href') ?? null,
        aria: control?.getAttribute('aria-disabled') ?? null,
        surface: {
          opacity: style?.opacity ?? '',
          pointerEvents: style?.pointerEvents ?? '',
        },
      };
    })()`);
    // A disabled anchor keeps NO navigation target — the compiled sink drops it
    // rather than relying on the click guard alone.
    expect(link.href, 'a disabled link must not carry href').toBe(null);
    expect(link.aria, 'aria-disabled names the state to AT').toBe('true');
    expect(link.surface.opacity).toBe('0.5');
    expect(link.surface.pointerEvents).toBe('none');
  });

  test('open-click fires on an enabled press and never on a disabled one (#757)', async ({
    page,
  }) => {
    await page.evaluate(`(() => {
      const w = window;
      w.__openClicks = [];
      document.addEventListener('open-click', (event) => {
        const host = event.composedPath()[0];
        w.__openClicks.push(host?.id ?? 'unknown');
      });
    })()`);

    // Enabled: a real press at the control's own coordinates.
    const enabledBox = await page.evaluate<{ x: number; y: number } | null>(`(() => {
      const control = ${deepFirstExpr('#button-enabled')}?.shadowRoot?.querySelector('[part=control]');
      if (!control) return null;
      control.scrollIntoView({ block: 'center' });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    expect(enabledBox).not.toEqual(null);
    await page.mouse.click(enabledBox!.x, enabledBox!.y);
    await expect.poll(() => page.evaluate('(window).__openClicks.length')).toBeGreaterThan(0);
    const afterEnabled = await page.evaluate<string[]>('(window).__openClicks');

    // Disabled: the control is `pointer-events: none`, so the press lands on
    // the host, and the guard refuses to announce anything.
    const disabledBox = await page.evaluate<{ x: number; y: number } | null>(`(() => {
      const control = ${deepFirstExpr('#button-disabled')}?.shadowRoot?.querySelector('[part=control]');
      if (!control) return null;
      control.scrollIntoView({ block: 'center' });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    expect(disabledBox).not.toEqual(null);
    await page.mouse.click(disabledBox!.x, disabledBox!.y);
    await page.waitForTimeout(120);
    const afterDisabled = await page.evaluate<string[]>('(window).__openClicks');
    expect(afterDisabled, 'a disabled press announces nothing').toEqual(afterEnabled);
  });

  test('::part(control) is the customization surface on both branches', async ({ page }) => {
    await page.evaluate(`(() => {
      const scope = ${deepFirstExpr('#button-enabled')}.getRootNode();
      const style = document.createElement('style');
      style.textContent =
        'open-button::part(control) { border-top-color: rgb(4, 5, 6); }';
      scope.appendChild(style);
    })()`);
    for (const host of ['#button-enabled', '#link-disabled']) {
      await expect
        .poll(() =>
          page.evaluate(`(() => {
            const control = ${deepFirstExpr(host)}?.shadowRoot?.querySelector('[part=control]');
            return control ? getComputedStyle(control).borderTopColor : null;
          })()`),
        )
        .toBe('rgb(4, 5, 6)');
    }
  });
});
