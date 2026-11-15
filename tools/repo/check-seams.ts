/**
 * check-seams.ts — the mechanical reader for the seams registry (P8).
 *
 * `docs/architecture/seams.md` is the live registry ADR-0163 / design
 * principle P8 requires: every seam (a boundary where one system writes what
 * another reads) names one owner, the crossing artifacts, the guard test that
 * fails at the crossing, and — the KR-5 vaccine clause — what the reader does
 * when the artifact is missing or unreadable. The registry is hand-maintained,
 * so without a reader it rots: a renamed or deleted guard test, a row that
 * loses a cell to an unescaped `|`, or a row that never states its failure
 * mode all stay invisible to every other gate.
 *
 * This check makes the registry fail closed:
 *
 *   - The table must exist with the exact five-column header (`Seam`, `Owner`,
 *     `Direction`, `Crossing artifacts`, `Guard test`) and a markdown
 *     separator row. Every data row must have exactly five cells when split
 *     on pipes that are NOT backslash-escaped (`\|` is content, per GitHub
 *     Flavored Markdown). Empty cells are violations.
 *   - Every row must name at least one guard-test path that exists on disk.
 *     Paths are read from backticked spans; absolute-from-repo-root and
 *     fixture-relative forms are both supported (`tests/fixtures/…` followed
 *     by `e2e/foo.spec.ts` resolves against the fixture directory named
 *     earlier in the same cell). A token that is spelled like a test file
 *     (`*.test.ts`, `*.spec.tsx`, …) but does not resolve is a violation, so
 *     a renamed/deleted guard cannot stay registered. The row needs at least
 *     one guard that IS a test/spec file, not just any existing path.
 *   - Every row must carry the vaccine statement LITERALLY, one English
 *     clause per row: `Missing/unreadable behavior: …`. The earlier liberal
 *     match (`missing`/`unreadable`/`fail`/`default`/`nothing` anywhere in the
 *     row) passed all 43 rows while only 14 stated the behavior explicitly —
 *     an unrelated "fails closed" elsewhere in the row satisfied it. The
 *     clause is now the row's own sentence, so the registry cannot answer the
 *     KR-5 question by accident.
 *   - Every path the guard cell resolves must be TRACKED by Git
 *     (`git ls-files`). A guard path that exists only in a working tree —
 *     a local scratch file, a generated artifact, a path typed from memory —
 *     is not evidence a clone or CI run can reproduce, so it is a violation.
 *     The check fails closed when Git itself cannot be read.
 *   - No guard-cell path spelling may be covered by `.gitignore`
 *     (`git check-ignore`), whether or not the file exists in this working
 *     tree. A lane worktree does not carry another tree's untracked files, so
 *     "it does not exist here" is not a defence: the integrated tree reds
 *     later. Negative proofs belong in the cell as a reproducible METHOD
 *     (what to revert, what reds) or as a tracked artifact.
 *   - The registry must parse to at least one data row and at least one guard
 *     test overall: a scan that read nothing fails closed instead of
 *     reporting a vacuous pass.
 *
 * The CLI reports `N rows / M explicit` so a shrinking explicit set is visible
 * in the gate log instead of hiding behind "0 violations".
 *
 * CLI:
 *   node tools/repo/check-seams.ts [--root=<dir>]
 * Exit 0 = the registry is parseable and every row carries owner, direction,
 * artifacts, an existing guard test, and the vaccine statement; 1 = at least
 * one violation (printed with file:line).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { emitSummary } from './checker-io.ts';
import { fileURLToPath } from 'node:url';

export const SEAMS_PATH = 'docs/architecture/seams.md';

/** The registry's one supported table shape. */
export const EXPECTED_HEADER = ['Seam', 'Owner', 'Direction', 'Crossing artifacts', 'Guard test'];

/**
 * KR-5 vaccine clause: a row must answer "what does the reader do when the
 * artifact is missing or unreadable" in this exact spelling, in English. The
 * literal is the contract the registry's rows are written against; a row that
 * merely contains the words somewhere does not answer the question.
 */
export const VACCINE_CLAUSE = 'Missing/unreadable behavior:';

/** A path spelled as a test file: renamed/deleted ones must fail the check. */
const TEST_FILE_SPELLING = /\.(?:test|spec)\.(?:ts|tsx|mts|js|mjs|cjs)$/;

/**
 * The registry's guard column also names the repo's own guard SCRIPTS, which
 * are consumer-form gates even though they are not `*.test.ts` files:
 * `check-<name>.ts` (e.g. the theme-token checker `check:theme-tokens` runs in
 * gate:release) and the packed-consumer proof scripts. Both conventions are
 * accepted as a guard artifact; a test/spec spelling is still resolved and
 * required to exist on its own (renamed tests cannot stay registered).
 */
const GUARD_SCRIPT_SPELLING = /(?:^|\/)(?:check-|consumer-packaged-)[a-z0-9-]+\.ts$/;

export type SeamViolationKind =
  | 'registry-missing'
  | 'table-missing'
  | 'malformed-row'
  | 'empty-cell'
  | 'missing-vaccine'
  | 'missing-guard'
  | 'guard-test-unresolved'
  | 'guard-not-a-test'
  | 'guard-not-tracked'
  | 'guard-evidence-ignored'
  | 'tracking-unavailable'
  | 'vacuous';

export interface SeamViolation {
  kind: SeamViolationKind;
  /** 1-based line in seams.md; 0 for whole-registry violations. */
  line: number;
  detail: string;
}

export interface SeamRow {
  /** 1-based line in seams.md. */
  line: number;
  cells: [string, string, string, string, string];
}

export interface SeamReport {
  rowCount: number;
  /** Rows whose guard cell resolved at least one existing test file. */
  guardedRows: number;
  /** Rows carrying the literal `Missing/unreadable behavior:` clause. */
  explicitRows: number;
  violations: SeamViolation[];
}

/**
 * Every path Git tracks under `root`, or undefined when Git cannot be read
 * (no repository, no `git` binary). Undefined fails the check closed: the
 * registry's evidence may not be assumed reproducible.
 */
export function gitTrackedPaths(root: string): Set<string> | undefined {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(output.split('\0').filter((entry) => entry !== ''));
  } catch {
    return undefined;
  }
}

/**
 * Whether a guard-cell token may be handed to `git check-ignore`: a
 * repo-relative spelling (no absolute, route or virtual-id forms), which is
 * what a citation of evidence looks like.
 */
export function isIgnoreCandidate(token: string): boolean {
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_@./-]*$/.test(token)) return false;
  return token.includes('/') || /\.(?:ts|tsx|mts|js|mjs|cjs|css|json|md|mdx|html|txt)$/.test(token);
}

/**
 * Which of `tokens` are covered by `.gitignore` under `root`, or undefined when
 * Git cannot answer. An ignored spelling is never reproducible evidence, even
 * when the file happens not to exist in this working tree — which is exactly
 * how a lane can pass while the integrated tree reds.
 */
export function gitIgnoredPaths(tokens: readonly string[], root: string): Set<string> | undefined {
  const candidates = tokens.filter(isIgnoreCandidate);
  if (candidates.length === 0) return new Set();
  try {
    const output = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root,
      input: `${candidates.join('\0')}\0`,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return new Set(output.split('\0').filter((entry) => entry !== ''));
  } catch (error) {
    // `git check-ignore` exits 1 when nothing matches — the normal case.
    if ((error as { status?: number }).status === 1) return new Set();
    return undefined;
  }
}

/** Whether a repo-relative file or directory is covered by `git ls-files`. */
export function isTrackedPath(
  tracked: ReadonlySet<string>,
  repoRelative: string,
  kind: 'file' | 'dir',
): boolean {
  if (kind === 'file') return tracked.has(repoRelative);
  const prefix = repoRelative.endsWith('/') ? repoRelative : `${repoRelative}/`;
  for (const path of tracked) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/** Split one markdown table line into cells, honoring GFM `\|` escapes. */
export function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '\\') {
      if (next === '|') {
        current += '|';
        index++;
        continue;
      }
      if (next === '\\') {
        current += '\\';
        index++;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  // A row that starts/ends with a pipe carries one empty edge cell each.
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/** Every backticked span in a cell, in order. */
export function backtickedTokens(cell: string): string[] {
  const tokens: string[] = [];
  for (const match of cell.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1]!.trim();
    if (token !== '') tokens.push(token);
  }
  return tokens;
}

/**
 * Whether a backticked token is a repository path worth resolving. Package
 * task specifiers (`@openelement/www#check:theme-tokens`), URLs and prose
 * fragments are not paths.
 */
export function looksLikeRepoPath(token: string): boolean {
  if (token.startsWith('#') || token.startsWith('@')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(token)) return false;
  if (/^[a-z][a-z0-9-]*#[a-z]/i.test(token)) return false;
  if (token.includes('/')) return true;
  return /\.(?:ts|tsx|mts|js|mjs|cjs|css|json|md|mdx|html)$/.test(token);
}

/**
 * Resolve one path token against the repo root and, when the token is
 * fixture-relative, against the directory of the last resolved path in the
 * same cell. Returns the repo-relative path of the first existing candidate.
 */
export function resolveSeamPath(
  token: string,
  rowDir: string,
  exists: (repoRelative: string) => boolean,
  kindOf: (repoRelative: string) => 'file' | 'dir',
): { path: string; kind: 'file' | 'dir' } | undefined {
  const cleaned = token.replace(/^\.\//, '');
  const candidates = [cleaned];
  if (rowDir !== '' && !cleaned.startsWith(rowDir)) {
    candidates.push(join(rowDir, cleaned));
  }
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { path: candidate, kind: kindOf(candidate) };
    }
  }
  return undefined;
}

/** One row's guard-cell analysis. */
interface GuardAnalysis {
  resolved: Array<{ path: string; kind: 'file' | 'dir'; test: boolean }>;
  unresolvedTestSpellings: string[];
}

/** Resolve every path token in a guard cell, threading fixture-relative dirs. */
function analyzeGuardCell(
  guardCell: string,
  exists: (repoRelative: string) => boolean,
  kindOf: (repoRelative: string) => 'file' | 'dir',
): GuardAnalysis {
  const guard: GuardAnalysis = { resolved: [], unresolvedTestSpellings: [] };
  let lastDir = '';
  for (const token of backtickedTokens(guardCell)) {
    if (!looksLikeRepoPath(token)) continue;
    const hit = resolveSeamPath(token, lastDir, exists, kindOf);
    if (hit !== undefined) {
      lastDir = hit.kind === 'dir' ? hit.path : dirname(hit.path);
      guard.resolved.push({
        path: hit.path,
        kind: hit.kind,
        test: TEST_FILE_SPELLING.test(token) || GUARD_SCRIPT_SPELLING.test(token),
      });
      continue;
    }
    if (TEST_FILE_SPELLING.test(token)) guard.unresolvedTestSpellings.push(token);
  }
  return guard;
}

export interface SeamCheckOptions {
  /**
   * The Git-tracked path set to validate guard evidence against. Omitted
   * means "read `git ls-files` under the root"; an unreadable Git fails the
   * check closed instead of assuming the evidence is reproducible.
   */
  tracked?: ReadonlySet<string>;
  /**
   * The guard-cell path tokens covered by `.gitignore`. Omitted means "ask
   * `git check-ignore`"; an unreadable Git fails the same way `tracked` does.
   */
  ignored?: ReadonlySet<string>;
}

/** Structural + semantic check of one registry document. */
export function checkSeamsMarkdown(
  markdown: string,
  root: string,
  options: SeamCheckOptions = {},
): SeamReport {
  const violations: SeamViolation[] = [];
  const lines = markdown.split(/\r?\n/);
  const tableStart = lines.findIndex((line) => line.startsWith('|'));
  if (tableStart === -1) {
    violations.push({ kind: 'table-missing', line: 0, detail: 'no markdown table found' });
    return { rowCount: 0, guardedRows: 0, explicitRows: 0, violations };
  }
  const tableLines: Array<{ line: number; text: string }> = [];
  for (let index = tableStart; index < lines.length; index++) {
    if (!lines[index]!.startsWith('|')) break;
    tableLines.push({ line: index + 1, text: lines[index]! });
  }
  if (tableLines.length < 3) {
    violations.push({
      kind: 'table-missing',
      line: tableStart + 1,
      detail: `table needs a header, a separator and at least one data row; found ${tableLines.length} line(s)`,
    });
    return { rowCount: 0, guardedRows: 0, explicitRows: 0, violations };
  }
  const exists = (repoRelative: string): boolean => existsSync(join(root, repoRelative));
  const kindOf = (repoRelative: string): 'file' | 'dir' => {
    try {
      return statSync(join(root, repoRelative)).isFile() ? 'file' : 'dir';
    } catch {
      return 'dir';
    }
  };

  const header = splitTableCells(tableLines[0]!.text);
  if (
    header.length !== EXPECTED_HEADER.length ||
    header.some((cell, i) => cell !== EXPECTED_HEADER[i])
  ) {
    violations.push({
      kind: 'malformed-row',
      line: tableLines[0]!.line,
      detail: `header must be exactly ${EXPECTED_HEADER.join(' | ')}; found ${header.join(' | ')}`,
    });
  }
  const separator = splitTableCells(tableLines[1]!.text);
  if (
    separator.length !== EXPECTED_HEADER.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    violations.push({
      kind: 'malformed-row',
      line: tableLines[1]!.line,
      detail: `separator row must carry ${EXPECTED_HEADER.length} dash cells; found ${separator.length}`,
    });
  }

  const tracked = options.tracked ?? gitTrackedPaths(root);
  if (tracked === undefined) {
    violations.push({
      kind: 'tracking-unavailable',
      line: 0,
      detail:
        'git ls-files could not be read under the root — guard evidence cannot be proven ' +
        'tracked; refusing to pass on an unverifiable tree',
    });
  }
  // Every path spelling any guard cell names, whether or not it resolves in
  // THIS working tree: an ignored spelling is unreproducible evidence even
  // where the file happens not to exist, which is how a lane can pass while
  // the integrated tree fails.
  const guardTokens = new Set<string>();
  for (const { text } of tableLines.slice(2)) {
    const cells = splitTableCells(text);
    if (cells.length !== EXPECTED_HEADER.length) continue;
    for (const token of backtickedTokens(cells[4]!)) {
      if (looksLikeRepoPath(token)) guardTokens.add(token);
    }
  }
  const ignored =
    options.ignored ??
    (tracked === undefined ? undefined : gitIgnoredPaths([...guardTokens], root));
  if (tracked !== undefined && ignored === undefined) {
    violations.push({
      kind: 'tracking-unavailable',
      line: 0,
      detail:
        'git check-ignore could not be read under the root — a .gitignore-only guard spelling ' +
        'cannot be ruled out; refusing to pass on an unverifiable tree',
    });
  }

  let rowCount = 0;
  let guardedRows = 0;
  let explicitRows = 0;
  for (const { line, text } of tableLines.slice(2)) {
    rowCount++;
    const cells = splitTableCells(text);
    if (cells.length !== EXPECTED_HEADER.length) {
      violations.push({
        kind: 'malformed-row',
        line,
        detail: `expected ${EXPECTED_HEADER.length} cells, found ${cells.length} (an unescaped '|' inside a cell splits it)`,
      });
      continue;
    }
    const row = cells as SeamRow['cells'];
    const seam = row[0];
    let empty = false;
    row.forEach((cell, index) => {
      if (cell === '') {
        empty = true;
        violations.push({
          kind: 'empty-cell',
          line,
          detail: `row ${JSON.stringify(seam)}: '${EXPECTED_HEADER[index]}' cell is empty`,
        });
      }
    });
    if (empty) continue;
    if (row.join(' ').includes(VACCINE_CLAUSE)) {
      explicitRows++;
    } else {
      violations.push({
        kind: 'missing-vaccine',
        line,
        detail:
          `row ${JSON.stringify(seam)}: no literal ${JSON.stringify(VACCINE_CLAUSE)} clause — the ` +
          'KR-5 vaccine clause requires the row to STATE what the reader does when the artifact ' +
          'is missing or unreadable, in that clause',
      });
    }
    const guard = analyzeGuardCell(row[4], exists, kindOf);
    for (const unresolved of guard.unresolvedTestSpellings) {
      violations.push({
        kind: 'guard-test-unresolved',
        line,
        detail: `row ${JSON.stringify(seam)}: guard test ${JSON.stringify(unresolved)} does not exist`,
      });
    }
    if (tracked !== undefined) {
      for (const entry of guard.resolved) {
        if (!isTrackedPath(tracked, entry.path, entry.kind)) {
          violations.push({
            kind: 'guard-not-tracked',
            line,
            detail:
              `row ${JSON.stringify(seam)}: guard evidence ${JSON.stringify(entry.path)} exists ` +
              'but is not tracked by Git — a clone or CI run cannot reproduce it',
          });
        }
      }
    }
    if (ignored !== undefined) {
      for (const token of backtickedTokens(row[4])) {
        if (!ignored.has(token)) continue;
        violations.push({
          kind: 'guard-evidence-ignored',
          line,
          detail:
            `row ${JSON.stringify(seam)}: guard evidence ${JSON.stringify(token)} is covered by ` +
            '.gitignore — a clone or CI run cannot reproduce it (state the reproducible method ' +
            'or cite a tracked artifact instead)',
        });
      }
    }
    if (!guard.resolved.some((entry) => entry.test)) {
      violations.push({
        kind: 'guard-not-a-test',
        line,
        detail:
          `row ${JSON.stringify(seam)}: no existing test/guard path in the 'Guard test' cell ` +
          `(resolved: ${guard.resolved.map((entry) => entry.path).join(', ') || 'none'})`,
      });
    } else {
      guardedRows++;
    }
  }
  if (rowCount === 0) {
    violations.push({ kind: 'vacuous', line: tableStart + 1, detail: 'table has no data rows' });
  }
  return { rowCount, guardedRows, explicitRows, violations };
}

/** Read and check the registry at `<root>/docs/architecture/seams.md`. */
export function checkSeams(root: string, options: SeamCheckOptions = {}): SeamReport {
  const file = join(root, SEAMS_PATH);
  if (!existsSync(file)) {
    return {
      rowCount: 0,
      guardedRows: 0,
      explicitRows: 0,
      violations: [{ kind: 'registry-missing', line: 0, detail: `${SEAMS_PATH} does not exist` }],
    };
  }
  return checkSeamsMarkdown(readFileSync(file, 'utf8'), root, options);
}

function formatViolation(violation: SeamViolation): string {
  const where = violation.line > 0 ? `${SEAMS_PATH}:${violation.line}` : SEAMS_PATH;
  return `${where}: ${violation.kind}: ${violation.detail}`;
}

function main(): void {
  const arg = process.argv.slice(2).find((token) => token.startsWith('--root='));
  const root = resolve(
    arg !== undefined
      ? arg.slice('--root='.length)
      : fileURLToPath(new URL('../..', import.meta.url)),
  );
  const report = checkSeams(root);
  if (report.violations.length > 0) {
    console.error(`seams:check: ${report.violations.length} violation(s) in ${SEAMS_PATH}:`);
    for (const violation of report.violations) console.error(formatViolation(violation));
    process.exit(1);
  }
  if (report.rowCount === 0 || report.guardedRows === 0 || report.explicitRows === 0) {
    console.error('seams:check: no seam rows with guard tests found — refusing a vacuous pass.');
    process.exit(1);
  }
  emitSummary(
    `seams:check: ${report.rowCount} rows / ${report.explicitRows} explicit — ` +
      `${report.guardedRows} row(s) carry an existing consumer-form guard test, every guard path ` +
      'is Git-tracked, no guard spelling is .gitignore-only, and every row states its ' +
      'Missing/unreadable behavior.',
  );
}

if (import.meta.main) main();
