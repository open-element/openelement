import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  CHECKER_WORKSPACE,
  discoverCheckerFiles,
  evaluateOutputDiscipline,
  WRITER_MODULE,
} from './check-output-discipline.ts';

test('the enforcement core flags every direct stdout write with file, line and pattern', () => {
  const hits = evaluateOutputDiscipline([
    {
      path: 'tools/repo/check-clean.ts',
      text: 'emitSummary("one line");\nconsole.error("failure channel");\n',
    },
    {
      path: 'tools/repo/check-verbose.ts',
      text: 'const a = 1;\nconsole.log(a);\nconsole.info(a);\nprocess.stdout.write(a);\n',
    },
  ]);
  expect(hits).toEqual([
    { path: 'tools/repo/check-verbose.ts', line: 2, pattern: 'console.log(' },
    { path: 'tools/repo/check-verbose.ts', line: 3, pattern: 'console.info(' },
    { path: 'tools/repo/check-verbose.ts', line: 4, pattern: 'process.stdout.write(' },
  ]);
});

test('the writer module itself is the only exemption', () => {
  const hits = evaluateOutputDiscipline([
    { path: `tools/repo/${WRITER_MODULE}`, text: 'process.stdout.write(`${line}\\n`);\n' },
    { path: 'tools/repo/check-other.ts', text: 'process.stdout.write(x);\n' },
  ]);
  expect(hits).toEqual([
    { path: 'tools/repo/check-other.ts', line: 1, pattern: 'process.stdout.write(' },
  ]);
});

test('discovery is canonical: the real workspace yields the checkers, never tests', async () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const files = await discoverCheckerFiles(repoRoot, CHECKER_WORKSPACE);
  expect(files.length).toBeGreaterThan(10);
  expect(files).toContain('tools/repo/check-output-discipline.ts');
  // The writer module does not carry the check- prefix, so it is not
  // enumerated as a checker; the evaluate step's exemption still names it so
  // a renamed writer can never become an unflagged second writer.
  expect(files).not.toContain(`tools/repo/${WRITER_MODULE}`);
  for (const file of files) {
    expect(file.endsWith('.test.ts'), file).toBe(false);
    expect(file.startsWith(`${CHECKER_WORKSPACE}/`), file).toBe(true);
  }
});

test('an unknown workspace fails loudly instead of scanning nothing', async () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  await expect(discoverCheckerFiles(repoRoot, 'no-such-workspace')).rejects.toThrow(
    /missing from the canonical workspace discovery/,
  );
});

test('consumer form: the real tree satisfies the single-writer ban', async () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const files = await discoverCheckerFiles(repoRoot, CHECKER_WORKSPACE);
  const loaded = [];
  for (const path of files) {
    loaded.push({ path, text: await readFile(join(repoRoot, path), 'utf8') });
  }
  expect(evaluateOutputDiscipline(loaded)).toEqual([]);
});
