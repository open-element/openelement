/**
 * @openelement/router — declared style compilation (ADR-0167).
 *
 * Demand for the Tailwind pipeline is a DECLARED fact: an admitted package
 * declaration says "my components need the compile" and owns the sources that
 * compile with them; the application's own `tailwind` declaration decides
 * enablement. Nothing here inspects class strings — `btn` and `p-4` are
 * opaque to the framework, and the official compiler owns utility semantics.
 *
 * The matrix this suite pins, on a REAL installed-package layout (temp package
 * dirs + a package.json `files`-style on-disk source):
 *
 *   undefined + declaration      → enabled, declared sources only, NO document reset
 *   undefined + no declaration   → undefined: no peer load, no compile, no resource
 *   true                         → enabled, declared sources only, document reset ON
 *   { theme }                    → declared sources first, then the application's, reset ON
 *   false + no requirement       → undefined
 *   false + required             → fails closed, naming the package and tag
 *   duplicate sources            → one entry (resolved-identity dedup)
 *   conflicting themes           → deterministic order (package, then tag)
 *   malformed / non-relative / missing declared source → coded diagnostics
 */

import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { PackageIslandErrorCode, PresetErrorCode } from '../src/internal/error-codes.ts';
import { type DeclaredStyleSource, resolveStylePlan } from '../src/vite/internal/style-plan.ts';
import { admittedTailwindDeclarations } from '../src/vite/internal/ssg/island-scanner.ts';
import type { OpenElementPackageManifest } from '@openelement/protocol/manifest';

/** The coded diagnostic one failing plan raises (errors classify by code, not text). */
async function errorCodeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/**
 * An app root with one installed package (`@acme/widgets`) whose manifest
 * subpath resolves and whose declared sources sit on disk — the layout a
 * tarball install has.
 */
async function appWithPackage(options: {
  packageName?: string;
  sources?: Record<string, string>;
  manifestTailwind?: { required?: boolean; sources?: string[] };
  declarations?: { tagName: string; tailwind?: unknown }[];
}): Promise<{ root: string; packageRoot: string }> {
  const created = await mkdtemp(join(tmpdir(), 'oe-tailwind-plan-'));
  roots.push(created);
  const root = created;
  const packageName = options.packageName ?? '@acme/widgets';
  const packageDir = join(root, 'node_modules', ...packageName.split('/'));
  await mkdir(join(packageDir, 'src'), { recursive: true });
  await mkdir(join(root, 'app'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'plan-app', private: true }));
  const declarations = options.declarations ?? [
    { tagName: 'acme-widget', tailwind: options.manifestTailwind },
  ];
  await writeFile(
    join(packageDir, 'manifest.json'),
    JSON.stringify({
      packageName,
      declarations: declarations.map((declaration) => ({
        tagName: declaration.tagName,
        // The contract (ADR-0167): the Tailwind block lives inside the
        // `openElement` extension block, beside `module`/`hydrate`.
        openElement: {
          module: `${packageName}/${declaration.tagName}`,
          ...(declaration.tailwind === undefined ? {} : { tailwind: declaration.tailwind }),
        },
      })),
    }),
  );
  await writeFile(
    join(packageDir, 'manifest.js'),
    "import manifest from './manifest.json' with { type: 'json' };\nexport { manifest };\n",
  );
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '1.0.0',
      type: 'module',
      exports: { './manifest': './manifest.js', './theme.css': './src/theme.css' },
    }),
  );
  for (const [file, body] of Object.entries(options.sources ?? { 'src/theme.css': ':root {}' })) {
    await mkdir(join(packageDir, file.slice(0, file.lastIndexOf('/'))), { recursive: true });
    await writeFile(join(packageDir, file), body);
  }
  // Node's resolver answers realpaths (macOS /var vs /private/var), so the
  // plan resolves inside the real package directory.
  return { root: realpathSync(root), packageRoot: realpathSync(packageDir) };
}

/** The admitted facts one installed-package app produces (real manifest read). */
async function admittedFacts(
  root: string,
  packageName = '@acme/widgets',
): Promise<DeclaredStyleSource[]> {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', ...packageName.split('/'), 'manifest.json'), 'utf8'),
  ) as OpenElementPackageManifest;
  return admittedTailwindDeclarations(
    [manifest],
    manifest.declarations.map((declaration) => ({ tagName: declaration.tagName })),
  );
}

test('undefined + a declared requirement enables the pipeline with the declared source', async () => {
  const { root, packageRoot } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/theme.css'] },
  });
  const plan = resolveStylePlan({
    root,
    tailwind: undefined,
    declarations: await admittedFacts(root),
  });
  expect(plan?.theme, 'the owner’s source compiles, resolved to the installed file').toEqual([
    join(packageRoot, 'src', 'theme.css'),
  ]);
  expect(
    plan?.documentReset,
    'automatic mode is NOT the application’s document: no preflight for a package’s requirement',
  ).toEqual(false);
});

test('the application owns the document reset, and only the application', async () => {
  // The one fact `tailwind` decides beyond enablement: the row where the
  // application turned the entry on itself gets Tailwind's preflight, and the
  // row where an admitted package requirement did it does not. The reduced
  // entry text that follows from it is pinned in tailwind-entry.test.ts.
  const { root } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/theme.css'] },
  });
  const declarations = await admittedFacts(root);
  const rows: Array<[boolean | { theme: string[] } | undefined, boolean]> = [
    [undefined, false],
    [true, true],
    [{ theme: [] }, true],
  ];
  for (const [tailwind, documentReset] of rows) {
    const plan = resolveStylePlan({ root, tailwind, declarations });
    expect(plan?.documentReset, `tailwind: ${JSON.stringify(tailwind)}`).toEqual(documentReset);
  }
});

test('undefined + no declaration leaves the pipeline off (no peer, no compile, no resource)', async () => {
  const { root } = await appWithPackage({});
  expect(
    resolveStylePlan({ root, tailwind: undefined, declarations: await admittedFacts(root) }),
    'an undeclared component library does not turn Tailwind on',
  ).toBeUndefined();
  expect(
    resolveStylePlan({ root, tailwind: undefined, declarations: [] }),
    'a bare application with classes but no declaration stays off',
  ).toBeUndefined();
});

test('true enables the pipeline with the declared sources only', async () => {
  const { root, packageRoot } = await appWithPackage({
    manifestTailwind: { sources: ['./src/theme.css'] },
  });
  const plan = resolveStylePlan({
    root,
    tailwind: true,
    declarations: await admittedFacts(root),
  });
  expect(plan?.theme).toEqual([join(packageRoot, 'src', 'theme.css')]);
});

test('an application override compiles after the declared sources, and a duplicate collapses', async () => {
  const { root, packageRoot } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/theme.css'] },
  });
  await writeFile(join(root, 'app', 'brand.css'), ':root { --color-primary: red; }');
  const plan = resolveStylePlan({
    root,
    tailwind: {
      theme: [
        // Repeating the owner's source is a no-op (resolved-identity dedup)…
        '@acme/widgets/theme.css',
        // …and the application's own sheet compiles last, so it wins.
        'app/brand.css',
      ],
    },
    declarations: await admittedFacts(root),
  });
  expect(plan?.theme?.length, JSON.stringify(plan?.theme)).toEqual(2);
  expect(plan?.theme?.[0]).toEqual(join(packageRoot, 'src', 'theme.css'));
  // An app-relative source keeps the existing spelling contract: the entry
  // lives in `<root>/.openElement/`, so the `@import` is relative to that base.
  expect(plan?.theme?.[1]).toEqual('app/brand.css');
});

test('false with no requirement is an authoritative off switch', async () => {
  const { root } = await appWithPackage({ manifestTailwind: { sources: ['./src/theme.css'] } });
  expect(
    resolveStylePlan({ root, tailwind: false, declarations: await admittedFacts(root) }),
    'an optional source does not make the compile mandatory',
  ).toBeUndefined();
});

test('false against a mandatory declaration fails closed, naming package and tag', async () => {
  const { root } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/theme.css'] },
  });
  const facts = await admittedFacts(root);
  expect(
    await errorCodeOf(() => resolveStylePlan({ root, tailwind: false, declarations: facts })),
    'the disablement conflict is a coded diagnostic',
  ).toEqual(PresetErrorCode.TAILWIND_REQUIRED_DISABLED);
  await expect(
    Promise.resolve().then(() => resolveStylePlan({ root, tailwind: false, declarations: facts })),
  ).rejects.toThrowError(/@acme\/widgets <acme-widget>/);
});

test('a declared source that the installed package does not carry fails closed', async () => {
  const { root } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/missing.css'] },
  });
  const facts = await admittedFacts(root);
  expect(
    await errorCodeOf(() => resolveStylePlan({ root, tailwind: undefined, declarations: facts })),
  ).toEqual(PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED);
});

test('a non-package-relative declared source fails closed', async () => {
  const { root } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['app/theme.css'] },
  });
  const facts = await admittedFacts(root);
  expect(
    await errorCodeOf(() => resolveStylePlan({ root, tailwind: undefined, declarations: facts })),
  ).toEqual(PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED);
  await expect(
    Promise.resolve().then(() =>
      resolveStylePlan({ root, tailwind: undefined, declarations: facts }),
    ),
  ).rejects.toThrowError(/must be package-relative/);
});

test('two declarations in one package resolve in a deterministic order (tag name)', async () => {
  const { root } = await appWithPackage({
    declarations: [
      { tagName: 'acme-beta', tailwind: { required: true, sources: ['./src/beta.css'] } },
      { tagName: 'acme-alpha', tailwind: { sources: ['./src/alpha.css'] } },
    ],
    sources: {
      'src/alpha.css': ':root { --a: 1 }',
      'src/beta.css': ':root { --b: 1 }',
    },
  });
  // Facts arrive in the DECLARED order; the plan sorts them.
  const facts = await admittedFacts(root);
  expect(facts.map((fact) => fact.tagName)).toEqual(['acme-beta', 'acme-alpha']);
  const plan = resolveStylePlan({ root, tailwind: undefined, declarations: facts });
  expect(plan?.theme?.map((source) => source.split('/').pop())).toEqual(['alpha.css', 'beta.css']);
});

test('the manifest shape is validated by the admission scan', () => {
  const manifest = {
    packageName: '@acme/widgets',
    version: '1.0.0',
    schemaVersion: '1.0.0',
    declarations: [
      {
        tagName: 'acme-widget',
        openElement: { module: '@acme/widgets/acme-widget', tailwind: { sources: 'nope' } },
      },
    ],
  } as unknown as OpenElementPackageManifest;
  let code: string | undefined;
  try {
    admittedTailwindDeclarations([manifest], [{ tagName: 'acme-widget' }]);
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  expect(code, 'a malformed declaration block fails closed with its own code').toEqual(
    PackageIslandErrorCode.TAILWIND_SHAPE,
  );
});

test('a declaration that is not admitted contributes nothing', async () => {
  const { root } = await appWithPackage({
    manifestTailwind: { required: true, sources: ['./src/theme.css'] },
  });
  const manifest = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(join(root, 'node_modules', '@acme', 'widgets', 'manifest.json'), 'utf8'),
    ),
  ) as OpenElementPackageManifest;
  // The package is scanned but its declaration is not admitted: the scan's own
  // verdict drives activation, never the mere presence of a manifest.
  expect(admittedTailwindDeclarations([manifest], [])).toEqual([]);
});
