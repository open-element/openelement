// esm-boundary:scanner — this file scans for Node globals, so it names them.
/** Ensure shipped/browser/Workers sources stay free of Node APIs and Deno-run
 * helpers stay off `node:*`, while a small, explicitly reviewed set of Node
 * host files keeps its host APIs.
 *
 * Policies (section 17):
 * - product roots (package src trees discovered from the workspace via
 *   readPackages, plus create templates, apps, fixture app/server sources):
 *   no `node:*`, `process`, `Buffer`, `require`,
 *   `module.exports`; runtime-free package surfaces additionally bar Deno
 *   APIs and unchartered `npm:` specifiers. A newly added package is covered
 *   automatically: without a reviewed PACKAGE_POLICIES entry it scans under
 *   the strictest policy and fails the gate.
 * - Deno-run host roots (tests, benchmarks, tools, package `__tests__`): no
 *   `node:*` and no Node globals; Deno APIs are the host API.
 * - Node host files (Playwright/WTR configs, the e2e Node test servers, the
 *   Vite-middleware Node server, pending benchmark harnesses): only files in
 *   NODE_HOST_ALLOWLIST may use Node APIs. Every entry is by explicit file or
 *   directory boundary with a reason; the check prints the table on every run
 *   and fails closed on any Node usage in an unlisted file.
 *
 * Comment and test-string lookalikes never count: imports and `Deno.`/
 * `process`/`Buffer`/`require` accesses are extracted from the TypeScript AST.
 */

import { walkSync } from '@std/fs/walk';
import {
  extractDenoAccesses,
  extractNodeGlobalAccesses,
  extractStaticModuleSpecifiers,
} from '../lib/typescript-ast.ts';
import { readPackages } from '../lib/package-graph.ts';

export interface HostFileEntry {
  /** Repository-relative exact file path or directory prefix ending in '/'. */
  path: string;
  reason: string;
}

/**
 * Files chartered to run on a Node host. This is the entire Node boundary:
 * nothing outside these entries may import `node:*` or touch Node globals.
 * New entries require explicit review — the check fails on unlisted usage and
 * prints every entry with its reason on each run.
 */
export const NODE_HOST_ALLOWLIST: readonly HostFileEntry[] = [
  {
    path: 'packages/element/__wtr__/web-test-runner.config.js',
    reason: 'Web Test Runner Node config (rule 3)',
  },
  {
    path: 'packages/element/__wtr__/fixtures/',
    reason: 'browser fixture sources served by the WTR Node runner (rule 3)',
  },
  {
    path: 'packages/element/__wtr__/tests/',
    reason: 'WTR browser tests run through the Node runner (rule 3)',
  },
  {
    path: 'packages/element/__wtr__/negative/',
    reason: 'WTR negative proofs run through the Node runner (rule 3)',
  },
  {
    path: 'packages/router/__tests__/request-time-parity.test.ts',
    reason:
      'boots the Vite middlewareMode stack behind a Node http server to compare dev and build semantics (rule 3: Node test server)',
  },
  {
    path: 'www/e2e/',
    reason: 'Playwright config, specs, and Node-side fixtures (rule 3)',
  },
  {
    path: 'tests/e2e/starter-smoke/',
    reason: 'Playwright config and Node-driven starter smoke specs (rule 3)',
  },
  {
    path: 'tests/fixtures/router-native-framework/e2e/',
    reason: 'Playwright config, Node test server, and specs (rule 3)',
  },
  {
    path: 'tests/fixtures/router-lit-framework/e2e/',
    reason: 'Playwright config, Node test server, and specs (rule 3)',
  },
  {
    path: 'tests/fixtures/router-request-time/e2e/',
    reason: 'Playwright config, Node test server, and specs (rule 3)',
  },
  {
    path: 'tests/fixtures/router-ui-dogfood/e2e/',
    reason: 'Playwright config, Node test server, and specs (rule 3)',
  },
  {
    path: 'tests/fixtures/site-light-probe/e2e/',
    reason: 'Playwright config for the light-probe fixture (rule 3)',
  },
  {
    path: 'benchmarks/jfb/harness/run.ts',
    reason:
      'node:os is limited to cpus()/release()/totalmem(): CPU model, OS release, and memory are host metadata the benchmark schema requires and Deno has no CPU-model API; identity values come from the environment and are redacted',
  },
];

/**
 * Host-side tooling rooted inside a runtime-free package: the Element
 * compiler tooling (TSX-to-Part Program semantic core + Vite plugin boundary)
 * and its two public subpath entries, plus the Router application-lifecycle
 * tooling (Vite orchestration under src/vite/, the build/start CLI under
 * src/cli/, and the Nitro mount). These modules are chartered to use the
 * TypeScript compiler API, Vite, and Deno host APIs where the Web platform
 * offers no filesystem/process capability; they are reachable only through
 * the @openelement/element/compiler, @openelement/element/vite,
 * @openelement/router/vite, @openelement/router/cli/* and
 * @openelement/router/nitro-mount subpaths, never from the browser/runtime
 * entry points. `node:*` imports stay barred here too.
 */
export const DENO_HOST_TOOLING: readonly HostFileEntry[] = [
  {
    path: 'packages/element/src/internal/compiler/',
    reason: 'Element compiler semantic core (TypeScript compiler API host tooling)',
  },
  { path: 'packages/element/src/compiler.ts', reason: 'Element /compiler subpath entry' },
  { path: 'packages/element/src/vite.ts', reason: 'Element /vite subpath entry' },
  { path: 'packages/router/src/vite/', reason: 'Router Vite orchestration host tooling' },
  { path: 'packages/router/src/cli/', reason: 'Router build/start CLI host tooling' },
  { path: 'packages/router/src/nitro-mount.ts', reason: 'Router Nitro mount host tooling' },
];

interface ProductRoot {
  root: string;
  /** Deno host APIs barred (runtime-free surface) or allowed (Deno-hosted app). */
  denoApis: 'ban' | 'allow';
  /** Only the chartered @preact/signals-core npm specifier, or npm imports allowed. */
  npm: 'chartered' | 'allow';
}

type PackagePolicy = Omit<ProductRoot, 'root'>;

/**
 * Per-package runtime policy, keyed by the workspace package name. The src
 * roots themselves are discovered from the workspace (readPackages), so a new
 * package cannot escape the gate by missing from a hardcoded list: an
 * unlisted package is scanned under STRICTEST_PACKAGE_POLICY and reported by
 * packagePolicyFailures below.
 */
const PACKAGE_POLICIES: Readonly<Record<string, PackagePolicy>> = {
  '@openelement/element': { denoApis: 'ban', npm: 'chartered' },
  '@openelement/router': { denoApis: 'ban', npm: 'chartered' },
  '@openelement/ui': { denoApis: 'ban', npm: 'allow' },
  '@openelement/create': { denoApis: 'allow', npm: 'allow' },
};

/** Fail-closed default for src trees of packages with no reviewed policy yet. */
const STRICTEST_PACKAGE_POLICY: PackagePolicy = { denoApis: 'ban', npm: 'chartered' };

/** Product roots outside the workspace package src trees. */
const EXTRA_PRODUCT_ROOTS: readonly ProductRoot[] = [
  { root: 'packages/create/templates', denoApis: 'allow', npm: 'allow' },
  { root: 'www/app', denoApis: 'allow', npm: 'allow' },
  { root: 'www/lib', denoApis: 'allow', npm: 'allow' },
  { root: 'apps/saas/app', denoApis: 'allow', npm: 'allow' },
  { root: 'apps/saas/lib', denoApis: 'allow', npm: 'allow' },
];

const workspacePackages = await readPackages();

/** Shipped product and browser/Workers-facing fixture sources. */
export const PRODUCT_ROOTS: readonly ProductRoot[] = [
  ...workspacePackages.map((pkg) => ({
    root: `${pkg.dir}/src`,
    ...(PACKAGE_POLICIES[pkg.name] ?? STRICTEST_PACKAGE_POLICY),
  })),
  ...EXTRA_PRODUCT_ROOTS,
];

/**
 * Every discovered workspace package must carry an explicit PACKAGE_POLICIES
 * entry: a missing entry means nobody reviewed the package's runtime
 * boundary, and the strictest-policy scan alone would not say so.
 */
export function packagePolicyFailures(
  packages: readonly { name: string; dir: string }[],
): string[] {
  return packages
    .filter((pkg) => PACKAGE_POLICIES[pkg.name] === undefined)
    .map((pkg) =>
      `${pkg.dir}: no PACKAGE_POLICIES entry for ${pkg.name}; ` +
      'review the package runtime boundary and add an explicit policy'
    );
}

const WALK_ROOTS = ['packages', 'www', 'apps', 'tests', 'tools', 'benchmarks'];
const EXTENSIONS = new Set(['.ts', '.tsx']);
const WALK_SKIP: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)\.output-/,
  /(^|\/)test-results(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)\.nitro(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /(^|\/)starter-smoke\/work(\/|$)/,
];

// @preact/signals-core is element's chartered engine dependency (#322-era
// decision); every other npm: specifier is barred from runtime-free packages.
const ALLOWED_NPM_SPECIFIER = /^npm:@preact\/signals-core(?:@|\/|$)/;

function normalize(path: string): string {
  return path.replaceAll('\\', '/');
}

function under(path: string, entry: string): boolean {
  return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
}

function isProductRoot(path: string): ProductRoot | undefined {
  return PRODUCT_ROOTS.find((candidate) => under(path, candidate.root + '/'));
}

function isDenoTooling(path: string): boolean {
  return DENO_HOST_TOOLING.some((entry) => under(path, entry.path));
}

function isNodeHost(path: string): boolean {
  return NODE_HOST_ALLOWLIST.some((entry) => under(path, entry.path));
}

type Policy =
  | { kind: 'product'; denoApis: 'ban' | 'allow'; npm: 'chartered' | 'allow' }
  | { kind: 'deno-host' }
  | { kind: 'node-host' }
  | { kind: 'skip' };

export function policyFor(rawPath: string): Policy {
  const path = normalize(rawPath);
  if (isNodeHost(path)) return { kind: 'node-host' };
  const product = isProductRoot(path);
  if (product) {
    if (isDenoTooling(path)) return { kind: 'product', denoApis: 'allow', npm: 'allow' };
    return { kind: 'product', denoApis: product.denoApis, npm: product.npm };
  }
  // Browser/Workers-facing fixture app and server-route sources.
  if (/^tests\/fixtures\/[^/]+\/(?:app|server)\//.test(path)) {
    return { kind: 'product', denoApis: 'allow', npm: 'allow' };
  }
  if (/^tests\/fixtures\//.test(path)) return { kind: 'deno-host' };
  if (/^(?:tools|benchmarks)\//.test(path)) return { kind: 'deno-host' };
  if (/^tests\//.test(path)) return { kind: 'deno-host' };
  if (/^packages\/[^/]+\/__tests__\//.test(path)) return { kind: 'deno-host' };
  // WTR Node-run surfaces are allowlisted above; the remaining __wtr__ tools
  // are Deno-run helpers and stay strict.
  if (/^packages\/element\/__wtr__\//.test(path)) return { kind: 'deno-host' };
  // App host config and helper modules (cloudflare entry, nitro config, ...).
  if (/^apps\//.test(path)) return { kind: 'deno-host' };
  // A package src tree the discovery above did not cover (e.g. a brand-new
  // package this process has not re-read yet) must never fall open: scan it
  // under the strictest policy.
  if (/^packages\/[^/]+\/src\//.test(path)) {
    return { kind: 'product', ...STRICTEST_PACKAGE_POLICY };
  }
  return { kind: 'skip' };
}

export interface DenoApiScanOptions {
  /** Chartered host tooling inside a runtime-free package. */
  hostTooling?: boolean;
  /** Deno host APIs allowed (Deno-hosted apps and templates). */
  denoApis?: 'ban' | 'allow';
  /** All npm: specifiers allowed instead of only the chartered signals-core. */
  npm?: 'chartered' | 'allow';
}

export function scanDenoApiSource(
  path: string,
  source: string,
  options: DenoApiScanOptions = {},
): string[] {
  const violations: string[] = [];
  const denoAllowed = options.hostTooling === true || options.denoApis === 'allow';
  const npmAllowed = options.hostTooling === true || options.npm === 'allow';
  for (const specifier of extractStaticModuleSpecifiers(source, path)) {
    if (specifier.value.startsWith('node:')) {
      // Barred in host tooling too: Web Standards, then Deno/Deno std.
      violations.push(`${path}:${specifier.line}: node import: ${specifier.value}`);
    } else if (
      !npmAllowed &&
      specifier.value.startsWith('npm:') &&
      !ALLOWED_NPM_SPECIFIER.test(specifier.value)
    ) {
      violations.push(`${path}:${specifier.line}: npm import: ${specifier.value}`);
    }
  }
  if (!denoAllowed) {
    for (const access of extractDenoAccesses(source, path)) {
      violations.push(`${path}:${access.line}: Deno API: Deno.${access.member}`);
    }
  }
  for (const access of extractNodeGlobalAccesses(source, path)) {
    violations.push(`${path}:${access.line}: Node global: ${access.name}`);
  }
  return violations;
}

/** Deno-run helper scan: `node:*` and Node globals are the only banned forms. */
export function scanDenoHostSource(path: string, source: string): string[] {
  return scanDenoApiSource(path, source, { denoApis: 'allow', npm: 'allow' });
}

export function scanPath(path: string, source: string): string[] {
  const policy = policyFor(path);
  if (policy.kind === 'node-host' || policy.kind === 'skip') return [];
  if (policy.kind === 'deno-host') return scanDenoHostSource(path, source);
  return scanDenoApiSource(path, source, { denoApis: policy.denoApis, npm: policy.npm });
}

function walkSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of WALK_ROOTS) {
    let entries;
    try {
      entries = walkSync(root, { includeDirs: false, skip: WALK_SKIP });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    for (const entry of entries) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1 || !EXTENSIONS.has(entry.name.slice(dot))) continue;
      files.push(normalize(entry.path));
    }
  }
  return files.sort();
}

/** Expand directory allowlist entries to the files they currently cover. */
export function allowlistMatches(
  entries: readonly HostFileEntry[],
  paths: readonly string[],
): { entry: HostFileEntry; matches: string[] }[] {
  return entries.map((entry) => ({
    entry,
    matches: paths.filter((path) => under(path, entry.path)),
  }));
}

/**
 * Every allowlist entry must still exist: a stale entry (deleted file or
 * directory) is dead review surface and must be removed deliberately.
 */
export function allowlistCoverageFailures(
  entries: readonly HostFileEntry[],
  exists: (path: string) => boolean,
): string[] {
  const failures: string[] = [];
  for (const entry of entries) {
    if (!exists(entry.path.replace(/\/$/, ''))) {
      failures.push(`stale allowlist entry (path no longer exists): ${entry.path}`);
    }
  }
  return failures;
}

export function scanTree(
  files: { path: string; text: string }[],
): { violations: string[]; scanned: number } {
  const violations: string[] = [];
  let scanned = 0;
  for (const file of files) {
    const policy = policyFor(file.path);
    if (policy.kind === 'node-host' || policy.kind === 'skip') continue;
    scanned++;
    if (policy.kind === 'deno-host') {
      violations.push(...scanDenoHostSource(file.path, file.text));
      continue;
    }
    violations.push(
      ...scanDenoApiSource(file.path, file.text, {
        denoApis: policy.denoApis,
        npm: policy.npm,
      }),
    );
  }
  return { violations, scanned };
}

/** Every file (any extension) currently covered by the Node host allowlist. */
function hostFiles(entries: readonly HostFileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.path.endsWith('/')) {
      paths.push(entry.path);
      continue;
    }
    try {
      for (const found of walkSync(entry.path, { includeDirs: false })) {
        paths.push(normalize(found.path));
      }
    } catch {
      // Stale entry; allowlistCoverageFailures reports it.
    }
  }
  return paths;
}

function printAllowlist(): void {
  const covered = hostFiles(NODE_HOST_ALLOWLIST);
  console.log(`Node host allowlist (${NODE_HOST_ALLOWLIST.length} explicit entries):`);
  for (const { entry, matches } of allowlistMatches(NODE_HOST_ALLOWLIST, covered)) {
    console.log(`  ALLOW ${entry.path} — ${entry.reason}`);
    if (entry.path.endsWith('/')) {
      for (const match of matches) console.log(`        ${match}`);
    }
  }
}

async function main(): Promise<void> {
  const paths = walkSourceFiles();
  printAllowlist();
  const files: { path: string; text: string }[] = [];
  for (const path of paths) {
    files.push({ path, text: await Deno.readTextFile(path) });
  }
  const result = scanTree(files);
  const violations = [
    ...result.violations,
    ...packagePolicyFailures(workspacePackages),
    ...allowlistCoverageFailures(NODE_HOST_ALLOWLIST, (path) => {
      try {
        Deno.statSync(path);
        return true;
      } catch {
        return false;
      }
    }),
  ];
  if (violations.length > 0) {
    console.error('\nRuntime boundary violations detected:');
    for (const violation of violations) console.error(`  ${violation}`);
    Deno.exit(1);
  }
  console.log(
    `Runtime boundary check passed (${result.scanned} modules scanned; ` +
      `${NODE_HOST_ALLOWLIST.length} Node host entries reviewed).`,
  );
}

if (import.meta.main) await main();
