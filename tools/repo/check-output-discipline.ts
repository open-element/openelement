/**
 * check-output-discipline.ts — the static half of the single-writer seam for
 * check stdout.
 *
 * Form: structural derived guard (permanent — no retirement condition). The
 * checker set is discovered from the workspace task graph, not copied; there
 * is nothing whose deletion would retire it.
 *
 * Output discipline (docs/architecture/design-principles.md, "Output
 * discipline"): a command's stdout is a data channel, and a passing check
 * prints one summary line and no more. The writer side of that seam is
 * tools/repo/checker-io.ts — the one stdout writer for check-* gates. This
 * gate is the consumer-form enforcement: every check-*.ts file (tests
 * excluded) in a checker-bearing workspace must contain zero direct stdout
 * writes, and the only exempt file is checker-io.ts itself, which owns the
 * writes.
 *
 * Discovery is canonical (tools/repo/workspace-tasks.ts): the workspace list
 * comes from the root pnpm-workspace.yaml globs and the checker set from a
 * recursive check-*.ts walk of the workspace directory — there is no
 * hand-maintained list to drift. Enforcement currently covers the tools/repo
 * workspace, the surface the remediation lane converted; widening it to the
 * other workspaces' checkers (www/tools, tools/release) is a follow-up lane
 * that converts their stdout writes first. Widening is a scope change in this
 * file's constants, never a list edit.
 *
 * Fail closed: an empty checker set refuses to pass (no repository state makes
 * zero check-*.ts files a green fact), and every hit names the file, the line,
 * and the pattern it was caught by.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { emitSummary } from './checker-io.ts';
import { readWorkspaces } from './workspace-tasks.ts';

/**
 * The workspace the ban is enforced over. Enumerated through the canonical
 * workspace discovery, so a renamed or moved directory fails loudly here
 * instead of silently scanning nothing.
 */
export const CHECKER_WORKSPACE = 'tools/repo';

/** The one exempt file: the writer module that owns every stdout byte. */
export const WRITER_MODULE = 'checker-io.ts';

/**
 * The banned stdout-write call heads. The call paren is appended at scan time
 * so this source file can name the heads without matching its own data.
 */
const BANNED_WRITE_HEADS = ['console.log', 'console.info', 'process.stdout.write'];

const BANNED_WRITE_PATTERNS: readonly string[] = BANNED_WRITE_HEADS.map((head) => `${head}(`);

export interface CheckerFile {
  /** Repository-relative path, e.g. `tools/repo/check-seams.ts`. */
  path: string;
  text: string;
}

export interface OutputDisciplineHit {
  path: string;
  line: number;
  pattern: string;
}

/** Line-major scan of one checker file for direct stdout writes. */
export function scanCheckerText(path: string, text: string): OutputDisciplineHit[] {
  const hits: OutputDisciplineHit[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    for (const pattern of BANNED_WRITE_PATTERNS) {
      if (lines[index]!.includes(pattern)) {
        hits.push({ path, line: index + 1, pattern });
      }
    }
  }
  return hits;
}

/**
 * The enforcement core: every checker file must be free of direct stdout
 * writes, except the writer module itself.
 */
export function evaluateOutputDiscipline(files: readonly CheckerFile[]): OutputDisciplineHit[] {
  const hits: OutputDisciplineHit[] = [];
  for (const file of files) {
    if (basename(file.path) === WRITER_MODULE) continue;
    hits.push(...scanCheckerText(file.path, file.text));
  }
  return hits;
}

/**
 * Enumerate the checker files of one workspace: `check-*.ts`, tests excluded,
 * node_modules excluded, from the canonical discovery's directory (no hand
 * list). Returns repository-relative paths.
 */
export async function discoverCheckerFiles(repoRoot: string, workspace: string): Promise<string[]> {
  const workspaces = await readWorkspaces(repoRoot);
  const member = workspaces.find((candidate) => candidate.workspace === workspace);
  if (!member) {
    throw new Error(
      `output-discipline: workspace '${workspace}' is missing from the canonical workspace discovery`,
    );
  }
  const files: string[] = [];
  for (const entry of await readdir(member.dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.name.startsWith('check-') || !entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    const parent = relative(member.dir, entry.parentPath);
    if (parent.split('/').includes('node_modules')) continue;
    files.push(join(workspace, relative(member.dir, join(entry.parentPath, entry.name))));
  }
  return files.sort();
}

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const paths = await discoverCheckerFiles(repoRoot, CHECKER_WORKSPACE);
  if (paths.length === 0) {
    console.error(
      `output-discipline: no check-*.ts files found under '${CHECKER_WORKSPACE}' — refusing to vacuously pass.`,
    );
    process.exit(1);
  }
  const files: CheckerFile[] = [];
  for (const path of paths) {
    files.push({ path, text: await readFile(join(repoRoot, path), 'utf8') });
  }
  const hits = evaluateOutputDiscipline(files);
  if (hits.length > 0) {
    console.error(
      `output-discipline: ${hits.length} direct stdout write(s) outside ${WRITER_MODULE} — ` +
        'stdout is the single-writer seam; emit the summary through tools/repo/checker-io.ts:',
    );
    for (const hit of hits) console.error(`  ${hit.path}:${hit.line}: ${hit.pattern}`);
    process.exit(1);
  }
  emitSummary(
    `output-discipline: ${files.length} checker(s) scanned — stdout confinement holds ` +
      `(single writer: ${CHECKER_WORKSPACE}/${WRITER_MODULE}).`,
  );
}

if (import.meta.main) await main();
