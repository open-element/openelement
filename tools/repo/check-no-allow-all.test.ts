/**
 * check-no-allow-all.test.ts — first-party broad-permission tripwire.
 *
 * check-task-permissions.test.ts only scans deno.json task maps. This test
 * scans every tracked first-party text file (tasks, TS string args,
 * Deno.Command argv, shell commands, fixtures, templates, workflows,
 * READMEs, docs, site content, generated data) for the broad Deno run flags
 * and fails on any occurrence. Bypass shapes that only the task-map scanner
 * would miss are covered too:
 *   - quoted argv elements ('-A' / "-A" in Deno.Command arrays)
 *   - split/concatenated construction ('-' + 'A', ['-', 'A']) in code files,
 *     detected on a quotes-and-separators-stripped normalization
 *   - shell indirection (exec deno run … in Playwright webServer commands)
 *
 * Docs and comments get no exemption, with ONE ruled exception: the consumer
 * scaffold command. A historical explanation must be reworded (never a
 * copy-pasteable command), so prose matches fail the same as executable
 * matches. Machine-generated integrity hashes are the only other exclusion
 * (deno.lock, package lockfiles). This file excludes itself by path (its
 * matcher is assembled from character codes); the ruled exception below
 * necessarily carries its literal lines, so the self-exclusion also keeps them
 * out of its own scan result.
 *
 * The consumer-scaffold exception (owner ruling 2026-09-21, alpha3):
 * `deno run -A npm:@openelement/create@<tag> <dir>` is a command a developer
 * runs to scaffold THEIR OWN project — consumer-side, not first-party repo
 * code — and the owner ruled the short form wins on optics ("越短越好").
 * That ruling overturns 2ccc41a96 for exactly these documented lines and
 * nothing else: every first-party invocation stays scoped, and the exception
 * is an exact (path, line) table with no pattern or substring relaxation.
 * The table covers the doc copies AND the two surfaces that must DISPLAY the
 * same command (the homepage copy and its e2e assertion); the scope test
 * asserts the exact path list, so adding a surface is an explicit edit.
 */

import { assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

// Assembled so this file contains no literal broad-flag token itself.
const DASH = String.fromCharCode(45);
const A = String.fromCharCode(65);
const BROAD_SHORT = DASH + A;
const BROAD_LONG = DASH + DASH + 'allow' + DASH + 'all';
const SINGLE_Q = String.fromCharCode(39);
const DOUBLE_Q = String.fromCharCode(34);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.tmpl',
]);

const PROSE_EXTENSIONS = new Set(['.md', '.mdx']);

const EXCLUDED_PATHS = new Set([
  // This scanner (matcher assembled from char codes; excluded by path).
  'tools/repo/check-no-allow-all.test.ts',
]);

const EXCLUDED_SUFFIXES = ['deno.lock', 'package-lock.json', 'npm-shrinkwrap.json'];

function trackedFiles(): string[] {
  const output = new Deno.Command('git', {
    args: ['ls-files', '-z'],
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync();
  if (!output.success) {
    throw new Error('check-no-allow-all: git ls-files failed (tests must run inside the repo)');
  }
  return new TextDecoder().decode(output.stdout).split('\0').filter((entry) => entry.length > 0);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

/**
 * The ruled consumer-scaffold lines, as an exact (path, line) table. Entries
 * are matched by full-line equality after trimming, so a variant (another
 * tool, another flag, an extra argument) is NOT exempt. Scope:
 * tools/repo/check-no-allow-all.scope.test.ts asserts every entry conforms to
 * {@link CONSUMER_SCAFFOLD_PATTERN} and that a loose entry would be rejected,
 * so widening this table into a general flag allowance fails a test.
 */
export const CONSUMER_SCAFFOLD_EXEMPT_LINES: ReadonlyArray<{ path: string; line: string }> = [
  { path: 'README.md', line: 'deno run -A npm:@openelement/create@alpha my-app' },
  { path: 'README.zh.md', line: 'deno run -A npm:@openelement/create@alpha my-app' },
  { path: 'packages/create/README.md', line: 'deno run -A npm:@openelement/create@alpha my-app' },
  {
    path: 'www/content/docs/guide/getting-started.md',
    line: 'deno run -A npm:@openelement/create@alpha my-app',
  },
  {
    path: 'www/content/docs/guide/getting-started.zh.md',
    line: 'deno run -A npm:@openelement/create@alpha my-app',
  },
  {
    path: 'www/content/docs/guide/tutorial.md',
    line: 'deno run -A npm:@openelement/create@alpha my-app',
  },
  {
    path: 'www/content/docs/guide/tutorial.zh.md',
    line: 'deno run -A npm:@openelement/create@alpha my-app',
  },
  // Display surfaces: the homepage command block and the e2e assertion that
  // pins the visible text. They must show the SAME command as the docs, or the
  // site would advertise a different install line than the guide.
  {
    path: 'www/app/components/page-home.tsx',
    line: 'deno run -A npm:@openelement/create@alpha my-app',
  },
  {
    path: 'www/e2e/cinematic-home.spec.ts',
    line: "'deno run -A npm:@openelement/create@alpha my-app',",
  },
];

/**
 * The only shape an exemption entry may take: the consumer scaffold command
 * with a CONCRETE tag (no glob) and a single target directory argument. The
 * optional surrounding quote/comma admits the one code surface that must carry
 * the command as a string literal. Anything looser (a bare flag, another tool,
 * a wildcard tag, an extra argument) must not be representable.
 */
export const CONSUMER_SCAFFOLD_PATTERN =
  /^'?deno run -A npm:@openelement\/create@[A-Za-z0-9][^\s*]* \S+'?,?$/u;

/** True when (path, line) is exactly one of the ruled exempt lines. */
export function isConsumerScaffoldExempt(path: string, line: string): boolean {
  const trimmed = line.trim();
  return CONSUMER_SCAFFOLD_EXEMPT_LINES.some((entry) =>
    entry.path === path && entry.line === trimmed
  );
}

/**
 * A tracked file the scanner cannot read is a scanner failure, not a pass.
 * Only a genuinely missing file (a broken `git ls-files` entry) may be
 * skipped: swallowing a permission error here made the whole scan report
 * "ok" while reading nothing (observed by running the test without
 * --allow-read), which is a false green on a security tripwire.
 */
export function shouldSkipUnreadableFile(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound;
}

export interface LineVerdict {
  kind: 'clean' | 'exempt' | 'violation';
  /** Present for 'violation'; the exact reason shown in the failure list. */
  note?: string;
}

/** Classify one line of one tracked file. */
export function classifyLine(path: string, line: string, isCode: boolean): LineVerdict {
  if (directHit(line)) {
    if (isConsumerScaffoldExempt(path, line)) return { kind: 'exempt' };
    return { kind: 'violation', note: '' };
  }
  if (isCode && splitHit(line)) {
    return { kind: 'violation', note: 'split-form broad flag: ' };
  }
  return { kind: 'clean' };
}

/** Direct matcher: boundary token, quoted argv element, or the long flag. */
function directHit(line: string): boolean {
  if (line.includes(BROAD_LONG)) return true;
  if (new RegExp(`(^|\\s)${DASH}${A}(\\s|$)`).test(line)) return true;
  if (line.includes(SINGLE_Q + BROAD_SHORT + SINGLE_Q)) return true;
  if (line.includes(DOUBLE_Q + BROAD_SHORT + DOUBLE_Q)) return true;
  return false;
}

/**
 * Split/concat matcher for executable code files: strip only string-literal
 * surgery (quotes, commas, plus signs, whitespace), then look for the
 * rejoined token. Brackets and parens are kept so regex character classes
 * such as [A-Z] never rejoin into a false token. Prose files skip this;
 * docs carry no executable string surgery, so direct matching suffices.
 */
function splitHit(line: string): boolean {
  const stripped = line.replace(/['"`\s,+]/g, '');
  const boundary = `([^A-Za-z0-9_]|^)${DASH}${A}([^A-Za-z0-9_]|$)`;
  if (new RegExp(boundary).test(stripped)) return true;
  return stripped.includes(BROAD_LONG);
}

Deno.test('permissions: no broad Deno flags in any tracked first-party text', () => {
  const violations: string[] = [];
  for (const path of trackedFiles()) {
    if (EXCLUDED_PATHS.has(path)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => path.endsWith(suffix))) continue;
    const extension = extensionOf(path);
    const isCode = CODE_EXTENSIONS.has(extension);
    const isProse = PROSE_EXTENSIONS.has(extension);
    if (!isCode && !isProse) continue;
    let text: string;
    try {
      text = Deno.readTextFileSync(join(repoRoot, path));
    } catch (error) {
      if (shouldSkipUnreadableFile(error)) continue;
      // Unreadable is NOT clean: failing closed keeps a permission/IO problem
      // from turning the whole scan into a silent pass.
      throw new Error(
        `check-no-allow-all: cannot read tracked file ${path}: ${String(error)}`,
      );
    }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const verdict = classifyLine(path, line, isCode);
      if (verdict.kind === 'violation') {
        violations.push(
          `${path}:${index + 1}: ${verdict.note ?? ''}${line.trim().slice(0, 140)}`,
        );
      }
    }
  }
  assertEquals(violations, [], `broad Deno permissions in tracked text:\n${violations.join('\n')}`);
});
