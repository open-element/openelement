/**
 * The island blocks scan (#1548) — the when/each axis of the element entry
 * selection.
 *
 * The scan's fact is the compiler's fact, read through the same generated-lane
 * compile the Vite transform runs: `usesBlocks` (F16) is derived from the
 * function model that compile already lowered, and it replaced the class lane's
 * `program.blocks` when Alpha16 retired that lane. These tests pin the walk
 * over a real fixture tree on disk:
 *
 * - a plain generated island (static tree only) scans blocks-free;
 * - a generated island with a when branch scans blocks-carrying;
 * - the walk follows relative imports (a plain module re-exporting a
 *   blocks-carrying island is caught);
 * - the walk follows resolvable bare imports (a tmp node_modules package
 *   whose generated island lowers a when is caught);
 * - an island specifier that resolves nowhere is inconclusive → the full
 *   runtime stays (the ADR-0155 asymmetry on the second axis);
 * - a module the compiler refuses is inconclusive → the full runtime stays;
 * - a pre-retirement packed package proves its own blocks from the embedded
 *   program, because a packed module has no authoring grammar to recompile;
 * - the emission half: the exact element-entry alias, and its back-off.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, expect, test } from 'vitest';
import {
  elementRuntimeBlocksAlias,
  islandsMightUseBlocks,
} from '../src/vite/internal/ssg/island-blocks-scan.ts';
import type { IslandsBlocksScanInput } from '../src/vite/internal/ssg/island-blocks-scan.ts';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

const tmpRoots: string[] = [];

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'oe-blocks-scan-'));
  tmpRoots.push(root);
  mkdirSync(join(root, 'app/islands'), { recursive: true });
  return root;
}

function writeIsland(root: string, name: string, body: string): void {
  writeFileSync(join(root, `app/islands/${name}`), body);
}

// The scan reads a module's sidecar through the ONE declaration reader and
// compiles it with the generated lane, so every fixture is an authored generated
// island: the sidecar is the lane's identity and the default-exported function is
// what the lane lowers (and what carries the when/each nodes `usesBlocks`
// reports). Each sidecar pins its tag because the scan passes NO path fallback to
// that reader — a conventional island's tag comes from its path, and the reader
// answers "absent" for it, so an untagged island never reaches the compile at
// all. That gap is the scan's, not the authoring model's; these fixtures pin the
// declared-identity case the scan currently admits.
const SIDECAR = [
  "import { defineIslandConfig } from '@openelement/router';",
  "export const openElement = defineIslandConfig({ hydrate: 'idle', tag: 'scan-island' });",
].join('\n');

const PLAIN_ISLAND = [
  SIDECAR,
  'function ScanPlain() {',
  '  return <div>plain</div>;',
  '}',
  'export default ScanPlain;',
].join('\n');

// The property table is what admits the props parameter: the generated lane
// refuses a props parameter that no declared row replaces (D-props), so the
// when test reads a declared value instead of an invented fixture state.
const REGIONS_ISLAND = [
  "import { defineIslandConfig } from '@openelement/router';",
  'export const openElement = defineIslandConfig({',
  "  hydrate: 'idle',",
  "  tag: 'scan-blocks',",
  '  properties: { visible: { default: 1 } },',
  '});',
  'function ScanBlocks(props: { visible: number }) {',
  '  return <div>{props.visible > 0 ? <p>on</p> : <em>off</em>}</div>;',
  '}',
  'export default ScanBlocks;',
].join('\n');

// Spread attributes are outside the admitted grammar (OEC9042): the lane fails
// closed with a source-located diagnostic instead of returning a model, so the
// module's block truth is unknown to the scan.
const UNSUPPORTED_GRAMMAR_ISLAND = [
  SIDECAR,
  'function ScanBroken() {',
  '  const rest = {};',
  '  return <div {...rest}></div>;',
  '}',
  'export default ScanBroken;',
].join('\n');

function scan(root: string, overrides: Partial<IslandsBlocksScanInput> = {}): boolean {
  return islandsMightUseBlocks({
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

test('#1548: a plain generated island (static tree only) scans blocks-free', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', PLAIN_ISLAND);
  expect(scan(root)).toBe(false);
});

test('#1548: a generated island with a when branch scans blocks-carrying', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', REGIONS_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: the walk follows relative imports to a blocks-carrying module', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', `import './blocks-el.tsx';\n${PLAIN_ISLAND}`);
  // .tsx: the compiler admits .tsx modules only, so a blocks-carrying helper
  // is one — the walk compiles it through the same admission.
  writeIsland(root, 'blocks-el.tsx', REGIONS_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: the walk follows resolvable bare imports (package island with a when)', () => {
  const root = makeApp();
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
  // Spread attributes are outside the admitted grammar (OEC9042): the lane
  // fails closed with a diagnostic instead of returning a model, so its block
  // truth is unknown and the scan keeps the full runtime instead of guessing.
  writeIsland(root, 'scan-island.tsx', UNSUPPORTED_GRAMMAR_ISLAND);
  expect(scan(root)).toBe(true);
});

test('#1548: a plain .ts island with no compiled module scans blocks-free', () => {
  const root = makeApp();
  writeIsland(root, 'scan-island.ts', 'export const answer = 42;\n');
  expect(
    scan(root, { islandFiles: ['scan-island.ts'] }),
    'only a compiled island can carry when/each nodes',
  ).toBe(false);
});

test('#1548: the walk follows an extensionless relative import to a .ts helper', () => {
  // The bundler resolves `./helper` against `helper.ts`; the walk must too, or
  // the module's own import closure (and the when Block behind it) is invisible
  // and the scan answers blocks-free for a graph that executes a Block.
  const root = makeApp();
  writeIsland(root, 'scan-island.tsx', `import './helper';\n${PLAIN_ISLAND}`);
  writeIsland(root, 'helper.ts', `import './blocks-el.tsx';\nexport const helper = 1;\n`);
  writeIsland(root, 'blocks-el.tsx', REGIONS_ISLAND);
  expect(scan(root)).toBe(true);
});

test('alpha15: a pre-compiled package island with an embedded Block scans blocks-carrying', () => {
  // A packed install ships COMPILED modules: the program rides as embedded
  // JSON the authoring compile cannot re-derive (it sees no sidecar and no
  // grammar, so it returns null). The alpha15 packaged-consumer appliance
  // broke exactly here — open-button's new when Block was invisible to the
  // scan, the build aliased the blocks-free element entry, and every Block
  // Part failed closed in the browser. Alpha16 retired the compiler lane that
  // emitted this banner, but published pre-retirement packages still carry it
  // in consumers' node_modules, so the scan's one-directional text proof is
  // live and pinned here; absence is still only proven from authoring sources.
  const root = makeApp();
  mkdirSync(join(root, 'node_modules/packed-ui'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/packed-ui/package.json'),
    JSON.stringify({ name: 'packed-ui', main: 'index.js' }),
  );
  writeFileSync(
    join(root, 'node_modules/packed-ui/index.js'),
    [
      "import { OpenElement } from '@openelement/element';",
      '// Compiled output: the program is data, not authoring grammar.',
      'const __partProgram = {',
      '\t"version": 2,',
      '\t"tag": "packed-el",',
      '\t"blocks": [{ "id": "r7", "index": 7, "kind": "when" }],',
      '};',
      'export class PackedEl extends OpenElement {}',
      '',
    ].join('\n'),
  );
  writeIsland(root, 'scan-island.tsx', `import 'packed-ui';\n${PLAIN_ISLAND}`);
  expect(scan(root, { islandFiles: ['scan-island.tsx'] })).toBe(true);
});

test('alpha15: a pre-compiled package island with empty blocks scans blocks-free', () => {
  const root = makeApp();
  mkdirSync(join(root, 'node_modules/packed-plain'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/packed-plain/package.json'),
    JSON.stringify({ name: 'packed-plain', main: 'index.js' }),
  );
  writeFileSync(
    join(root, 'node_modules/packed-plain/index.js'),
    [
      "import { OpenElement } from '@openelement/element';",
      'const __partProgram = {',
      '\t"version": 2,',
      '\t"tag": "packed-plain-el",',
      '\t"blocks": [],',
      '};',
      'export class PackedPlainEl extends OpenElement {}',
      '',
    ].join('\n'),
  );
  writeIsland(root, 'scan-island.tsx', `import 'packed-plain';\n${PLAIN_ISLAND}`);
  expect(scan(root, { islandFiles: ['scan-island.tsx'] })).toBe(false);
});

// #1548: the emission half — the client build's exact element-entry alias.

test('#1548: the alias resolves the element entry to its no-blocks sibling', () => {
  const alias = elementRuntimeBlocksAlias(REPO_ROOT, []);
  expect(alias).toBeTruthy();
  expect(alias!.find.test('@openelement/element'), 'the bare specifier is rewritten').toBe(true);
  expect(
    alias!.find.test('@openelement/element/authoring'),
    'subpaths keep their own exports',
  ).toBe(false);
  expect(alias!.replacement.replace(/\\/g, '/')).toMatch(/no-blocks\.ts$/);
});

test('#1548: the alias backs off when the app aliases the element package itself', () => {
  expect(
    elementRuntimeBlocksAlias(REPO_ROOT, [{ find: '@openelement/element', replacement: '/x.ts' }]),
  ).toBeUndefined();
  expect(
    elementRuntimeBlocksAlias(REPO_ROOT, [{ find: /^@openelement/, replacement: '/x.ts' }]),
  ).toBeUndefined();
  expect(
    elementRuntimeBlocksAlias(REPO_ROOT, [{ find: /^@acme\//, replacement: '/x.ts' }]),
  ).toBeTruthy();
});

test('#1548: the alias backs off when the element package cannot be resolved', () => {
  // Resolution is injectable: a resolver that throws stands in for an app
  // root whose element specifier resolves nowhere (the vitest module runner
  // anchors bare-specifier resolution at the workspace, so an fs fixture
  // cannot produce this failure here).
  expect(
    elementRuntimeBlocksAlias(REPO_ROOT, [], () => {
      throw Object.assign(new Error('MODULE_NOT_FOUND'), { code: 'MODULE_NOT_FOUND' });
    }),
  ).toBeUndefined();
});

test('#1548: the alias backs off when the no-blocks sibling is missing', () => {
  // A resolved entry whose package layout carries no no-blocks entry (an
  // older install) keeps the default resolution.
  expect(
    elementRuntimeBlocksAlias(REPO_ROOT, [], () => '/nowhere/element/src/index.ts'),
  ).toBeUndefined();
});
