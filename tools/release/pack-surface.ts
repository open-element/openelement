/**
 * Release gate: the packed npm facade (#1412).
 *
 * `vp pack` produces the artifact; tools/release/npm-manifest.ts owns the
 * metadata the coordinator writes into it. This check reads the REAL tarball
 * bytes (run tools/release#pack:dry-run first) and fails closed on five
 * things a consumer would otherwise see:
 *
 *   1. facade metadata (`homepage`, `keywords`, `engines`, `sideEffects`,
 *      `bin`, `customElements`) missing or diverging from packedMetadata();
 *   2. repository-internal references in shipped text — a repo directory path
 *      (`packages/`, `tools/`, `www/`, `apps/`, `tests/`, `benchmarks/`,
 *      `docs/`) or a decision-record citation. The tarball is the only
 *      documentation a consumer can read; a path they cannot open is noise,
 *      and an ADR id is maintainer vocabulary. These are ADVISORY: they are
 *      reported on every run but do not block a PR push. Only the consumer
 *      contracts below (metadata, export subpaths, bin targets, side-effect
 *      truthfulness) are BLOCKING. A prose wording in a JSDoc comment is not
 *      the same class of defect as a package a consumer cannot install; the
 *      #1708 CI run is the evidence — two ADR tokens in a correct comment
 *      stopped the entire pack job, while the local gate scanned a stale
 *      tarball and stayed green. Severity lives on the violation, not on a
 *      per-invocation flag, so the same rule cannot be green in one job and
 *      red in another;
 *   3. a packed export subpath that the shipped README never names;
 *   4. a module-scope write to a well-known global in a package declared
 *      `sideEffects: false`, which would make the tree-shaking claim false;
 *   5. a module-scope install call (`installX(...)`) in a package declared
 *      `sideEffects: false` without naming that module — the install can be
 *      removed along with the bare import that reaches it, without changing
 *      what the artifact looks like. This is the #1425 class: the default
 *      entry's claim-executor install was declared tree-shakeable, so consumer
 *      bundles shipped without it and island hydration threw at runtime.
 *
 * Bytes are parsed in-process with the repository's standards-only tar reader
 * (tools/repo/tarball-inspect.ts), so the check inspects exactly what npm
 * installs and spawns nothing.
 */

import { readFile } from 'node:fs/promises';
import { type PackageInfo, readPackages, releasePublishOrder } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { parseTarGz } from '../repo/tarball-inspect.ts';
import { type PackedMetadata, packedMetadata } from './npm-manifest.ts';

/**
 * Repository directories a consumer cannot resolve. Matching requires a
 * directory boundary, so prose like "tests, HMR" or a consumer's own
 * `docs/guide/` path does not trip it. The captured directory name is group 1.
 *
 * N2: the original single pattern only saw the bare `dir/segment` form. It
 * missed every spelling a path can take in shipped text — `./packages/…`,
 * `../packages/…`, absolute host/CI paths (`/Users/…/packages/…`,
 * `C:\repo\packages\…`), installed-copy paths (`node_modules/packages/…`) and
 * the `.zcode/` internal ledger — so a repository-internal reference could
 * ship simply by being prefixed. The three patterns below cover the forms and
 * are matched after backslash normalization.
 */
const REPO_DIRECTORY = String.raw`(?:packages|tools|www|apps|tests|benchmarks|docs|\.zcode)`;

/** One path component (a directory name or the leaf file name). */
const PATH_SEGMENT = String.raw`[A-Za-z0-9._-]+`;

/** Token start: the match must not continue a larger name or a path segment. */
const TOKEN_BOUNDARY = String.raw`(?:^|[^A-Za-z0-9_$./-])`;

/** Machine-local absolute roots a repo path can be buried under. */
const ABSOLUTE_ROOT = String.raw`(?:/(?:Users|home|private|tmp|var|opt|mnt|Volumes|root|builds|workspace|scratch|github)|[A-Za-z]:)`;

const REPO_PATH_PATTERNS: readonly RegExp[] = [
  // Bare, `./` and `../` forms: `packages/x`, `./packages/x`, `../tools/x`.
  new RegExp(String.raw`${TOKEN_BOUNDARY}(?:\.{1,2}/)?(${REPO_DIRECTORY})/${PATH_SEGMENT}`),
  // Absolute forms: `/Users/dev/repo/packages/x`, `/home/runner/work/tools/x`,
  // `C:/repo/www/x` (Windows originates as `C:\repo\www\x`; normalized first).
  // The root token is followed by slash-prefixed segments, so the directory
  // must be reached through the machine root — public URLs stay unflagged.
  new RegExp(
    String.raw`${TOKEN_BOUNDARY}${ABSOLUTE_ROOT}(?:/${PATH_SEGMENT})*/(${REPO_DIRECTORY})/${PATH_SEGMENT}`,
  ),
  // Installed-copy forms: `node_modules/packages/x`, optionally nested in a
  // longer path (`/app/node_modules/packages/x`).
  new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_$.-])node_modules/(?:[A-Za-z0-9._$-]+/)*(${REPO_DIRECTORY})/${PATH_SEGMENT}`,
  ),
];

/** Decision-record vocabulary (`ADR-0143`, `ADR 0143`, `ADRs`). */
const ADR_PATTERN = /\bADRs?\b|ADR[- ]\d{4}/;

/** A write to a well-known global at the head of a module-scope statement. */
const GLOBAL_WRITE_PATTERN =
  /^(?:globalThis|window|document|customElements|self)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*=|\[)|^Object\.defineProperty\(\s*(?:globalThis|window|document|customElements)\b/;

/**
 * A seam install at module scope: an `install<Something>(...)` call. The
 * naming is the codebase's install convention (`installHydrationExecutor` in
 * hydrate-seam.ts), and it is the shape a tree-shaking bundler silently drops
 * (#1425): the call has no used export to keep it, so a package that declares
 * the module side-effect-free loses the install while still shipping. Narrow
 * on purpose — a module-scope factory call (`createLogger()`) is not an
 * install and stays out of this class, so Router's pure reachability imports
 * are not flagged.
 */
const SEAM_INSTALL_PATTERN = /^install[A-Z][A-Za-z0-9_$]*\s*\(/;

/** Text members worth scanning: shipped code, declarations, docs, styles. */
const SCAN_EXTENSIONS = ['.js', '.mjs', '.cjs', '.d.ts', '.json', '.md', '.css', '.tmpl', '.txt'];

/** Documentation-hygiene findings are advisory; consumer contracts block. */
export type PackSurfaceSeverity = 'blocking' | 'advisory';

export interface PackSurfaceViolation {
  packageName: string;
  path: string;
  line?: number;
  message: string;
  /** Absent means `blocking` — a new violation is fail-closed by default. */
  severity?: PackSurfaceSeverity;
}

/**
 * Split findings by severity. Only `advisory` findings are non-blocking, and
 * only when a rule explicitly opts in; every other rule stays fail-closed.
 * Exported so the severity contract is machine-verified rather than promised
 * in a comment.
 */
export function partitionViolations(violations: readonly PackSurfaceViolation[]): {
  blocking: PackSurfaceViolation[];
  advisory: PackSurfaceViolation[];
} {
  const blocking: PackSurfaceViolation[] = [];
  const advisory: PackSurfaceViolation[] = [];
  for (const violation of violations) {
    (violation.severity === 'advisory' ? advisory : blocking).push(violation);
  }
  return { blocking, advisory };
}

function isScannable(path: string): boolean {
  return SCAN_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Repository-internal references in one shipped file. `path` is
 * package-relative; the line number is one-based.
 */
export function findInternalReferences(
  packageName: string,
  path: string,
  text: string,
): PackSurfaceViolation[] {
  const violations: PackSurfaceViolation[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Backslash spellings (`packages\router\src\x.ts`, `C:\repo\tools\x`) are
    // the same reference; normalize for matching only (line numbers/bytes
    // stay untouched).
    const matchable = line.replaceAll('\\', '/');
    const repoPath = REPO_PATH_PATTERNS.map((pattern) => matchable.match(pattern)).find(
      (match) => match !== null,
    );
    if (repoPath) {
      violations.push({
        packageName,
        path,
        line: index + 1,
        message: `repository-internal path '${repoPath[1]}/' must not ship in an npm artifact`,
        severity: 'advisory',
      });
    }
    if (ADR_PATTERN.test(line)) {
      violations.push({
        packageName,
        path,
        line: index + 1,
        message: 'decision-record citation (ADR) must not ship in an npm artifact',
        severity: 'advisory',
      });
    }
  }
  return violations;
}

/**
 * Facade metadata assertions for one packed manifest. `metadata` is the
 * expected value from packedMetadata(); every field it declares must be
 * present and equal in the packed manifest.
 */
export function findMetadataViolations(
  packageName: string,
  packageJson: Record<string, unknown>,
  metadata: PackedMetadata,
): PackSurfaceViolation[] {
  const violations: PackSurfaceViolation[] = [];
  const fail = (field: string, expected: unknown): void => {
    violations.push({
      packageName,
      path: 'package.json',
      message: `${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(
        packageJson[field] ?? null,
      )}`,
    });
  };
  if (packageJson.homepage !== metadata.homepage) fail('homepage', metadata.homepage);
  // H6: description rides the same parity — a package missing from
  // PACKAGE_DESCRIPTIONS packed with the key dropped (JSON.stringify omits
  // undefined), which this assertion catches. Guarded: a future package with
  // no declared description stays exempt rather than failing closed here.
  if (metadata.description !== undefined && packageJson.description !== metadata.description) {
    fail('description', metadata.description);
  }
  if (JSON.stringify(packageJson.keywords) !== JSON.stringify(metadata.keywords)) {
    fail('keywords', metadata.keywords);
  }
  if (
    metadata.engines &&
    JSON.stringify(packageJson.engines) !== JSON.stringify(metadata.engines)
  ) {
    fail('engines', metadata.engines);
  }
  if (
    metadata.sideEffects !== undefined &&
    JSON.stringify(packageJson.sideEffects) !== JSON.stringify(metadata.sideEffects)
  ) {
    fail('sideEffects', metadata.sideEffects);
  }
  if (
    metadata.bin !== undefined &&
    JSON.stringify(packageJson.bin) !== JSON.stringify(metadata.bin)
  ) {
    fail('bin', metadata.bin);
  }
  // The CEM publish pointer: a package that ships a Custom Elements Manifest
  // must name it in the packed manifest, or the artifact advertises no
  // component metadata to npm consumers and tooling.
  if (
    metadata.customElements !== undefined &&
    packageJson.customElements !== metadata.customElements
  ) {
    fail('customElements', metadata.customElements);
  }
  return violations;
}

/**
 * Bins the packed manifest declares whose target file is missing from the
 * archive. npm materializes one `.bin` shim per declared bin at install time;
 * a shim pointing at an absent file is a broken command, and the same
 * manifest is the only place a consumer can read the command name from. The
 * declared target is the published `./src/…js` form; the archive member is
 * matched after stripping the leading `./`.
 */
export function findMissingBinTargets(
  packageName: string,
  bin: unknown,
  files: ReadonlyMap<string, string>,
): PackSurfaceViolation[] {
  const targets: string[] = [];
  if (typeof bin === 'string') targets.push(bin);
  else if (bin && typeof bin === 'object') {
    for (const value of Object.values(bin as Record<string, unknown>)) {
      if (typeof value === 'string') targets.push(value);
    }
  }
  const violations: PackSurfaceViolation[] = [];
  for (const target of targets) {
    const member = `package/${target.replace(/^\.\//, '')}`;
    if (!files.has(member)) {
      violations.push({
        packageName,
        path: 'package.json',
        message: `declared bin target '${target}' is missing from the packed archive`,
      });
    }
  }
  return violations;
}

/**
 * Exports subpaths the shipped README never names. The README is the only
 * per-subpath documentation an npm consumer gets, so an undocumented public
 * subpath is a facade gap (#1412 acceptance 4). A README names a subpath
 * either qualified (`@openelement/element/html`) or bare (`/html`), so either
 * form counts as documented.
 */
export function findUndocumentedSubpaths(
  packageName: string,
  exportsMap: unknown,
  readme: string,
): PackSurfaceViolation[] {
  if (!exportsMap || typeof exportsMap !== 'object') return [];
  const violations: PackSurfaceViolation[] = [];
  for (const subpath of Object.keys(exportsMap as Record<string, unknown>)) {
    if (subpath === '.') continue;
    const bare = subpath.replace(/^\.\//, '');
    if (readme.includes(`${packageName}/${bare}`) || readme.includes(subpath)) continue;
    violations.push({
      packageName,
      path: 'README.md',
      message: `public subpath '${packageName}/${bare}' is not documented`,
    });
  }
  return violations;
}

/**
 * Module-scope statements in one module matching `pattern`. Returns the
 * offending source lines.
 *
 * Used with GLOBAL_WRITE_PATTERN for `sideEffects: false`: a write that runs
 * merely because the module was imported would make the claim a lie. Used with
 * SEAM_INSTALL_PATTERN for the same claim on install calls (#1425). Only
 * statements at brace depth 0 AND outside every string/template/regex position
 * are reported: the polyfill banners in `ssr-polyfills.ts` carry
 * `globalThis.customElements = …` inside emitted template literals, which run
 * in a generated entry the consumer opts into, never on importing the shipped
 * module.
 */
export function findModuleScopeGlobalWrites(
  text: string,
  pattern: RegExp = GLOBAL_WRITE_PATTERN,
): string[] {
  const hits: string[] = [];
  let braceDepth = 0;
  let mode: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code';
  // Brace depth at which each open template-literal `${` sits.
  const interpolationDepths: number[] = [];
  // A line qualifies only when it BEGINS at module scope; the flag is latched
  // at the first non-whitespace character and read at the newline, so a `{`
  // later on the same line cannot retroactively disqualify it.
  let lineStart = 0;
  let lineStartedAtModuleScope = true;
  let lineBecameCode = false;
  let lineText = '';
  const consider = (lineEnd: number): void => {
    if (!lineStartedAtModuleScope || braceDepth !== 0) return;
    const code = lineText.trim();
    if (code !== '' && pattern.test(code)) {
      // Report the real source line so quoted fragments survive.
      hits.push(text.slice(lineStart, lineEnd).trim().slice(0, 140));
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') {
      consider(i);
      lineStart = i + 1;
      lineStartedAtModuleScope = true;
      lineBecameCode = false;
      lineText = '';
      if (mode === 'line') mode = 'code';
      continue;
    }
    if (!lineBecameCode && (ch === ' ' || ch === '\t')) {
      // Leading whitespace: an indented line never starts at module scope.
      lineStartedAtModuleScope = false;
      continue;
    }
    if (!lineBecameCode) {
      lineBecameCode = true;
      lineStartedAtModuleScope = lineStartedAtModuleScope && braceDepth === 0 && mode === 'code';
    }
    if (mode === 'code') lineText += ch;
    if (mode === 'line') continue;
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i++;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'template') {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (mode === 'template' && ch === '$' && next === '{') {
        mode = 'code';
        i++;
        braceDepth++;
        interpolationDepths.push(braceDepth);
        continue;
      }
      const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (ch === quote) mode = 'code';
      continue;
    }
    // code mode
    if (ch === '/' && next === '/') {
      mode = 'line';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = 'block';
      i++;
      continue;
    }
    if (ch === "'") mode = 'single';
    else if (ch === '"') mode = 'double';
    else if (ch === '`') mode = 'template';
    else if (ch === '{') braceDepth++;
    else if (ch === '}') {
      if (
        interpolationDepths.length > 0 &&
        braceDepth === interpolationDepths[interpolationDepths.length - 1]
      ) {
        interpolationDepths.pop();
        mode = 'template';
      } else if (braceDepth > 0) braceDepth--;
    }
  }
  consider(text.length);
  return hits;
}

/** Scan one packed package: `files` maps `package/<path>` to shipped text. */
export function scanPackedPackage(
  packageName: string,
  files: ReadonlyMap<string, string>,
): PackSurfaceViolation[] {
  const violations: PackSurfaceViolation[] = [];
  const manifestText = files.get('package/package.json');
  if (!manifestText) {
    return [
      {
        packageName,
        path: 'package.json',
        message: 'packed archive is missing package/package.json',
      },
    ];
  }
  const packageJson = JSON.parse(manifestText) as Record<string, unknown>;
  const metadata = packedMetadata(packageName);
  violations.push(...findMetadataViolations(packageName, packageJson, metadata));
  violations.push(...findMissingBinTargets(packageName, packageJson.bin, files));
  violations.push(
    ...findUndocumentedSubpaths(
      packageName,
      packageJson.exports,
      files.get('package/README.md') ?? '',
    ),
  );
  violations.push(...findUndeclaredSeamInstalls(packageName, packageJson.sideEffects, files));
  for (const [archivePath, text] of files) {
    const path = archivePath.replace(/^package\//, '');
    if (!isScannable(path)) continue;
    violations.push(...findInternalReferences(packageName, path, text));
    if (metadata.sideEffects === false && path.endsWith('.js')) {
      for (const write of findModuleScopeGlobalWrites(text)) {
        violations.push({
          packageName,
          path,
          message: `module-scope global write contradicts "sideEffects": false: ${write}`,
        });
      }
    }
  }
  return violations;
}

/**
 * Module-scope seam installs in one module, reported with the module-scope
 * line that performs them. Reuses the module-scope walker's limits: only calls
 * at brace depth 0 and outside string positions count, so an install written
 * inside a generated template literal (a consumer's emitted entry) is not
 * mistaken for the shipped module's own import-time effect.
 */
export function findModuleScopeSeamInstalls(text: string): string[] {
  return findModuleScopeGlobalWrites(text, SEAM_INSTALL_PATTERN);
}

/**
 * Modules a package ships while declaring them without side effects, yet whose
 * module scope installs a seam (#1425). `sideEffects: false` lets a bundler
 * remove the module body — and the bare import that reaches it — so the
 * install never runs at runtime while the artifact still looks correct. The
 * declaration must name every such module (or the package must declare
 * `sideEffects: true`).
 */
export function findUndeclaredSeamInstalls(
  packageName: string,
  sideEffects: unknown,
  files: ReadonlyMap<string, string>,
): PackSurfaceViolation[] {
  if (sideEffects === true || sideEffects === undefined) return [];
  const declared = Array.isArray(sideEffects)
    ? (sideEffects as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  const violations: PackSurfaceViolation[] = [];
  for (const [archivePath, text] of files) {
    const path = archivePath.replace(/^package\//, '');
    if (!path.endsWith('.js')) continue;
    for (const install of findModuleScopeSeamInstalls(text)) {
      if (declared.some((entry) => matchesDeclaredPath(entry, path))) continue;
      violations.push({
        packageName,
        path,
        message:
          `module-scope seam install is declared side-effect-free and would be ` +
          `tree-shaken away: ${install} (declare '${path}' in sideEffects)`,
      });
    }
  }
  return violations;
}

/**
 * Whether one `sideEffects` array entry covers one shipped path. Entries are
 * package-relative (`./src/index.js`); npm matches them as globs, so `*` spans
 * one path segment (`./src/*.js`) and `**` spans any number of them
 * (`./src/**`). The leading `./` is optional in npm's own reading, so it is
 * stripped before matching.
 */
function matchesDeclaredPath(entry: string, path: string): boolean {
  return globToRegExp(entry.replace(/^\.\//, '')).test(path);
}

/** npm-style glob -> anchored RegExp for package-relative paths. */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index++;
      // A globstar directly before a separator also consumes that separator,
      // so `src/**` covers `src/a.js` (which has no separator after `src`).
      if (pattern[index + 1] === '/') index++;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Decode one archive member as UTF-8 text, or null when it is binary. */
function decodeText(data: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/** Scan the shipped bytes of one packed tarball. */
async function scanTarball(pkg: PackageInfo): Promise<PackSurfaceViolation[]> {
  const tarball = tarballPath(pkg);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(tarball);
  } catch {
    throw new Error(
      `${tarball} is missing — run \`pnpm --dir tools/release run pack:dry-run\` first`,
    );
  }
  const files = new Map<string, string>();
  for (const entry of await parseTarGz(bytes)) {
    if (entry.type !== 'file') continue;
    const text = decodeText(entry.data);
    if (text !== null) files.set(entry.path, text);
  }
  console.log(`[pack-surface] ${pkg.name}: ${files.size} text member(s) scanned`);
  return scanPackedPackage(pkg.name, files);
}

function formatViolation(violation: PackSurfaceViolation): string {
  const line = violation.line ? `:${violation.line}` : '';
  return `  ${violation.packageName}/${violation.path}${line}: ${violation.message}`;
}

async function main(): Promise<void> {
  const packages = releasePublishOrder(await readPackages());
  const violations: PackSurfaceViolation[] = [];
  for (const pkg of packages) {
    violations.push(...(await scanTarball(pkg)));
  }
  const { blocking, advisory } = partitionViolations(violations);

  // Advisory findings stay visible on every run (a stale repo path or an ADR
  // id is still worth fixing) but must not stop a PR. Only a consumer-facing
  // contract violation exits non-zero.
  if (advisory.length > 0) {
    console.warn(`\nPacked facade advisories (#1412, non-blocking, ${advisory.length}):`);
    for (const violation of advisory) console.warn(formatViolation(violation));
  }
  if (blocking.length > 0) {
    console.error('\nPacked facade violations detected (#1412):');
    for (const violation of blocking) console.error(formatViolation(violation));
    process.exit(1);
  }
  console.log(
    `Packed facade check passed (${packages.length} packages: metadata, exports, bin and side-effects verified; ${advisory.length} advisory finding(s)).`,
  );
}

if (import.meta.main) await main();
