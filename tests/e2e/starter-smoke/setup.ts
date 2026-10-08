#!/usr/bin/env node
/**
 * starter-smoke setup (#934/#936)
 *
 * Builds the packed-starter verification surface on the B5 Node/pnpm consumer
 * surface (ADR-0161): packs the release tarballs through the release
 * toolchain (vp pack via publish-npm dry-run), runs the packed create CLI
 * under Node to generate a fresh starter (the non-interactive default, the
 * #1530 showcase form), rewires the starter's @openelement/* dependencies to
 * the same current-SHA tarballs, installs the starter's own dependency
 * surface with pnpm, then builds it. The built dist/ + dist/server/ are
 * served by the starter's own `start` script during the Playwright run.
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

const PACKAGES = ['protocol', 'element', 'compiler', 'router', 'create'] as const;
/**
 * The release toolchain (vp pack) writes each packed tarball next to the
 * package sources under its logical artifact name. Returns the tarball path.
 * The pack run itself happens once in main() — one invocation produces every
 * retained tarball, so per-package repetition only re-pays the whole pack.
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
  if (!existsSync(artifact)) {
    throw new Error(`pack:dry-run produced no ${artifact}`);
  }
  const extractDir = join(depsDir, pkg);
  mkdirSync(extractDir, { recursive: true });
  await runStep('tar', ['-xzf', artifact, '-C', extractDir, '--strip-components=1'], {
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
 * the retired import-map rewrite). The starter's direct deps are element and
 * router, but since the #1557 split their packed tarballs carry TRANSITIVE
 * workspace pins (protocol, compiler at the exact current version) — pnpm
 * overrides force those to this checkout's tarballs too, so the smoke never
 * depends on the registry having published the new packages yet (#944).
 */
const STARTER_FRAMEWORK_PACKAGES = ['protocol', 'element', 'compiler', 'router'] as const;

/**
 * The scaffold default is the ONE showcase template (#1530): no Tailwind
 * variant pair anymore — the starter ships platform CSS (tokens + recipes)
 * and the two showcase islands. The pin the manifest must still carry is the
 * Vite devDependency, imported in-process from the create package's own
 * source module (the same pattern as the canonical-command check above).
 */
async function assertShowcaseStarter(manifestPath: string, starterDir: string): Promise<void> {
  const versionUrl = pathToFileURL(join(repoRoot, 'packages', 'create', 'src', 'version.ts')).href;
  const { VITE_STARTER_PIN, TAILWIND_STARTER_PIN } = (await import(versionUrl)) as {
    VITE_STARTER_PIN: string;
    TAILWIND_STARTER_PIN: string;
  };
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  const vitePin = manifest.devDependencies.vite;
  if (vitePin !== VITE_STARTER_PIN) {
    throw new Error(
      `[starter-smoke setup] the generated starter is not the showcase form: ` +
        `devDependency vite=${vitePin ?? '<missing>'}, expected ${VITE_STARTER_PIN}`,
    );
  }
  // Tailwind-ON is the single scaffold default (owner ruling 2026-10-08 — one
  // default, no variant, no flag): both build-time pins must ride the packed
  // template payload, and the @theme role sheet must be on disk.
  for (const name of ['tailwindcss', '@tailwindcss/vite']) {
    if (manifest.devDependencies[name] !== TAILWIND_STARTER_PIN) {
      throw new Error(
        `[starter-smoke setup] the generated starter is not the Tailwind-ON default: ` +
          `devDependency ${name}=${manifest.devDependencies[name] ?? '<missing>'}, ` +
          `expected ${TAILWIND_STARTER_PIN}`,
      );
    }
  }
  for (const sheet of ['theme.css', 'recipes.css']) {
    if (!existsSync(join(starterDir, 'app', 'styles', sheet))) {
      throw new Error(`[starter-smoke setup] the generated starter is missing app/styles/${sheet}`);
    }
  }
  for (const island of ['my-counter.tsx', 'live-timer.tsx']) {
    if (!existsSync(join(starterDir, 'app', 'islands', island))) {
      throw new Error(
        `[starter-smoke setup] the generated starter is missing the showcase island ` +
          `app/islands/${island} (#1530)`,
      );
    }
  }
  console.log('[starter-smoke setup] starter is the showcase form, Tailwind-ON single default');
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
    const tarball = tarballs[pkg];
    if (typeof tarball !== 'string') {
      throw new Error(
        `[starter-smoke setup] no packed tarball for ${name}; the gate may not be ` +
          `testing this checkout`,
      );
    }
    if (typeof manifest.dependencies[name] === 'string') {
      manifest.dependencies[name] = pathToFileURL(tarball).href;
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * pnpm 12 reads overrides from the workspace file, not package.json: the
 * starter's own pnpm-workspace.yaml carries the file:// pins for every
 * framework package so the TRANSITIVE workspace deps inside the element and
 * router tarballs (protocol, compiler — #1557) resolve to this checkout.
 */
async function writeStarterOverrides(
  workspacePath: string,
  tarballs: Record<(typeof PACKAGES)[number], string>,
): Promise<void> {
  const overrides: Record<string, string> = {};
  for (const pkg of STARTER_FRAMEWORK_PACKAGES) {
    overrides[`@openelement/${pkg}`] = pathToFileURL(tarballs[pkg]).href;
  }
  const yaml = [
    'packages: []',
    'overrides:',
    ...Object.entries(overrides).map(([name, url]) => `  "${name}": ${url}`),
    '',
  ].join('\n');
  await writeFile(workspacePath, yaml);
}

async function main(): Promise<void> {
  mkdirSync(depsDir, { recursive: true });
  if (existsSync(appDir)) rmSync(appDir, { recursive: true });
  // Pack fresh on every setup run: a stale tarball would silently qualify
  // yesterday's sources (one pack produces every retained tarball).
  await runStep('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run'], { cwd: repoRoot });
  const tarballs = {} as Record<(typeof PACKAGES)[number], string>;
  for (const pkg of PACKAGES) tarballs[pkg] = await packAndExtract(pkg);

  const createCli = join(depsDir, 'create', 'src', 'cli.js');
  await assertPackedCliPrintsCanonicalCommand(createCli);
  // The packed CLI is node-hosted and prompt-free: a bare node spawn is the
  // whole contract (no host permission flags on the Node consumer surface).
  // --no-install: this harness rewires every framework dependency to this
  // checkout's packed tarballs before installing, so the CLI's default
  // registry install would fetch packages the rewire immediately discards —
  // and its pnpm-lock.yaml would then mismatch the file:// specifiers under
  // CI's implicit frozen install (#1530 install-on-scaffold default).
  await runStep('node', [createCli, 'my-blog', '--no-install'], { cwd: workDir });
  if (!existsSync(appDir)) {
    throw new Error(`scaffolded starter missing at ${appDir}`);
  }
  await assertShowcaseStarter(join(appDir, 'package.json'), appDir);

  await rewireToPackedTarballs(join(appDir, 'package.json'), tarballs);

  // Clean-machine simulation: the generated starter must install as its OWN
  // workspace root. The repository's pnpm-workspace.yaml (membership globs,
  // minimumReleaseAge policy, allowBuilds allowlist, root lockfile) governs
  // THIS checkout, not a consumer project that merely sits inside it. Its
  // overrides pin every framework package — transitive workspace deps of the
  // packed tarballs included — to this checkout's tarballs.
  await writeStarterOverrides(join(appDir, 'pnpm-workspace.yaml'), tarballs);

  // --no-frozen-lockfile: CI runners imply frozen installs; the smoke's
  // file:// rewiring is exactly the manifest change a frozen install refuses.
  await runStep('pnpm', ['install', '--no-frozen-lockfile'], { cwd: appDir });
  await runStep('pnpm', ['run', 'build'], { cwd: appDir });
  console.log(`starter-smoke ready at ${appDir}`);
}

await main();
