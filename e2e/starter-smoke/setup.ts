#!/usr/bin/env -S deno run -A
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
 *   deno run -A setup.ts            (build everything into work/)
 */

import { join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname!, '..', '..');
const suiteDir = join(repoRoot, 'e2e', 'starter-smoke');
const workDir = join(suiteDir, 'work');
const appDir = join(workDir, 'my-blog');
const depsDir = join(workDir, 'deps');

const PACKAGES = ['element', 'router', 'adapter-vite', 'create'] as const;

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

function main(): void {
  Deno.mkdirSync(depsDir, { recursive: true });
  if (existsSync(appDir)) Deno.removeSync(appDir, { recursive: true });
  for (const pkg of PACKAGES) packAndExtract(pkg);

  const createCli = join(depsDir, 'create', 'src', 'cli.js');
  run(
    'deno',
    ['run', '--minimum-dependency-age', '0', '-A', createCli, 'my-blog'],
    workDir,
  );

  const denoJsonPath = join(appDir, 'deno.json');
  const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
  const imports = denoJson.imports as Record<string, string>;

  const sourceMap: Record<string, string> = {
    '@openelement/router': 'packages/router/src/index.ts',
    '@openelement/router/model': 'packages/router/src/model.ts',
    '@openelement/router/spa': 'packages/router/src/spa.ts',
    '@openelement/router/i18n': 'packages/router/src/i18n.ts',
    '@openelement/router/preact': 'packages/router/src/preact.ts',
    '@openelement/adapter-vite': 'packages/adapter-vite/src/index.ts',
    '@openelement/adapter-vite/nitro-mount': 'packages/adapter-vite/src/nitro-mount.ts',
    '@openelement/element': 'packages/element/src/index.ts',
    '@openelement/element/jsx-runtime': 'packages/element/src/jsx-runtime.ts',
    '@openelement/element/jsx-dev-runtime': 'packages/element/src/jsx-dev-runtime.ts',
    '@openelement/element/sanitize': 'packages/element/src/sanitize.ts',
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
      /npm:@openelement\/adapter-vite@[0-9][^/]*\/cli\/(build|start)/,
      (_, sub: 'build' | 'start') =>
        relativeSource('packages', 'adapter-vite', 'src', 'cli', `${sub}.ts`),
    );
    if (replaced !== command) denoJson.tasks[name] = replaced;
  }

  Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + '\n');

  run('deno', ['task', 'build'], appDir);
  console.log(`starter-smoke ready at ${appDir}`);
}

main();
