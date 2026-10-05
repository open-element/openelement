/**
 * One-knob release version bump (#1415; full stamp-surface rewrite in alpha9
 * C5, #1508 — the transitional manual is deleted with this rewrite and its
 * procedure lives in docs/maintainers/version-bump.md).
 *
 * A version bump is TEN text points plus the tracked generated outputs, not
 * one, and hand-editing them burned two release rounds in alpha.2 and the
 * alpha.8 stamp (#1515 missed the tracked generated manifest):
 *
 *   1-4.  packages/{element,router,create,ui}/package.json `version`
 *   5.    packages/create/src/version.ts `CREATE_VERSION`
 *   6.    docs/release/release-state.json `sourceVersion` and `activeTarget`
 *         (the activeTarget carries the `v` prefix)
 *   7.    tools/repo/check-release-state-machine.ts `ADMITTED_ACTIVE_TARGET`
 *   8.    its twin fixture tools/repo/check-release-state-machine.test.ts
 *         (`sourceVersion`, `activeTarget`, and the workspace-versions map)
 *   9-10. the root README.md / README.zh.md source-tree lines
 *   +     packages/ui/src/generated-manifest.json (a TRACKED generator output
 *         embedding the package version) and the www release-line module are
 *         refreshed by running the generate:all face after the text points.
 *
 * Usage:
 *   pnpm --dir tools/repo run version-bump 1.0.0-alpha.9               # dry run (default)
 *   pnpm --dir tools/repo run version-bump 1.0.0-alpha.9 --dry-run     # explicit dry run
 *   pnpm --dir tools/repo run version-bump 1.0.0-alpha.9 --write       # apply
 *
 * The dry run prints the diff for every text point plus the generated-output
 * preview so the stamp can be reviewed before anything is written. `--write`
 * performs the text edits, regenerates through generate:all, and fails when
 * the ten points do not end up carrying one version.
 *
 * What stays OUT of the knob (release bookkeeping that must not move at bump
 * time, with the reasons):
 *   - the CHANGELOG entry — authored prose, written by the release train;
 *   - release-state.json `registry` dist-tags and `latestPrerelease` — they
 *     record what the REGISTRY serves, which lags the source version until
 *     the packages actually publish;
 *   - packages/create/README.md's pinned install example — it documents the
 *     version npm's `@alpha` tag RESOLVES to (registry truth, same lag);
 *   - pnpm-lock.yaml — workspace links are recorded as `workspace:*` with no
 *     version token, so a bump normally produces no lock diff.
 *
 * The existing gates stay the second line of defence: `check-package-graph`
 * cross-asserts CREATE_VERSION and every package version against
 * docs/release/release-state.json, and `release:state-machine:check` asserts
 * the admitted-train model. Advancing ADMITTED_ACTIVE_TARGET here is still a
 * reviewed change to the state machine (the stamp commit carries it); the
 * knob just makes the twin sites move together instead of by memory.
 */

import { parse } from 'semver';
import { join, relative } from 'node:path';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { wwwReleaseAnchorDrift } from './www-release-anchor.ts';
import { commandStatus } from './node-command.ts';

/** Packages whose package.json carries the release line version. */
export const PACKAGE_CONFIGS: readonly string[] = [
  'packages/element/package.json',
  'packages/router/package.json',
  'packages/create/package.json',
  'packages/ui/package.json',
];

/** The embedded create-CLI version anchor. */
export const VERSION_SOURCE = 'packages/create/src/version.ts';

/** Registry-truth record: `sourceVersion` + `activeTarget` are stamp points. */
export const RELEASE_STATE = 'docs/release/release-state.json';

/** The state-machine source carrying the `ADMITTED_ACTIVE_TARGET` constant. */
export const ADMITTED_TARGET_SOURCE = 'tools/repo/check-release-state-machine.ts';

/** The twin fixture that must move with the constant (same commit, always). */
export const ADMITTED_TWIN_FIXTURE = 'tools/repo/check-release-state-machine.test.ts';

/** Tracked generator output embedding the version; refreshed by generate:all. */
export const GENERATED_MANIFEST = 'packages/ui/src/generated-manifest.json';

/** The root README source-tree sentences, with their bilingual anchors. */
export const README_SOURCE_LINES: readonly { path: string; anchor: string }[] = [
  { path: 'README.md', anchor: 'The source tree is `' },
  { path: 'README.zh.md', anchor: '全新公开基线 `' },
];

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

/** Which of the stamp points an edit belongs to. */
export type StampPoint =
  | 'package-config'
  | 'create-anchor'
  | 'release-state'
  | 'admitted-target'
  | 'admitted-twin'
  | 'readme-line';

/** One pending text edit. */
export interface VersionEdit {
  /** Repo-relative path. */
  path: string;
  /** Which stamp point this edit belongs to. */
  point: StampPoint;
  before: string;
  after: string;
}

/** Preview of one generated output the write step refreshes via generate:all. */
export interface GeneratedOutputPreview {
  /** Repo-relative path. */
  path: string;
  /** The version the generated output carries now (null when unreadable). */
  version: string | null;
}

export interface VersionBumpPlan {
  /** Version the tree carries now (from packages/element/package.json). */
  currentVersion: string;
  targetVersion: string;
  /** Text-point edits (points 1-10). */
  edits: VersionEdit[];
  /** Generated outputs refreshed through the generate:all face on --write. */
  generated: GeneratedOutputPreview[];
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

/** The version a generated manifest declares, or null when absent/invalid. */
export function readGeneratedManifestVersion(text: string): string | null {
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

/**
 * Rewrite release-state bookkeeping: `sourceVersion` (bare) and `activeTarget`
 * (`v`-prefixed). The `registry` dist-tags and `latestPrerelease` record what
 * npm serves and are deliberately NOT touched.
 */
export function rewriteReleaseState(text: string, from: string, to: string): string {
  const source = new RegExp(`("sourceVersion"\\s*:\\s*")${escapeRegExp(from)}(")`);
  const target = new RegExp(`("activeTarget"\\s*:\\s*"v)${escapeRegExp(from)}(")`);
  if (!source.test(text) || !target.test(text)) {
    throw new Error(`${RELEASE_STATE} does not carry sourceVersion/activeTarget "${from}"`);
  }
  return text.replace(source, `$1${to}$2`).replace(target, `$1${to}$2`);
}

/** Rewrite the admitted-train constant in the state machine source. */
export function rewriteAdmittedTarget(text: string, from: string, to: string): string {
  const pattern = new RegExp(`(ADMITTED_ACTIVE_TARGET\\s*=\\s*')v${escapeRegExp(from)}(')`);
  if (!pattern.test(text)) {
    throw new Error(`ADMITTED_ACTIVE_TARGET for "v${from}" not found in ${ADMITTED_TARGET_SOURCE}`);
  }
  return text.replace(pattern, `$1v${to}$2`);
}

/**
 * Rewrite the twin test fixture. Every QUOTED occurrence of the source
 * version moves: the pinned state's `sourceVersion`/`activeTarget` and the
 * workspace-versions map. Quote anchoring keeps registry-truth fixtures
 * (e.g. a router `0.41.0-alpha.8` history entry) untouched — they are not
 * substrings of the quoted source token.
 */
export function rewriteTwinFixture(text: string, from: string, to: string): string {
  const bare = `'${from}'`;
  const tagged = `'v${from}'`;
  const bareCount = text.split(bare).length - 1;
  const taggedCount = text.split(tagged).length - 1;
  if (bareCount < 1 || taggedCount < 1) {
    throw new Error(
      `${ADMITTED_TWIN_FIXTURE} does not carry the source version "${from}" ` +
        `(bare: ${bareCount}, v-tagged: ${taggedCount})`,
    );
  }
  return text.split(tagged).join(`'v${to}'`).split(bare).join(`'${to}'`);
}

/** Rewrite one README source-tree sentence, anchored to its bilingual lead. */
export function rewriteReadmeSourceLine(
  text: string,
  from: string,
  to: string,
  anchor: string,
  path: string,
): string {
  const pattern = new RegExp(`(${escapeRegExp(anchor)})${escapeRegExp(from)}(\`)`);
  if (!pattern.test(text)) {
    throw new Error(`${path} does not carry the source-tree line for "${from}"`);
  }
  return text.replace(pattern, `$1${to}$2`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the stamp plan without touching the filesystem beyond reads. */
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
  const pushEdit = (path: string, point: StampPoint, before: string, after: string): void => {
    if (after !== before) edits.push({ path, point, before, after });
  };

  for (const path of PACKAGE_CONFIGS) {
    const before = await readFile(join(root, path), 'utf8');
    pushEdit(
      path,
      'package-config',
      before,
      rewriteConfigVersion(before, currentVersion, targetVersion),
    );
  }

  const anchorBefore = await readFile(join(root, VERSION_SOURCE), 'utf8');
  pushEdit(
    VERSION_SOURCE,
    'create-anchor',
    anchorBefore,
    rewriteCreateVersion(anchorBefore, currentVersion, targetVersion),
  );

  const stateBefore = await readFile(join(root, RELEASE_STATE), 'utf8');
  pushEdit(
    RELEASE_STATE,
    'release-state',
    stateBefore,
    rewriteReleaseState(stateBefore, currentVersion, targetVersion),
  );

  const admittedBefore = await readFile(join(root, ADMITTED_TARGET_SOURCE), 'utf8');
  pushEdit(
    ADMITTED_TARGET_SOURCE,
    'admitted-target',
    admittedBefore,
    rewriteAdmittedTarget(admittedBefore, currentVersion, targetVersion),
  );

  const twinBefore = await readFile(join(root, ADMITTED_TWIN_FIXTURE), 'utf8');
  pushEdit(
    ADMITTED_TWIN_FIXTURE,
    'admitted-twin',
    twinBefore,
    rewriteTwinFixture(twinBefore, currentVersion, targetVersion),
  );

  for (const { path, anchor } of README_SOURCE_LINES) {
    const before = await readFile(join(root, path), 'utf8');
    pushEdit(
      path,
      'readme-line',
      before,
      rewriteReadmeSourceLine(before, currentVersion, targetVersion, anchor, path),
    );
  }

  const generated: GeneratedOutputPreview[] = [];
  try {
    const manifest = await readFile(join(root, GENERATED_MANIFEST), 'utf8');
    generated.push({ path: GENERATED_MANIFEST, version: readGeneratedManifestVersion(manifest) });
  } catch {
    generated.push({ path: GENERATED_MANIFEST, version: null });
  }

  return { currentVersion, targetVersion, edits, generated };
}

/**
 * The ten text points after a bump must all carry one version, the tracked
 * generated manifest must have been regenerated, and the www source-line
 * anchor must stay derived from release bookkeeping truth (the anchor audit
 * rides the same cross-assertion). Returns one message per point that does
 * not (empty when the tree is consistent).
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

  const state = await readFile(join(root, RELEASE_STATE), 'utf8');
  let parsedState: { sourceVersion?: unknown; activeTarget?: unknown };
  try {
    parsedState = JSON.parse(state) as { sourceVersion?: unknown; activeTarget?: unknown };
  } catch {
    parsedState = {};
  }
  if (parsedState.sourceVersion !== expected) {
    failures.push(
      `${RELEASE_STATE}: sourceVersion ${String(parsedState.sourceVersion)} != ${expected}`,
    );
  }
  if (parsedState.activeTarget !== `v${expected}`) {
    failures.push(
      `${RELEASE_STATE}: activeTarget ${String(parsedState.activeTarget)} != v${expected}`,
    );
  }

  const admitted = await readFile(join(root, ADMITTED_TARGET_SOURCE), 'utf8');
  const admittedMatch = admitted.match(/ADMITTED_ACTIVE_TARGET\s*=\s*'([^']+)'/u);
  if (admittedMatch?.[1] !== `v${expected}`) {
    failures.push(
      `${ADMITTED_TARGET_SOURCE}: ADMITTED_ACTIVE_TARGET ${String(admittedMatch?.[1])} != v${expected}`,
    );
  }

  const twin = await readFile(join(root, ADMITTED_TWIN_FIXTURE), 'utf8');
  if (!twin.includes(`sourceVersion: '${expected}'`)) {
    failures.push(`${ADMITTED_TWIN_FIXTURE}: pinned sourceVersion is not ${expected}`);
  }
  if (!twin.includes(`activeTarget: 'v${expected}'`)) {
    failures.push(`${ADMITTED_TWIN_FIXTURE}: pinned activeTarget is not v${expected}`);
  }

  for (const { path, anchor } of README_SOURCE_LINES) {
    const text = await readFile(join(root, path), 'utf8');
    if (!text.includes(`${anchor}${expected}\``)) {
      failures.push(`${path}: source-tree line does not carry ${expected}`);
    }
  }

  const manifest = await readFile(join(root, GENERATED_MANIFEST), 'utf8');
  const manifestVersion = readGeneratedManifestVersion(manifest);
  if (manifestVersion !== expected) {
    failures.push(
      `${GENERATED_MANIFEST}: version ${String(manifestVersion)} != ${expected} ` +
        '(regenerate with generate:all)',
    );
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

/**
 * Refresh the tracked generated outputs through the generate:all face (the
 * ui generated-manifest.json embeds the package version; the www release-line
 * module mirrors release-state.json). Runs the canonical discovery-to-dispatch
 * script so the generator set is never duplicated here.
 */
export async function regenerateTrackedOutputs(root: string): Promise<void> {
  const { code } = await commandStatus(process.execPath, {
    args: [join(root, 'tools/repo/generate-all.ts')],
    cwd: root,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (code !== 0) {
    throw new Error(`generate:all exited ${code}; the stamp is incomplete`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = argv.filter((arg) => !arg.startsWith('--'));
  const write = argv.includes('--write');
  const dryRun = argv.includes('--dry-run');
  if (write && dryRun) {
    console.error('version-bump: --write and --dry-run are mutually exclusive.');
    process.exit(2);
  }
  const root = process.cwd();
  const target = args[0];
  if (!target) {
    console.error(
      'usage: pnpm --dir tools/repo run version-bump <version> [--write]\n' +
        '       (dry run by default; --write applies the ten-point update + generate:all)',
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
  for (const output of plan.generated) {
    console.log(
      `--- ${output.path} (generated; refreshed via generate:all on --write)\n` +
        `+++ version ${output.version ?? '<unreadable>'} -> ${target}`,
    );
  }
  console.log(`\npoints: ${plan.edits.length} file(s) edited (ten stamp points)`);

  if (!write) {
    console.log('\ndry run: nothing written. Apply with `--write`.');
    return;
  }

  for (const edit of plan.edits) {
    await writeFile(join(root, edit.path), edit.after, 'utf8');
    console.log(`[version-bump] wrote ${edit.path}`);
  }

  await regenerateTrackedOutputs(root);

  const failures = await inconsistencyFailures(root, target);
  if (failures.length > 0) {
    console.error(
      `version-bump: stamp points are NOT consistent after the bump:\n  ${failures.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `version-bump: ten stamp points + generated outputs consistent at ${target}. ` +
      'Still by hand (release bookkeeping, not this knob): the CHANGELOG entry. ' +
      'Registry dist-tags, latestPrerelease, and the create README pinned example ' +
      'move only when the packages actually publish.',
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
