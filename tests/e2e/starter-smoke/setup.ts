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

const repoRoot = resolve(import.meta.dirname!, '..', '..', '..');
const suiteDir = join(repoRoot, 'tests', 'e2e', 'starter-smoke');
const workDir = join(suiteDir, 'work');
const appDir = join(workDir, 'my-blog');
const depsDir = join(workDir, 'deps');

const PACKAGES = ['element', 'router', 'create'] as const;

function run(cmd: string, args: string[], cwd: string): void {
  const result = new Deno.Command(cmd, { args, cwd, stdout: 'piped', stderr: 'piped' })
    .outputSync();
  if (result.code !== 0) {
    const out = new TextDecoder().decode(result.stderr) || new TextDecoder().decode(result.stdout);
    throw new Error(`[${cmd} ${args.join(' ')}] failed:\n${out.slice(0, 4000)}`);
  }
}

function packAndExtract(pkg: (typeof PACKAGES)[number]): void {
  const pkgDir = join(repoRoot, 'packages', pkg);
  const tgz = join(depsDir, `${pkg}.tgz`);
  run('deno', ['pack', '--allow-dirty', '-o', tgz], pkgDir);
  const extractDir = join(depsDir, pkg);
  Deno.mkdirSync(extractDir, { recursive: true });
  run('tar', ['-xzf', tgz, '-C', extractDir, '--strip-components=1'], repoRoot);
}

function relativeSource(...segments: string[]): string {
  return relative(appDir, join(repoRoot, ...segments));
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
  const expected = (await runCapture(
    Deno.execPath(),
    ['run', '--allow-read', '--no-prompt', '-'],
    repoRoot,
    {
      stdin: `const { createInstallCommand } = await import(${
        JSON.stringify(installCommandUrl)
      }); console.log(createInstallCommand());`,
    },
  )).stdout.trim();
  const stdout = await runCliUsage(createCli);
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
 * The packed CLI's usage text. A bare invocation is the CLI's documented
 * "no arguments" exit path (it prints usage and exits 1), so this reads stdout
 * without treating the exit code as a failure.
 */
async function runCliUsage(createCli: string): Promise<string> {
  return (await runCapture(
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
    workDir,
    // The no-arguments path is the usage path; exit 1 is its documented code.
    { allowFailure: true },
  )).stdout;
}

/** Run a command, capturing output; a nonzero exit is reported with its logs. */
async function runCapture(
  cmd: string,
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const child = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
    stdin: options.stdin === undefined ? 'null' : 'piped',
  }).spawn();
  if (options.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    writer.write(new TextEncoder().encode(options.stdin));
    writer.releaseLock();
    child.stdin.close();
  }
  const [status, stdoutBytes, stderrBytes] = await Promise.all([
    child.status,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ]);
  const stdout = new TextDecoder().decode(stdoutBytes);
  const stderr = new TextDecoder().decode(stderrBytes);
  if (!status.success && options.allowFailure !== true) {
    throw new Error(`[${cmd} ${args.join(' ')}] failed:\n${stderr || stdout}`);
  }
  return { stdout, stderr };
}

async function main(): Promise<void> {
  Deno.mkdirSync(depsDir, { recursive: true });
  if (existsSync(appDir)) Deno.removeSync(appDir, { recursive: true });
  for (const pkg of PACKAGES) packAndExtract(pkg);

  const createCli = join(depsDir, 'create', 'src', 'cli.js');
  await assertPackedCliPrintsCanonicalCommand(createCli);
  run(
    'deno',
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
      'my-blog',
    ],
    workDir,
  );

  const denoJsonPath = join(appDir, 'deno.json');
  const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
  const imports = denoJson.imports as Record<string, string>;

  const sourceMap: Record<string, string> = {
    '@openelement/router': 'packages/router/src/index.ts',
    '@openelement/router/vite': 'packages/router/src/vite/index.ts',
    '@openelement/router/nitro-mount': 'packages/router/src/nitro-mount.ts',
    '@openelement/element': 'packages/element/src/index.ts',
    '@openelement/element/jsx-runtime': 'packages/element/src/jsx-runtime.ts',
    '@openelement/element/jsx-dev-runtime': 'packages/element/src/jsx-dev-runtime.ts',
    '@openelement/element/build-utils': 'packages/element/src/build-utils.ts',
  };

  for (const [key, target] of Object.entries(sourceMap)) {
    if (imports[key]?.startsWith('npm:')) {
      imports[key] = relativeSource(...target.split('/'));
    } else if (key in imports) {
      // The mapping exists but changed shape — never skip silently (#944):
      // an unwarned skip would leave the gate testing the published package
      // instead of the monorepo source. Keys absent from the template's
      // import map are fine and stay silent.
      console.warn(
        `[starter-smoke setup] import-map entry "${key}" not rewired to monorepo source (current value: ${
          imports[key]
        }); the gate may be testing the published package`,
      );
    }
  }

  for (const [name, command] of Object.entries(denoJson.tasks as Record<string, string>)) {
    const replaced = command.replace(
      /npm:@openelement\/router@[0-9][^/]*\/cli\/(build|start)/,
      (_, sub: 'build' | 'start') =>
        relativeSource('packages', 'router', 'src', 'cli', `${sub}.ts`),
    );
    if (replaced !== command) denoJson.tasks[name] = replaced;
  }

  Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + '\n');

  run('deno', ['task', 'build'], appDir);
  console.log(`starter-smoke ready at ${appDir}`);
}

await main();
