/**
 * @openelement/router — package admission coverage for ORDINARY package imports
 * (ADR-0167 §3 / the admission-delivery support table; the alpha15 auto-admission
 * ruling).
 *
 * `packageIslands` is the admission channel for a component package: it admits
 * the package's declarations AND derives the SSR externalization list. Since the
 * auto-admission default, an ORDINARY import of a package's element module is
 * itself the admission fact: the scan derives the module's owner package from
 * the real resolver walk and admits a VALID manifest without any config key
 * (`packageIslands` defaults to 'auto'). The probe decides the whole contract
 * on REAL builds of the same app, one config key apart:
 *
 *   no key (auto)        → the imported component delivers (DSD + style link +
 *                          the Provider requirement its manifest declares)
 *   'manual'             → the old behavior: nothing delivers, and the report
 *                          names the explicit fix
 *   an explicit list      → still works, and wins a tag it shares with a
 *                          derived package
 *
 * Identity is a PACKAGE fact, never a path fact: a dependency installed under
 * the app's own `node_modules/` is a dependency (the ordinary install layout),
 * and the same package reached through a workspace link must derive the same
 * way. Both layouts are built here, plus the pnpm store layout and a real
 * tarball install, so a regression to a path test fails on the ordinary layout
 * immediately.
 *
 * Set OE_KEEP_FIXTURE=1 to keep the temp apps for inspection.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

const fixtureRoots: string[] = [];

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function write(joinedPath: string, content: string): Promise<void> {
  await mkdir(joinedPath.slice(0, joinedPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinedPath, content, 'utf8');
}

/** How a dependency reaches the app's resolution: the four layouts that matter. */
type InstallLayout = 'symlink' | 'copy' | 'pnpm' | 'tarball';

/**
 * Install `@openelement/ui` into `appDir` in one real layout. All four land the
 * package's own `package.json` (its real identity) in the graph; they differ
 * only in the path the resolver reports, which is exactly the axis the
 * derivation must not care about.
 *
 * The non-workspace layouts mirror the RELEASE staging contract: a published
 * artifact stages a compiled manifest (node cannot load TypeScript from under
 * node_modules), so the installed package carries `manifest.js` beside the
 * TypeScript source — exactly what the release pipeline's compiled-pack
 * staging produces.
 */
async function installUi(appDir: string, layout: InstallLayout): Promise<void> {
  const source = join(REPO_ROOT, 'packages', 'ui');
  const scoped = join(appDir, 'node_modules', '@openelement');
  mkdirSync(scoped, { recursive: true });
  const dest = join(scoped, 'ui');
  if (layout === 'symlink') {
    await symlink(source, dest);
    return;
  }
  const stageCompiledManifest = async (into: string): Promise<void> => {
    await write(
      join(into, 'manifest.js'),
      [
        "import manifestData from './src/generated-manifest.json' with { type: 'json' };",
        'export const manifest = manifestData;',
        '',
      ].join('\n'),
    );
  };
  if (layout === 'copy') {
    cpSync(source, dest, { recursive: true });
    await stageCompiledManifest(dest);
    return;
  }
  if (layout === 'pnpm') {
    // The pnpm store shape: `.pnpm/<name>@<version>/node_modules/<name>` with
    // the inner directory being the real package and the outer one the
    // resolver's path.
    const store = join(
      appDir,
      'node_modules',
      '.pnpm',
      '@openelement+ui@1.0.0-alpha.14',
      'node_modules',
      '@openelement',
      'ui',
    );
    mkdirSync(store, { recursive: true });
    cpSync(source, store, { recursive: true });
    await stageCompiledManifest(store);
    await symlink(store, dest);
    return;
  }
  // tarball: really pack the package and unpack it, so the installed tree is
  // the published member list rather than the working directory.
  const staging = await mkdtemp(join(tmpdir(), 'oe-ui-pack-'));
  try {
    execFileSync('npm', ['pack', '--pack-destination', staging, '--silent'], {
      cwd: source,
      stdio: 'pipe',
    });
    const tarball = (await readdir(staging)).find((name) => name.endsWith('.tgz'));
    if (tarball === undefined) throw new Error('npm pack produced no tarball');
    mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['xzf', join(staging, tarball), '--strip-components=1', '-C', dest], {
      stdio: 'pipe',
    });
    await stageCompiledManifest(dest);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The `packageIslands` spellings the probe builds. */
type ConfigSpelling = 'none' | 'manual' | 'explicit-ui' | 'explicit-probe-a';

function configLine(spelling: ConfigSpelling): string {
  switch (spelling) {
    case 'none':
      return '// Auto admission: the package is reached by an ordinary import only.\nexport default defineConfig({});';
    case 'manual':
      return "export default defineConfig({ packageIslands: 'manual' });";
    case 'explicit-ui':
      return "export default defineConfig({ packageIslands: ['@openelement/ui'] });";
    case 'explicit-probe-a':
      return "export default defineConfig({ packageIslands: ['@probe/a'] });";
  }
}

/**
 * One synthetic component package under the app's `node_modules`, with a REAL
 * element module (compiled by the app's build like any shipped-source package)
 * and a `./manifest` subpath. `broken` writes a manifest export that is missing
 * `packageName` — the manifest-is-invalid shape the contract fails closed on.
 */
async function writeComponentPackage(
  appDir: string,
  packageName: string,
  options: { tagName: string; broken?: boolean } = { tagName: 'probe-widget' },
): Promise<void> {
  const packageDir = join(appDir, 'node_modules', ...packageName.split('/'));
  await write(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '1.0.0',
      type: 'module',
      exports: { './widget': './src/widget.tsx', './manifest': './manifest.js' },
    }),
  );
  await write(
    join(packageDir, 'src', 'widget.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      `@element('${options.tagName}', { root: 'shadow-open' })`,
      `export class ProbeWidget extends OpenElement {`,
      `  render() { return <span>probe</span>; }`,
      `}`,
      '',
    ].join('\n'),
  );
  const manifest = options.broken
    ? {
        declarations: [
          { tagName: options.tagName, openElement: { module: `${packageName}/widget` } },
        ],
      }
    : {
        packageName,
        declarations: [
          {
            tagName: options.tagName,
            className: 'ProbeWidget',
            openElement: { module: `${packageName}/widget`, ssr: true, dsd: true },
          },
        ],
      };
  await write(
    join(packageDir, 'manifest.js'),
    `export const manifest = ${JSON.stringify(manifest)};\n`,
  );
}

/**
 * One app. `imports`/`body` restate the page module, so each probe controls
 * exactly which package modules its graph really reaches.
 */
async function writeProbeApp(
  spelling: ConfigSpelling,
  layout: InstallLayout = 'symlink',
  page: { imports: string[]; body: string } = {
    imports: ["import '@openelement/ui/open-button';"],
    body: "    return <main><open-button variant='primary'>probe</open-button></main>;",
  },
): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-package-import-probe-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await write(
    join(appDir, 'package.json'),
    JSON.stringify({
      name: 'oe-package-import-probe',
      private: true,
      type: 'module',
      dependencies: { '@openelement/ui': 'workspace:*' },
    }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/', plugins: [openElement()] });",
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'openelement.config.ts'),
    ["import { defineConfig } from '@openelement/router';", configLine(spelling), ''].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'import-probe-page.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      ...page.imports,
      '',
      "@element('import-probe-page', { root: 'shadow-open' })",
      'export default class ImportProbePage extends OpenElement {',
      '  render() {',
      page.body,
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import ImportProbePage from '../components/import-probe-page.tsx';",
      '',
      "export default definePage(ImportProbePage, { head: { title: 'package import probe' } });",
      '',
    ].join('\n'),
  );

  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  for (const name of ['router', 'element']) {
    await symlink(
      join(REPO_ROOT, 'packages', name),
      join(appDir, 'node_modules', '@openelement', name),
    );
  }
  await installUi(appDir, layout);
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDir, 'node_modules', 'hono'),
  );
  await symlink(
    join(REPO_ROOT, 'node_modules', 'tailwindcss'),
    join(appDir, 'node_modules', 'tailwindcss'),
  );
  return appDir;
}

/** Build one probe app; returns the app dir plus the build's own output. */
async function buildProbeApp(...args: Parameters<typeof writeProbeApp>): Promise<{
  appDir: string;
  logs: string;
  code: number;
}> {
  const appDir = await writeProbeApp(...args);
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  let logs = '';
  build.stdout.on('data', (chunk) => (logs += chunk));
  build.stderr.on('data', (chunk) => (logs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
  return { appDir, logs, code };
}

test('an ordinary package import is admitted automatically: DSD, style link, Provider need', async () => {
  // The flipped baseline: no config key at all. The scan derives the imported
  // module's owner package from the resolver walk and admits its valid
  // manifest — the component delivers exactly what the explicit list delivered.
  const { appDir, logs, code } = await buildProbeApp('none');
  expect(code, `the auto probe build failed:\n${logs}`).toEqual(0);

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'the derived component renders its declarative shadow root').toMatch(
    /<open-button[\s\S]*?<template shadowrootmode="open"/,
  );
  expect(html, 'the derived component declares its stylesheet link').toMatch(
    /<link rel="stylesheet" href="[^"]+" data-oe-static-styles/,
  );
  expect(
    html,
    'the manifest-declared Tailwind requirement flows: the document stylesheet is linked',
  ).toMatch(/<link rel="stylesheet" href="\/client\/assets\/[^"]+\.css" \/>/);

  // The derivation is a scan fact, not a silent one: the admitted declarations
  // are announced by the same line the explicit list announces.
  expect(logs, 'the scan reports the derived package islands').toContain('Package islands:');
  expect(logs, 'an admitted package has nothing to report').not.toContain(
    'is imported by this app but not admitted',
  );
}, 240_000);

test('the derivation keys off package identity, not the path: every install layout delivers', async () => {
  // The layouts a real consumer produces. The ordinary `node_modules` install
  // and the pnpm store layout both sit INSIDE the project root, so a path test
  // ("skip everything under root") silently lost the derivation exactly where
  // it matters most; a workspace link sits outside the root. The owner-package
  // walk must admit all of them.
  for (const layout of ['copy', 'pnpm', 'tarball'] as const) {
    const { appDir, logs, code } = await buildProbeApp('none', layout);
    expect(code, `${layout}: build failed:\n${logs}`).toEqual(0);
    const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
    expect(html, `${layout}: the derived component delivers its shadow root`).toMatch(
      /<open-button[\s\S]*?<template shadowrootmode="open"/,
    );
  }
}, 600_000);

test('an explicit list still works and outranks a derived claim', async () => {
  const { appDir, logs, code } = await buildProbeApp('explicit-ui');
  expect(code, `the explicit probe build failed:\n${logs}`).toEqual(0);
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'the admitted component renders its declarative shadow root').toMatch(
    /<open-button[\s\S]*?<template shadowrootmode="open"/,
  );
  expect(html, 'the admitted component declares its stylesheet link').toMatch(
    /<link rel="stylesheet" href="[^"]+" data-oe-static-styles/,
  );
  expect(logs, 'an admitted package has nothing to report').not.toContain(
    'is imported by this app but not admitted',
  );
}, 240_000);

test("'manual' is the escape hatch: the old behavior, reported with the explicit fix", async () => {
  const { appDir, logs, code } = await buildProbeApp('manual');
  // The build itself is legal: importing a package module is not an error.
  expect(code, `the manual probe build failed:\n${logs}`).toEqual(0);

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'the application page still renders its own DSD').toContain('shadowrootmode="open"');
  expect(
    html.includes('<open-button><template shadowrootmode'),
    'a manual-mode package component must not render a shadow root',
  ).toEqual(false);
  expect(html, 'no style link is declared for it').not.toMatch(
    /<link rel="stylesheet" href="[^"]+" data-oe-static-styles/,
  );

  // The old report, with the old fix: declare the package explicitly.
  expect(logs, 'the manual mode must report the gap').toContain(
    'is imported by this app but not admitted',
  );
  expect(logs, 'the diagnostic names the package').toContain('@openelement/ui');
  expect(logs, 'the diagnostic names the fix').toContain('packageIslands');
}, 240_000);

test('a pure utility import derives nothing', async () => {
  // A helper module from the package is not a component fact: the package
  // stays unadmitted (its element modules never entered the graph), and —
  // because nothing component-shaped was imported — there is also nothing to
  // report. The declared Tailwind requirement must NOT flow from a utility.
  const { appDir, logs, code } = await buildProbeApp('none', 'symlink', {
    imports: ["import { installInstanceState } from '@openelement/ui/instance-state';"],
    body: '    return <main>utility probe</main>;',
  });
  expect(code, `the utility probe build failed:\n${logs}`).toEqual(0);
  expect(logs, 'no component package was derived').not.toContain('Package islands:');
  expect(logs, 'no component package was imported, so nothing is reported').not.toContain(
    'is imported by this app but not admitted',
  );

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'no component stylesheet link exists').not.toMatch(
    /<link rel="stylesheet" href="[^"]+" data-oe-static-styles/,
  );
  expect(
    html,
    'the required Tailwind pipeline did NOT flow from a utility import: no document stylesheet',
  ).not.toMatch(/<link rel="stylesheet" href="\/client\/assets\/[^"]+\.css" \/>/);
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = existsSync(assetsDir)
    ? (await readdir(assetsDir)).filter((name) => name.endsWith('.css'))
    : [];
  expect(cssFiles, 'no sheet exists at all for a utility-only graph').toEqual([]);
}, 240_000);

test('an imported element module whose manifest is invalid fails the build with a coded report', async () => {
  // Derivation admits VALID manifests only. A package that exports a manifest
  // missing its packageName is a broken component package, not an unknown one:
  // fail closed with the manifest scan's own diagnostic instead of admitting
  // or silently skipping.
  const appDir = await writeProbeApp('none', 'symlink', {
    imports: ["import '@probe/broken/widget';"],
    body: '    return <main><broken-widget>probe</broken-widget></main>;',
  });
  await writeComponentPackage(appDir, '@probe/broken', {
    tagName: 'broken-widget',
    broken: true,
  });
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  let logs = '';
  build.stdout.on('data', (chunk) => (logs += chunk));
  build.stderr.on('data', (chunk) => (logs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
  expect(code, 'the invalid manifest must fail the build').not.toEqual(0);
  expect(logs, 'the manifest scan names the package and the defect').toContain(
    'Invalid manifest in @probe/broken',
  );
}, 240_000);

test('two derived packages claiming one tag fail closed, and an explicit list resolves it', async () => {
  // Identity conflict: both packages derive (both element modules are really
  // imported) and both manifests claim <probe-widget>. Scan-time diagnosis
  // names both owners and the explicit fix; declaring one owner explicitly
  // resolves the ambiguity (explicit priority) and that owner delivers.
  const conflict = await buildProbeAppWithPackages('none');
  expect(conflict.code, 'the two-package conflict must fail the build').not.toEqual(0);
  expect(conflict.logs, 'the diagnostic names the tag').toContain('probe-widget');
  expect(conflict.logs, 'the diagnostic names both owners').toContain('@probe/a');
  expect(conflict.logs, 'the diagnostic names both owners').toContain('@probe/b');
  expect(conflict.logs, 'the diagnostic names the explicit fix').toContain('packageIslands');

  const resolved = await buildProbeAppWithPackages('explicit-probe-a');
  expect(resolved.code, `the resolved build failed:\n${resolved.logs}`).toEqual(0);
  expect(resolved.logs, 'the explicit declaration ended the conflict').not.toContain(
    'OE_PACKAGE_ADMISSION_TAG_CONFLICT',
  );
  const html = await readFile(join(resolved.appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'the explicit owner delivers the tag').toMatch(
    /<probe-widget[\s\S]*?<template shadowrootmode="open"/,
  );
}, 480_000);

/** The two-package app: both element modules imported, the shared tag rendered. */
async function buildProbeAppWithPackages(spelling: ConfigSpelling) {
  const appDir = await writeProbeApp(spelling, 'symlink', {
    imports: ["import '@probe/a/widget';", "import '@probe/b/widget';"],
    body: '    return <main><probe-widget>probe</probe-widget></main>;',
  });
  await writeComponentPackage(appDir, '@probe/a', { tagName: 'probe-widget' });
  await writeComponentPackage(appDir, '@probe/b', { tagName: 'probe-widget' });
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  let logs = '';
  build.stdout.on('data', (chunk) => (logs += chunk));
  build.stderr.on('data', (chunk) => (logs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
  return { appDir, logs, code };
}
