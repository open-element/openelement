/**
 * Consumer-form test (constitution P8) for docs/agent-contract.md's
 * generated-file map: every row claims a repository state (**Tracked** or
 * **Git-ignored**), and trackedness is derivable from git itself. This test
 * runs the git plumbing (`git ls-files` / `git check-ignore`) against each
 * claimed state so the map cannot drift from reality silently — the exact
 * failure mode of a hand-maintained fact table. check-generator-gates.ts owns
 * the generator wiring discipline and deliberately does not assert
 * trackedness; this test owns the tracked/ignored fact.
 *
 * Fail closed: a map section that parses to zero rows, or a data row whose
 * repository-state cell is neither claim, fails the test (an unreadable map
 * must never read as a green fact).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const CONTRACT_PATH = 'docs/agent-contract.md';

export type ClaimedState = 'Tracked' | 'Git-ignored' | 'unparseable';

export interface GeneratedMapRow {
  /** The generated surface pattern, e.g. `www/app/data/_generated-*.ts`. */
  surface: string;
  claimed: ClaimedState;
  /** 1-based line in docs/agent-contract.md. */
  line: number;
}

/** Parse the generated-file map table rows with their claimed states. */
export function parseGeneratedFileMap(text: string): GeneratedMapRow[] {
  const lines = text.split('\n');
  const sectionStart = lines.findIndex((line) => line.startsWith('## Generated files'));
  if (sectionStart === -1) return [];
  const rows: GeneratedMapRow[] = [];
  for (let index = sectionStart + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith('## ')) break; // next section: the map ended
    if (!line.startsWith('|')) continue;
    // Skip the table header and the `| --- |` separator rows.
    if (line.includes('Generated surface') || /^\|\s*-/.test(line)) continue;
    const surfaceMatch = line.match(/^\|\s*`([^`]+)`/);
    const stateMatch = line.match(/\*\*(Tracked|Git-ignored)\*\*/);
    if (!surfaceMatch || !stateMatch) {
      // A data row this parser cannot read: surfaced as 'unparseable' so a
      // reformatted table can never shrink the checked set silently.
      rows.push({
        surface: line.slice(0, 80),
        claimed: 'unparseable',
        line: index + 1,
      });
      continue;
    }
    rows.push({
      surface: surfaceMatch[1]!,
      claimed: stateMatch[1] as 'Tracked' | 'Git-ignored',
      line: index + 1,
    });
  }
  return rows;
}

/**
 * A concrete probe path derived from the claimed pattern: the path git would
 * have to ignore for the **Git-ignored** claim to be true. A `/**` tail
 * becomes one nested probe file under the directory; a `*` glob becomes a
 * concrete name.
 */
export function probePathFor(pattern: string): string {
  if (pattern.endsWith('/**')) return `${pattern.slice(0, -3)}/trackedness-probe/probe.file`;
  return pattern.replaceAll('*', 'trackedness-probe');
}

async function gitLsFiles(pattern: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', pattern], {
    cwd: repoRoot,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

/** Exit code 0 = ignored, 1 = not ignored (git check-ignore -q). */
async function gitCheckIgnore(path: string): Promise<number> {
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', path], { cwd: repoRoot });
    return 0;
  } catch (error) {
    return typeof (error as { code?: number }).code === 'number'
      ? (error as { code: number }).code
      : -1;
  }
}

test('every generated-file map row matches git reality', async () => {
  const contract = await readFile(join(repoRoot, CONTRACT_PATH), 'utf8');
  const rows = parseGeneratedFileMap(contract);
  // Fail closed: an unreadable or emptied map is not a green fact.
  expect(
    rows.length,
    `${CONTRACT_PATH} generated-file map parsed to zero rows — the table format drifted`,
  ).toBeGreaterThan(0);

  const problems: string[] = [];
  for (const row of rows) {
    const where = `${CONTRACT_PATH}:${row.line}`;
    if (row.claimed === 'unparseable') {
      problems.push(`${where}: cannot read the repository-state claim from '${row.surface}'`);
      continue;
    }
    const tracked = await gitLsFiles(row.surface);
    if (row.claimed === 'Tracked' && tracked.length === 0) {
      problems.push(
        `${where}: claims **Tracked** for '${row.surface}' but git ls-files matches nothing tracked`,
      );
    }
    if (row.claimed === 'Git-ignored') {
      if (tracked.length > 0) {
        problems.push(
          `${where}: claims **Git-ignored** for '${row.surface}' but git tracks ` +
            `${tracked.slice(0, 3).join(', ')}`,
        );
      }
      const probe = probePathFor(row.surface);
      const ignored = await gitCheckIgnore(probe);
      if (ignored !== 0) {
        problems.push(
          `${where}: claims **Git-ignored** for '${row.surface}' but git check-ignore exits ` +
            `${ignored} for the probe path '${probe}' (git does not ignore it)`,
        );
      }
    }
  }
  expect(problems, `generated-file map claims disagree with git:\n${problems.join('\n')}`).toEqual(
    [],
  );
});
