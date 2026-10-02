/**
 * Validate the openElement package dependency graph.
 *
 * Checks:
 * - all package package.json files under packages/ are readable
 * - all package versions are on one release line
 * - internal npm:@openelement/* specifiers point at that release line
 * - source-level @openelement/* imports resolve. Resolution is a workspace
 *   fallback: an import counts as declared when it matches ANY workspace
 *   package's name or export keys, or the importing package's own manifest.
 *   It does NOT prove the importing package declares the dependency itself
 *   (publish-npm.ts materializes npm dependencies from the same source scan,
 *   so published artifacts still carry the dependency).
 * - dependency direction stays inside the explicit layering rules below
 *   (cycle detection alone cannot catch an invalid edge into create)
 * - no circular package dependencies exist
 * - release publish order lists every package after its dependencies
 * - the workspace package roster matches the retained release set, every
 *   declared export target exists, product-boundary imports stay forbidden
 *   (Element must not import Router; the Router core must not import
 *   Element), and no source reaches into another package via a private
 *   workspace path (merged from the former standalone package-surface check)
 * - release-critical package configuration: every package is on
 *   PACKAGE_VERSION, declares exports and a files allowlist (with
 *   README.md/LICENSE present on disk), uses the @openelement
 *   scope, and the create CLI's embedded CREATE_VERSION tracks the release
 *   line (merged from the former standalone package-config verification)
 */

import { readFile, stat, stat as statPath } from 'node:fs/promises';
import {
  PACKAGE_COUNT,
  PACKAGE_VERSION,
  RETAINED_PACKAGE_NAMES,
} from '../repo/project-constants.ts';
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
} from '../lib/package-graph.ts';
import { walk, walkSync } from '@std/fs/walk';
import { basename, dirname, join } from '@std/path';
import { formatError } from '@openelement/element';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Explicit dependency-direction rules: each package may only depend on the
 * listed workspace packages (element and create sit at the leaves/edge and
 * depend on nothing). Any other @openelement/* cross-package edge is an error.
 * The url-pattern-list edge is the externally published, OE-maintained
 * matching fork (ADR-0152/#1324) — a dependency boundary, not a second matcher.
 */
export const ALLOWED_DEPENDENCY_DIRECTION: Readonly<Record<string, readonly string[]>> = {
  '@openelement/element': [],
  '@openelement/router': ['@openelement/element', '@openelement/url-pattern-list'],
  // ui consumes element's StyleSheet/logger/manifest contracts (1.0 baseline —
  // the rule predated ui's re-entry onto the publish surface).
  '@openelement/ui': ['@openelement/element'],
  '@openelement/create': [],
};

export function isAllowedDependencyDirection(from: string, to: string): boolean {
  return ALLOWED_DEPENDENCY_DIRECTION[from]?.includes(to) ?? false;
}

async function collectTsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    for await (const { path } of walk(dir, {
      includeDirs: false,
      skip: [/(^|\/)node_modules(\/|$)/, /(^|\/)dist(\/|$)/],
      exts: ['ts'],
    })) {
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
          `${pkg.dir}/package.json dependency "${key}" has invalid internal specifier: ${value}`,
        );
        continue;
      }
      // OE-scope packages published outside the workspace (the maintained
      // url-pattern-list fork, #1324) carry their own release line; only
      // workspace members must track the train version.
      if (!packages.some((member) => member.name === parsed.packageName)) continue;
      if (parsed.version !== releaseVersion) {
        failures.push(
          `${pkg.dir}/package.json dependency "${key}" points to ${parsed.packageName}@${parsed.version}; ` +
            `expected ${releaseVersion}.`,
        );
      }
    }
  }
}

/**
 * Retained-package roster rule (merged from the former surface check): the
 * workspace must contain exactly the release-state package set.
 */
export function packageSetFailures(actual: string[], expected: readonly string[]): string[] {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return [
    ...expected
      .filter((name) => !actualSet.has(name))
      .map((name) => `missing retained package: ${name}`),
    ...actual
      .filter((name) => !expectedSet.has(name))
      .map((name) => `unowned workspace package: ${name}`),
  ];
}

function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports];
  if (!exports || typeof exports !== 'object') return [];
  return Object.values(exports as Record<string, unknown>).filter(
    (value): value is string => typeof value === 'string',
  );
}

function surfaceSourceFiles(root: string): string[] {
  try {
    return [...walkSync(root, { includeDirs: false, exts: ['.ts', '.tsx'] })].map((e) => e.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
}

function forbiddenImportFailures(file: string, source: string, forbidden: string[]): string[] {
  const imports = extractOpenImports(source);
  return forbidden.flatMap((packageName) =>
    imports.some(
      (specifier) => specifier === packageName || specifier.startsWith(`${packageName}/`),
    )
      ? [`${file}: forbidden product-boundary import ${packageName}`]
      : [],
  );
}

async function validatePackageSurface(packages: PackageInfo[], failures: string[]): Promise<void> {
  failures.push(
    ...packageSetFailures(
      packages.map((pkg) => pkg.name),
      RETAINED_PACKAGE_NAMES,
    ),
  );

  for (const pkg of packages) {
    for (const target of exportTargets(pkg.exports)) {
      const path = `${pkg.dir}/${target.replace(/^\.\//, '')}`;
      try {
        const targetStat = await statPath(path);
        if (!targetStat.isFile())
          failures.push(`${pkg.name}: export target is not a file: ${target}`);
      } catch {
        failures.push(`${pkg.name}: missing export target: ${target}`);
      }
    }
  }

  for (const file of surfaceSourceFiles('packages/element/src')) {
    const source = await readFile(file, 'utf8');
    failures.push(...forbiddenImportFailures(file, source, ['@openelement/router']));
  }

  for (const file of ['packages/router/src/router.ts', 'packages/router/src/http.ts']) {
    const source = await readFile(file, 'utf8');
    failures.push(...forbiddenImportFailures(file, source, ['@openelement/element']));
  }

  for (const pkg of packages) {
    for (const file of surfaceSourceFiles(`${pkg.dir}/src`)) {
      const source = await readFile(file, 'utf8');
      if (/from\s+['"][^'"]*packages\//.test(source)) {
        failures.push(`${file}: private workspace path import`);
      }
    }
  }
}

const REQUIRED_PUBLISHED_FILES = ['README.md', 'LICENSE'];

/**
 * Cross-assert the embedded create CLI version against the workspace package
 * line (#713). packages/create/src/version.ts is rewritten by the version bump
 * but lives outside the package manifest files the graph check covers, so a
 * missed bump would otherwise ship a CLI advertising a stale version.
 */
export function createVersionFailures(createVersionSource: string): string[] {
  const match = createVersionSource.match(/CREATE_VERSION = '([^']+)'/u);
  if (!match) {
    return ['packages/create/src/version.ts: CREATE_VERSION anchor missing'];
  }
  if (match[1] !== PACKAGE_VERSION) {
    return [
      `packages/create/src/version.ts: CREATE_VERSION ${match[1]} does not match ` +
        `docs/release/release-state.json sourceVersion ${PACKAGE_VERSION}`,
    ];
  }
  return [];
}

async function validatePackageConfigs(packages: PackageInfo[], failures: string[]): Promise<void> {
  failures.push(...createVersionFailures(await readFile('packages/create/src/version.ts', 'utf8')));

  for (const pkg of packages) {
    // The B2 manifest conversion moved package truth to package.json; the
    // publish surface is its `files` allowlist (npm), never a deno publish
    // config — JSR is not a release channel (ADR-0108).
    const configPath = join(pkg.dir, 'package.json');
    const config = (await readJson(configPath)) as {
      name?: unknown;
      version?: unknown;
      exports?: unknown;
      files?: unknown;
    };

    if (config.version !== PACKAGE_VERSION) {
      failures.push(
        `${configPath}: version ${
          typeof config.version === 'string' ? config.version : '<missing>'
        } does not match PACKAGE_VERSION ${PACKAGE_VERSION}`,
      );
    }
    if (!config.exports) failures.push(`${configPath}: missing public exports`);

    const files = config.files;
    if (!Array.isArray(files)) {
      failures.push(`${configPath}: files must be an array (the npm publish allowlist)`);
    } else {
      for (const required of REQUIRED_PUBLISHED_FILES) {
        if (!files.includes(required)) {
          failures.push(`${configPath}: files omits ${required}`);
        }
      }
    }

    for (const required of REQUIRED_PUBLISHED_FILES) {
      try {
        await stat(join(dirname(configPath), required));
      } catch {
        failures.push(`${pkg.name}: missing ${required}`);
      }
    }

    if (!pkg.name.startsWith('@openelement/')) {
      failures.push(`${basename(pkg.dir)}: package name must use @openelement scope`);
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
      const source = await readFile(file, 'utf8');
      for (const specifier of extractOpenImports(source)) {
        if (!isDeclaredImport(specifier, pkg, workspaceSpecifiers)) {
          const msg =
            `${file} imports "${specifier}" but no workspace package exports it ` +
            `and ${pkg.dir}/package.json does not declare it.`;
          console.error(`  FAIL: ${msg}`);
          failures.push(msg);
        }
        const base = normalizeDep(specifier, pkg.name);
        if (base !== null && base.startsWith('@openelement/')) {
          if (!isAllowedDependencyDirection(pkg.name, base)) {
            const msg =
              `Dependency direction violation: ${pkg.name} must not depend on ${base} ` +
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

  console.log('\n--- Topological Sort ---');
  try {
    const topoOrder = topologicalSort(graph);
    console.log(`  Order: ${topoOrder.join(' -> ')}`);
  } catch (err) {
    const msg = `Topological sort failed: ${formatError(err)}`;
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
  }

  console.log('\n--- Package Surface Validation ---');
  const surfaceFailuresBefore = failures.length;
  await validatePackageSurface(packages, failures);
  if (failures.length === surfaceFailuresBefore) {
    console.log(
      '  PASS: Workspace roster matches the retained release set, all export targets exist, ' +
        'product-boundary imports are absent, and no private workspace path imports were found.',
    );
  }

  console.log('\n--- Package Configuration Validation ---');
  const configFailuresBefore = failures.length;
  await validatePackageConfigs(packages, failures);
  if (failures.length === configFailuresBefore) {
    console.log(
      `  PASS: All ${packages.length} packages carry release-critical configuration ` +
        `(version ${PACKAGE_VERSION}, exports, publish.include, required files, @openelement scope).`,
    );
  }

  console.log('\n--- Package Versions ---');
  for (const pkg of packages) {
    console.log(`  ${pkg.name}@${pkg.version} (${pkg.deps.length} internal deps)`);
  }

  if (failures.length > 0) {
    console.error(`\nPackage graph check FAILED with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `\nPackage graph check passed (${packages.length} packages, ${publishOrder.length} publish steps).`,
  );
}

if (import.meta.main) await main();
