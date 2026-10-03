/**
 * island-resolution.test.ts — the one package-island specifier → module-path
 * resolution (ADR-0160 rule (d), P6).
 *
 * The client build (`cli/build-client.ts`) and the client asset manifest
 * (`vite/client-asset-manifest.ts`) must resolve an island's declared
 * specifier through ONE mechanism over the same inputs: the deno.json import
 * map, then the same sorted alias table the build ships as `resolve.alias`,
 * then — only when both have no file target — the import-condition
 * node_modules fallback. These tests pin the invariant from both ends:
 * the two consumers give the same answer for every sampled alias-table
 * entry, the fallback answers import conditions (never the require
 * conditions the retired createRequire branch answered), and the manifest
 * join consumes a fallback answer only when the emitted graph confirms it.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from '@std/path';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import {
  resolvePackageIslandSourcePath,
  resolveIslandIdentityPath,
} from '../src/vite/island-resolution.ts';
import { buildClientAssetManifest } from '../src/vite/client-asset-manifest.ts';
import { sortAliasEntries } from '../src/vite/alias-utils.ts';
import { OpenElementError } from '@openelement/element';
import { ClientAssetErrorCode } from '../src/internal/error-codes.ts';
import type { ClientIslandDeliveryEntry } from '../src/vite/internal/ssg/delivery.ts';

function island(overrides: Partial<ClientIslandDeliveryEntry> = {}): ClientIslandDeliveryEntry {
  return {
    tagName: 'open-widget',
    modulePath: '@oe-fixture/widget',
    isPackage: true,
    strategy: 'idle',
    ...overrides,
  };
}

const ENTRY_MANIFEST = {
  'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
};

async function inTempFixture(run: (root: string) => Promise<void>): Promise<void> {
  const created = await mkdtemp(join(tmpdir(), 'oe-island-resolution-'));
  // Node resolution answers realpaths (the module ids a bundler emits), so
  // every fixture path this test expects must be built from the real root —
  // on macOS tmpdir() hands out a /var/... path whose realpath is /private/var.
  const root = await realpath(created);
  try {
    await run(root);
  } finally {
    await rm(created, { recursive: true, force: true });
  }
}

/** A fixture app whose node_modules ships a dual-condition package. */
async function writeDualConditionFixture(root: string): Promise<string> {
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-app' }));
  const pkgDir = join(root, 'node_modules', '@oe-drift-fixture', 'widget-pkg');
  await mkdir(join(pkgDir, 'dist'), { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@oe-drift-fixture/widget-pkg',
      version: '1.0.0',
      exports: {
        '.': { import: './dist/esm.mjs', require: './dist/cjs.cjs' },
        './widget': { import: './dist/esm-widget.mjs', require: './dist/cjs-widget.cjs' },
      },
    }),
  );
  for (const file of ['esm.mjs', 'cjs.cjs', 'esm-widget.mjs', 'cjs-widget.cjs']) {
    await writeFile(join(pkgDir, 'dist', file), '');
  }
  return pkgDir;
}

test('manifest and build resolutions give the same answer for every alias-table sample', async () => {
  await inTempFixture(async (root) => {
    // One import-map entry and two overlapping alias finds: the subpath find
    // must win by specificity order, so any consumer that dropped or reordered
    // the table would answer differently — exactly the drift these samples
    // refuse to admit.
    await writeFile(
      join(root, 'deno.json'),
      JSON.stringify({ imports: { '@maps/thing': './src/thing.ts' } }),
    );
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'thing.ts'), '');
    const uiDir = join(root, 'packages/ui/src');
    await mkdir(uiDir, { recursive: true });
    await writeFile(join(uiDir, 'open-callout.ts'), '');
    // Passed unsorted on purpose: production passes the sortAliasEntries()
    // output the build ships as resolve.alias, and both consumers must apply
    // the same order.
    const aliases = sortAliasEntries([
      { find: '@acme/ui', replacement: uiDir },
      { find: '@acme/ui/open-callout', replacement: join(uiDir, 'open-callout.ts') },
    ]);

    const samples = [
      '@maps/thing', // import map claims it before the alias table
      '@acme/ui/open-callout', // the longer alias find must win
      '@acme/ui/other', // prefix rewrite onto the parent alias
      'unmapped-specifier', // no file target anywhere
    ];
    for (const specifier of samples) {
      const buildSide = resolvePackageIslandSourcePath(root, specifier, aliases);
      const manifestSide = resolveIslandIdentityPath(root, specifier, aliases);
      // The build side and the manifest side share one chain prefix, so
      // every resolvable specifier resolves to the identical path.
      expect(manifestSide ?? null, `manifest resolution for ${specifier}`).toEqual(buildSide);
    }
    // Spot-check the answers the equality is about: the import map, the
    // specificity-ordered alias rewrite, and the no-target null/undefined.
    expect(resolvePackageIslandSourcePath(root, '@maps/thing', aliases)).toEqual(
      join(root, 'src/thing.ts'),
    );
    expect(resolvePackageIslandSourcePath(root, '@acme/ui/open-callout', aliases)).toEqual(
      join(uiDir, 'open-callout.ts'),
    );
    expect(resolvePackageIslandSourcePath(root, 'unmapped-specifier', aliases)).toEqual(null);
    expect(resolveIslandIdentityPath(root, 'unmapped-specifier', aliases)).toEqual(undefined);
  });
});

test('the node fallback answers import conditions, never require conditions', async () => {
  await inTempFixture(async (root) => {
    const pkgDir = await writeDualConditionFixture(root);
    // The client build bundles the import-condition target; the retired
    // createRequire branch answered the require-condition target of the same
    // exports map — a second source of truth that diverges exactly here.
    expect(resolveIslandIdentityPath(root, '@oe-drift-fixture/widget-pkg', [])).toEqual(
      join(pkgDir, 'dist/esm.mjs'),
    );
    expect(resolveIslandIdentityPath(root, '@oe-drift-fixture/widget-pkg/widget', [])).toEqual(
      join(pkgDir, 'dist/esm-widget.mjs'),
    );
    // A specifier no exports map admits stays unresolved (fail-closed), and
    // local identities never enter node resolution.
    expect(resolveIslandIdentityPath(root, '@oe-drift-fixture/widget-pkg/nope', [])).toEqual(
      undefined,
    );
    expect(resolveIslandIdentityPath(root, './relative/island.ts', [])).toEqual(undefined);
    expect(resolveIslandIdentityPath(root, '/app/islands/counter.ts', [])).toEqual(undefined);
  });
});

test('the manifest join consumes the alias-table resolution the build used', async () => {
  await inTempFixture(async (root) => {
    const uiDir = join(root, 'packages/ui/src');
    await mkdir(uiDir, { recursive: true });
    await writeFile(join(uiDir, 'open-callout.ts'), '');
    const aliases = sortAliasEntries([{ find: '@acme/ui', replacement: uiDir }]);
    const buildSide = resolvePackageIslandSourcePath(root, '@acme/ui/open-callout', aliases)!;
    // No sourceFile: the manifest must resolve the declared specifier itself,
    // through the same table. The emitted module id is the aliased path.
    const manifest = buildClientAssetManifest({
      root,
      base: '/',
      islands: [
        {
          entry: island({ tagName: 'open-callout', modulePath: '@acme/ui/open-callout' }),
          sourceFile: null,
        },
      ],
      viteManifest: ENTRY_MANIFEST,
      chunks: [
        {
          fileName: 'islands/island-open-callout-Zz00.js',
          modules: { [buildSide]: {} },
        },
        { fileName: 'islands/client.js', modules: {} },
      ],
      manifestPath: join(root, 'dist/client/.vite/manifest.json'),
      aliases,
    });
    expect(manifest.islands['open-callout'].file).toEqual(
      '/client/islands/island-open-callout-Zz00.js',
    );
  });
});

test('a fallback answer the emitted graph does not confirm cannot satisfy the join', async () => {
  await inTempFixture(async (root) => {
    const pkgDir = await writeDualConditionFixture(root);
    const importTarget = resolveIslandIdentityPath(
      root,
      '@oe-drift-fixture/widget-pkg/widget',
      [],
    )!;
    expect(importTarget).toEqual(join(pkgDir, 'dist/esm-widget.mjs'));
    // The emitted graph carries only the require-condition file — what a
    // require-conditions resolver would have named. The import-condition
    // resolution is not in the graph, the exact identity rule does not match
    // the CJS file either, and the build fails instead of shipping a module
    // the client graph never bundled.
    const error = assertThrowsIncludes(
      () =>
        buildClientAssetManifest({
          root,
          base: '/',
          islands: [
            {
              entry: island({
                tagName: 'open-widget',
                modulePath: '@oe-drift-fixture/widget-pkg/widget',
              }),
              sourceFile: null,
            },
          ],
          viteManifest: ENTRY_MANIFEST,
          chunks: [
            {
              fileName: 'islands/island-open-widget-Zz00.js',
              modules: { [join(pkgDir, 'dist/cjs-widget.cjs')]: {} },
            },
            { fileName: 'islands/client.js', modules: {} },
          ],
          manifestPath: join(root, 'dist/client/.vite/manifest.json'),
        }),
      OpenElementError,
    );
    expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);

    // The confirmed answer is consumed: the import-condition module in the
    // graph attributes the island, and when both condition targets are
    // emitted the import target is the one the join names.
    const both = buildClientAssetManifest({
      root,
      base: '/',
      islands: [
        {
          entry: island({
            tagName: 'open-widget',
            modulePath: '@oe-drift-fixture/widget-pkg/widget',
          }),
          sourceFile: null,
        },
      ],
      viteManifest: ENTRY_MANIFEST,
      chunks: [
        {
          fileName: 'islands/island-open-widget-Es01.js',
          modules: { [importTarget]: {} },
        },
        {
          fileName: 'islands/island-open-widget-Cj02.js',
          modules: { [join(pkgDir, 'dist/cjs-widget.cjs')]: {} },
        },
        { fileName: 'islands/client.js', modules: {} },
      ],
      manifestPath: join(root, 'dist/client/.vite/manifest.json'),
    });
    expect(both.islands['open-widget'].file).toEqual('/client/islands/island-open-widget-Es01.js');
  });
});

test('the fallback preserves the workspace realpath the bundler emits', async () => {
  await inTempFixture(async (root) => {
    // pnpm-style layout: the real package lives outside the app; node_modules
    // carries a symlink. Node resolution (require and import alike) answers
    // the realpath — the module id rolldown emits — so the fallback must too.
    const realDir = join(root, 'store', 'widget-pkg');
    await mkdir(join(realDir, 'dist'), { recursive: true });
    await writeFile(
      join(realDir, 'package.json'),
      JSON.stringify({
        name: '@oe-drift-fixture/widget-pkg',
        version: '1.0.0',
        exports: { './widget': './dist/widget.mjs' },
      }),
    );
    await writeFile(join(realDir, 'dist', 'widget.mjs'), '');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-app' }));
    await mkdir(join(root, 'node_modules', '@oe-drift-fixture'), { recursive: true });
    await symlink(realDir, join(root, 'node_modules', '@oe-drift-fixture', 'widget-pkg'), 'dir');
    expect(resolveIslandIdentityPath(root, '@oe-drift-fixture/widget-pkg/widget', [])).toEqual(
      join(realDir, 'dist/widget.mjs'),
    );
  });
});
