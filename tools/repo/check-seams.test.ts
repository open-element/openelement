/**
 * check-seams.test.ts — negative proof for the seams-registry reader (P8).
 *
 * The check exists because `docs/architecture/seams.md` had no mechanical
 * reader (`grep -rn "seams" tools tests .githooks` found only runtime seam
 * files), so the AGENTS.md/P8 claim "a seam missing either does not pass the
 * gate" was not true: rows could lose cells, guards could be renamed, and the
 * KR-5 vaccine clause could be omitted without anything going red. A check
 * that only ever reports "0 violations on today's tree" proves nothing about
 * that, so this file pins the failure direction:
 *
 *   - the parser matrix: escaped pipes stay inside a cell, an unescaped pipe
 *     splits a row into six cells and is reported, empty cells are reported,
 *     a missing header/table is reported;
 *   - the guard matrix: a nonexistent `*.test.ts` path is a violation, a repo
 *     guard script (`check-*.ts`) is accepted, and a fixture-relative token
 *     (`e2e/probe.spec.ts` after the fixture directory) resolves;
 *   - the vaccine matrix: the literal missing/unreadable-behavior clause is
 *     required (the earlier liberal vocabulary match — "fails closed" anywhere
 *     in the row — no longer satisfies it), and a row carrying only that
 *     vocabulary is reported;
 *   - the evidence matrix: guard paths must be Git-tracked (a path that exists
 *     only in this working tree is reported), a guard spelling covered by
 *     `.gitignore` is reported even when the file does not exist in this tree
 *     (the lane-versus-integration gap), and an unreadable Git fails the check
 *     closed instead of assuming reproducibility;
 *   - the ratchet matrix: the merge-base Owner state is read from the registry
 *     revision (marked rows included, escaped pipes kept inside a Seam cell),
 *     a baseline entry for a row that is marked now is rejected, and
 *     de-marking a row that carried the marker at the merge base is rejected
 *     even when the baseline is edited in the same change to absorb it (the
 *     audited post-merge bypass). A clone without that history reports the
 *     history layer as unverified and the passing summary says so, instead of
 *     claiming a monotonicity proof it did not run;
 *   - the live tree: the registry as committed is clean, and every row carries
 *     the explicit clause.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  checkSeams,
  checkSeamsMarkdown,
  formatSeamsSummary,
  readBaseOwnerState,
  splitTableCells,
  type SeamCheckOptions,
  type SeamViolation,
} from './check-seams.ts';
import { spawnCommandSync } from './node-command.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const HEADER = '| Seam | Owner | Direction | Crossing artifacts | Guard test |';
const SEPARATOR = '| --- | --- | --- | --- | --- |';

/** One registry document from raw row lines (each row is five cells). */
function registry(rows: string[], header = HEADER, separator = SEPARATOR): string {
  return [`# Seams`, '', header, separator, ...rows, ''].join('\n');
}

/** A cell sentence that carries the KR-5 vaccine behavior. */
const VACCINE = 'Missing/unreadable behavior: the reader fails closed.';

function kinds(violations: SeamViolation[]): string[] {
  return violations.map((violation) => violation.kind);
}

/**
 * The R1 ratchet option set for one synthetic registry: `unmarked` is the
 * frozen legacy set, and `base` is the merge-base Owner state (seam name →
 * marked there); `null` is a clone without that history. Each test still
 * spells its own case and assertions.
 */
function ratchet(
  unmarked: string[],
  base: Readonly<Record<string, boolean>> | null = {},
): SeamCheckOptions {
  return {
    ownerRatchet: {
      unmarked: new Set(unmarked),
      baseOwnerState: base === null ? null : new Map(Object.entries(base)),
    },
  };
}

test('splitTableCells keeps an escaped pipe inside one cell and drops edge empties', () => {
  expect(splitTableCells('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
  expect(splitTableCells('| a |  | c |')).toEqual(['a', '', 'c']);
  expect(splitTableCells('| a | b | c | d | e |')).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('a well-formed row with an existing test guard and the vaccine clause passes', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | \`owner.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
      `| Sample seam 2 | \`owner.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(report.violations).toEqual([]);
  expect(report.rowCount).toBe(2);
  expect(report.guardedRows).toBe(2);
});

test('an unescaped pipe splits a row into six cells and is reported as malformed', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`a | b\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('malformed-row');
  expect(report.violations[0]!.detail).toContain('expected 5 cells, found 6');
});

test('a row with fewer than five cells is reported as malformed', () => {
  const report = checkSeamsMarkdown(
    registry([`| Sample | owner | writer → reader | ${VACCINE} |`]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('malformed-row');
  expect(report.violations[0]!.detail).toContain('expected 5 cells, found 4');
});

test('R1 ratchet: an unmarked row is reported once the frozen set does not list it', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| New seam | \`owner.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([]),
  );
  expect(kinds(report.violations)).toContain('owner-baseline-missing');
});

test('R1 ratchet: a marked row naming one existing repo path passes', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| New seam | ONE owner: \`tools/repo/checker-io.ts\` — the one writer | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([]),
  );
  expect(kinds(report.violations)).not.toContain('owner-ambiguous');
  expect(kinds(report.violations)).not.toContain('owner-baseline-missing');
  expect(report.markedRows).toBe(1);
});

test('R1 ratchet: a marked row naming two repo paths is reported as ambiguous', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| New seam | ONE owner: \`tools/repo/checker-io.ts\` and \`tools/repo/check-seams.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([]),
  );
  expect(kinds(report.violations)).toContain('owner-ambiguous');
});

test('R1 ratchet: an Owner cell carrying the marker twice is reported even with one path', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| New seam | ONE owner: \`tools/repo/checker-io.ts\` (ONE owner: the one writer) | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([]),
  );
  expect(kinds(report.violations)).toContain('owner-ambiguous');
  expect(kinds(report.violations)).not.toContain('owner-path-missing');
  expect(report.markedRows).toBe(1);
});

test('R1 ratchet: a marked row naming a missing path is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| New seam | ONE owner: \`tools/repo/does-not-exist.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([]),
  );
  expect(kinds(report.violations)).toContain('owner-path-missing');
});

test('R1 ratchet: a baseline entry with no row is stale', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | \`owner.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam', 'Ghost seam'], { 'Sample seam': false, 'Ghost seam': false }),
  );
  expect(kinds(report.violations)).toContain('owner-baseline-stale');
});

test('R1 ratchet: a baseline entry that did not exist at the merge base is unverifiable', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | \`owner.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam']),
  );
  expect(kinds(report.violations)).toContain('owner-baseline-unverifiable');
});

test('R1 ratchet: a baseline entry whose row is marked now is rejected (the frozen set may only shrink)', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | ONE owner: \`tools/repo/checker-io.ts\` — the one writer | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam'], { 'Sample seam': false }),
  );
  expect(kinds(report.violations)).toContain('owner-baseline-marked');
  expect(kinds(report.violations)).not.toContain('owner-marked-regression');
  expect(report.markedRows).toBe(1);
});

test('R1 ratchet: de-marking a row marked at the merge base and adding it to the baseline is rejected', () => {
  // The audited post-merge bypass: the row already existed at the merge base,
  // so a name-presence-only layer waves the forged baseline entry through.
  // Its Owner state was marked there, so this must be both a regression and
  // an illegal baseline entry — never "frozen legacy".
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | plain owner text | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam'], { 'Sample seam': true }),
  );
  const found = kinds(report.violations);
  expect(found).toContain('owner-marked-regression');
  expect(found).toContain('owner-baseline-marked');
  expect(report.historyLayer).toBe('verified');
});

test('R1 ratchet: a marked row that loses the marker is a regression, not merely a missing baseline entry', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | plain owner text | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet([], { 'Sample seam': true }),
  );
  const found = kinds(report.violations);
  expect(found).toContain('owner-marked-regression');
  expect(found).toContain('owner-baseline-missing');
});

test('a clone without the merge-base history runs the row-level ratchet and reports the history layer unverified', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | plain owner text | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam'], null),
  );
  expect(report.violations).toEqual([]);
  expect(report.historyLayer).toBe('unverified');
  const summary = formatSeamsSummary(report);
  expect(summary).toContain('NOT verified');
  expect(summary).not.toContain('is monotone');
});

test('the passing summary states the verified history layer only when the Owner state was read', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample seam | plain owner text | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    ratchet(['Sample seam'], { 'Sample seam': false }),
  );
  expect(report.violations).toEqual([]);
  expect(report.historyLayer).toBe('verified');
  const summary = formatSeamsSummary(report);
  expect(summary).toContain('R1 ratchet enforced');
  expect(summary).not.toContain('NOT verified');
  expect(summary.includes('\n')).toBe(false);
});

test('the merge-base Owner state is read from the registry revision, marked rows included', () => {
  const root = mkdtempSync(join(tmpdir(), 'oe-seams-base-'));
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    const decoder = new TextDecoder();
    const git = (args: string[]) =>
      spawnCommandSync('git', { args, cwd: root, env, stdin: 'null' });
    expect(git(['init', '-q']).success).toBe(true);
    mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
    writeFileSync(
      join(root, 'docs/architecture/seams.md'),
      registry([
        `| Marked seam \\| alias | ONE owner: \`tools/repo/checker-io.ts\` | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
        `| Unmarked seam | plain owner text | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
      ]),
      'utf8',
    );
    expect(git(['add', 'docs/architecture/seams.md']).success).toBe(true);
    const commit = git([
      '-c',
      'user.name=seams-base-probe',
      '-c',
      'user.email=seams-base-probe@localhost',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'base registry',
    ]);
    expect(commit.success, decoder.decode(commit.stderr)).toBe(true);
    const ref = git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    expect(ref.success, decoder.decode(ref.stderr)).toBe(true);
    const state = readBaseOwnerState(root);
    expect(state).not.toBeNull();
    expect([...state!.keys()].sort()).toEqual(['Marked seam | alias', 'Unmarked seam']);
    expect(state!.get('Marked seam | alias')).toBe(true);
    expect(state!.get('Unmarked seam')).toBe(false);
    expect(readBaseOwnerState('/nonexistent-root-for-tracking-proof')).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty owner cell is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample |  | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('empty-cell');
});

test('a row without the missing/unreadable-behavior statement is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('missing-vaccine');
});

test('the liberal vaccine vocabulary without the literal clause is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` absent → the reader fails closed with a default; nothing else. | \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('missing-vaccine');
  expect(report.explicitRows).toBe(0);
});

test('guard evidence that exists but is not Git-tracked is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    { tracked: new Set(['docs/architecture/seams.md']) },
  );
  expect(kinds(report.violations)).toContain('guard-not-tracked');
});

test('guard evidence in the tracked set passes the evidence rule', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    repoRoot,
    { tracked: new Set(['tools/repo/check-vp-selector-flags.test.ts']) },
  );
  expect(report.violations).toEqual([]);
});

test('an unreadable Git fails closed instead of assuming guard evidence is reproducible', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
    ]),
    '/nonexistent-root-for-tracking-proof',
  );
  expect(kinds(report.violations)).toContain('tracking-unavailable');
});

test('a guard spelling covered by .gitignore is reported even when the file does not exist', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\`; negative proof in \`.zcode/scratch/proof-red.txt\` |`,
    ]),
    repoRoot,
    {
      tracked: new Set(['tools/repo/check-vp-selector-flags.test.ts']),
      ignored: new Set(['.zcode/scratch/proof-red.txt']),
    },
  );
  expect(kinds(report.violations)).toContain('guard-evidence-ignored');
  expect(kinds(report.violations)).not.toContain('guard-not-tracked');
});

test('the live registry itself carries no .gitignore-only guard spelling', () => {
  const report = checkSeams(repoRoot);
  expect(kinds(report.violations)).not.toContain('guard-evidence-ignored');
});

test('a guard-cell test path that does not exist is reported', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/does-not-exist.test.ts\` |`,
    ]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('guard-test-unresolved');
  expect(kinds(report.violations)).toContain('guard-not-a-test');
});

test('a repo guard script (check-*.ts) is accepted as a guard artifact', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`www/tools/check-site-theme-tokens.ts\` |`,
    ]),
    repoRoot,
  );
  expect(report.violations).toEqual([]);
});

test('a fixture-relative guard token resolves against the fixture directory named earlier', () => {
  const report = checkSeamsMarkdown(
    registry([
      `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tests/fixtures/router-unocss-probe\`; \`e2e/probe.spec.ts\` |`,
    ]),
    repoRoot,
  );
  expect(report.violations).toEqual([]);
});

test('a wrong header is reported instead of silently reading the wrong columns', () => {
  const report = checkSeamsMarkdown(
    registry(
      [
        `| Sample | owner | writer → reader | \`artifact\` | ${VACCINE} \`tools/repo/check-vp-selector-flags.test.ts\` |`,
      ],
      '| Name | Owner | Direction | Crossing artifacts | Guard test |',
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('malformed-row');
});

test('a document without a table fails closed instead of passing vacuously', () => {
  const report = checkSeamsMarkdown('# Seams\n\nno table here\n', repoRoot);
  expect(kinds(report.violations)).toContain('table-missing');
  expect(report.rowCount).toBe(0);
});

test('a header-only table fails closed', () => {
  const report = checkSeamsMarkdown(registry([]), repoRoot);
  expect(kinds(report.violations)).toContain('table-missing');
});

test('the live seams registry is clean (this is the drift guard, not a smoke test)', () => {
  const report = checkSeams(repoRoot);
  expect(
    report.violations,
    report.violations.map((violation) => `${violation.line}: ${violation.detail}`).join('\n'),
  ).toEqual([]);
  expect(report.rowCount).toBeGreaterThanOrEqual(43);
  expect(report.guardedRows).toBe(report.rowCount);
  expect(report.explicitRows).toBe(report.rowCount);
  // History-layer wiring: a full checkout verifies the merge-base Owner state;
  // a shallow one must report it UNVERIFIED and say so in the summary instead
  // of letting the pass read as a monotonicity proof.
  const baseState = readBaseOwnerState(repoRoot);
  expect(report.historyLayer).toBe(baseState === null ? 'unverified' : 'verified');
  expect(formatSeamsSummary(report).includes('NOT verified')).toBe(baseState === null);
});
