#!/usr/bin/env node
/**
 * starter-smoke setup (#934/#936)
 *
 * Builds the packed-starter verification surface on the B5 Node/pnpm consumer
 * surface (ADR-0161): packs the release tarballs through the release
 * toolchain (vp pack via publish-npm dry-run — `deno pack` retired with the
 * A1 toolchain swap and the package manifests no longer carry deno.json),
 * runs the packed create CLI under Node to generate a fresh starter, rewires
 * the starter's @openelement/* dependencies to the same current-SHA tarballs,
 * installs the starter's own dependency surface with pnpm, then builds it.
 * The built dist/ + dist/server/ are served by the starter's own `start`
 * script during the Playwright run.
 *
 * Usage:
 *   pnpm --dir tests/e2e/starter-smoke run setup   (build everything into work/)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve, toFileUrl } from '@std/path';
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
  const installCommandUrl = toFileUrl(
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
    .find((line) => line.includes('npm:@openelement/create@'))
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
  await runStep('node', [createCli, 'my-blog'], { cwd: workDir });
  if (!existsSync(appDir)) {
    throw new Error(`scaffolded starter missing at ${appDir}`);
  }

  await rewireToPackedTarballs(join(appDir, 'package.json'), tarballs);

  // Clean-machine simulation: the generated starter must install as its OWN
  // workspace root. The repository's pnpm-workspace.yaml (membership globs,
  // minimumReleaseAge policy, allowBuilds allowlist, root lockfile) governs
  // THIS checkout, not a consumer project that merely sits inside it — the
  // same reason the old flow rewired the deno.json import map instead of
  // letting workspace resolution leak in.
  await writeFile(
    join(appDir, 'pnpm-workspace.yaml'),
    'packages: []\nallowBuilds:\n  esbuild: true\n',
  );

  await runStep('pnpm', ['install'], { cwd: appDir });
  await runStep('pnpm', ['run', 'build'], { cwd: appDir });
  console.log(`starter-smoke ready at ${appDir}`);
}

await main();
