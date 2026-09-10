#!/usr/bin/env -S deno run --allow-read
/** Verify the public Element/Router package boundary from manifests and source. */

import { walkSync } from '@std/fs/walk';
import { RETAINED_PACKAGE_NAMES } from './project-constants.ts';
import { extractOpenImports, readPackages } from './lib/package-graph.ts';

export function packageSetFailures(actual: string[], expected: readonly string[]): string[] {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return [
    ...expected.filter((name) => !actualSet.has(name)).map((name) =>
      `missing retained package: ${name}`
    ),
    ...actual.filter((name) => !expectedSet.has(name)).map((name) =>
      `unowned workspace package: ${name}`
    ),
  ];
}

function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports];
  if (!exports || typeof exports !== 'object') return [];
  return Object.values(exports as Record<string, unknown>).filter(
    (value): value is string => typeof value === 'string',
  );
}

function sourceFiles(root: string): string[] {
  try {
    return [...walkSync(root, { includeDirs: false, exts: ['.ts', '.tsx'] })].map((e) => e.path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

function forbiddenImportFailures(file: string, source: string, forbidden: string[]): string[] {
  const imports = extractOpenImports(source);
  return forbidden.flatMap((packageName) =>
    imports.some((specifier) =>
        specifier === packageName || specifier.startsWith(`${packageName}/`)
      )
      ? [`${file}: forbidden product-boundary import ${packageName}`]
      : []
  );
}

async function main(): Promise<void> {
  const packages = await readPackages();
  const failures = packageSetFailures(
    packages.map((pkg) => pkg.name),
    RETAINED_PACKAGE_NAMES,
  );

  for (const pkg of packages) {
    for (const target of exportTargets(pkg.exports)) {
      const path = `${pkg.dir}/${target.replace(/^\.\//, '')}`;
      try {
        const stat = await Deno.stat(path);
        if (!stat.isFile) failures.push(`${pkg.name}: export target is not a file: ${target}`);
      } catch {
        failures.push(`${pkg.name}: missing export target: ${target}`);
      }
    }
  }

  for (const file of sourceFiles('packages/element/src')) {
    const source = await Deno.readTextFile(file);
    failures.push(...forbiddenImportFailures(file, source, ['@openelement/app']));
  }

  for (const file of ['packages/app/src/router.ts', 'packages/app/src/router-http.ts']) {
    const source = await Deno.readTextFile(file);
    failures.push(...forbiddenImportFailures(file, source, ['@openelement/element']));
  }

  for (const pkg of packages) {
    for (const file of sourceFiles(`${pkg.dir}/src`)) {
      const source = await Deno.readTextFile(file);
      if (/from\s+['"][^'"]*packages\//.test(source)) {
        failures.push(`${file}: private workspace path import`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Package surface check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log(
    `Package surface check passed for ${packages.length} support-distribution packages (Element + Router).`,
  );
}

if (import.meta.main) await main();
