/**
 * Fixture typecheck-coverage drift guard (#1615).
 *
 * Every application-shaped source under `tests/` — fixture apps, e2e spec
 * payloads, qualify/proof drivers — must carry a standing `typecheck` task
 * (package.json `scripts.typecheck` + a `tsconfig.json` in the owning
 * package). The inventory is the data source: a new fixture directory that
 * holds application sources without coverage fails here, and a recorded
 * waiver that no longer matches the tree fails too.
 *
 * Waivers are per-directory carve-outs with a reason, for third-party
 * corpora the repo deliberately does not install (the client payload is
 * CDN-served through import maps; typechecking it would require declaring
 * a dependency universe the fixture intentionally does not carry). A waiver
 * never waives the typecheck TASK itself — only documents which source
 * directory the task's tsconfig leaves out.
 *
 * Usage: node tools/repo/check-fixture-typecheck-coverage.ts
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

/** Directories scanned for application-shaped sources. */
export const APPLICATION_ROOTS = ['tests/fixtures', 'tests/e2e'];

/**
 * Directory names that never hold first-party application sources: build
 * output, generated work trees, results, and tool state.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'test-results',
  'work',
  '.mimosa',
  '.output',
  '.nitro',
  'public',
]);

/**
 * Documented carve-outs: application-shaped fixture -> the source directory
 * its typecheck does NOT cover, with the reason. Keep this list minimal;
 * every entry must keep matching the tree or the guard fails stale.
 */
export const COVERAGE_WAIVERS: Record<string, { directory: string; reason: string }> = {
  'third-party-web-components': {
    directory: 'app',
    reason:
      'the app/ tree hosts the CDN-served third-party corpus (lit, shoelace, ' +
      'material web, fast-element, ionic) through import maps; the dependency ' +
      'universe is intentionally undeclared, so only the node drivers ' +
      '(qualify.ts, snapshot-prototype.ts) typecheck',
  },
  'web-component-interop': {
    directory: 'app',
    reason:
      'the app/ client payload imports the same CDN-served third-party corpus ' +
      '(lit, fast-element, ionic) via import maps; only qualify.ts and the ' +
      'vitest qualification test typecheck',
  },
};

export interface FixtureCoverage {
  /** Fixture (package) directory name relative to the application root. */
  name: string;
  /** True when the directory holds application-shaped sources. */
  applicationShaped: boolean;
  /** package.json declares scripts.typecheck. */
  hasTypecheckScript: boolean;
  /** A tsconfig.json exists in the package root. */
  hasTsconfig: boolean;
}

export interface CoverageReport {
  covered: string[];
  /** Application-shaped without a standing typecheck task. */
  uncovered: string[];
  /** Waivers naming a fixture the tree no longer justifies. */
  staleWaivers: string[];
}

/** Application-shaped sources: an app/ or server/ tree, an e2e/ payload
 * directory, or top-level TypeScript drivers (qualify.ts, proof.ts, spec
 * payloads). */
export function isApplicationShaped(entries: DirentShape[]): boolean {
  const names = entries.map((entry) => entry.name);
  if (names.includes('app') || names.includes('server') || names.includes('e2e')) return true;
  return entries.some(
    (entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'tsconfig.json',
  );
}

/** Minimal dirent shape so the pure logic stays testable without faking Dirent. */
export interface DirentShape {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export async function scanFixtureTypecheckCoverage(repoRoot: string): Promise<CoverageReport> {
  const report: CoverageReport = { covered: [], uncovered: [], staleWaivers: [] };
  const shaped: string[] = [];
  for (const root of APPLICATION_ROOTS) {
    const rootDir = join(repoRoot, root);
    let packages: DirentShape[];
    try {
      packages = (await readdir(rootDir, { withFileTypes: true })) as DirentShape[];
    } catch {
      continue;
    }
    for (const entry of packages) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const packageDir = join(rootDir, entry.name);
      const children = (await readdir(packageDir, {
        withFileTypes: true,
      })) as DirentShape[];
      const visible = children.filter((child) => !IGNORED_DIRS.has(child.name));
      if (!isApplicationShaped(visible)) continue;
      shaped.push(entry.name);
      const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      const hasTypecheckScript = Boolean(manifest.scripts?.typecheck);
      const hasTsconfig = visible.some((child) => child.isFile() && child.name === 'tsconfig.json');
      if (hasTypecheckScript && hasTsconfig) report.covered.push(entry.name);
      else report.uncovered.push(entry.name);
    }
  }
  for (const [name, waiver] of Object.entries(COVERAGE_WAIVERS)) {
    if (!shaped.includes(name)) {
      report.staleWaivers.push(`${name}: the fixture no longer holds application sources`);
      continue;
    }
    // Waivers only ever name fixture packages, which live under tests/fixtures.
    let waivedDirExists = false;
    try {
      await readdir(join(repoRoot, 'tests/fixtures', name, waiver.directory));
      waivedDirExists = true;
    } catch {
      waivedDirExists = false;
    }
    if (!waivedDirExists) {
      report.staleWaivers.push(`${name}: waived directory "${waiver.directory}" no longer exists`);
    }
  }
  return report;
}

export async function main(): Promise<void> {
  const repoRoot = join(import.meta.dirname!, '..', '..');
  const report = await scanFixtureTypecheckCoverage(repoRoot);
  for (const uncovered of report.uncovered) {
    console.error(
      `FAIL ${uncovered}: application-shaped sources without a standing typecheck task ` +
        '(package.json scripts.typecheck + tsconfig.json) — add one, or record a ' +
        'reasoned waiver in check-fixture-typecheck-coverage.ts',
    );
  }
  for (const stale of report.staleWaivers) {
    console.error(`FAIL stale coverage waiver: ${stale}`);
  }
  if (report.uncovered.length > 0 || report.staleWaivers.length > 0) {
    console.error(
      `${report.uncovered.length} uncovered surface(s), ` +
        `${report.staleWaivers.length} stale waiver(s)`,
    );
    process.exit(1);
  }
  console.log(
    `fixture typecheck coverage ok (${report.covered.length} application-shaped surfaces covered)`,
  );
}

if (import.meta.main) await main();
