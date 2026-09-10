/**
 * Validate the openElement package dependency graph.
 *
 * Checks:
 * - all package deno.json files under packages/ are readable
 * - all package versions are on one release line
 * - internal npm:@openelement/* specifiers point at that release line
 * - source-level @openelement/* imports resolve. Resolution is a workspace
 *   fallback: an import counts as declared when it matches ANY workspace
 *   package's name or export keys, or the importing package's own deno.json.
 *   It does NOT prove the importing package declares the dependency itself
 *   (publish-npm.ts materializes npm dependencies from the same source scan,
 *   so published artifacts still carry the dependency).
 * - dependency direction stays inside the explicit layering rules below
 *   (cycle detection alone cannot catch an invalid edge into create)
 * - no circular package dependencies exist
 * - release publish order lists every package after its dependencies
 */

import { PACKAGE_COUNT, PACKAGE_VERSION } from './project-constants.ts';
import {
  buildDependencyGraph,
  detectCycles,
  extractOpenImports,
  normalizeDep,
  type PackageInfo,
  packagesByVersion,
  readPackages,
  releasePublishOrder,
  topologicalSort,
} from './lib/package-graph.ts';
import { walk } from '@std/fs/walk';
import { readJson } from './lib/fs.ts';
import { formatError } from '@openelement/element';

/**
 * Explicit dependency-direction rules: each package may only depend on the
 * listed workspace packages (element and create sit at the leaves/edge and
 * depend on nothing). Any other @openelement/* cross-package edge is an error.
 * The url-pattern-list edge is the externally published, OE-maintained
 * matching fork (ADR-0152/#1324) — a dependency boundary, not a second matcher.
 */
export const ALLOWED_DEPENDENCY_DIRECTION: Readonly<Record<string, readonly string[]>> = {
  '@openelement/element': [],
  '@openelement/app': ['@openelement/element', '@openelement/url-pattern-list'],
  '@openelement/adapter-vite': ['@openelement/element', '@openelement/app'],
  '@openelement/create': [],
};

export function isAllowedDependencyDirection(from: string, to: string): boolean {
  return ALLOWED_DEPENDENCY_DIRECTION[from]?.includes(to) ?? false;
}

async function collectTsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (
      const { path } of walk(dir, {
        includeDirs: false,
        skip: [/(^|\/)node_modules(\/|$)/, /(^|\/)dist(\/|$)/],
        exts: ['ts'],
      })
    ) {
      files.push(path);
    }
  } catch {
    // Packages without src are allowed.
  }

  return files;
}

function isDeclaredImport(
  specifier: string,
  pkg: PackageInfo,
  workspaceSpecifiers: Set<string>,
): boolean {
  const base = normalizeDep(specifier, pkg.name);
  if (base === null) return true;
  if (workspaceSpecifiers.has(specifier) || workspaceSpecifiers.has(base)) return true;
  return pkg.importKeys.has(specifier) || pkg.importKeys.has(base);
}

export function collectWorkspaceSpecifiers(packages: PackageInfo[]): Set<string> {
  const specifiers = new Set<string>();
  for (const pkg of packages) {
    specifiers.add(pkg.name);
    const exports = pkg.exports;
    if (typeof exports === 'object' && exports !== null) {
      for (const key of Object.keys(exports)) {
        specifiers.add(key === '.' ? pkg.name : pkg.name + key.slice(1));
      }
    }
  }
  return specifiers;
}

async function validateRootImportMap(
  packages: PackageInfo[],
  failures: string[],
): Promise<void> {
  const rootConfig = await readJson('deno.json') as {
    imports?: Record<string, string>;
  };
  const imports = rootConfig.imports ?? {};
  const packageNames = packages.map((pkg) => pkg.name).sort((a, b) => b.length - a.length);

  for (const specifier of Object.keys(imports)) {
    const packageName = packageNames.find((name) =>
      specifier === name || specifier.startsWith(`${name}/`)
    );
    if (!packageName) continue;
    failures.push(
      `Root deno.json imports must not alias workspace package "${specifier}". ` +
        `Use ${packageName}/deno.json exports so deno publish can rewrite workspace deps.`,
    );
  }
}

function validateVersionConsistency(packages: PackageInfo[], failures: string[]): string | null {
  const versions = packagesByVersion(packages);

  if (versions.size !== 1) {
    for (const [version, names] of versions) {
      failures.push(`Package version ${version || '<missing>'}: ${names.join(', ')}`);
    }
    return null;
  }

  return packages[0]?.version ?? null;
}

function parseInternalSpecifier(value: string): { packageName: string; version: string } | null {
  const match = value.match(/^npm:(@openelement\/[^@/]+)@\^?(\d+\.\d+\.\d+)(?:\/.*)?$/);
  if (!match) return null;
  return { packageName: match[1], version: match[2] };
}

function validateInternalRanges(
  packages: PackageInfo[],
  releaseVersion: string | null,
  failures: string[],
): void {
  if (!releaseVersion) return;
  for (const pkg of packages) {
    for (const [key, value] of Object.entries(pkg.importValues)) {
      if (!value.startsWith('npm:@openelement/')) continue;
      const parsed = parseInternalSpecifier(value);
      if (!parsed) {
        failures.push(
          `${pkg.dir}/deno.json import "${key}" has invalid internal specifier: ${value}`,
        );
        continue;
      }
      // OE-scope packages published outside the workspace (the maintained
      // url-pattern-list fork, #1324) carry their own release line; only
      // workspace members must track the train version.
      if (!packages.some((member) => member.name === parsed.packageName)) continue;
      if (parsed.version !== releaseVersion) {
        failures.push(
          `${pkg.dir}/deno.json import "${key}" points to ${parsed.packageName}@${parsed.version}; ` +
            `expected ${releaseVersion}.`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];

  const packages = await readPackages();
  // releasePublishOrder throws on a dependency-order violation; format it as
  // a gate failure instead of an uncaught stack trace (#825).
  let publishSteps: PackageInfo[] = [];
  try {
    publishSteps = releasePublishOrder(packages);
  } catch (err) {
    failures.push(formatError(err));
  }
  const publishOrder = publishSteps.map((pkg) => pkg.name);

  console.log(`Publish order (${publishOrder.length} packages):`);
  for (const [index, step] of publishSteps.entries()) {
    console.log(`  ${index + 1}. ${step.name} (${step.dir})`);
  }

  console.log(`\nRead ${packages.length} packages:`);
  for (const pkg of packages) {
    console.log(`  ${pkg.name}@${pkg.version} -> deps: [${pkg.deps.join(', ') || 'none'}]`);
  }
  if (packages.length !== PACKAGE_COUNT) {
    failures.push(`Expected ${PACKAGE_COUNT} packages, found ${packages.length}.`);
  }

  console.log('\n--- Version Line Validation ---');
  const releaseVersion = validateVersionConsistency(packages, failures);
  if (releaseVersion && releaseVersion !== PACKAGE_VERSION) {
    failures.push(
      `Package graph version ${releaseVersion} does not match PACKAGE_VERSION ${PACKAGE_VERSION}.`,
    );
  }
  validateInternalRanges(packages, releaseVersion, failures);
  if (releaseVersion) {
    console.log(`  PASS: all packages and internal npm ranges use ${releaseVersion}.`);
  }

  const graph = buildDependencyGraph(packages);

  console.log('\n--- Cycle Detection ---');
  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      const msg = `Circular dependency detected: ${cycle.join(' -> ')}`;
      console.error(`  FAIL: ${msg}`);
      failures.push(msg);
    }
  } else {
    console.log('  PASS: No circular dependencies found.');
  }

  console.log('\n--- Source Import Declarations ---');
  const importFailuresBefore = failures.length;
  const workspaceSpecifiers = collectWorkspaceSpecifiers(packages);
  for (const pkg of packages) {
    const sourceFiles = await collectTsFiles(`${pkg.dir}/src`);
    for (const file of sourceFiles) {
      const source = await Deno.readTextFile(file);
      for (const specifier of extractOpenImports(source)) {
        if (!isDeclaredImport(specifier, pkg, workspaceSpecifiers)) {
          const msg = `${file} imports "${specifier}" but no workspace package exports it ` +
            `and ${pkg.dir}/deno.json does not declare it.`;
          console.error(`  FAIL: ${msg}`);
          failures.push(msg);
        }
        const base = normalizeDep(specifier, pkg.name);
        if (base !== null && base.startsWith('@openelement/')) {
          if (!isAllowedDependencyDirection(pkg.name, base)) {
            const msg = `Dependency direction violation: ${pkg.name} must not depend on ${base} ` +
              `(${file} imports "${specifier}"). Allowed: ${
                ALLOWED_DEPENDENCY_DIRECTION[pkg.name]?.join(', ') || 'none'
              }.`;
            console.error(`  FAIL: ${msg}`);
            failures.push(msg);
          }
        }
      }
    }
  }
  if (failures.length === importFailuresBefore) {
    console.log(
      '  PASS: All source-level @openelement/* imports resolve (workspace fallback) ' +
        'and follow the dependency-direction rules.',
    );
  }

  console.log('\n--- Root Import Map Validation ---');
  const rootImportFailuresBefore = failures.length;
  await validateRootImportMap(packages, failures);
  if (failures.length === rootImportFailuresBefore) {
    console.log('  PASS: Root deno.json does not alias workspace package exports.');
  }

  console.log('\n--- Topological Sort ---');
  try {
    const topoOrder = topologicalSort(graph);
    console.log(`  Order: ${topoOrder.join(' -> ')}`);
  } catch (err) {
    const msg = `Topological sort failed: ${formatError(err)}`;
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
  }

  console.log('\n--- Package Versions ---');
  for (const pkg of packages) {
    console.log(`  ${pkg.name}@${pkg.version} (${pkg.deps.length} internal deps)`);
  }

  if (failures.length > 0) {
    console.error(`\nPackage graph check FAILED with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    Deno.exit(1);
  }

  console.log(
    `\nPackage graph check passed (${packages.length} packages, ${publishOrder.length} publish steps).`,
  );
}

if (import.meta.main) await main();
