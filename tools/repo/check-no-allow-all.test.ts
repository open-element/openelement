/**
 * check-no-allow-all.test.ts — first-party broad-permission tripwire.
 *
 * check-task-permissions.test.ts only scans deno.json task maps. This test
 * scans every tracked first-party text file (tasks, TS string args,
 * subprocess argv, shell commands, fixtures, templates, workflows,
 * READMEs, docs, site content, generated data) for the broad Deno run flags
 * and fails on any occurrence. Bypass shapes that only the task-map scanner
 * would miss are covered too:
 *   - quoted argv elements ('-A' / "-A" in subprocess argv arrays)
 *   - split/concatenated construction ('-' + 'A', ['-', 'A']) in code files,
 *     detected on a quotes-and-separators-stripped normalization
 *   - shell indirection (exec deno run … in Playwright webServer commands)
 *
 * Docs and comments get no exemption. The ONE former exception — the consumer
 * scaffold command (`deno run -A npm:@openelement/create@<tag> <dir>`, owner
 * ruling 2026-09-21, alpha3) — retired with the Deno bootstrap itself: owner
 * ruling 2026-10-03 (ADR-0161 amendment) removed the documented `deno run`
 * command from every README, and the replacement bootstrap is a plain Node
 * command (`npm exec @openelement/create@<tag> -- <dir>`) that carries no
 * broad flag. The exemption table below is therefore EMPTY; it is kept as a
 * structure (not deleted) so the scope test's completeness checks — every
 * entry must be the strict scaffold shape and must exist in its file — stay
 * in force if a future ruling ever re-adds an entry. Machine-generated
 * integrity hashes are the only other exclusion (deno.lock, package
 * lockfiles). This file excludes itself by path (its matcher is assembled
 * from character codes); its own historical comments accordingly carry no
 * literal broad-flag token.
 */

import { expect, test } from 'vitest';
import { dirname, join } from '@std/path';
import { readFileSync } from 'node:fs';
import { commandOutputSync } from './node-command.ts';

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
  const output = commandOutputSync('git', {
    args: ['ls-files', '-z'],
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  });
  if (!output.success) {
    throw new Error('check-no-allow-all: git ls-files failed (tests must run inside the repo)');
  }
  return new TextDecoder()
    .decode(output.stdout)
    .split('\0')
    .filter((entry) => entry.length > 0);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

/**
 * The ruled consumer-scaffold lines, as an exact (path, line) table. Entries
 * are matched by full-line equality after trimming, so a variant (another
 * tool, another flag, an extra argument) is NOT exempt.
 *
 * RETIRED (owner ruling 2026-10-03, ADR-0161 amendment): the documented
 * consumer scaffold was a `deno run` invocation; the READMEs now document the
 * plain Node bootstrap, so no line qualifies and the table is empty. The
 * scope test (tools/repo/check-no-allow-all.scope.test.ts) asserts the empty
 * state AND keeps the completeness machinery — strict-shape validation and
 * exact existence per entry — in force for any future entry.
 */
export const CONSUMER_SCAFFOLD_EXEMPT_LINES: ReadonlyArray<{ path: string; line: string }> = [];

/**
 * The only shape an exemption entry may take: the consumer scaffold command
 * with a CONCRETE tag (no glob) and a single target directory argument. The
 * optional surrounding quote/comma admits the one code surface that must carry
 * the command as a string literal. Anything looser (a bare flag, another tool,
 * a wildcard tag, an extra argument) must not be representable.
 *
 * The shape is the RETIRED `deno run` command on purpose: the validator exists
 * so a loosened entry can be demonstrated to fail it (scope test), and a
 * future re-ruled entry must look exactly like the command the exemption once
 * covered — not invent a new loose shape.
 */
export const CONSUMER_SCAFFOLD_PATTERN =
  // Ruled consumer-scaffold shapes (owner 2026-09-21, widened #1424):
  //   the create command — `deno run -A npm:@openelement/create@<tag> <arg>`
  //   optionally wrapped in single quotes with a trailing comma (a code
  //   example inside a spec), with nothing after it (a trailing flag or
  //   second word loosens it). The benchmark-harness usage-note shape that
  //   the pattern once carried retired with the removed in-repo benchmark
  //   surface (owner ruling 2026-10-03).
  /^(?:'deno run -A (?:npm:@openelement\/create@[A-Za-z0-9][^\s']* \S+)',|deno run -A npm:@openelement\/create@[A-Za-z0-9][^\s]* \S+)\s*$/u;

/** True when (path, line) is exactly one of the ruled exempt lines. */
export function isConsumerScaffoldExempt(path: string, line: string): boolean {
  const trimmed = line.trim();
  return CONSUMER_SCAFFOLD_EXEMPT_LINES.some(
    (entry) => entry.path === path && entry.line === trimmed,
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
  // node:fs signals "path does not exist" with ENOENT (pre-port: NotFound).
  return (error as { code?: string }).code === 'ENOENT';
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

test('permissions: no broad Deno flags in any tracked first-party text', () => {
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
      text = readFileSync(join(repoRoot, path), 'utf8');
    } catch (error) {
      if (shouldSkipUnreadableFile(error)) continue;
      // Unreadable is NOT clean: failing closed keeps a permission/IO problem
      // from turning the whole scan into a silent pass.
      throw new Error(`check-no-allow-all: cannot read tracked file ${path}: ${String(error)}`);
    }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const verdict = classifyLine(path, line, isCode);
      if (verdict.kind === 'violation') {
        violations.push(`${path}:${index + 1}: ${verdict.note ?? ''}${line.trim().slice(0, 140)}`);
      }
    }
  }
  expect(violations, `broad Deno permissions in tracked text:\n${violations.join('\n')}`).toEqual(
    [],
  );
});
