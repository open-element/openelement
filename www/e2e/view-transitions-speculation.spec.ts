/**
 * E2E: View Transitions & Speculation Rules
 *
 * Verifies the SSG post-processing pipeline's declarations in the built HTML:
 * the cross-document View Transition opt-in (the `@view-transition` at-rule,
 * CSS View Transitions Level 2) and the Speculation Rules script.
 *
 * Core SSG output contract — critical to validate in e2e.
 *
 * Two facts are kept apart, because only one of them is the product's: the
 * built document CARRIES the opt-in (true in every engine — it is what the
 * pipeline emits), and a given engine PARSES it and then actually performs a
 * cross-document transition (a platform capability, measured where it exists).
 * An engine without the at-rule ignores it, exactly as it ignored the legacy
 * meta tag, so the unsupported rows record N/A and assert that degradation
 * instead of asserting around it.
 */

import { expect, test } from '@playwright/test';

/** The declaration the pipeline injects, and the injection guard's own marker. */
const OPT_IN_MARKER = '@view-transition { navigation: auto; }';

test.describe('View Transitions', () => {
  const pages = ['/', '/guide/getting-started', '/architecture', '/blog', '/changelog'];

  for (const path of pages) {
    test(`"${path}" carries the cross-document opt-in exactly once`, async ({ page }) => {
      // `goto` waits for `load`; the declaration is part of the parsed head,
      // so `networkidle` would only add a race with the page's own background
      // requests (search index, counters) and never change the answer.
      await page.goto(path);

      const shape = await page.evaluate((marker) => {
        const styles = [...document.querySelectorAll('head style')];
        return {
          carrier: styles.some((style) => style.textContent?.includes(marker)),
          occurrences: (
            document.head.innerHTML.match(/@view-transition \{ navigation: auto; \}/g) ?? []
          ).length,
          legacyMeta: document.querySelectorAll('meta[name="view-transition"]').length,
        };
      }, OPT_IN_MARKER);
      expect(shape.carrier, 'the declaration rides a head <style>').toBe(true);
      expect(shape.occurrences, 'injected exactly once').toBe(1);
      expect(shape.legacyMeta, 'the legacy meta spelling is gone').toBe(0);
    });
  }

  test('the engine parses the opt-in where it has the at-rule', async ({ page }, testInfo) => {
    await page.goto('/');

    const observed = await page.evaluate((marker) => {
      const parsed: string[] = [];
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule.cssText.includes(marker)) parsed.push(rule.cssText);
        }
      }
      // A rule the engine cannot parse is dropped from `cssRules` entirely,
      // which is exactly how an unsupported engine shows the at-rule.
      return { parsed, text: document.head.innerHTML.includes(marker) };
    }, OPT_IN_MARKER);
    testInfo.annotations.push({
      type: 'cross-document view transitions',
      description: `parsedRules=${observed.parsed.length} presentAsText=${observed.text}`,
    });
    expect(observed.text, 'the declaration is in the document either way').toBe(true);
    if (observed.parsed.length === 0) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          'this engine has no `@view-transition` at-rule; the parsed-rule row is not measured on it (the declaration is ignored, which is the intended degradation)',
      });
      return;
    }
    expect(observed.parsed.join(' '), 'the parsed rule is the navigation opt-in').toContain(
      'navigation: auto',
    );
  });

  test('a real cross-document navigation runs a view transition, where the engine can', async ({
    page,
  }, testInfo) => {
    // `pagereveal` fires on the DESTINATION document, and only when a
    // cross-document view transition is actually active — the platform's own
    // confirmation that the opt-in took effect, not a restatement of the
    // declaration. The listener is installed by `addInitScript`, which runs in
    // every document of this page.
    //
    // The navigation is a history traversal (`goBack`): the spec runs a
    // transition for `traverse`, `push` and `replace`, and a `page.goto` is
    // none of those. A link click would not do either — the client Router
    // intercepts same-origin clicks, so that is a SAME-document navigation
    // with its own acceptance.
    await page.addInitScript(() => {
      (window as unknown as { __reveal: number }).__reveal = 0;
      window.addEventListener('pagereveal', () => {
        (window as unknown as { __reveal: number }).__reveal += 1;
      });
    });
    await page.goto('/');
    await page.goto('/roadmap');
    await page.goBack();
    await page.waitForLoadState('networkidle');

    const observed = await page.evaluate((marker) => {
      // The prerequisite for the CROSS-DOCUMENT row is the at-rule, not the
      // same-document `ViewTransition` interface: an engine can ship
      // `startViewTransition` for a single document and still have no
      // `@view-transition` for navigations between them (Firefox does exactly
      // that today). Probing the interface would have counted that engine as
      // capable and then failed it for the engine's own limitation.
      let atRule = false;
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) if (rule.cssText.includes(marker)) atRule = true;
      }
      return {
        atRule,
        sameDocument:
          typeof (window as unknown as { ViewTransition?: unknown }).ViewTransition === 'function',
        revealed: (window as unknown as { __reveal: number }).__reveal,
        path: location.pathname,
      };
    }, OPT_IN_MARKER);
    testInfo.annotations.push({
      type: 'cross-document view transitions',
      description: `atRule=${observed.atRule} sameDocumentApi=${observed.sameDocument} pagereveal=${observed.revealed} at=${observed.path}`,
    });
    if (!observed.atRule) {
      testInfo.annotations.push({
        type: 'N/A',
        description:
          'this engine has no `@view-transition` at-rule, so no cross-document transition is possible; the row is not measured on it',
      });
      expect(observed.revealed, 'an engine without the at-rule fires no reveal').toBe(0);
      return;
    }
    expect(observed.path, 'the traversal landed on the previous document').toBe('/');
    expect(observed.revealed, 'the traversal ran the cross-document transition').toBe(1);
  });
});

test.describe('Speculation Rules', () => {
  test('homepage has <script type="speculationrules">', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const script = page.locator('script[type="speculationrules"]');
    expect(await script.count()).toBe(1);
  });

  test('speculation rules contain valid JSON', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const jsonText = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      return script?.textContent ?? '';
    });

    // Should be parseable JSON
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(jsonText);
    }).not.toThrow();

    // Should have at least one of: prefetch or prerender
    const hasPrefetch = 'prefetch' in parsed! && Array.isArray(parsed!.prefetch);
    const hasPrerender = 'prerender' in parsed! && Array.isArray(parsed!.prerender);
    expect(hasPrefetch || hasPrerender).toBe(true);
  });

  test('speculation rules include prefetch entries', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const rules = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      if (!script) return null;
      return JSON.parse(script.textContent!);
    });

    expect(rules).not.toBeNull();
    expect(rules.prefetch).toBeDefined();
    expect(Array.isArray(rules.prefetch)).toBe(true);
    expect(rules.prefetch.length).toBeGreaterThan(0);
  });

  test('each prefetch rule has href_matches pattern', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const rules = await page.evaluate(() => {
      const script = document.querySelector('script[type="speculationrules"]');
      if (!script) return null;
      return JSON.parse(script.textContent!);
    });

    for (const rule of rules.prefetch) {
      expect(rule.where).toBeDefined();
      expect(rule.where.href_matches).toBeDefined();
      expect(typeof rule.where.href_matches).toBe('string');
    }
  });

  test('guide page also has speculation rules', async ({ page }) => {
    await page.goto('/guide/getting-started');
    await page.waitForLoadState('networkidle');

    const script = page.locator('script[type="speculationrules"]');
    expect(await script.count()).toBe(1);
  });

  test('only one speculationrules script tag per page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const count = await page.locator('script[type="speculationrules"]').count();
    expect(count).toBe(1);
  });
});
