/**
 * Run package-scoped tasks in dependency order.
 *
 * This is intentionally small and graph-driven: root deno.json should not carry
 * a hand-maintained workspace package task chain. Publishing goes through
 * tools/publish-npm.ts; the JSR publish channel was removed (#746).
 */

import { runCommand } from './lib/process.ts';
import { type PackageInfo, readPackages, sortPackages } from './lib/package-graph.ts';

const COMMANDS = new Set(['build', 'typecheck']);

function exportEntries(pkg: PackageInfo): string[] {
  if (typeof pkg.exports === 'string') return [pkg.exports];
  if (!pkg.exports || typeof pkg.exports !== 'object') return [];
  const entries = Object.values(pkg.exports as Record<string, unknown>)
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => value.endsWith('.ts') || value.endsWith('.tsx'));
  return [...new Set(entries)];
}

async function typecheckPackage(pkg: PackageInfo): Promise<void> {
  const entries = exportEntries(pkg);
  if (entries.length === 0) {
    console.log(`[typecheck] ${pkg.name}: skipped, no TS exports`);
    return;
  }
  const rootEntries = entries.map((entry) => `${pkg.dir}/${entry.replace(/^\.\//, '')}`);
  await runCommand('deno', ['check', ...rootEntries]);
}

function parseOnlyFilter(args: string[]): Set<string> | null {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--only') {
      const value = args[++i];
      if (!value) throw new Error('--only requires a comma-separated package list.');
      values.push(value);
    } else if (arg.startsWith('--only=')) {
      values.push(arg.slice('--only='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const names = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function packageKeys(pkg: PackageInfo): string[] {
  return [pkg.name, pkg.name.replace('@openelement/', '')];
}

function filterPackagesWithDependencies(
  packages: PackageInfo[],
  only: Set<string> | null,
): PackageInfo[] {
  if (!only) return packages;

  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const selected = new Set<string>();
  const requested = packages.filter((pkg) => packageKeys(pkg).some((key) => only.has(key)));

  if (requested.length === 0) {
    throw new Error(`No packages match --only ${[...only].join(',')}`);
  }

  function visit(pkg: PackageInfo): void {
    if (selected.has(pkg.name)) return;
    for (const dep of pkg.deps) {
      const depPkg = byName.get(dep);
      if (depPkg) visit(depPkg);
    }
    selected.add(pkg.name);
  }

  for (const pkg of requested) visit(pkg);
  return packages.filter((pkg) => selected.has(pkg.name));
}

async function main(): Promise<void> {
  const [command, ...args] = Deno.args;
  if (!COMMANDS.has(command)) {
    throw new Error(
      `Usage: deno run --allow-read --allow-run tools/run-package-graph-task.ts ${
        [...COMMANDS].join('|')
      } [--only package-a,package-b]`,
    );
  }
  const only = parseOnlyFilter(args);

  const packages = filterPackagesWithDependencies(sortPackages(await readPackages()), only);
  if (packages.length === 0) throw new Error('No packages found under packages/.');
  console.log(
    `[graph-task] ${command}: ${packages.length} packages in dependency order: ${
      packages.map((pkg) => pkg.name).join(' -> ')
    }`,
  );

  for (const pkg of packages) {
    await typecheckPackage(pkg);
  }
}

if (import.meta.main) await main();
