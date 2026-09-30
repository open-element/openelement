#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * starter-smoke setup (#934/#936)
 *
 * Builds the packed-starter verification surface: runs the packed create CLI
 * (deno pack output) to generate a fresh starter, rewrites the starter's
 * @openelement/* imports and build/start tasks to the monorepo sources
 * (deno pack strips package deno.json files; each package's own deno.json is
 * rediscovered from its sources, so transitive npm imports keep resolving),
 * then builds the starter. The built dist/ + dist/server/ are served by the
 * starter's own `start` command during the Playwright run.
 *
 * Usage:
 *   deno task --cwd tests/e2e/starter-smoke setup   (build everything into work/)
 */

import { join, relative, resolve, toFileUrl } from '@std/path';
import { existsSync } from '@std/fs';
import { runStep } from '../../lib/qualify-harness/command-run.ts';
import { routerCliPath, runRouterBuild } from '../../lib/qualify-harness/build-router.ts';
import { scaffoldApp } from '../../lib/qualify-harness/scaffold-app.ts';
import { workspaceSourceAliases } from '../../lib/qualify-harness/workspace-alias.ts';

const repoRoot = resolve(import.meta.dirname!, '..', '..', '..');
const suiteDir = join(repoRoot, 'tests', 'e2e', 'starter-smoke');
const workDir = join(suiteDir, 'work');
const appDir = join(workDir, 'my-blog');
const depsDir = join(workDir, 'deps');

const PACKAGES = ['element', 'router', 'create'] as const;

function packAndExtract(pkg: (typeof PACKAGES)[number]): Promise<void> {
  const pkgDir = join(repoRoot, 'packages', pkg);
  const tgz = join(depsDir, `${pkg}.tgz`);
  return (async () => {
    await runStep('deno', ['pack', '--allow-dirty', '-o', tgz], { cwd: pkgDir });
    const extractDir = join(depsDir, pkg);
    Deno.mkdirSync(extractDir, { recursive: true });
    await runStep('tar', ['-xzf', tgz, '-C', extractDir, '--strip-components=1'], {
      cwd: repoRoot,
    });
  })();
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
  // the homepage. Loading it in a subprocess keeps this check independent of
  // the packed artifact it is comparing against.
  const installCommandUrl = toFileUrl(
    join(repoRoot, 'packages', 'create', 'src', 'install-command.ts'),
  ).href;
  // `deno eval` accepts no permission flags; a bare `deno run -` with the
  // script on stdin keeps the same isolation with the flags this check needs.
  const expected = (await runStep(
    Deno.execPath(),
    ['run', '--allow-read', '--no-prompt', '-'],
    {
      cwd: repoRoot,
      stdin: `const { createInstallCommand } = await import(${
        JSON.stringify(installCommandUrl)
      }); console.log(createInstallCommand());`,
    },
  )).stdout.trim();
  // The no-arguments path is the usage path; exit 1 is its documented code.
  const stdout = (await runStep(
    Deno.execPath(),
    [
      'run',
      '--minimum-dependency-age',
      '0',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-net',
      '--deny-ffi',
      '--no-prompt',
      createCli,
    ],
    { cwd: workDir, allowFailure: true },
  )).stdout;
  const printed = stdout.split('\n')
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
 * Rewire the scaffolded starter's @openelement/* import-map entries and
 * build/start tasks to monorepo sources. The mapping is the workspace
 * package exports (tools/lib/package-aliases.ts), expressed as repo-relative
 * paths so the packed starter's rediscovered package deno.json files keep
 * transitive npm imports resolving.
 */
async function rewireToMonorepoSources(denoJsonPath: string): Promise<void> {
  const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
    imports: Record<string, string>;
    tasks: Record<string, string>;
  };
  const imports = denoJson.imports;

  for (const { specifier, sourcePath } of workspaceSourceAliases(repoRoot)) {
    if (imports[specifier]?.startsWith('npm:')) {
      imports[specifier] = relative(appDir, sourcePath);
    } else if (specifier in imports) {
      // The mapping exists but changed shape — never skip silently (#944):
      // an unwarned skip would leave the gate testing the published package
      // instead of the monorepo source. Keys absent from the template's
      // import map are fine and stay silent.
      console.warn(
        `[starter-smoke setup] import-map entry "${specifier}" not rewired to monorepo source (current value: ${
          imports[specifier]
        }); the gate may be testing the published package`,
      );
    }
  }

  for (const [name, command] of Object.entries(denoJson.tasks)) {
    const replaced = command.replace(
      /npm:@openelement\/router@[0-9][^/]*\/cli\/(build|start)/,
      (_, sub: 'build' | 'start') => relative(appDir, routerCliPath(repoRoot, sub)),
    );
    if (replaced !== command) denoJson.tasks[name] = replaced;
  }

  await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + '\n');
}

async function main(): Promise<void> {
  Deno.mkdirSync(depsDir, { recursive: true });
  if (existsSync(appDir)) Deno.removeSync(appDir, { recursive: true });
  for (const pkg of PACKAGES) await packAndExtract(pkg);

  const createCli = join(depsDir, 'create', 'src', 'cli.js');
  await assertPackedCliPrintsCanonicalCommand(createCli);
  const scaffoldedAppDir = await scaffoldApp({
    workDir,
    projectName: 'my-blog',
    createCli,
    extraArgs: ['--minimum-dependency-age', '0'],
  });
  if (scaffoldedAppDir !== appDir) {
    throw new Error(`scaffolded starter at ${scaffoldedAppDir}, expected ${appDir}`);
  }

  await rewireToMonorepoSources(join(appDir, 'deno.json'));

  await runRouterBuild(appDir);
  console.log(`starter-smoke ready at ${appDir}`);
}

await main();
