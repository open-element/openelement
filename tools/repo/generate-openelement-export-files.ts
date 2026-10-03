/**
 * Generates packages/router/src/vite/generated-export-files.ts from the
 * "exports" maps declared in each package package.json (the B2 manifest
 * conversion moved package truth here from deno.json).
 *
 * OPENELEMENT_EXPORT_FILES used to be a
 * hand-maintained copy of those export maps, which drifted (e.g. content's
 * nav-data was renamed to write-json in its manifest but never updated in
 * the resolver). This script makes package.json the single source of truth.
 *
 * Usage:
 *   node tools/repo/generate-openelement-export-files.ts
 *     -> (re)write the generated file and format it.
 *   node tools/repo/generate-openelement-export-files.ts --check
 *     -> regenerate, format, and fail (exit 1) if the committed file is stale.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { commandOutput } from './node-command.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

interface PackageExports {
  [subpath: string]: string;
}

interface PackageConfig {
  exports?: unknown;
}

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const TARGET = `${REPO_ROOT}packages/router/src/vite/generated-export-files.ts`;

async function resolverPackages(): Promise<string[]> {
  const entries = await readdir(`${REPO_ROOT}packages`, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\.\//, '');
}

async function readPackageExports(pkg: string): Promise<PackageExports> {
  const path = `${REPO_ROOT}packages/${pkg}/package.json`;
  const raw = await readJson<PackageConfig>(path);
  const exportsField = raw.exports;

  const result: PackageExports = {};
  if (typeof exportsField === 'string') {
    result['.'] = stripLeadingSlash(exportsField);
    return result;
  }
  if (exportsField && typeof exportsField === 'object') {
    for (const [key, value] of Object.entries(exportsField)) {
      result[stripLeadingSlash(key)] = stripLeadingSlash(String(value));
    }
  }
  return result;
}

async function buildExportFiles(): Promise<Record<string, PackageExports>> {
  const map: Record<string, PackageExports> = {};
  for (const pkg of await resolverPackages()) {
    map[pkg] = await readPackageExports(pkg);
  }
  return map;
}

function render(map: Record<string, PackageExports>): string {
  const packages = Object.keys(map).sort();
  const lines: string[] = [];
  lines.push('// GENERATED FILE — do not edit by hand.');
  // The banner ships in the npm artifact (#1412): name the tooling task, not
  // the repository-internal script path a consumer cannot open.
  lines.push('// Regenerate via the repository\'s "generate:all" tooling task.');
  lines.push('// Source of truth: the "exports" field of each workspace package manifest.');
  lines.push('export const OPENELEMENT_EXPORT_FILES: Record<string, Record<string, string>> = {');
  for (const pkg of packages) {
    lines.push(`  ${JSON.stringify(pkg)}: {`);
    const subpaths = Object.keys(map[pkg]).sort();
    for (const sub of subpaths) {
      lines.push(`    ${JSON.stringify(sub)}: ${JSON.stringify(map[pkg][sub])},`);
    }
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

async function runFormatter(target: string): Promise<void> {
  // oxfmt is the repository formatter (A2 engine swap); the binary comes
  // from the deno-installed root node_modules (pinned in deno.json imports).
  const oxfmt = new URL('../../node_modules/.bin/oxfmt', import.meta.url).pathname;
  const status = await commandOutput(oxfmt, { args: [target] });
  if (!status.success) {
    throw new Error(`oxfmt failed on ${target}`);
  }
}

async function gitDiffIsEmpty(target: string): Promise<boolean> {
  const status = await commandOutput('git', { args: ['diff', '--quiet', '--', target] });
  return status.code === 0;
}

async function main(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const map = await buildExportFiles();
  const source = render(map);

  await writeFile(TARGET, source, 'utf8');
  await runFormatter(TARGET);

  if (checkOnly) {
    const clean = await gitDiffIsEmpty(TARGET);
    if (!clean) {
      const out = await commandOutput('git', {
        args: ['--no-pager', 'diff', '--', TARGET],
      });
      console.error('export-files sync check failed: generated file is stale.');
      console.error(new TextDecoder().decode(out.stdout));
      process.exit(1);
    }
    console.log('export-files sync check passed (generated file matches package.json exports).');
    return;
  }

  console.log(`Wrote ${TARGET}`);
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
