/**
 * @openelement/router — the scan-time AUTO package admission derivation
 * (alpha15 auto-admission ruling).
 *
 * The admitted set is derived from the app's REAL module graph: the shared
 * resolver walk starts at the app's page routes, islands and layout modules,
 * and every reached package-owned element module attributes itself to its
 * owner package. The matrix this suite pins, on a temp app with a real
 * installed package layout and a resolver double (the scanner's unit contract;
 * production resolution is the bundler's, and the build-level proof lives in
 * `package-import-admission-probe.test.ts`):
 *
 *   an imported package element module  → derived, manifest admitted
 *   a pure utility import               → nothing derived, nothing reported
 *   an owner without a manifest         → the manifest-less warning class
 *   an owner with a BROKEN manifest     → coded failure (PACKAGE_MANIFEST_ERROR)
 *   two derived owners, one tag         → coded conflict (explicit fix named)
 *   an explicit owner on a shared tag   → explicit wins, derived yields
 *   a dynamic-only import               → reported unproven, never admitted
 *   a layout-imported component         → derived (layouts are seeds)
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { statSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import type { RouteEntry } from '@openelement/protocol/framework';
import {
  deriveAdmittedPackages,
  mergeAdmittedManifests,
} from '../src/vite/internal/ssg/derived-admission.ts';
import type { ModuleWalkResolver } from '../src/vite/internal/module-graph-walk.ts';
import { PackageAdmissionErrorCode } from '../src/internal/error-codes.ts';
import { loadPackageManifest } from '../src/vite/internal/ssg/island-scanner.ts';
import { admittedTailwindDeclarations } from '../src/vite/internal/ssg/island-scanner.ts';
import { resolveStylePlan } from '../src/vite/internal/style-plan.ts';
import { PresetErrorCode } from '../src/internal/error-codes.ts';
import { realpathSync } from 'node:fs';

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function write(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source, 'utf8');
}

/**
 * One app plus one installed component package (`@acme/ui`, an element module
 * with a `./manifest` subpath — the ordinary tarball-install shape).
 */
async function appWithPackage(
  options: {
    widgetImport?: string;
    body?: string;
    manifest?: object | null;
    layout?: string;
    island?: string;
    dynamicImport?: string;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oe-derived-admission-'));
  roots.push(root);
  await write(root, 'package.json', JSON.stringify({ name: 'unit-app', private: true }));
  const imports = [
    options.widgetImport === undefined ? "import '@acme/ui/widget';" : options.widgetImport,
  ];
  await write(
    root,
    'app/routes/index.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      ...imports,
      '',
      "@element('index-page', { root: 'shadow-open' })",
      'export default class IndexPage extends OpenElement {',
      '  render() {',
      `    return <main>${options.body ?? '<acme-widget>x</acme-widget>'}</main>;`,
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  if (options.layout !== undefined) {
    await write(
      root,
      'app/layout.tsx',
      [
        "import { element, OpenElement } from '@openelement/element';",
        ...(options.layout === '' ? [] : [options.layout]),
        '',
        "@element('app-layout', { root: 'shadow-open' })",
        'export default class AppLayout extends OpenElement {',
        '  render() { return <slot />; }',
        '}',
        '',
      ].join('\n'),
    );
  }
  if (options.island !== undefined) {
    await write(
      root,
      'app/islands/counter.tsx',
      [
        "import { element, OpenElement } from '@openelement/element';",
        ...(options.island === '' ? [] : [options.island]),
        '',
        "@element('open-counter', { root: 'shadow-open' })",
        'export default class Counter extends OpenElement {',
        '  render() { return <slot />; }',
        '}',
        '',
      ].join('\n'),
    );
  }
  if (options.dynamicImport !== undefined) {
    // The dynamic import replaces the static one: the module is reached ONLY
    // dynamically, exactly the shape the static contract cannot prove.
    await write(
      root,
      'app/routes/dynamic.tsx',
      [
        "import { element, OpenElement } from '@openelement/element';",
        '',
        "@element('dynamic-page', { root: 'shadow-open' })",
        'export default class DynamicPage extends OpenElement {',
        '  async load() {',
        `    return import('${options.dynamicImport}');`,
        '  }',
        '  render() { return <main>dynamic</main>; }',
        '}',
        '',
      ].join('\n'),
    );
  }
  await writeComponentPackage(root, '@acme/ui', {
    manifest: options.manifest === undefined ? undefined : options.manifest,
  });
  return root;
}

/** One installed package with an element module (named export, like @openelement/ui). */
async function writeComponentPackage(
  root: string,
  packageName: string,
  options: { tagName?: string; manifest?: object | null; broken?: boolean } = {},
): Promise<void> {
  const tag = options.tagName ?? 'acme-widget';
  await write(
    root,
    ['node_modules', ...packageName.split('/'), 'package.json'].join('/'),
    JSON.stringify({
      name: packageName,
      version: '1.0.0',
      type: 'module',
      exports: { './widget': './src/widget.tsx', './manifest': './manifest.js' },
    }),
  );
  await write(
    root,
    ['node_modules', ...packageName.split('/'), 'src', 'widget.tsx'].join('/'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      `@element('${tag}', { root: 'shadow-open' })`,
      'export class AcmeWidget extends OpenElement {',
      '  render() { return <span>acme</span>; }',
      '}',
      '',
    ].join('\n'),
  );
  const manifest =
    options.manifest === null
      ? undefined
      : (options.manifest ?? {
          packageName,
          declarations: [
            {
              tagName: tag,
              className: 'AcmeWidget',
              openElement: { module: `${packageName}/widget`, ssr: true, dsd: true },
            },
          ],
        });
  if (manifest !== undefined) {
    await write(
      root,
      ['node_modules', ...packageName.split('/'), 'manifest.js'].join('/'),
      `export const manifest = ${JSON.stringify(manifest)};\n`,
    );
  }
}

/**
 * The resolver double: relative specifiers with extension probing, plus bare
 * package specifiers through the app's own node_modules (the unit contract —
 * production resolution is the bundler's).
 */
function resolverFor(root: string): ModuleWalkResolver {
  const probe = (base: string): string | undefined => {
    const candidates = ['.tsx', '.ts', '.jsx', '.js', ''].map((extension) => base + extension);
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // keep probing
      }
    }
    return undefined;
  };
  return {
    resolve(specifier: string, importer?: string) {
      if (specifier.startsWith('.')) {
        if (importer === undefined) return Promise.resolve(null);
        const id = probe(resolvePath(dirname(importer), specifier));
        return Promise.resolve(id === undefined ? null : { id });
      }
      // The element package resolves into the monorepo checkout (the
      // workspace-link shape): outside the app root, owned by its own package.
      if (specifier === '@openelement/element') {
        const id = probe(join(REPO_ROOT, 'packages', 'element', 'src', 'index.ts'));
        return Promise.resolve(id === undefined ? null : { id });
      }
      const segments = specifier.split('/');
      const parts = segments[0]!.startsWith('@')
        ? segments
        : [...segments.slice(0, 1), ...segments.slice(1)];
      let id = probe(join(root, 'node_modules', ...parts));
      // The packages' exports map spells './widget' → './src/widget.tsx'; the
      // double honors that one hop.
      if (id === undefined) {
        const inSrc = [...parts.slice(0, -1), 'src', ...parts.slice(-1)];
        id = probe(join(root, 'node_modules', ...inSrc));
      }
      return Promise.resolve(id === undefined ? null : { id });
    },
  };
}

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');

const ROUTES: RouteEntry[] = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex' },
];

function deriveInput(
  root: string,
  overrides: Partial<Parameters<typeof deriveAdmittedPackages>[0]> = {},
) {
  return {
    root,
    resolve: resolverFor(root),
    routes: ROUTES,
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandFiles: [],
    ...overrides,
  };
}

test('an imported package element module derives its owner and admits the manifest', async () => {
  const root = await appWithPackage();
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/ui']);
  expect(derived.manifestLess).toEqual([]);
  expect(derived.dynamicUnproven).toEqual([]);
});

test('a pure utility import derives nothing and reports nothing', async () => {
  const root = await appWithPackage({ widgetImport: "import '@acme/ui/missing-helper';" });
  // The helper does not exist: the resolver misses it, so the graph never
  // reaches the package and there is no component fact to derive or report.
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests).toEqual([]);
  expect(derived.manifestLess).toEqual([]);
});

test('a package module that defines no element derives nothing', async () => {
  // The package resolves and the module is read, but it is a plain helper —
  // the compiler's own facts say so, not an import-list guess.
  const root = await appWithPackage({ widgetImport: "import '@acme/ui/widget';" });
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'src', 'widget.tsx'].join('/'),
    'export const helper = 1;\n',
  );
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests).toEqual([]);
  expect(derived.manifestLess).toEqual([]);
});

test('an owner with no manifest is the manifest-less class', async () => {
  const root = await appWithPackage({ manifest: null });
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests).toEqual([]);
  expect(
    derived.manifestLess.map((entry) => [entry.packageName, entry.reason]),
    'the owner is named with the reason',
  ).toEqual([['@acme/ui', 'does not export a manifest']]);
});

test('a manifest that is TypeScript under node_modules is manifest-less, not a failure', async () => {
  // Node refuses to strip types under node_modules; a package shipping only a
  // TypeScript manifest inside an install directory cannot be loaded by a
  // node-host scan (the published artifact stages a compiled manifest), so it
  // classifies as manifest-less with the accurate reason — never transport.
  const root = await appWithPackage({ manifest: null });
  await rm(join(root, 'node_modules', '@acme', 'ui', 'package.json'), { force: true });
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'package.json'].join('/'),
    JSON.stringify({
      name: '@acme/ui',
      version: '1.0.0',
      type: 'module',
      exports: { './widget': './src/widget.tsx', './manifest': './src/manifest.ts' },
    }),
  );
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'src', 'manifest.ts'].join('/'),
    'export const manifest = { packageName: "@acme/ui", declarations: [] };\n',
  );
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests).toEqual([]);
  expect(derived.manifestLess[0]?.packageName).toEqual('@acme/ui');
  expect(derived.manifestLess[0]?.reason).toMatch(/node-host scan cannot load/);
});

test('an owner with a broken manifest fails closed with the manifest code', async () => {
  const root = await appWithPackage({
    manifest: { declarations: [{ tagName: 'acme-widget' }] }, // no packageName
  });
  let code: string | undefined;
  try {
    await deriveAdmittedPackages(deriveInput(root));
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  expect(code, 'a present-but-broken manifest is a coded failure').toEqual(
    'PACKAGE_MANIFEST_ERROR',
  );
});

test('the loader anchors at the app root, not at this package’s install location', async () => {
  // The workspace checkout resolves bare imports from the MONOREPO root, where
  // the app-local package does not exist; the app-rooted anchor must answer.
  const root = await appWithPackage();
  const anchored = await loadPackageManifest('@acme/ui', { from: root });
  expect(anchored.status).toEqual('ok');
});

test('two derived owners claiming one tag fail closed with the conflict code', async () => {
  const root = await appWithPackage({
    widgetImport: "import '@acme/ui/widget';\nimport '@acme/other/widget';",
    body: '<acme-widget>x</acme-widget>',
  });
  await writeComponentPackage(root, '@acme/other', { tagName: 'acme-widget' });
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests.map((manifest) => manifest.packageName).sort()).toEqual([
    '@acme/other',
    '@acme/ui',
  ]);
  let code: string | undefined;
  let message = '';
  try {
    mergeAdmittedManifests({ explicit: [], derived: derived.manifests });
  } catch (error) {
    code = (error as { code?: string }).code;
    message = (error as Error).message;
  }
  expect(code, 'the ambiguity is a coded build failure').toEqual(
    PackageAdmissionErrorCode.TAG_CONFLICT,
  );
  expect(message, 'the diagnostic names both owners and the explicit fix').toContain('@acme/other');
  expect(message).toContain('packageIslands');
});

test('an explicit owner outranks a derived claim on a shared tag', async () => {
  const root = await appWithPackage({
    widgetImport: "import '@acme/ui/widget';\nimport '@acme/other/widget';",
    body: '<acme-widget>x</acme-widget>',
  });
  await writeComponentPackage(root, '@acme/other', { tagName: 'acme-widget' });
  const derived = await deriveAdmittedPackages(deriveInput(root));
  const explicitManifest = derived.manifests.find(
    (manifest) => manifest.packageName === '@acme/other',
  )!;
  const merged = mergeAdmittedManifests({
    explicit: [explicitManifest],
    derived: derived.manifests,
  });
  expect(merged.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/other']);
  expect(merged.yielded).toEqual([{ packageName: '@acme/ui', tags: ['acme-widget'] }]);
});

test('a dynamic-only import is reported unproven, never admitted', async () => {
  const root = await appWithPackage({
    widgetImport: "import '@openelement/element';",
    dynamicImport: '@acme/ui/widget',
  });
  const derived = await deriveAdmittedPackages(
    deriveInput(root, {
      routes: [
        ...ROUTES,
        { path: '/dynamic', filePath: 'dynamic.tsx', type: 'page', varName: 'pageDynamic' },
      ],
    }),
  );
  expect(derived.manifests, 'a dynamic import is not static proof').toEqual([]);
  expect(
    derived.dynamicUnproven.map((entry) => entry.packageName),
    'the unprovable reach is named with the explicit fix',
  ).toEqual(['@acme/ui']);
});

test('a layout-imported package component derives (layouts are seeds)', async () => {
  const root = await appWithPackage({
    widgetImport: "import '@openelement/element';",
    layout: "import '@acme/ui/widget';",
  });
  const derived = await deriveAdmittedPackages(
    deriveInput(root, { layout: { import: './app/layout.tsx' } }),
  );
  expect(derived.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/ui']);
});

test('an island-imported package component derives (islands are seeds)', async () => {
  const root = await appWithPackage({
    widgetImport: "import '@openelement/element';",
    island: "import '@acme/ui/widget';",
  });
  const derived = await deriveAdmittedPackages(deriveInput(root, { islandFiles: ['counter.tsx'] }));
  expect(derived.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/ui']);
});

test("the app's own modules never derive a package", async () => {
  // An app-local component (no package owner above it but the app itself) is
  // the static-component scan's input, never a package island.
  const root = await appWithPackage({ widgetImport: "import '../components/local.tsx';" });
  await write(
    root,
    'app/components/local.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('local-widget', { root: 'shadow-open' })",
      'export class LocalWidget extends OpenElement {}',
      '',
    ].join('\n'),
  );
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests).toEqual([]);
  expect(derived.manifestLess).toEqual([]);
});

test('the element package itself is not derived by an ordinary base-class import', async () => {
  const root = await appWithPackage();
  // The page imports '@openelement/element' (walked, outside root) — the
  // package defines no element module and exports no manifest, so nothing is
  // derived and nothing is reported.
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/ui']);
  expect(derived.manifestLess).toEqual([]);
});

test('symlinked node_modules layouts are resolved as installed files', async () => {
  // The workspace-link layout: the package dir is a symlink to elsewhere. The
  // derivation owns the resolved id, so the manifest load must anchor at the
  // app and the identity walk must not depend on the link spelling.
  const root = await appWithPackage();
  const realPackage = await mkdtemp(join(tmpdir(), 'oe-derived-link-'));
  roots.push(realPackage);
  const { cpSync, rmSync } = await import('node:fs');
  cpSync(join(root, 'node_modules', '@acme', 'ui'), join(realPackage, 'ui'), {
    recursive: true,
  });
  rmSync(join(root, 'node_modules', '@acme', 'ui'), { recursive: true, force: true });
  await symlink(join(realPackage, 'ui'), join(root, 'node_modules', '@acme', 'ui'));
  const derived = await deriveAdmittedPackages(deriveInput(root));
  expect(derived.manifests.map((manifest) => manifest.packageName)).toEqual(['@acme/ui']);
});

// ─── fail-closed guards ride the DERIVED chain (ADR-0167 ownership) ───
//
// Auto admission changes WHO declared the requirement (the scan derived it,
// not the app's list) and nothing else: the declared-tailwind contract's
// coded refusals fire exactly as they do for an explicit list. The compile-
// level refusal itself is pinned on the provider (style-provider.test.ts) and
// on the packed consumer; these pin the CHAIN from derived facts to plan.

/** One derived manifest with a declared Tailwind requirement, as the scan admits it. */
async function derivedFacts(root: string) {
  const derived = await deriveAdmittedPackages(deriveInput(root));
  const islandDecls = derived.manifests.flatMap((manifest) =>
    manifest.declarations.map((declaration) => ({ tagName: declaration.tagName })),
  );
  return admittedTailwindDeclarations(derived.manifests, islandDecls);
}

test('a derived requirement still fails closed when the app disables the entry', async () => {
  const root = await appWithPackage({
    manifest: {
      packageName: '@acme/ui',
      declarations: [
        {
          tagName: 'acme-widget',
          className: 'AcmeWidget',
          openElement: {
            module: '@acme/ui/widget',
            ssr: true,
            dsd: true,
            tailwind: { required: true, sources: ['./src/theme.css'] },
          },
        },
      ],
    },
  });
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'src', 'theme.css'].join('/'),
    '@theme { --color-primary: red; }\n',
  );
  const facts = await derivedFacts(realpathSync(root));
  expect(facts, 'the derived declaration carries the requirement').toEqual([
    {
      packageName: '@acme/ui',
      tagName: 'acme-widget',
      required: true,
      dialect: 'tailwind4',
      sources: ['./src/theme.css'],
    },
  ]);
  let code: string | undefined;
  let message = '';
  try {
    resolveStylePlan({ root: realpathSync(root), tailwind: false, declarations: facts });
  } catch (error) {
    code = (error as { code?: string }).code;
    message = (error as Error).message;
  }
  expect(code, 'derived or explicit, disablement is a coded failure').toEqual(
    PresetErrorCode.TAILWIND_REQUIRED_DISABLED,
  );
  expect(message, 'the diagnostic names the derived owner').toContain('@acme/ui <acme-widget>');
});

test('a derived `@theme` source reaches the plan under the engine that cannot compile it', async () => {
  // The refusal itself (OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE) fires at
  // the provider compile and is pinned there plus on the packed consumer; the
  // chain pin is that a DERIVED requirement produces the same plan shape the
  // explicit path does — provider unocss, owner source first — so auto
  // admission cannot route around the refusal.
  const root = await appWithPackage({
    manifest: {
      packageName: '@acme/ui',
      declarations: [
        {
          tagName: 'acme-widget',
          className: 'AcmeWidget',
          openElement: {
            module: '@acme/ui/widget',
            ssr: true,
            dsd: true,
            tailwind: { required: true, sources: ['./src/theme.css'] },
          },
        },
      ],
    },
  });
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'src', 'theme.css'].join('/'),
    '@theme { --color-primary: red; }\n',
  );
  const facts = await derivedFacts(realpathSync(root));
  const plan = resolveStylePlan({
    root: realpathSync(root),
    tailwind: undefined,
    unocss: true,
    declarations: facts,
  });
  expect(plan?.provider).toEqual('unocss');
  expect(plan?.theme).toEqual([join(realpathSync(root), 'node_modules/@acme/ui/src/theme.css')]);
});
