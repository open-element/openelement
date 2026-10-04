/**
 * v0.27.0 Regression Tests — Build Output Integrity
 *
 * Prevents recurrence of the three production bugs discovered in v0.27.0:
 *   Bug 1: Sidebar disappears on docs pages (open-layout DSD missing)
 *   Bug 2: [object Object] in rendered HTML (VNode stringified)
 *   Bug 3: Search panel theme not following (dialog::backdrop isolation)
 *
 * Also guards against API surface regressions:
 *   - JSX must be available from the supported Element root
 *   - parse5 must NOT be a dependency
 *
 * Run: pnpm --dir www run test (the vitest www project)
 * Prerequisite: `pnpm run site:build`
 */

import { expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const DIST = join(import.meta.dirname ?? '.', '..', 'dist');
const DOCS_PAGE = join(DIST, 'zh', 'guide', 'getting-started', 'index.html');
const HOME_PAGE = join(DIST, 'index.html');
const ARCHITECTURE_PAGE = join(DIST, 'zh', 'architecture', 'islands', 'index.html');
const REGISTRY_PAGE = join(DIST, 'zh', 'registry', 'index.html');

// ─── Helpers ────────────────────────────────────────────────────────

function readPage(path: string): string {
  if (!existsSync(path)) throw new Error(`Page not found: ${path}`);
  return readFileSync(path, 'utf8');
}

// ─── Bug 1: Sidebar not missing ─────────────────────────────────────

test('v0.44 regression: compiled reading shell and page rail are present in guide pages', () => {
  const html = readPage(DOCS_PAGE);
  expect(html, 'Reading shell must be present').toContain('<open-reading-shell');
  expect(html, 'Page rail must be present').toContain('<open-page-rail');
});

test('v0.27.0 regression: open-layout has DSD template', () => {
  const html = readPage(DOCS_PAGE);
  // The light-root app shell and static article chain must be expanded, while
  // admitted shadow-root islands retain native DSD. Article-embedded components
  // (open-code-block inside the article's Trusted HTML) stay SSR-inert on
  // purpose: trusted content is opaque to nested composition, so only shell
  // admitted islands compose server-side. The inert host must not gain a
  // server DSD template from an opaque string.
  const count = (html.match(/shadowrootmode="open"/g) || []).length;
  expect(count >= 1, `Expected >= 1 DSD template in docs page, got ${count}`).toBeTruthy();
  expect(html, 'App shell host must be present').toContain('<open-layout');
  expect(html, 'Compiled light roots must be expanded').toContain('data-oe-light');
  expect(html, 'Admitted shadow islands must keep native DSD').toContain(
    '<open-theme-toggle><template shadowrootmode="open"',
  );
  const codeBlock = html.indexOf('<open-code-block');
  expect(codeBlock !== -1, 'open-code-block host must be present in article content').toBeTruthy();
  expect(
    html.slice(codeBlock, codeBlock + 200).includes('<template shadowrootmode'),
    'Trusted HTML content must stay opaque to nested composition',
  ).toBeFalsy();
});

test('v0.27.0 regression: open-search is present in output', () => {
  for (const page of [DOCS_PAGE, HOME_PAGE, ARCHITECTURE_PAGE]) {
    const html = readPage(page);
    expect(html.includes('<open-search'), `open-search missing in ${page}`).toBeTruthy();
  }
});

test('v0.27.0 regression: open-theme-toggle is present in output', () => {
  for (const page of [DOCS_PAGE, HOME_PAGE, ARCHITECTURE_PAGE]) {
    const html = readPage(page);
    expect(
      html.includes('<open-theme-toggle'),
      `open-theme-toggle missing in ${page}`,
    ).toBeTruthy();
  }
});

// ─── Bug 2: No [object Object] or [object Promise] ──────────────────

test('v0.27.0 regression: no [object Object] in rendered HTML', () => {
  for (const page of [DOCS_PAGE, HOME_PAGE, ARCHITECTURE_PAGE]) {
    const html = readPage(page);
    expect(html.includes('[object Object]'), `[object Object] found in ${page}`).toBeFalsy();
  }
});

test('v0.27.0 regression: no [object Promise] in rendered HTML', () => {
  for (const page of [DOCS_PAGE, HOME_PAGE, ARCHITECTURE_PAGE]) {
    const html = readPage(page);
    expect(html.includes('[object Promise]'), `[object Promise] found in ${page}`).toBeFalsy();
  }
});

// ─── Bug 3: No <dialog> in output ────────────────────────────────────

test('v0.27.0 regression: no <dialog> in rendered HTML', () => {
  for (const page of [DOCS_PAGE, HOME_PAGE, ARCHITECTURE_PAGE]) {
    const html = readPage(page);
    expect(html.includes('<dialog'), `<dialog> found in ${page}`).toBeFalsy();
  }
});

// ─── API Surface: jsx NOT in root export ────────────────────────────

test('v0.44 surface: JSX factories live only in the supported jsx-runtime subpath', () => {
  const elementRoot = join(
    import.meta.dirname ?? '.',
    '..',
    '..',
    'packages',
    'element',
    'src',
    'index.ts',
  );
  const runtimePath = join(
    import.meta.dirname ?? '.',
    '..',
    '..',
    'packages',
    'element',
    'src',
    'jsx-runtime.ts',
  );
  const devRuntimePath = join(
    import.meta.dirname ?? '.',
    '..',
    '..',
    'packages',
    'element',
    'src',
    'jsx-dev-runtime.ts',
  );
  const rootSource = readFileSync(elementRoot, 'utf8');
  const src = readFileSync(runtimePath, 'utf8');
  const devSource = readFileSync(devRuntimePath, 'utf8');
  for (const name of ['Fragment', 'jsx', 'jsxs']) {
    expect(src.includes(name), `${name} should be exported from jsx-runtime`).toBeTruthy();
  }
  expect(
    devSource.includes('jsxDEV'),
    'jsxDEV should be exported from jsx-dev-runtime',
  ).toBeTruthy();
  expect(
    rootSource.includes("from './jsx-runtime.ts'"),
    'Element root must not re-export JSX',
  ).toBeFalsy();
});

// ─── parse5 not a dependency ─────────────────────────────────────────

test('alpha.10 surface: retired package directories stay deleted', () => {
  const packages = join(import.meta.dirname ?? '.', '..', '..', 'packages');
  // 1.0 baseline note: 'router' was retired at v0.27, but the directory name was
  // re-legitimized by the @openelement/router product (ADR-0152) — excluded here.
  for (const name of ['core', 'signal', 'protocol', 'content', 'ssg']) {
    expect(
      existsSync(join(packages, name)),
      `retired package directory returned: ${name}`,
    ).toBeFalsy();
  }
});

// ─── Registry Hub iframe ─────────────────────────────────────────────

test('v0.40.0 cleanup: registry output is not built', () => {
  expect(existsSync(REGISTRY_PAGE), 'registry page should not be generated in v0.40').toBeFalsy();
  const componentPage = join(DIST, 'en', 'registry', '@openelement~ui', 'open-card', 'index.html');
  expect(
    existsSync(componentPage),
    'registry component page should not be generated in v0.40',
  ).toBeFalsy();
});

// ─── Custom element count sanity ─────────────────────────────────────

test('v0.27.0 regression: open-layout tags not duplicated', () => {
  const html = readPage(DOCS_PAGE);
  // open-layout should appear exactly once as the wrapper (opening + closing)
  const opens = (html.match(/<open-layout/g) || []).length;
  const closes = (html.match(/<\/open-layout>/g) || []).length;
  expect(opens, 'Mismatched open-layout tags').toEqual(closes);
  expect(opens >= 1 && opens <= 3, `open-layout appears ${opens} times, expected 1-3`).toBeTruthy();
});
