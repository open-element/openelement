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
 * Docs and comments get no exemption: a historical explanation must be
 * reworded (never a copy-pasteable command), so prose matches fail the same
 * as executable matches. Machine-generated integrity hashes are the only
 * exclusion (deno.lock, package lockfiles). This file excludes itself by
 * path: its own matcher is assembled from character codes so the file carries
 * no literal broad-flag token.
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
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (directHit(line)) {
        violations.push(`${path}:${index + 1}: ${line.trim().slice(0, 140)}`);
      } else if (isCode && splitHit(line)) {
        violations.push(
          `${path}:${index + 1}: split-form broad flag: ${line.trim().slice(0, 140)}`,
        );
      }
    }
  }
  assertEquals(violations, [], `broad Deno permissions in tracked text:\n${violations.join('\n')}`);
});
