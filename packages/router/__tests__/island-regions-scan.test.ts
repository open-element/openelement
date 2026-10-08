/**
 * The island regions scan (#1548) — the compiler-owned regions axis of the
 * element entry selection.
 *
 * The scan's fact is the compiler's fact (`program.regions`), read through
 * the same public `compileElementModule` the Vite transform runs. These tests
 * pin the walk over a real fixture tree on disk:
 *
 * - a plain compiled island (fixed Parts only) scans regions-free;
 * - a compiled island with a conditional Region scans regions-carrying;
 * - the walk follows relative imports (a plain module re-exporting a
 *   regions-carrying island is caught);
 * - the walk follows resolvable bare imports (a tmp node_modules package
 *   whose element lowers a Region is caught);
 * - an island specifier that resolves nowhere is inconclusive → the full
 *   runtime stays (the ADR-0155 asymmetry on the second axis);
 * - a module the compiler rejects is inconclusive → the full runtime stays.
 */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, expect, test } from 'vitest';
import {
  elementRuntimeRegionsAlias,
  islandsMightUseRegions,
} from '../src/vite/internal/ssg/island-regions-scan.ts';
import type { IslandsRegionsScanInput } from '../src/vite/internal/ssg/island-regions-scan.ts';

const ELEMENT_PACKAGE_ROOT = new URL('../../packages/element', import.meta.url).pathname;
const REPO_ROOT = new URL('../..', import.meta.url).pathname;

const tmpRoots: string[] = [];

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'oe-regions-scan-'));
  tmpRoots.push(root);
  mkdirSync(join(root, 'app/islands'), { recursive: true });
  return root;
}

/** The @openelement/element package must resolve from the tmp app for bare-import walking. */
function linkElementPackage(root: string): void {
  mkdirSync(join(root, 'node_modules/@openelement'), { recursive: true });
  symlinkSync(ELEMENT_PACKAGE_ROOT, join(root, 'node_modules/@openelement/element'), 'dir');
}

function writeIsland(root: string, name: string, body: string): void {
  writeFileSync(join(root, `app/islands/${name}`), body);
}

const PLAIN_ISLAND = [
  "import { element, OpenElement } from '@openelement/element';",
  "@element('oe-scan-plain')",
  'export class ScanPlain extends OpenElement {',
  '  render() {',
  '    return <div>plain</div>;',
  '  }',
  '}',
].join('\n');

const REGIONS_ISLAND = [
  "import { element, OpenElement, property } from '@openelement/element';",
  "@element('oe-scan-regions')",
  'export class ScanRegions extends OpenElement {',
  '  @property({ reflect: false }) visible = 1;',
  '  render() {',
  '    return <div>{this.visible > 0 ? <p>on</p> : <em>off</em>}</div>;',
  '  }',
  '}',
].join('\n');

const UNSUPPORTED_GRAMMAR_ISLAND = [
  "import { element, OpenElement } from '@openelement/element';",
  "@element('oe-scan-broken')",
  'export class ScanBroken extends OpenElement {',
  '  render() {',
  '    const rest = {};',
  '    return <div {...rest}></div>;',
  '  }',
  '}',
].join('\n');

function scan(root: string, overrides: Partial<IslandsRegionsScanInput> = {}): boolean {
  return islandsMightUseRegions({
    root,
    islandsDir: 'app/islands',
    islandTagNames: ['scan-island'],
    islandFiles: ['scan-island.tsx'],
    packageIslandDecls: [],
    ...overrides,
  });
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

test('#1548: a plain island (fixed Parts only) scans regions-free', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', PLAIN_ISLAND);
  expect(scan(root)).toBe(false);
});

test('#1548: an island with a conditional Region scans regions-carrying', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', REGIONS_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: the walk follows relative imports to a regions-carrying module', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', `import './regions-el.tsx';\n${PLAIN_ISLAND}`);
  // .tsx: the compiler admits .tsx modules only, so a regions-carrying helper
  // is one — the walk compiles it through the same admission.
  writeIsland(root, 'regions-el.tsx', REGIONS_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: the walk follows resolvable bare imports (package element with a Region)', () => {
  const root = makeApp();
  linkElementPackage(root);
  mkdirSync(join(root, 'node_modules/app-lib'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/app-lib/package.json'),
    JSON.stringify({ name: 'app-lib', main: 'index.tsx' }),
  );
  writeFileSync(join(root, 'node_modules/app-lib/index.tsx'), REGIONS_ISLAND);
  writeIsland(root, 'scan-island.tsx', `import 'app-lib';\n${PLAIN_ISLAND}`);
  expect(scan(root)).toBe(true);
});

test('#1548: an unresolvable package island is inconclusive (full runtime stays)', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', PLAIN_ISLAND);
  expect(
    scan(root, {
      islandTagNames: [],
      islandFiles: [],
      packageIslandDecls: [
        {
          tagName: 'x-pkg',
          modulePath: '@nowhere/does-not-exist/island',
        } as never,
      ],
    }),
  ).toBe(true);
});

test('#1548: a module the compiler rejects is inconclusive (full runtime stays)', () => {
  const root = makeApp();
  // Spread attributes are outside the compiler grammar (OEC9011): the module
  // compiles to a diagnostic, not a program, so its region truth is unknown
  // and the scan keeps the full runtime instead of guessing.
  writeIsland(root, 'scan-island.tsx', UNSUPPORTED_GRAMMAR_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: a plain .ts island with no compiled module scans regions-free', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.ts', 'export const answer = 42;\n');
  expect(
    scan(root, { islandFiles: ['scan-island.ts'] }),
    'only compiler output can carry Region Parts',
  ).toBe(false);
});

// #1548: the emission half — the client build's exact element-entry alias.

test('#1548: the alias resolves the element entry to its no-regions sibling', () => {
  const alias = elementRuntimeRegionsAlias(REPO_ROOT, []);
  expect(alias).toBeTruthy();
  expect(alias!.find.test('@openelement/element'), 'the bare specifier is rewritten').toBe(true);
  expect(
    alias!.find.test('@openelement/element/authoring'),
    'subpaths keep their own exports',
  ).toBe(false);
  expect(alias!.replacement.replace(/\\/g, '/')).toMatch(/no-regions\.ts$/);
});

test('#1548: the alias backs off when the app aliases the element package itself', () => {
  expect(
    elementRuntimeRegionsAlias(REPO_ROOT, [{ find: '@openelement/element', replacement: '/x.ts' }]),
  ).toBeUndefined();
  expect(
    elementRuntimeRegionsAlias(REPO_ROOT, [{ find: /^@openelement/, replacement: '/x.ts' }]),
  ).toBeUndefined();
  expect(
    elementRuntimeRegionsAlias(REPO_ROOT, [{ find: /^@acme\//, replacement: '/x.ts' }]),
  ).toBeTruthy();
});

test('#1548: the alias backs off when the element package cannot be resolved', () => {
  // Resolution is injectable: a resolver that throws stands in for an app
  // root whose element specifier resolves nowhere (the vitest module runner
  // anchors bare-specifier resolution at the workspace, so an fs fixture
  // cannot produce this failure here).
  expect(
    elementRuntimeRegionsAlias(REPO_ROOT, [], () => {
      throw Object.assign(new Error('MODULE_NOT_FOUND'), { code: 'MODULE_NOT_FOUND' });
    }),
  ).toBeUndefined();
});

test('#1548: the alias backs off when the no-regions sibling is missing', () => {
  // A resolved entry whose package layout carries no no-regions entry (an
  // older install) keeps the default resolution.
  expect(
    elementRuntimeRegionsAlias(REPO_ROOT, [], () => '/nowhere/element/src/index.ts'),
  ).toBeUndefined();
});
