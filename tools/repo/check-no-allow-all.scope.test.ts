/**
 * check-no-allow-all.scope.test.ts — the ruling's scope pins (alpha3,
 * #1411 install-command sync).
 *
 * `check-no-allow-all.test.ts` carries one ruled exception to its "no broad
 * Deno flags anywhere" rule: the consumer scaffold command
 * `deno run -A npm:@openelement/create@<tag> <dir>`, which a developer runs to
 * scaffold their own project (consumer-side, owner ruling 2026-09-21,
 * overturning 2ccc41a96 for exactly those documented lines).
 *
 * An exception on a security tripwire must not be able to grow quietly, so
 * this file pins its boundaries:
 *   1. every exemption entry is the strict consumer-scaffold shape;
 *   2. a loosened entry (bare flag, wildcard, another tool) is REJECTED by the
 *      same validator — i.e. widening must turn a test red;
 *   3. any other broad-flag occurrence still classifies as a violation, in an
 *      exempt document and elsewhere;
 *   4. unreadable files fail the scan instead of being skipped.
 */

import { assert, assertEquals, assertFalse } from '@std/assert';
import {
  classifyLine,
  CONSUMER_SCAFFOLD_EXEMPT_LINES,
  CONSUMER_SCAFFOLD_PATTERN,
  isConsumerScaffoldExempt,
  shouldSkipUnreadableFile,
} from './check-no-allow-all.test.ts';

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
 * exception auditable rather than open-ended.
 */
const EXEMPT_PATHS: readonly string[] = [
  'README.md',
  'README.zh.md',
  'packages/create/README.md',
  'www/app/components/page-home.tsx',
  'www/content/docs/guide/getting-started.md',
  'www/content/docs/guide/getting-started.zh.md',
  'www/content/docs/guide/tutorial.md',
  'www/content/docs/guide/tutorial.zh.md',
  'www/e2e/cinematic-home.spec.ts',
];

/** The strict-shape validator the table must satisfy (see test 2). */
function nonConformingEntries(
  entries: ReadonlyArray<{ path: string; line: string }>,
): string[] {
  return entries
    .filter((entry) => !CONSUMER_SCAFFOLD_PATTERN.test(entry.line))
    .map((entry) => `${entry.path}: ${entry.line}`);
}

Deno.test('scope: every exemption entry is a consumer scaffold command', () => {
  assertEquals(nonConformingEntries(CONSUMER_SCAFFOLD_EXEMPT_LINES), []);
  assert(CONSUMER_SCAFFOLD_EXEMPT_LINES.length > 0, 'the table must not be empty');
  // The exact path list: growth is explicit, never implicit.
  assertEquals(
    CONSUMER_SCAFFOLD_EXEMPT_LINES.map((entry) => entry.path).toSorted(),
    [...EXEMPT_PATHS].toSorted(),
  );
  // Every path must actually EXIST and carry the exempt line — a stale entry
  // would silently shrink the exception's coverage story.
  for (const entry of CONSUMER_SCAFFOLD_EXEMPT_LINES) {
    const text = Deno.readTextFileSync(new URL(`../../${entry.path}`, import.meta.url));
    assert(
      text.split('\n').some((line) => line.trim() === entry.line),
      `${entry.path} no longer carries the exempt line: ${entry.line}`,
    );
  }
});

Deno.test('scope: a loosened exemption entry is rejected by the validator', () => {
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
    assert(
      nonConformingEntries([entry]).length === 1,
      `validator must reject a loosened entry: ${entry.line}`,
    );
  }
  // ...and the table's own entries must satisfy the very same validator.
  assertEquals(nonConformingEntries(CONSUMER_SCAFFOLD_EXEMPT_LINES), []);
});

Deno.test('scope: another broad-flag line still classifies as a violation', () => {
  // (i) In an EXEMPT document: the path is allowlisted, the line is not.
  assertEquals(
    classifyLine('README.md', `${RUN} ${BROAD_SHORT} npm:other@1 x`, false).kind,
    'violation',
  );
  // (ii) The same consumer command in a non-allowlisted path.
  assertEquals(classifyLine('packages/router/README.md', CONSUMER_LINE, false).kind, 'violation');
  // (iii) A nearby variant in an exempt document (different arg shape).
  assertEquals(
    classifyLine('README.md', `${RUN} ${BROAD_SHORT} ${TOOL}@alpha other-app`, false).kind,
    'violation',
  );
  // (iv) Split/concat construction in code is still caught, in an exempt path.
  assertEquals(classifyLine('README.md', `args: ['-', 'A']`, true).kind, 'violation');
  // The ruled lines themselves are exempt...
  assertEquals(classifyLine('README.md', CONSUMER_LINE, false).kind, 'exempt');
  // ...and an unruled clean line is neither.
  assertEquals(classifyLine('README.md', 'deno task dev', false).kind, 'clean');
});

Deno.test('scope: the exemption is exact-match, never substring', () => {
  assert(isConsumerScaffoldExempt('README.md', CONSUMER_LINE));
  assert(isConsumerScaffoldExempt('README.md', `  ${CONSUMER_LINE}  `));
  assertFalse(isConsumerScaffoldExempt('README.md', `${CONSUMER_LINE} extra`));
  assertFalse(isConsumerScaffoldExempt('docs/other.md', CONSUMER_LINE));
  assertFalse(isConsumerScaffoldExempt('README.md', `${RUN} ${BROAD_SHORT}`));
});

Deno.test('scope: unreadable tracked files are not silently skipped', () => {
  // The false-green that hid this tripwire during the #1411 install-command
  // sync: a permission error was swallowed as "skip" and the scan reported ok.
  assertFalse(shouldSkipUnreadableFile(new Deno.errors.PermissionDenied('denied')));
  assertFalse(shouldSkipUnreadableFile(new Error('boom')));
  assert(shouldSkipUnreadableFile(new Deno.errors.NotFound('missing')));
});
