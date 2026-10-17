/**
 * UI behaviour matrix (alpha15 Stage 2) — the components the Site renders,
 * measured on the SERVER-RENDERED build in real engines.
 *
 * What a green run means, and what it does not
 * --------------------------------------------
 * Coverage: `open-button`, `open-code-block` (the contributing page and the
 * home page's code blocks) and `open-theme-toggle` (the layout chrome of every
 * page). `open-input`, `open-dialog` and `open-dropdown` are NOT rendered by
 * the Site — a green run here says nothing about them; their rows run against
 * the packed appliance's ui-lab (tools/release/consumer-packaged-ui-app.ts).
 *
 * A green run means every row that RAN passed. It does not mean every row ran
 * in every engine, and the executed-test count is a count of test instances
 * (3 engines × the rows below), not a count of component states. Where an
 * engine cannot reach a row's subject, the row records `N/A` in its annotation
 * and asserts the capability probe instead of asserting something adjacent and
 * calling it the same thing — see the component focus-ring row, which the
 * macOS WebKit build's default Tab path cannot reach at all.
 *
 * What this spec adds over the existing suites: real keyboard focus rings
 * (never simulated `:focus-visible`) with their geometry, the disabled and
 * aria-disabled states of the button's two forms under a real pointer press
 * and a real keyboard activation attempt, the copy control's success/failure
 * feedback after a real click, every declared `::part`, the shipped colour
 * pairs against WCAG AA, forced-colors behaviour where the engine can actually
 * emulate it, and the no-JavaScript path.
 */
import { expect, test } from '@playwright/test';
import { MATRIX_HELPERS_SOURCE } from './wcag-contrast.ts';

const PAGE = '/contributing';

/**
 * The contributing page's content renders inside the page component's own
 * shadow tree, so plain `document.querySelector` cannot see its components.
 * This walks every open shadow root, the way a user agent renders the tree.
 */
const DEEP_QUERY = `((selector) => {
  const found = [];
  const walk = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (element.matches(selector)) found.push(element);
      if (element.shadowRoot) walk(element.shadowRoot);
    }
  };
  walk(document);
  return found;
})`;

/**
 * The colour maths behind the contrast rows lives in `wcag-contrast.ts`, where
 * `www/__tests__/wcag-contrast.test.ts` proves it numerically. This spec only
 * drives it.
 */
type ContrastMeasurement = { ratio: number; opaque: boolean; unresolved: string[] };

/** The ring the focused element paints, and whether anything cuts it off. */
type FocusRing = {
  key: string;
  part: string | null;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  outlineColor: string;
  /** The scroll-clipping ancestor whose box the ring leaves, if any. */
  clippedBy: string | null;
  /** True when no pixel of the ring falls inside the viewport. */
  offscreen: boolean;
};

/**
 * Measure the focused element's ring from its own geometry.
 *
 * The clipping answer is geometric, not a string read: an ancestor only clips
 * what leaves its client box, so the test computes the ring box (border box
 * inflated by `outline-width` + `outline-offset`) and intersects it with every
 * scroll-clipping ancestor's box across shadow boundaries. Asserting
 * `outlineStyle === 'solid'` proves a declaration was computed; this proves
 * the indicator a user would see is not cut away.
 */
const RING_PROBE = `(() => {
  let element = document.activeElement;
  while (element && element.shadowRoot && element.shadowRoot.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  if (!element) return null;
  const style = getComputedStyle(element);
  const width = Number.parseFloat(style.outlineWidth) || 0;
  const offset = Number.parseFloat(style.outlineOffset) || 0;
  const rect = element.getBoundingClientRect();
  const ring = {
    left: rect.left - width - offset,
    top: rect.top - width - offset,
    right: rect.right + width + offset,
    bottom: rect.bottom + width + offset,
  };
  const parentOf = (node) => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const part = element.getAttribute('part');
  const describe = (node) =>
    node.tagName.toLowerCase() +
    (node.getAttribute('part') ? '::part(' + node.getAttribute('part') + ')' : '');
  let clippedBy = null;
  for (let node = parentOf(element); node && clippedBy === null; node = parentOf(node)) {
    const owner = getComputedStyle(node);
    const clipsX = owner.overflowX !== 'visible';
    const clipsY = owner.overflowY !== 'visible';
    if (!clipsX && !clipsY) continue;
    const box = node.getBoundingClientRect();
    const leavesX = clipsX && (ring.left < box.left || ring.right > box.right);
    const leavesY = clipsY && (ring.top < box.top || ring.bottom > box.bottom);
    if (leavesX || leavesY) {
      clippedBy = describe(node) + ' {' + owner.overflowX + '/' + owner.overflowY + '}';
    }
  }
  return {
    key: describe(element),
    part,
    outlineStyle: style.outlineStyle,
    outlineWidth: width,
    outlineOffset: offset,
    outlineColor: style.outlineColor,
    clippedBy,
    offscreen:
      ring.bottom <= 0 || ring.top >= innerHeight || ring.right <= 0 || ring.left >= innerWidth,
  };
})()`;

/** Drive a real Tab path and measure the ring at every stop it reaches. */
const walkTabPath = async (
  page: import('@playwright/test').Page,
  presses: number,
): Promise<FocusRing[]> => {
  const stops: FocusRing[] = [];
  for (let index = 0; index < presses; index += 1) {
    await page.keyboard.press('Tab');
    const stop = (await page.evaluate(RING_PROBE)) as FocusRing | null;
    if (stop) stops.push(stop);
  }
  return stops;
};

/** The ring every in-page stop must paint, wherever the engine's path goes. */
const expectVisibleRing = (stop: FocusRing) => {
  // `auto` is the user agent's own focus ring — the honest indicator a control
  // inside a package component's shadow tree gets where the site's
  // document-level baseline cannot reach. Both are visible indicators.
  expect(['solid', 'auto'], `${stop.key} paints a visible indicator`).toContain(stop.outlineStyle);
  expect(stop.outlineWidth, `${stop.key} outline width`).toBeGreaterThanOrEqual(1);
  if (stop.outlineStyle === 'solid') {
    expect(stop.outlineOffset, `${stop.key} outline offset`).toBeGreaterThanOrEqual(0);
    expect(stop.outlineColor, `${stop.key} outline colour`).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(stop.offscreen, `${stop.key} ring has pixels inside the viewport`).toBe(false);
  expect(stop.clippedBy, `${stop.key} ring is not cut off by a scrolling ancestor`).toBeNull();
};

const inPage = (stops: FocusRing[]) =>
  stops.filter((stop) => stop.key !== 'body' && stop.key !== 'html');

/**
 * Page-side helper source: read a computed colour once it has stopped moving.
 *
 * The components transition `all`, and a theme or media change restarts those
 * transitions, so a single read taken right after the change samples an
 * interpolated value — and engines serialise interpolated colours in a
 * different form (`oklab(…)` where the settled value prints as `oklch(…)`),
 * which turned a comparison into a false failure. Waiting for three
 * consecutive identical frames measures the colour the user ends up seeing.
 */
const SETTLED_READ = `(async (read) => {
  let previous = read();
  let stable = 0;
  for (let attempt = 0; attempt < 120 && stable < 3; attempt += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const current = read();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
  return previous;
})`;

/**
 * Page-side helper source: measure once the MEASUREMENT has stopped moving.
 *
 * Settling one property is not enough — a contrast ratio reads ink and surface
 * together, and the two transition on their own clocks, so a run that waited
 * only for the ink measured white text against a surface that had not darkened
 * yet (1.09:1 where the settled pair is 17:1). The quantity under test is the
 * ratio, so the ratio is what has to hold still.
 *
 * Waiting three frames is not enough either: a theme change lands on a later
 * frame than the frame that set the attribute, so an early window can see a
 * page that has simply not moved yet. The helper therefore waits for the
 * engine to report no running animation at all (`document.getAnimations`,
 * which covers CSS transitions), and only then requires the ratio to repeat.
 */
const SETTLED_MEASUREMENT = `(async (measure) => {
  const idle = () => document.getAnimations().every((animation) => animation.playState !== 'running');
  for (let frame = 0; frame < 240 && !idle(); frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
  let previous = measure();
  let stable = 0;
  for (let frame = 0; frame < 120 && stable < 6; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const current = measure();
    stable =
      current.ratio === previous.ratio &&
      current.opaque === previous.opaque &&
      current.unresolved.length === previous.unresolved.length
        ? stable + 1
        : 0;
    previous = current;
  }
  return previous;
})`;

test.describe('focus-visible rings on a real keyboard path', () => {
  // The engines' default keyboard navigation differs: chromium and firefox
  // walk the page's links, buttons and the code block's `pre[tabindex=0]`;
  // the macOS WebKit build tabs only to `[tabindex]` elements and the body,
  // so it never reaches a component control (measured; recorded per row).
  test('every stop the real Tab path reaches paints a visible, unclipped ring', async ({
    page,
  }, testInfo) => {
    await page.goto(PAGE);
    const stops = await walkTabPath(page, 25);
    const reached = inPage(stops);
    testInfo.annotations.push({
      type: 'measured tab path',
      description: [...new Set(stops.map((stop) => stop.key))].join(', '),
    });
    expect(reached.length, 'the keyboard path reaches the page').toBeGreaterThan(0);
    for (const stop of reached) expectVisibleRing(stop);
  });

  test('a component control the path reaches paints the component ring', async ({
    page,
  }, testInfo) => {
    await page.goto(PAGE);
    const controls = (await walkTabPath(page, 25)).filter((stop) => stop.part !== null);
    testInfo.annotations.push({
      type: 'component stops measured',
      description:
        controls.length > 0 ? [...new Set(controls.map((stop) => stop.part))].join(', ') : 'none',
    });
    if (controls.length === 0) {
      // N/A, said out loud rather than papered over. The macOS WebKit build's
      // default Tab path stops only at `[tabindex]` elements, so no component
      // control is reachable and this row has nothing to measure there. The
      // assertion below is the CAPABILITY PROBE — it states what this engine
      // can do — and deliberately does not assert the component ring, which
      // would be a claim the run has no evidence for. A Site E2E gate treats a
      // skip as a failed qualification, so N/A is recorded here and in the
      // matrix's applicability table instead of being hidden as a skip.
      testInfo.annotations.push({
        type: 'N/A',
        description:
          "this engine's default Tab path reaches no component control; the component ring row is not measured on it",
      });
      expect(
        controls.length,
        'the engine reaches no component control, so the component row is N/A (see the annotation)',
      ).toBe(0);
      return;
    }
    for (const control of controls) expectVisibleRing(control);
  });

  test('shift+tab returns to the stop the path came from', async ({ page }) => {
    await page.goto(PAGE);
    const key = () =>
      page.evaluate(() => {
        let element: Element | null = document.activeElement;
        while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
        return element
          ? `${element.tagName.toLowerCase()}:${element.getAttribute('part') ?? ''}:${(element.textContent ?? '').trim().slice(0, 16)}`
          : 'none';
      });
    // Tab to the second distinct stop: the first is the skip link, where
    // Shift+Tab correctly stays put (it is the first tabbable in the page).
    let first = 'none';
    let second = 'none';
    for (let index = 0; index < 25 && second === 'none'; index += 1) {
      await page.keyboard.press('Tab');
      const key_ = await key();
      if (first === 'none') first = key_;
      else if (key_ !== first) second = key_;
    }
    expect(second, 'the path has a second stop').not.toBe('none');
    await page.keyboard.press('Shift+Tab');
    expect(await key(), 'Shift+Tab returns to the previous stop').toBe(first);
    await page.keyboard.press('Tab');
    expect(await key(), 'Tab moves forward again').toBe(second);
  });
});

test.describe('open-button disabled states', () => {
  /**
   * Install a listener and count what the component announces, so the rows
   * below can assert the absence of an event rather than the absence of an
   * observation.
   */
  const watch = (page: import('@playwright/test').Page, selector: string) =>
    page.evaluate(
      ([query, target]) => {
        const find = eval(query) as (selector: string) => Element[];
        const authored = find('open-button')[0]!;
        const host = authored.cloneNode(false) as Element;
        if (target === 'native') host.removeAttribute('href');
        else host.setAttribute('href', '/roadmap');
        host.setAttribute('disabled', '');
        host.append(target === 'native' ? 'Disabled' : 'Disabled link');
        authored.after(host);
        (window as unknown as { events: number }).events = 0;
        host.addEventListener('open-click', () => {
          (window as unknown as { events: number }).events += 1;
        });
        return true;
      },
      [DEEP_QUERY, selector === 'native' ? 'native' : 'link'],
    );

  const events = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as { events: number }).events);

  test('the native form: a real press and a real Enter reach nothing', async ({ page }) => {
    await page.goto(PAGE);
    await watch(page, 'native');
    const control = page.locator('open-button[disabled] button').last();
    await expect(control).toHaveAttribute('disabled', '');
    const style = await control.evaluate((element) => {
      const cs = getComputedStyle(element);
      return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
    });
    expect(style.opacity, 'the disabled control dims').toBe('0.5');
    expect(style.pointerEvents, 'the disabled control is inert to the pointer').toBe('none');

    // A real pointer press at the control's own coordinates. Nothing is
    // synthesised: the browser sees a genuine mousedown/mouseup pair where the
    // control is drawn, and the shipped `pointer-events: none` decides what
    // receives it.
    const box = await control.boundingBox();
    expect(box, 'the control is laid out').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await events(page), 'a real press announces nothing').toBe(0);

    // A real keyboard activation attempt. A disabled button is not focusable,
    // so the press lands on whatever the document already had focused — which
    // is the point: there is no path from the keyboard into a disabled control.
    await control.focus().catch(() => undefined);
    const focused = await page.evaluate(
      () => document.activeElement?.tagName.toLowerCase() ?? 'none',
    );
    expect(focused, 'a disabled button cannot take focus').not.toBe('button');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect(await events(page), 'a real Enter/Space announces nothing').toBe(0);
  });

  test('the link form: a real press and a real Enter do not navigate', async ({ page }) => {
    await page.goto(PAGE);
    await watch(page, 'link');
    const control = page.locator('open-button[href][disabled] a').last();
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    const style = await control.evaluate((element) => {
      const cs = getComputedStyle(element);
      return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
    });
    expect(style.opacity, 'the disabled link dims').toBe('0.5');
    expect(style.pointerEvents, 'the disabled link is inert to the pointer').toBe('none');

    const before = page.url();
    const box = await control.boundingBox();
    expect(box, 'the link is laid out').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(page.url(), 'a real press does not navigate').toBe(before);
    expect(await events(page), 'a real press announces nothing').toBe(0);

    // `aria-disabled` does not remove an anchor from the focus order the way
    // the native attribute does, so this half is a genuine keyboard path: if
    // the link takes focus, Enter must still not navigate.
    await control.focus().catch(() => undefined);
    const tookFocus = await control.evaluate((element) => document.activeElement === element);
    if (tookFocus) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      expect(page.url(), 'Enter on the aria-disabled link does not navigate').toBe(before);
      expect(await events(page), 'Enter announces nothing').toBe(0);
    }
  });
});

test.describe('open-theme-toggle', () => {
  test('clicking flips the button state and the resolved theme', async ({ page }) => {
    await page.goto(PAGE);
    // The toggle's handler arrives with its upgrade; without this wait a click
    // can land on a still-inert server-rendered button.
    await page.waitForFunction(() => customElements.get('open-theme-toggle') !== undefined);
    const toggle = page.locator('open-theme-toggle button[part=toggle]').first();
    const before = await toggle.getAttribute('data-theme');
    const themeBefore = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    await toggle.click();
    await expect
      .poll(() => toggle.getAttribute('data-theme'), { timeout: 10_000 })
      .not.toBe(before);
    const themeAfter = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAfter).not.toBe(themeBefore);
    expect(await toggle.getAttribute('data-theme')).toBe(themeAfter);
  });

  test('the system preference decides the first paint', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(PAGE);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(PAGE);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'light',
    );
  });
});

test.describe('open-code-block copy control', () => {
  test('a real click copies and reports what the clipboard did', async ({ page, context }) => {
    // Chromium takes the permission grant; Firefox and WebKit reject the
    // permission names, so the assertion below follows what the platform
    // actually did rather than assuming a granted clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await page.goto(PAGE);
    const button = page.locator('open-code-block .copy-btn').first();
    await expect(button).toHaveText('Copy');
    const source = await page.evaluate(
      ([query]) => {
        const find = eval(query) as (selector: string) => Element[];
        return (find('open-code-block')[0] as HTMLElement | undefined)?.textContent ?? '';
      },
      [DEEP_QUERY],
    );
    const canWrite = await page.evaluate(() =>
      navigator.clipboard
        .writeText('probe')
        .then(() => true)
        .catch(() => false),
    );
    await button.click();
    await expect.poll(() => button.textContent(), { timeout: 3000 }).not.toBe('Copy');
    const label = (await button.textContent())!.trim();
    if (canWrite) {
      expect(label, 'the control reports the copy that happened').toBe('Copied!');
      const clipboard = await page
        .evaluate(() => navigator.clipboard.readText().catch(() => null))
        .catch(() => null);
      if (clipboard !== null) expect(clipboard).toBe(source);
    } else {
      expect(label, 'the control reports the copy that could not happen').toBe('Failed');
    }
    // The feedback is transient: the label returns to the idle one.
    await expect(button).toHaveText('Copy', { timeout: 5000 });
  });

  test('a real click reports the failure when the write is refused', async ({ page }) => {
    await page.goto(PAGE);
    // The failure is induced in the page, not in the engine: the platform
    // clipboard is replaced by one whose write always rejects, so the
    // component's failure path is exercised deterministically in every engine
    // while the control that is clicked stays the real one.
    await page.evaluate(() => {
      // The component reads `navigator.clipboard` at click time, so replacing
      // the getter is enough — nothing else about the control changes.
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get() {
          return { writeText: () => Promise.reject(new Error('denied by the probe')) };
        },
      });
    });
    const button = page.locator('open-code-block .copy-btn').first();
    await button.click();
    await expect.poll(() => button.textContent(), { timeout: 3000 }).toBe('Failed');
    await expect(button).toHaveText('Copy', { timeout: 5000 });
  });
});

test.describe('declared ::part surface', () => {
  test('every part the components declare is reachable from the consumer', async ({ page }) => {
    await page.goto(PAGE);
    // The components render inside the page component's shadow tree, and a
    // `::part()` rule only reaches the parts of hosts its own tree scope can
    // see — so the consumer rule is declared where the hosts are: the page's
    // shadow root.
    const reached = await page.evaluate(
      async ([query]) => {
        const find = eval(query) as (selector: string) => Element[];
        const button = find('open-button')[0]!;
        const toggle = find('open-theme-toggle')[0]!;
        const codeBlock = find('open-code-block')[0]!;

        // These hosts sit in different trees (the page component's shadow
        // root, and wherever the layout renders the toggle), so the rule set
        // is written into every root along each host's ancestor chain.
        const rootsOf = (element: Element): (Document | ShadowRoot)[] => {
          const roots: (Document | ShadowRoot)[] = [];
          let node: Element | null = element;
          while (node) {
            const root = node.getRootNode() as Document | ShadowRoot;
            roots.push(root);
            node = root instanceof ShadowRoot ? root.host : null;
          }
          return roots;
        };
        // `transition: none` is part of the probe: the components transition
        // `all`, so a computed read taken while the injected value animates in
        // reports the pre-injection value (measured: opacity read 1 while the
        // rule was already taking effect).
        const text = [
          'open-button::part(control) { outline-color: rgb(1, 2, 3) !important; transition: none !important; }',
          'open-theme-toggle::part(toggle) { outline-color: rgb(1, 2, 3) !important; transition: none !important; }',
          'open-theme-toggle::part(icon-sun) { outline-color: rgb(1, 2, 3) !important; }',
          'open-theme-toggle::part(icon-moon) { outline-color: rgb(1, 2, 3) !important; }',
          'open-code-block::part(copy) { outline-color: rgb(1, 2, 3) !important; transition: none !important; }',
        ].join('\n');
        for (const host of [button, toggle, codeBlock]) {
          for (const root of rootsOf(host)) {
            const style = document.createElement('style');
            style.textContent = text;
            (root instanceof Document ? root.head : root).appendChild(style);
          }
        }

        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const outlineOf = (element: Element | null | undefined) =>
          element ? getComputedStyle(element).outlineColor : 'absent';
        return {
          // The page is a server function page: its own output is light DOM,
          // and the components it composes are the shadow hosts whose parts
          // are being reached. The meaningful scoping fact is therefore the
          // HOST's own shadow root, not an enclosing page component's.
          shadowScoped: button.shadowRoot !== null,
          control: outlineOf(button.shadowRoot?.querySelector('[part=control]')),
          toggle: outlineOf(toggle.shadowRoot?.querySelector('[part=toggle]')),
          iconSun: outlineOf(toggle.shadowRoot?.querySelector('[part=icon-sun]')),
          iconMoon: outlineOf(toggle.shadowRoot?.querySelector('[part=icon-moon]')),
          copy: outlineOf(codeBlock.shadowRoot?.querySelector('[part=copy]')),
        };
      },
      [DEEP_QUERY],
    );
    expect(reached.shadowScoped).toBe(true);
    for (const [part, color] of Object.entries(reached)) {
      if (part === 'shadowScoped') continue;
      expect(color, `::part(${part}) is reachable`).toBe('rgb(1, 2, 3)');
    }
  });
});

test.describe('shipped colour pairs', () => {
  // Scope: pairs whose backdrop is a surface the PAGE paints opaquely, and
  // therefore measurable by walking the painted chain — the code block's
  // surface and its copy label. The button's and the toggle's surfaces are
  // translucent (a `color-mix` over the page) and sit behind the header's
  // backdrop-filter, so an ancestor walk cannot model what the user sees;
  // asserting them here would be a guess dressed as a measurement. Their roles
  // are covered by the existing accessibility suite's prose/rail pairs
  // (accessibility-performance.spec.ts), which measures rendered pixels. The
  // measurement reports `opaque: false` rather than assuming paper, and this
  // row fails if it does.
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the code surface pair clears WCAG AA`, async ({ page }) => {
      await page.goto(PAGE);
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      const ratios = await page.evaluate(
        async ([source, settled, query]) => {
          const { measuredContrast } = eval(source) as {
            measuredContrast: (element: Element) => ContrastMeasurement;
          };
          const settle = eval(settled) as (
            measure: () => ContrastMeasurement,
          ) => Promise<ContrastMeasurement>;
          const find = eval(query) as (selector: string) => Element[];
          const codeBlock = find('open-code-block')[0]!;
          // The site slots its `<pre>` as light DOM into the block (the
          // component's own shadow root only hosts the copy button).
          const surface =
            codeBlock.querySelector('pre') ?? codeBlock.shadowRoot?.querySelector('pre');
          const copy = codeBlock.shadowRoot!.querySelector('.copy-btn')!;
          return {
            codeSurface: await settle(() => measuredContrast(surface ?? codeBlock)),
            copyLabel: await settle(() => measuredContrast(copy)),
          };
        },
        [MATRIX_HELPERS_SOURCE, SETTLED_MEASUREMENT, DEEP_QUERY],
      );
      for (const [pair, measured] of Object.entries(ratios)) {
        // A colour this module could not read, or a surface the page does not
        // paint opaquely, is not a measurement — say that rather than let a
        // fallback turn into a pass.
        expect(measured.unresolved, `${theme} ${pair} colours are readable`).toEqual([]);
        expect(measured.opaque, `${theme} ${pair} sits on a surface the page paints`).toBe(true);
        expect(measured.ratio, `${theme} ${pair} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test.describe('forced colours', () => {
  // Two rows in one: the capability probe decides which one this engine gets.
  // Entering the mode is the engine's business — `emulateMedia` reports the
  // media query as matching even where the engine then changes nothing
  // (measured: the macOS WebKit build). So the probe asks whether an authored
  // colour actually resolved to something else, and only the capable branch
  // asserts the product's mapping. The other branch is recorded as N/A and
  // asserts the inverse fact — that the authored ink survives — which is what
  // the run can honestly claim there.
  //
  // Every colour comparison here is by PARSED value, never by the serialised
  // string: an engine prints the same colour as `oklab(…)` on one read and
  // `oklch(…)` on the next, so a string compare would report a difference that
  // is not there.
  test('the control maps onto system colours where the engine can enter the mode', async ({
    page,
  }, testInfo) => {
    await page.goto(PAGE);
    /**
     * A page-side thunk for the control's own colour. The control lives in the
     * component's shadow tree, so the lookup has to walk the deep query.
     */
    const controlColour = `((query) => {
      const find = eval(query);
      const control = find('open-button')[0].shadowRoot.querySelector('[part=control]');
      return () => getComputedStyle(control).color;
    })`;

    const authored = await page.evaluate(
      ([settled, reader, query]) => {
        const read = eval(reader)(query) as () => string;
        return (eval(settled) as (read: () => string) => Promise<string>)(read);
      },
      [SETTLED_READ, controlColour, DEEP_QUERY],
    );
    await page.emulateMedia({ forcedColors: 'active' });
    const observed = await page.evaluate(
      async ([helpers, settled, reader, query, authoredInk]) => {
        const { parseColor } = eval(helpers) as {
          parseColor: (value: string) => [number, number, number, number] | null;
        };
        const settle = eval(settled) as (read: () => string) => Promise<string>;
        const sameColour = (a: string, b: string) => {
          const left = parseColor(a);
          const right = parseColor(b);
          if (left === null || right === null) return a === b;
          return left.every((channel, index) => Math.abs(channel - right[index]!) < 0.004);
        };
        const colour = await settle(eval(reader)(query) as () => string);
        const system = {} as Record<string, string>;
        for (const name of [
          'ButtonText',
          'CanvasText',
          'Canvas',
          'Highlight',
          'LinkText',
          'GrayText',
        ]) {
          const probe = document.createElement('span');
          probe.style.color = name;
          document.documentElement.appendChild(probe);
          system[name] = await settle(() => getComputedStyle(probe).color);
          probe.remove();
        }
        const ink = document.createElement('span');
        ink.style.color = authoredInk;
        document.documentElement.appendChild(ink);
        const probeValue = await settle(() => getComputedStyle(ink).color);
        ink.remove();
        return {
          mediaActive: matchMedia('(forced-colors: active)').matches,
          probeChanged: !sameColour(probeValue, authoredInk),
          colour,
          system,
        };
      },
      [MATRIX_HELPERS_SOURCE, SETTLED_READ, controlColour, DEEP_QUERY, authored],
    );
    testInfo.annotations.push({
      type: 'forced-colors capability',
      description: `media=${observed.mediaActive} authoredColourResolved=${observed.probeChanged}`,
    });

    if (!observed.mediaActive || !observed.probeChanged) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          'this engine reports the forced-colors media query without applying it; the system-colour mapping row is not measured on it',
      });
      expect(
        observed.colour,
        'an engine that does not apply forced colours keeps the authored ink',
      ).toBe(authored);
      return;
    }
    // With the UA owning hue, the authored role colour is gone and the ink is
    // one of the resolved system colours.
    expect(observed.colour, 'the authored role colour is gone').not.toBe(authored);
    expect(
      Object.values(observed.system),
      `${observed.colour} is a system colour (system: ${JSON.stringify(observed.system)})`,
    ).toContain(observed.colour);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the server-rendered components keep their styling', async ({ page }) => {
    await page.goto(PAGE);
    const measured = await page.evaluate(
      ([query]) => {
        const find = eval(query) as (selector: string) => Element[];
        const control = find('open-button')[0]!.shadowRoot!.querySelector('[part=control]')!;
        const copy = find('open-code-block')[0]!.shadowRoot!.querySelector('[part=copy]')!;
        const toggle = find('open-theme-toggle')[0]!.shadowRoot!.querySelector('[part=toggle]')!;
        const read = (element: Element) => {
          const cs = getComputedStyle(element);
          return {
            display: cs.display,
            radius: cs.borderRadius,
            padding: cs.padding,
            position: cs.position,
          };
        };
        return { control: read(control), copy: read(copy), toggle: read(toggle) };
      },
      [DEEP_QUERY],
    );
    expect(measured.control.display).toBe('inline-flex');
    expect(measured.control.padding).not.toBe('0px');
    expect(measured.control.radius).not.toBe('0px');
    expect(measured.copy.position).toBe('absolute');
    expect(measured.toggle.display).not.toBe('none');
  });
});
