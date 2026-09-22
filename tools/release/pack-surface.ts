/**
 * Release gate: the packed npm facade (#1412).
 *
 * `deno pack` produces the artifact; tools/release/npm-manifest.ts owns the
 * metadata the coordinator writes into it. This check reads the REAL tarball
 * bytes (run tools/release#pack:dry-run first) and fails closed on four
 * things a consumer would otherwise see:
 *
 *   1. facade metadata (`homepage`, `keywords`, `engines`, `sideEffects`)
 *      missing or diverging from packedMetadata();
 *   2. repository-internal references in shipped text — a repo directory path
 *      (`packages/`, `tools/`, `www/`, `apps/`, `tests/`, `benchmarks/`,
 *      `docs/`) or a decision-record citation. The tarball is the only
 *      documentation a consumer can read; a path they cannot open is noise,
 *      and an ADR id is maintainer vocabulary;
 *   3. a packed export subpath that the shipped README never names;
 *   4. a module-scope write to a well-known global in a package declared
 *      `sideEffects: false`, which would make the tree-shaking claim false.
 *
 * Bytes are parsed in-process with the repository's standards-only tar reader
 * (tools/repo/tarball-inspect.ts), so the check inspects exactly what npm
 * installs and spawns nothing.
 */

import { type PackageInfo, readPackages, releasePublishOrder } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { parseTarGz } from '../repo/tarball-inspect.ts';
import { type PackedMetadata, packedMetadata } from './npm-manifest.ts';

/**
 * Repository directories a consumer cannot resolve. Matching requires a
 * directory boundary, so prose like "tests, HMR" or a consumer's own
 * `docs/guide/` path does not trip it. The captured directory name is group 2
 * (group 1 is the boundary character).
 */
const REPO_PATH_PATTERN =
  /(^|[^A-Za-z0-9_./-])(packages|tools|www|apps|tests|benchmarks|docs)\/[A-Za-z0-9._-]+/;

/** Decision-record vocabulary (`ADR-0143`, `ADR 0143`, `ADRs`). */
const ADR_PATTERN = /\bADRs?\b|ADR[- ]\d{4}/;

/** A write to a well-known global at the head of a module-scope statement. */
const GLOBAL_WRITE_PATTERN =
  /^(?:globalThis|window|document|customElements|self)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*=|\[)|^Object\.defineProperty\(\s*(?:globalThis|window|document|customElements)\b/;

/** Text members worth scanning: shipped code, declarations, docs, styles. */
const SCAN_EXTENSIONS = ['.js', '.mjs', '.cjs', '.d.ts', '.json', '.md', '.css', '.tmpl', '.txt'];

export interface PackSurfaceViolation {
  packageName: string;
  path: string;
  line?: number;
  message: string;
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
    const repoPath = line.match(REPO_PATH_PATTERN);
    if (repoPath) {
      violations.push({
        packageName,
        path,
        line: index + 1,
        message: `repository-internal path '${repoPath[2]}/' must not ship in an npm artifact`,
      });
    }
    if (ADR_PATTERN.test(line)) {
      violations.push({
        packageName,
        path,
        line: index + 1,
        message: 'decision-record citation (ADR) must not ship in an npm artifact',
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
      message: `${field} must be ${JSON.stringify(expected)}, got ${
        JSON.stringify(packageJson[field] ?? null)
      }`,
    });
  };
  if (packageJson.homepage !== metadata.homepage) fail('homepage', metadata.homepage);
  if (JSON.stringify(packageJson.keywords) !== JSON.stringify(metadata.keywords)) {
    fail('keywords', metadata.keywords);
  }
  if (
    metadata.engines && JSON.stringify(packageJson.engines) !== JSON.stringify(metadata.engines)
  ) {
    fail('engines', metadata.engines);
  }
  if (
    metadata.sideEffects !== undefined &&
    JSON.stringify(packageJson.sideEffects) !== JSON.stringify(metadata.sideEffects)
  ) {
    fail('sideEffects', metadata.sideEffects);
  }
  return violations;
}

/**
 * Export subpaths the shipped README never names. The README is the only
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
 * Module-scope writes to a well-known global in one module. Returns the
 * offending source lines.
 *
 * `sideEffects: false` tells a bundler it may drop an unused import, so a
 * write that runs merely because the module was imported would make the claim
 * a lie. Only writes at brace depth 0 AND outside every string/template/regex
 * position are reported: the polyfill banners in `ssr-polyfills.ts` carry
 * `globalThis.customElements = …` inside emitted template literals, which run
 * in a generated entry the consumer opts into, never on importing the shipped
 * module.
 */
export function findModuleScopeGlobalWrites(text: string): string[] {
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
    if (code !== '' && GLOBAL_WRITE_PATTERN.test(code)) {
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
    return [{
      packageName,
      path: 'package.json',
      message: 'packed archive is missing package/package.json',
    }];
  }
  const packageJson = JSON.parse(manifestText) as Record<string, unknown>;
  const metadata = packedMetadata(packageName);
  violations.push(...findMetadataViolations(packageName, packageJson, metadata));
  violations.push(
    ...findUndocumentedSubpaths(
      packageName,
      packageJson.exports,
      files.get('package/README.md') ?? '',
    ),
  );
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
    bytes = await Deno.readFile(tarball);
  } catch {
    throw new Error(`${tarball} is missing — run \`deno task pack:dry-run\` first`);
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

async function main(): Promise<void> {
  const packages = releasePublishOrder(await readPackages());
  const violations: PackSurfaceViolation[] = [];
  for (const pkg of packages) {
    violations.push(...await scanTarball(pkg));
  }

  if (violations.length > 0) {
    console.error('\nPacked facade violations detected (#1412):');
    for (const violation of violations) {
      const line = violation.line ? `:${violation.line}` : '';
      console.error(`  ${violation.packageName}/${violation.path}${line}: ${violation.message}`);
    }
    Deno.exit(1);
  }
  console.log(
    `Packed facade check passed (${packages.length} packages: metadata, no internal references, subpaths documented).`,
  );
}

if (import.meta.main) await main();
