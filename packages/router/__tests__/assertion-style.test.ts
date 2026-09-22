import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

/**
 * Audit gate: boolean expressions must not be passed to assertExists.
 *
 * assertExists only rejects null/undefined, so a predicate wrapped in it
 * (e.g. a `.includes(...)` result) can never fail the test. Use assert,
 * assertStringIncludes, or assertEquals for predicates instead.
 *
 * Every packages/*\/__tests__\/*.test.ts file is scanned. An assertExists
 * call is flagged when its direct argument (text at paren depth 1, before the
 * first top-level comma) contains a boolean construct: .includes(/
 * .startsWith(/.endsWith(/.some(/.every(/instanceof, or a comparison/logical
 * operator. Nested expressions — e.g. a `.find((w) => ...)` narrowing guard
 * whose callback uses predicates — are legitimate and not flagged.
 *
 * The package root is derived from this file's own URL, never from the
 * process cwd: `deno task --cwd packages/router test` runs with the cwd set to
 * packages/router, where `join(cwd, 'packages')` is a directory that does not
 * exist (the scan crashed) — or, worse, whatever stray `packages/` happens to
 * be there, which would silently scan the wrong tree and pass vacuously.
 */

const BOOLEAN_PATTERN =
  /\.(?:includes|startsWith|endsWith|some|every)\(|\binstanceof\b|===|!==|>=|<=|\|\||&&/;

/** Repository root, derived from this test's location (packages/router/__tests__). */
const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

function listTestFiles(): string[] {
  const files: string[] = [];
  const packagesDir = join(REPO_ROOT, 'packages');
  for (const pkg of Deno.readDirSync(packagesDir)) {
    if (!pkg.isDirectory) continue;
    const testsDir = join(packagesDir, pkg.name, '__tests__');
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(testsDir)];
    } catch {
      continue; // package without __tests__
    }
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith('.test.ts')) {
        files.push(join(testsDir, entry.name));
      }
    }
  }
  return files.sort();
}

/** Extract the direct (depth-1) argument text of every assertExists call. */
function directArguments(source: string): Array<{ text: string; line: number }> {
  const results: Array<{ text: string; line: number }> = [];
  const marker = 'assertExists' + '(';
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) return results;
    const line = source.slice(0, start).split('\n').length;
    let depth = 1;
    let text = '';
    let quote: string | null = null;
    let i = start + marker.length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        if (depth === 1) text += ch;
        depth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) break;
        if (depth === 1) text += ch;
      } else if (depth === 1) {
        if (ch === ',') break; // stop before the optional message argument
        text += ch;
      }
    }
    results.push({ text, line });
    searchFrom = i;
  }
}

Deno.test('audit gate: no boolean expressions passed to assertExists', () => {
  const offenders: string[] = [];
  const files = listTestFiles();
  // A scan that found no test files proves nothing: an empty offender list
  // from an empty file set would report success without looking at any code.
  assert(
    files.length > 0,
    `no test files found under ${join(REPO_ROOT, 'packages')} — the audit cannot pass vacuously`,
  );

  for (const file of files) {
    const content = Deno.readTextFileSync(file);
    for (const { text, line } of directArguments(content)) {
      if (BOOLEAN_PATTERN.test(text)) {
        offenders.push(`${file}:${line}: ${text.trim().replaceAll(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
  }

  assertEquals(offenders, []);
});
