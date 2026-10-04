/**
 * One-knob release version bump (#1415).
 *
 * A version bump is FIVE points, not one, and hand-editing them burned two
 * release rounds in alpha.2:
 *
 *   1-4. packages/{element,router,create,ui}/package.json `version`
 *   5.    packages/create/src/version.ts `CREATE_VERSION`
 *
 * Usage:
 *   pnpm --dir tools/repo run version-bump 1.0.0-alpha.4              # dry run (default)
 *   pnpm --dir tools/repo run version-bump 1.0.0-alpha.4 --write      # apply
 *
 * Dry run prints the diff for points 1-5 so the points can be reviewed
 * before anything is written. `--write` performs the edits and fails when
 * the five points do not end up carrying one version.
 *
 * The existing gates stay the second line of defence: `check-package-graph`
 * cross-asserts CREATE_VERSION and every package version against
 * docs/release/release-state.json. Registry truth (release-state.json) is
 * release bookkeeping and is deliberately NOT touched here.
 *
 * Two #1468 guards ride the same knob and fail closed in both modes:
 *   - shipped source (each shipped package's src/ tree) must not carry
 *     historical release names (the retired 0.23/0.40/0.42/0.44 lines) —
 *     runtime copy and generated banners speak in protocol versions; release
 *     history belongs in docs, changelogs and content (the scan allowlist)
 *   - the www source-line anchor audit (www-release-anchor.ts): version.ts
 *     stays derived from the generated release-line module, which mirrors
 *     release-state.json
 */

import { parse } from 'semver';
import { join, relative } from 'node:path';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { wwwReleaseAnchorDrift } from './www-release-anchor.ts';

/** Packages whose package.json carries the release line version. */
export const PACKAGE_CONFIGS: readonly string[] = [
  'packages/element/package.json',
  'packages/router/package.json',
  'packages/create/package.json',
  'packages/ui/package.json',
];

/** The embedded create-CLI version anchor. */
export const VERSION_SOURCE = 'packages/create/src/version.ts';

/** The published packages' source trees scanned for historical release names. */
export const SHIPPED_SOURCE_ROOTS: readonly string[] = [
  'packages/element/src',
  'packages/router/src',
  'packages/create/src',
  'packages/ui/src',
];

/**
 * Paths exempt from the shipped-source scan: release history belongs in
 * docs, changelogs, site content, fixtures and lock files — never in what
 * consumers import.
 */
export const SHIPPED_SCAN_ALLOWLIST: readonly string[] = [
  'docs/',
  'CHANGELOG.md',
  'www/content/',
  '**/__fixtures__/**',
  'pnpm-lock.yaml',
];

/** Historical release-name lines that must not reappear in shipped source. */
const HISTORICAL_RELEASE_NAME = /(^|[^0-9.])v?0\.(23|40|42|44)([^0-9]|$)/u;

/** One historical release-name occurrence in shipped source. */
export interface HistoricalVersionFinding {
  /** Repo-relative path. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed offending line. */
  text: string;
}

/** Minimal glob match: `**` spans path segments, `*` stays within one. */
export function shippedScanAllowlisted(pattern: string, path: string): boolean {
  let body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  body = body.split('**').join('\u0000');
  body = body.split('*').join('[^/]*');
  body = body.split('\u0000').join('.*');
  // A trailing '/' means "everything under this directory".
  if (body.endsWith('/')) body += '.*';
  return new RegExp('^' + body + '$').test(path);
}

/**
 * Scan the shipped package sources for historical release names. A finding
 * means a retired release train leaked back into what consumers receive;
 * allowlisted paths are skipped.
 */
export async function historicalReleaseNameFindings(
  root: string,
): Promise<HistoricalVersionFinding[]> {
  const findings: HistoricalVersionFinding[] = [];
  for (const shippedRoot of SHIPPED_SOURCE_ROOTS) {
    const walkRoot = join(root, shippedRoot);
    try {
      await stat(walkRoot);
    } catch {
      continue; // root absent — nothing to scan
    }
    // Pre-order recursive scan; directory entries are skipped the way the
    // former files-only walker never yielded them. Findings sort by path
    // below, so enumeration order is not load-bearing.
    const entries = await readdir(walkRoot, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const entryPath = join(entry.parentPath, entry.name);
      const path = relative(root, entryPath);
      if (SHIPPED_SCAN_ALLOWLIST.some((pattern) => shippedScanAllowlisted(pattern, path))) {
        continue;
      }
      const lines = (await readFile(entryPath, 'utf8')).split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (HISTORICAL_RELEASE_NAME.test(lines[index])) {
          findings.push({ path, line: index + 1, text: lines[index].trim() });
        }
      }
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/** One pending text edit. */
export interface VersionEdit {
  /** Repo-relative path. */
  path: string;
  /** Which of the five points this edit belongs to. */
  point: 'package-config' | 'create-anchor';
  before: string;
  after: string;
}

export interface VersionBumpPlan {
  /** Version the tree carries now (from packages/element/package.json). */
  currentVersion: string;
  targetVersion: string;
  /** Package-config + anchor edits (points 1-5). */
  edits: VersionEdit[];
}

/** Validate the requested release version. Returns an error message or null. */
export function validateVersion(version: string): string | null {
  if (parse(version) === null) {
    return `"${version}" is not a valid semver version (expected e.g. 1.0.0-alpha.4).`;
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return `"${version}" must be a concrete version, not a range (e.g. 1.0.0-alpha.4).`;
  }
  return null;
}

/** The version a package.json declares, or null when absent/invalid. */
export function readConfigVersion(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Rewrite a package.json `version` field in place, preserving formatting. */
export function rewriteConfigVersion(text: string, from: string, to: string): string {
  const pattern = new RegExp(`("version"\\s*:\\s*")${escapeRegExp(from)}(")`);
  if (!pattern.test(text)) {
    throw new Error(`package.json does not declare version "${from}"`);
  }
  return text.replace(pattern, `$1${to}$2`);
}

/** Rewrite the CREATE_VERSION anchor, leaving VITE_STARTER_PIN alone. */
export function rewriteCreateVersion(text: string, from: string, to: string): string {
  const pattern = new RegExp(`(CREATE_VERSION = ')${escapeRegExp(from)}(')`);
  if (!pattern.test(text)) {
    throw new Error(`CREATE_VERSION anchor for "${from}" not found in ${VERSION_SOURCE}`);
  }
  return text.replace(pattern, `$1${to}$2`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the five-point plan without touching the filesystem beyond reads. */
export async function planVersionBump(
  root: string,
  targetVersion: string,
): Promise<VersionBumpPlan> {
  const elementConfig = await readFile(join(root, PACKAGE_CONFIGS[0]), 'utf8');
  const currentVersion = readConfigVersion(elementConfig);
  if (currentVersion === null) {
    throw new Error(`${PACKAGE_CONFIGS[0]} declares no version`);
  }

  const edits: VersionEdit[] = [];
  for (const path of PACKAGE_CONFIGS) {
    const before = await readFile(join(root, path), 'utf8');
    const after = rewriteConfigVersion(before, currentVersion, targetVersion);
    if (after !== before) {
      edits.push({ path, point: 'package-config', before, after });
    }
  }

  const anchorBefore = await readFile(join(root, VERSION_SOURCE), 'utf8');
  const anchorAfter = rewriteCreateVersion(anchorBefore, currentVersion, targetVersion);
  if (anchorAfter !== anchorBefore) {
    edits.push({
      path: VERSION_SOURCE,
      point: 'create-anchor',
      before: anchorBefore,
      after: anchorAfter,
    });
  }

  return { currentVersion, targetVersion, edits };
}

/**
 * The five points after a bump must all carry one version, and the www
 * source-line anchor must stay derived from release bookkeeping truth (the
 * anchor audit rides the same cross-assertion). Returns one message per point
 * that does not (empty when the tree is consistent).
 */
export async function inconsistencyFailures(root: string, expected: string): Promise<string[]> {
  const failures: string[] = [];
  for (const path of PACKAGE_CONFIGS) {
    const version = readConfigVersion(await readFile(join(root, path), 'utf8'));
    if (version !== expected) {
      failures.push(`${path}: version ${String(version)} != ${expected}`);
    }
  }
  const anchor = await readFile(join(root, VERSION_SOURCE), 'utf8');
  const match = anchor.match(/CREATE_VERSION = '([^']+)'/u);
  if (match?.[1] !== expected) {
    failures.push(`${VERSION_SOURCE}: CREATE_VERSION ${String(match?.[1])} != ${expected}`);
  }
  failures.push(...(await wwwReleaseAnchorDrift(root)));
  return failures;
}

/** Render a line diff (only the changed lines, plus a header). */
export function renderDiff(edit: VersionEdit, limit = 12): string {
  const before = edit.before.split('\n');
  const after = edit.after.split('\n');
  const lines = [`--- ${edit.path} (${edit.point})`, `+++ ${edit.path}`];
  let shown = 0;
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (before[index] === after[index]) continue;
    if (shown >= limit) {
      lines.push('  … (more changes elided)');
      break;
    }
    lines.push(`- ${before[index] ?? ''}`);
    lines.push(`+ ${after[index] ?? ''}`);
    shown += 1;
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const write = process.argv.slice(2).includes('--write');
  const root = process.cwd();
  const target = args[0];
  if (!target) {
    console.error(
      'usage: pnpm --dir tools/repo run version-bump <version> [--write]\n' +
        '       (dry run by default; --write applies the five-point update)',
    );
    process.exit(2);
  }
  const invalid = validateVersion(target);
  if (invalid) {
    console.error(`version-bump: ${invalid}`);
    process.exit(2);
  }

  const findings = await historicalReleaseNameFindings(root);
  if (findings.length > 0) {
    console.error(
      'version-bump: shipped source carries historical release names ' +
        '(runtime copy and generated banners must speak protocol versions, not release trains):',
    );
    for (const finding of findings) {
      console.error(`  ${finding.path}:${finding.line}: ${finding.text}`);
    }
    process.exit(1);
  }

  const plan = await planVersionBump(root, target);
  if (plan.currentVersion === target) {
    console.log(`version-bump: tree already at ${target}; nothing to do.`);
    return;
  }

  console.log(`version-bump: ${plan.currentVersion} -> ${target} (${write ? 'WRITE' : 'dry run'})`);
  for (const edit of plan.edits) console.log(renderDiff(edit));
  console.log(
    `\npoints: ${plan.edits.length} file(s) edited (4 package manifests + create anchor)`,
  );

  if (!write) {
    console.log('\ndry run: nothing written. Apply with `--write`.');
    return;
  }

  for (const edit of plan.edits) {
    await writeFile(join(root, edit.path), edit.after, 'utf8');
    console.log(`[version-bump] wrote ${edit.path}`);
  }

  const failures = await inconsistencyFailures(root, target);
  if (failures.length > 0) {
    console.error(
      `version-bump: five points are NOT consistent after the bump:\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `version-bump: five points consistent at ${target}. ` +
      'Still required (release bookkeeping, not this knob): ' +
      'docs/release/release-state.json sourceVersion/activeTarget + CHANGELOG entry.',
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`version-bump: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
