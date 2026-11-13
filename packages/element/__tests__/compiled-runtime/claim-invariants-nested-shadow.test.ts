/**
 * R7 — the shadow-including ancestor walk of the generated-leaf claim parent.
 *
 * `assertElementInHtmlNamespace` walks the claim parent's element ancestors.
 * `ShadowRoot.parentNode` is `null` by platform definition, so before this
 * slice the walk stopped at a shadow boundary and a claim target nested inside
 * ANOTHER shadow tree escaped the namespace check entirely. The fix is the
 * composed-parent step in `claim-invariants.ts`: a node with no `parentNode`
 * that IS a real ShadowRoot continues from its host.
 *
 * The one predicate is still the native cross-realm brand check
 * (`ShadowRoot.prototype.host` captured at module load): no polyfill, no
 * structural fallback, no realm-local `instanceof`.
 *
 * Evidence runs in real Chromium because the brand predicate needs the real
 * platform object; the element runtime is bundled from THIS tree by a real
 * Vite build, never re-implemented in the page. Covered:
 *
 * - RED (was silent, now coded): an HTML element inside an SVG ancestor owns a
 *   shadow root, and a generated host inside THAT root owns another — the
 *   inner claim parent's ancestor chain crosses two boundaries into a non-HTML
 *   element, and the walk must report it;
 * - GREEN control: the same nesting without the SVG ancestor still passes, so
 *   the fix does not reject nesting itself;
 * - the light path: a claim target whose element parent chain crosses a shadow
 *   boundary into a non-HTML ancestor is refused for the same reason;
 * - cross-realm: a ShadowRoot created in another realm (an iframe) is still
 *   traversed, which guards the brand check against a realm-local regression;
 * - unchanged refusals: a bare `DocumentFragment` is still not a claim parent,
 *   and a same-tree HTML chain still passes.
 *
 * Strict-only: every one of these is a new failure or an unchanged result.
 * LOCAL, one Chromium engine. Not M09 exit, not the M13 browser matrix.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;

interface PageRuntime {
  assertElementInHtmlNamespace: (node: Node, where: string) => void;
  isClaimParentShadowRoot: (node: Node | null) => boolean;
  LEAF_CLAIM_MISMATCH: string;
}

declare global {
  interface Window {
    __oeR7: PageRuntime;
  }
}

interface Outcome {
  readonly message: string | null;
  readonly code: string | null;
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';

/**
 * Bundle the REAL runtime module for the page. The entry re-exports only the
 * functions under test; nothing about the rule is restated in the test.
 */
async function buildRuntimeBundle(dir: string): Promise<string> {
  const runtime = join(REPO_ROOT, 'packages/element/src/internal/compiled/runtime');
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { assertElementInHtmlNamespace, isClaimParentShadowRoot, LEAF_CLAIM_MISMATCH } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: '__oeR7',
        fileName: () => 'claim-invariants-r7.js',
      },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('the R7 runtime bundle produced no chunk');
  const file = join(dir, 'claim-invariants-r7.js');
  writeFileSync(file, chunk.code);
  return file;
}

/**
 * Page-side helpers. `run` returns the coded outcome instead of throwing so a
 * silent pass and a coded refusal are distinguishable facts.
 */
const PAGE_HELPERS = `
  const SVG_NS = 'http://www.w3.org/2000/svg';
  window.__oeOutcome = (run) => {
    try {
      run();
      return { message: null, code: null };
    } catch (error) {
      return { message: error.message, code: error.code ?? null };
    }
  };
  window.__oeBuildNested = (svgAncestor) => {
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    let foreign = wrapper;
    if (svgAncestor) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      wrapper.append(svg);
      foreign = svg;
    }
    const middle = document.createElement('div');
    foreign.append(middle);
    const outer = middle.attachShadow({ mode: 'open' });
    const host = document.createElement('x-r7-inner');
    outer.append(host);
    const inner = host.attachShadow({ mode: 'open' });
    return { wrapper, middle, outer, host, inner };
  };
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_HELPERS });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-r7-'));
  bundleFile = await buildRuntimeBundle(tempDir);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('R7 shadow-including ancestor walk (Chromium)', () => {
  test('a claim parent nested inside another shadow tree reports the outer non-HTML ancestor', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const { inner, host, outer, middle } = (
          window as unknown as {
            __oeBuildNested: (svg: boolean) => Record<string, ShadowRoot | HTMLElement>;
          }
        ).__oeBuildNested(true);
        const outcome = (
          window as unknown as { __oeOutcome: (run: () => void) => Outcome }
        ).__oeOutcome(() =>
          window.__oeR7.assertElementInHtmlNamespace(inner as unknown as Node, 'nested'),
        );
        return {
          outcome,
          // The host and the inner root are real HTML/ShadowRoot objects; only
          // the OUTER ancestor is foreign, so the failure can only come from
          // crossing the boundary.
          brandInner: window.__oeR7.isClaimParentShadowRoot(inner as unknown as Node),
          brandOuter: window.__oeR7.isClaimParentShadowRoot(outer as unknown as Node),
          hostNamespace: (host as HTMLElement).namespaceURI,
          middleNamespace: (middle as HTMLElement).namespaceURI,
        };
      });
      expect(result.brandInner).toBe(true);
      expect(result.brandOuter).toBe(true);
      expect(result.hostNamespace).toBe('http://www.w3.org/1999/xhtml');
      expect(result.middleNamespace).toBe('http://www.w3.org/1999/xhtml');
      expect(result.outcome.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.outcome.message).toContain('non-HTML namespace at nested');
      expect(result.outcome.message).toContain('http://www.w3.org/2000/svg');
    } finally {
      await page.close();
    }
  });

  test('the same nesting without the foreign ancestor passes (green control)', async () => {
    const page = await openPage();
    try {
      const outcome = await page.evaluate(() => {
        const { inner } = (
          window as unknown as {
            __oeBuildNested: (svg: boolean) => Record<string, ShadowRoot>;
          }
        ).__oeBuildNested(false);
        return (window as unknown as { __oeOutcome: (run: () => void) => Outcome }).__oeOutcome(
          () => window.__oeR7.assertElementInHtmlNamespace(inner as unknown as Node, 'nested'),
        );
      });
      expect(outcome).toEqual({ message: null, code: null });
    } finally {
      await page.close();
    }
  });

  test('a claim target whose element chain crosses a shadow boundary is refused', async () => {
    const page = await openPage();
    try {
      const outcome = await page.evaluate(() => {
        const { inner } = (
          window as unknown as {
            __oeBuildNested: (svg: boolean) => Record<string, ShadowRoot>;
          }
        ).__oeBuildNested(true);
        const target = document.createElement('span');
        (inner as unknown as ShadowRoot).append(target);
        return (window as unknown as { __oeOutcome: (run: () => void) => Outcome }).__oeOutcome(
          () => window.__oeR7.assertElementInHtmlNamespace(target, 'target'),
        );
      });
      expect(outcome.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(outcome.message).toContain('non-HTML namespace at target');
      expect(outcome.message).toContain('http://www.w3.org/2000/svg');
    } finally {
      await page.close();
    }
  });

  test('a ShadowRoot from another realm is still traversed by the native brand check', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const view = frame.contentWindow!;
        const doc = view.document;
        doc.body.innerHTML = '';
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        doc.body.append(svg);
        const middle = doc.createElement('div');
        svg.append(middle);
        const outer = middle.attachShadow({ mode: 'open' });
        const host = doc.createElement('x-r7-cross');
        outer.append(host);
        const inner = host.attachShadow({ mode: 'open' });
        // The brand predicate must accept both realms' roots ...
        const brands = {
          inner: window.__oeR7.isClaimParentShadowRoot(inner as unknown as Node),
          outer: window.__oeR7.isClaimParentShadowRoot(outer as unknown as Node),
          local: window.__oeR7.isClaimParentShadowRoot(
            document.createElement('div').attachShadow({ mode: 'open' }),
          ),
        };
        // ... and the walk must cross the boundary into the foreign realm's
        // shadow tree and reach the SVG ancestor.
        const own = (
          window as unknown as { __oeOutcome: (run: () => void) => Outcome }
        ).__oeOutcome(() =>
          window.__oeR7.assertElementInHtmlNamespace(inner as unknown as Node, 'cross-realm'),
        );
        const sameRealm = (
          window as unknown as { __oeOutcome: (run: () => void) => Outcome }
        ).__oeOutcome(() =>
          window.__oeR7.assertElementInHtmlNamespace(
            document.createElement('div').attachShadow({ mode: 'open' }),
            'local',
          ),
        );
        return { brands, own, sameRealm };
      });
      expect(result.brands).toEqual({ inner: true, outer: true, local: true });
      expect(result.own.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.own.message).toContain('non-HTML namespace at cross-realm');
      expect(result.sameRealm).toEqual({ message: null, code: null });
    } finally {
      await page.close();
    }
  });

  test('a bare DocumentFragment is still not a claim parent and a same-tree HTML chain passes', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const outcome = (run: () => void) => {
          try {
            run();
            return { message: null, code: null };
          } catch (error) {
            return {
              message: (error as Error).message,
              code: (error as { code?: string }).code ?? null,
            };
          }
        };
        const fragment = document.createDocumentFragment();
        const wrapper = document.createElement('div');
        wrapper.append(fragment);
        const attached = document.createElement('div').attachShadow({ mode: 'open' });
        const child = document.createElement('p');
        attached.append(child);
        return {
          fragment: outcome(() => window.__oeR7.assertElementInHtmlNamespace(fragment, 'fragment')),
          brandFragment: window.__oeR7.isClaimParentShadowRoot(fragment),
          sameTree: outcome(() => window.__oeR7.assertElementInHtmlNamespace(child, 'child')),
          shadowParent: outcome(() =>
            window.__oeR7.assertElementInHtmlNamespace(attached, 'shadow-parent'),
          ),
        };
      });
      expect(result.brandFragment).toBe(false);
      expect(result.fragment.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.fragment.message).toContain('not an element');
      expect(result.sameTree).toEqual({ message: null, code: null });
      expect(result.shadowParent).toEqual({ message: null, code: null });
    } finally {
      await page.close();
    }
  });
});
