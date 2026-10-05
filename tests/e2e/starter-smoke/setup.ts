#!/usr/bin/env node
/**
 * starter-smoke setup (#934/#936)
 *
 * Builds the packed-starter verification surface on the B5 Node/pnpm consumer
 * surface (ADR-0161): packs the release tarballs through the release
 * toolchain (vp pack via publish-npm dry-run), runs the packed create CLI
 * under Node to generate a fresh starter (the non-interactive default, the
 * Tailwind-ON form, #1524 — plus a surface-only --no-tailwind variant check),
 * rewires the starter's @openelement/* dependencies to the same current-SHA
 * tarballs, installs the starter's own dependency surface with pnpm, then
 * builds it. The built dist/ + dist/server/ are served by the starter's own
 * `start` script during the Playwright run.
 *
 * Usage:
 *   pnpm --dir tests/e2e/starter-smoke run setup   (build everything into work/)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { runStep } from '../../lib/qualify-harness/command-run.ts';

const repoRoot = resolve(import.meta.dirname!, '..', '..', '..');
const suiteDir = join(repoRoot, 'tests', 'e2e', 'starter-smoke');
const workDir = join(suiteDir, 'work');
const appDir = join(workDir, 'my-blog');
const depsDir = join(workDir, 'deps');

const PACKAGES = ['element', 'router', 'create'] as const;
/**
 * The release toolchain (vp pack) writes each packed tarball next to the
 * package sources under its logical artifact name. Returns the tarball path.
 */
async function packAndExtract(pkg: (typeof PACKAGES)[number]): Promise<string> {
  const pkgDir = join(repoRoot, 'packages', pkg);
  const manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const artifact = join(
    pkgDir,
    `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
  );
  // Pack fresh on every setup run: a stale tarball would silently qualify
  // yesterday's sources (one pack produces every retained tarball).
  await runStep('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run'], { cwd: repoRoot });
  if (!existsSync(artifact)) {
    throw new Error(`pack:dry-run produced no ${artifact}`);
  }
  const extractDir = join(depsDir, pkg);
  mkdirSync(extractDir, { recursive: true });
  await runStep('tar', ['-xzf', join(artifact), '-C', extractDir, '--strip-components=1'], {
    cwd: pkgDir,
  });
  return artifact;
}

/**
 * The documented install command must be the CLI's own output (#1414): the
 * packed CLI is run with no arguments and its usage line is compared against
 * the canonical string the create package exports — the very string the
 * documentation generator projects into the guides and the homepage. A
 * divergence (the CLI gaining or losing a flag while the docs keep the old
 * spelling, or a stale packed artifact) fails the starter gate here, on the
 * packed CLI rather than on workspace sources.
 */
async function assertPackedCliPrintsCanonicalCommand(createCli: string): Promise<void> {
  // The canonical command comes from the create package's own source module —
  // the same module the documentation generator projects into the guides and
  // the homepage. Importing it in-process keeps this check independent of the
  // packed artifact it is comparing against (setup runs under Node, whose
  // type stripping loads the .ts source directly).
  const installCommandUrl = pathToFileURL(
    join(repoRoot, 'packages', 'create', 'src', 'install-command.ts'),
  ).href;
  const { createInstallCommand } = (await import(installCommandUrl)) as {
    createInstallCommand: () => string;
  };
  const expected = createInstallCommand().trim();
  // The no-arguments path is the usage path; exit 1 is its documented code.
  const stdout = (await runStep('node', [createCli], { cwd: workDir, allowFailure: true })).stdout;
  const printed = stdout
    .split('\n')
    // The usage line carries the package's identity in either documented
    // shape: the canonical `npm create @openelement@<tag>` alias or a
    // runner spelling of `@openelement/create@<tag>`.
    .find((line) => line.includes('@openelement@'))
    ?.replace(/^Usage \(Alpha\): /, '')
    .trim();
  if (printed !== expected) {
    throw new Error(
      '[starter-smoke setup] the packed create CLI does not print the canonical install ' +
        `command:\n    printed:   ${printed ?? '(none)'}\n    canonical: ${expected}`,
    );
  }
  console.log(`[starter-smoke setup] packed create CLI prints: ${printed}`);
}

/**
 * Rewire the scaffolded starter's @openelement/* dependencies to the packed
 * current-SHA tarballs (B5, ADR-0161: dependency pins in package.json replace
 * the retired import-map rewrite). The starter depends on element and router
 * (create is the scaffold CLI itself); the mapping must hit every entry or
 * the gate silently tests the published registry instead of this checkout
 * (#944).
 */
const STARTER_FRAMEWORK_PACKAGES = ['element', 'router'] as const;

/**
 * The Tailwind-ON scaffold default (#1524): the packed CLI runs
 * non-interactively here, so the generated starter must be the ON form — the
 * exact build-time pins in devDependencies and the @theme role sheet on disk.
 * The pin value comes from the create package's own source module (the same
 * in-process import pattern as the canonical-command check above).
 */
async function assertTailwindOnStarter(manifestPath: string, starterDir: string): Promise<void> {
  const versionUrl = pathToFileURL(join(repoRoot, 'packages', 'create', 'src', 'version.ts')).href;
  const { TAILWIND_STARTER_PIN } = (await import(versionUrl)) as {
    TAILWIND_STARTER_PIN: string;
  };
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  for (const name of ['tailwindcss', '@tailwindcss/vite']) {
    const pin = manifest.devDependencies[name];
    if (pin !== TAILWIND_STARTER_PIN) {
      throw new Error(
        `[starter-smoke setup] the generated starter is not the Tailwind-ON default form: ` +
          `devDependency ${name}=${pin ?? '<missing>'}, expected ${TAILWIND_STARTER_PIN} (#1524)`,
      );
    }
  }
  if (!existsSync(join(starterDir, 'app', 'styles', 'theme.css'))) {
    throw new Error(
      '[starter-smoke setup] the generated starter is missing the @theme role sheet ' +
        '(app/styles/theme.css) of the Tailwind-ON default form (#1524)',
    );
  }
  console.log('[starter-smoke setup] starter is the Tailwind-ON default form');
}

/**
 * The --no-tailwind variant keeps one dedicated packed-surface check (#1524):
 * the flag must still reach the PACKED template payload and produce the
 * minimal form. Surface-only by design (no install, no build) — the full
 * lifecycle legs above already qualify the ON form end to end, and the
 * create package's template tests own the OFF-form depth.
 */
async function assertNoTailwindVariant(createCli: string): Promise<void> {
  const variantDir = join(workDir, 'my-blog-plain');
  if (existsSync(variantDir)) rmSync(variantDir, { recursive: true });
  try {
    await runStep('node', [createCli, 'my-blog-plain', '--no-tailwind'], { cwd: workDir });
    const manifestText = await readFile(join(variantDir, 'package.json'), 'utf8');
    if (manifestText.includes('tailwind')) {
      throw new Error(
        '[starter-smoke setup] the --no-tailwind variant carries a Tailwind dependency: ' +
          'the flag did not reach the packed template payload (#1524)',
      );
    }
    if (existsSync(join(variantDir, 'app', 'styles', 'theme.css'))) {
      throw new Error(
        '[starter-smoke setup] the --no-tailwind variant shipped the @theme role sheet',
      );
    }
    console.log('[starter-smoke setup] --no-tailwind variant scaffolds the minimal form');
  } finally {
    if (existsSync(variantDir)) rmSync(variantDir, { recursive: true });
  }
}

async function rewireToPackedTarballs(
  manifestPath: string,
  tarballs: Record<(typeof PACKAGES)[number], string>,
): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const pkg of STARTER_FRAMEWORK_PACKAGES) {
    const name = `@openelement/${pkg}`;
    const current = manifest.dependencies[name];
    if (typeof current !== 'string') {
      throw new Error(
        `[starter-smoke setup] generated starter has no "${name}" dependency to rewire ` +
          `(found: ${current ?? 'nothing'}); the gate may not be testing this checkout`,
      );
    }
    manifest.dependencies[name] = pathToFileURL(tarballs[pkg]).href;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  mkdirSync(depsDir, { recursive: true });
  if (existsSync(appDir)) rmSync(appDir, { recursive: true });
  const tarballs = {} as Record<(typeof PACKAGES)[number], string>;
  for (const pkg of PACKAGES) tarballs[pkg] = await packAndExtract(pkg);

  const createCli = join(depsDir, 'create', 'src', 'cli.js');
  await assertPackedCliPrintsCanonicalCommand(createCli);
  // The packed CLI is node-hosted and prompt-free: a bare node spawn is the
  // whole contract (no host permission flags on the Node consumer surface).
  // Non-interactive stdin takes the scaffold default (Tailwind ON, #1524).
  await runStep('node', [createCli, 'my-blog'], { cwd: workDir });
  if (!existsSync(appDir)) {
    throw new Error(`scaffolded starter missing at ${appDir}`);
  }
  await assertTailwindOnStarter(join(appDir, 'package.json'), appDir);
  await assertNoTailwindVariant(createCli);

  await rewireToPackedTarballs(join(appDir, 'package.json'), tarballs);

  // Clean-machine simulation: the generated starter must install as its OWN
  // workspace root. The repository's pnpm-workspace.yaml (membership globs,
  // minimumReleaseAge policy, allowBuilds allowlist, root lockfile) governs
  // THIS checkout, not a consumer project that merely sits inside it.
  await writeFile(
    join(appDir, 'pnpm-workspace.yaml'),
    'packages: []\nallowBuilds:\n  esbuild: true\n',
  );

  await runStep('pnpm', ['install'], { cwd: appDir });
  await runStep('pnpm', ['run', 'build'], { cwd: appDir });
  console.log(`starter-smoke ready at ${appDir}`);
}

await main();
