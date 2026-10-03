/**
 * check-no-allow-all.scope.test.ts — the ruling's scope pins (alpha3,
 * #1411 install-command sync; retirement 2026-10-03).
 *
 * `check-no-allow-all.test.ts` once carried one ruled exception to its "no
 * broad Deno flags anywhere" rule: the consumer scaffold command — the
 * broad-flag short form of `deno run`, then `npm:@openelement/create@<tag>
 * <dir>` — which a developer ran to scaffold their own project (consumer-side,
 * owner ruling 2026-09-21, overturning 2ccc41a96 for exactly those documented
 * lines).
 *
 * RETIRED (owner ruling 2026-10-03, ADR-0161 amendment): the documented
 * bootstrap became a plain Node command (`npm exec …`) that carries no broad
 * flag, the `deno run` copies left the READMEs, and the exemption table is
 * empty. This file now pins THAT state: the table must stay empty, and the
 * once-exempt command classifies as an ordinary violation everywhere.
 *
 * This file never spells that token literally: the tripwire scans it too, so
 * it assembles the token from character codes exactly as the tripwire does.
 *
 * An exception on a security tripwire must not be able to grow quietly, so
 * this file pins its boundaries:
 *   1. the exemption table is empty (retired); any entry is an explicit edit
 *      here as well as in the table;
 *   2. every entry the table could carry is the strict consumer-scaffold
 *      shape, and a loosened entry (bare flag, wildcard, another tool) is
 *      REJECTED by the same validator — i.e. widening must turn a test red;
 *   3. any broad-flag occurrence classifies as a violation — including the
 *      retired scaffold command in the formerly exempt documents;
 *   4. unreadable files fail the scan instead of being skipped.
 */

import { expect, test } from 'vitest';
import {
  classifyLine,
  CONSUMER_SCAFFOLD_EXEMPT_LINES,
  CONSUMER_SCAFFOLD_PATTERN,
  isConsumerScaffoldExempt,
  shouldSkipUnreadableFile,
} from './check-no-allow-all.test.ts';
import { readFileSync } from 'node:fs';

const BROAD_SHORT = String.fromCharCode(45, 65);
// Assembled so this file carries no literal broad-flag token (the tripwire
// scans every tracked file, including this one).
const BROAD_LONG = String.fromCharCode(45, 45) + 'allow' + String.fromCharCode(45) + 'all';
const RUN = 'deno run';
const TOOL = 'npm:@openelement/create';
const CONSUMER_LINE = `${RUN} ${BROAD_SHORT} ${TOOL}@alpha my-app`;

/**
 * The exemption's complete path list. Pinned verbatim: adding a surface must
 * be an explicit edit HERE as well as in the table, which is what makes the
 * exception auditable rather than open-ended. Empty since the 2026-10-03
 * retirement; a re-ruled entry must restore the path here AND in the table.
 */
const EXEMPT_PATHS: readonly string[] = [];

/** The strict-shape validator the table must satisfy (see test 2). */
function nonConformingEntries(entries: ReadonlyArray<{ path: string; line: string }>): string[] {
  return entries
    .filter((entry) => !CONSUMER_SCAFFOLD_PATTERN.test(entry.line))
    .map((entry) => `${entry.path}: ${entry.line}`);
}

test('scope: the exemption is retired — the table is empty and stays empty', () => {
  // Owner ruling 2026-10-03 (ADR-0161 amendment): the deno bootstrap left the
  // READMEs, so no line qualifies for the exemption. A non-empty table is an
  // explicit edit that must land together with the documented command it
  // exempts — never a quiet regrowth.
  expect(CONSUMER_SCAFFOLD_EXEMPT_LINES.length).toEqual(0);
  // The exact path list: growth is explicit, never implicit.
  expect(
    [...new Set(CONSUMER_SCAFFOLD_EXEMPT_LINES.map((entry) => entry.path))].toSorted(),
  ).toEqual([...new Set(EXEMPT_PATHS)].toSorted());
  // Every entry must actually EXIST and carry the exempt line — a stale entry
  // would silently shrink the exception's coverage story. Vacuous while the
  // table is empty; kept in force for any future entry.
  for (const entry of CONSUMER_SCAFFOLD_EXEMPT_LINES) {
    const text = readFileSync(new URL(`../../${entry.path}`, import.meta.url), 'utf8');
    expect(
      text.split('\n').some((line) => line.trim() === entry.line),
      `${entry.path} no longer carries the exempt line: ${entry.line}`,
    ).toBeTruthy();
  }
});

test('scope: a loosened exemption entry is rejected by the validator', () => {
  // The owner requirement: widening an entry into a general flag allowance
  // must turn this test red.
  const loosened: Array<{ path: string; line: string }> = [
    { path: 'README.md', line: `${RUN} ${BROAD_SHORT} npm:some-other-tool@1 x` },
    { path: 'README.md', line: `${RUN} ${BROAD_SHORT}` },
    { path: 'README.md', line: `${RUN} ${BROAD_SHORT} ${TOOL}@alpha` },
    { path: 'README.md', line: `${RUN} ${BROAD_SHORT} ${TOOL}@alpha my-app --extra` },
    { path: 'README.md', line: `${RUN} ${BROAD_LONG} ${TOOL}@alpha my-app` },
    { path: 'README.md', line: `${RUN} ${BROAD_SHORT} ${TOOL}@* my-app` },
  ];
  for (const entry of loosened) {
    expect(
      nonConformingEntries([entry]).length === 1,
      `validator must reject a loosened entry: ${entry.line}`,
    ).toBeTruthy();
  }
  // ...and the table's own entries must satisfy the very same validator.
  expect(nonConformingEntries(CONSUMER_SCAFFOLD_EXEMPT_LINES)).toEqual([]);
});

test('scope: any broad-flag line classifies as a violation — including the retired scaffold', () => {
  // (i) In a formerly EXEMPT document: the retirement removed the allowance,
  // so the once-ruled command is an ordinary violation today.
  expect(classifyLine('README.md', CONSUMER_LINE, false).kind).toEqual('violation');
  // (ii) A nearby variant in the same document.
  expect(
    classifyLine('README.md', `${RUN} ${BROAD_SHORT} ${TOOL}@alpha other-app`, false).kind,
  ).toEqual('violation');
  // (iii) The same command anywhere else.
  expect(classifyLine('packages/router/README.md', CONSUMER_LINE, false).kind).toEqual('violation');
  // (iv) Split/concat construction in code is still caught, in the same path.
  // Assembled from character codes so this file carries no literal token: the
  // tripwire scans it as tracked text.
  const splitConstruction = `args: ['${String.fromCharCode(45)}', '${String.fromCharCode(65)}']`;
  expect(classifyLine('README.md', splitConstruction, true).kind).toEqual('violation');
  // An unruled clean line is neither exempt nor a violation.
  expect(classifyLine('README.md', 'deno task dev', false).kind).toEqual('clean');
});

test('scope: the retirement is exact-match — no path is exempt anymore', () => {
  // The retired command is exempt nowhere, and never by substring.
  expect(isConsumerScaffoldExempt('README.md', CONSUMER_LINE)).toBeFalsy();
  expect(isConsumerScaffoldExempt('README.md', `  ${CONSUMER_LINE}  `)).toBeFalsy();
  expect(isConsumerScaffoldExempt('README.md', `${CONSUMER_LINE} extra`)).toBeFalsy();
  expect(isConsumerScaffoldExempt('docs/other.md', CONSUMER_LINE)).toBeFalsy();
  expect(isConsumerScaffoldExempt('README.md', `${RUN} ${BROAD_SHORT}`)).toBeFalsy();
});

test('scope: unreadable tracked files are not silently skipped', () => {
  // The false-green that hid this tripwire during the #1411 install-command
  // sync: a permission error was swallowed as "skip" and the scan reported ok.
  const permissionDenied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const notFound = Object.assign(new Error('missing'), { code: 'ENOENT' });
  expect(shouldSkipUnreadableFile(permissionDenied)).toBeFalsy();
  expect(shouldSkipUnreadableFile(new Error('boom'))).toBeFalsy();
  expect(shouldSkipUnreadableFile(notFound)).toBeTruthy();
});
