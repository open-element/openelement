/**
 * Codemod: `Deno.test` + `@std/assert` → vitest (B3 test migration).
 *
 * Run with Node (>= 24, native TS type stripping — same convention as the
 * other tools/repo scripts):
 *
 *   node tools/repo/codemod-deno-test-to-vitest.ts --dry   # list + stats, no writes
 *   node tools/repo/codemod-deno-test-to-vitest.ts         # apply, per-file stats
 *
 * The transform is idempotent: applied output contains no `Deno.test(` call
 * and no `@std/assert` import in code regions, so a second run is a no-op.
 * Rewrites never touch string/template/comment/regex regions (token-level
 * masking), so generated guide content that embeds `Deno.test(...)` inside
 * string literals is structurally safe — and www/app/data (generated) is
 * excluded by path as well.
 *
 * ─── MAPPING TABLE ────────────────────────────────────────────────────────
 * Registration (narrow edits — the callback body is left for the assertion
 * pass; `t` is vitest's own context parameter, so a plain `(t)` stays):
 *   Deno.test('n', fn)                      → test('n', fn)
 *   Deno.test('n', { ignore: true }, fn)    → test.skip('n', fn)
 *   Deno.test('n', { only: true }, fn)      → test.only('n', fn)
 *   Deno.test('n', { permissions|sanitizeResources|sanitizeOps|sanitizeExit },
 *             fn)                           → test('n', fn) — options dropped:
 *             there is no vitest/Node permission model to map them onto;
 *             every such drop is counted in the per-file stats.
 *   Deno.test({ name: 'n', [droppables], fn })   → test('n', fn) — same
 *             option handling; the fn value (arrow or method shorthand,
 *             rewritten `fn(` → `function fn(`) must be the object's last
 *             key or the file goes to the manual list. Computed conditions
 *             map onto vitest's conditional API:
 *             `ignore: <expr>` → `test.skipIf(<expr>)`,
 *             `only: <expr>` → `test.runIf(<expr>)`.
 *   Any other Deno.test option key          → file skipped → manual list.
 *   `t.step(...)` anywhere in the file      → file skipped → manual list:
 *             vitest 5.0.2 refuses to collect `test()` inside a running test
 *             (verified empirically during B3 step 1), so sequential steps
 *             need a describe + beforeEach restructure, not a rewrite.
 *
 * Assertions (imported from '@std/assert'). std's optional trailing message
 * argument is relocated to expect()'s optional second argument (vitest
 * reports it on failure); everything else maps 1:1:
 *   assertEquals(a, b)            → expect(a).toEqual(b)
 *   assert(a)                     → expect(a).toBeTruthy()
 *   assertFalse(a)                → expect(a).toBeFalsy()
 *   assertStrictEquals(a, b)      → expect(a).toBe(b)
 *   assertNotEquals(a, b)         → expect(a).not.toEqual(b)
 *   assertNotStrictEquals(a, b)   → expect(a).not.toBe(b)
 *   assertStringIncludes(a, b)    → expect(a).toContain(b)
 *   assertArrayIncludes(a, b)     → expect(a).toEqual(expect.arrayContaining(b))
 *   assertExists(a)               → expect(a).toEqual(expect.anything())
 *             (expect.anything() matches anything except null/undefined —
 *             exactly assertExists' contract; strictly stronger than the
 *             idiomatic toBeDefined(), which silently passes null)
 *   assertInstanceOf(a, C)        → expect(a).toBeInstanceOf(C)
 *   assertMatch(a, re)            → expect(a).toMatch(re)
 *   assertThrows(fn)              → expect(fn).toThrow()
 *   assertThrows(fn, C)           → expect(fn).toThrow(C)
 *   assertRejects(fn)             → expect(fn).rejects.toThrow() (a leading
 *             `await ` in the source is preserved as-is)
 *   assertRejects(fn, C)          → expect(fn).rejects.toThrow(C)
 *   assertThrows/assertRejects with a third (msgIncludes) argument, or with
 *   the caught error captured (const err = assertThrows(...)) → file skipped
 *   → manual list: vitest has no substring-message one-liner that also hands
 *   you the error value.
 *   Import:                       → import { test, expect } from 'vitest';
 *             (names trimmed to what the file actually uses), left at the
 *             position of the removed '@std/assert' import.
 *
 * std/testing BDD (describe/it/beforeEach): kept — same names under vitest.
 * (B3 inventory: the repository imports @std/testing zero times, so this is
 * a no-op clause recorded for completeness.)
 *
 * Deliberately NOT rewritten (listed, not transformed):
 *   - Deno.* runtime APIs (fs/net/env/Command/…) — owned by the runtime-API
 *     pass (docs/maintainers/node-porting-residuals.md §1–§5); a file that
 *     calls Deno.serve/Deno.listen/Deno.connect/Deno.listenTls/Deno.
 *     upgradeWebSocket is transformed AND flagged into the manual list for
 *     the node:http adaptation.
 *   - benchmarks/ (outside the walked roots) — stays on `deno test` (root
 *     `bench` script).
 *   - www/app/data/** (generated content), *.spec.* (Playwright universes),
 *     tools/release/consumer-packaged-* (templates shipped into consumer
 *     sandboxes that have no vitest), snapshot-prototype.ts (a `deno run`
 *     script, not a test), tests/fixtures universes other than the ones
 *     containing Deno.test registrations (the registration call is the
 *     migration unit).
 * ──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DRY = process.argv.includes('--dry');
// --soft-throws: convert assertThrows/assertRejects onto the shared
// tests/lib/vitest-asserts helpers (exact std semantics incl. captured
// errors) instead of skipping such files — used for the step-2 sweep of the
// step-1 manual batch. t.step files still fail closed.
const SOFT_THROWS = process.argv.includes('--soft-throws');

const ROOTS = ['packages', 'apps', 'www', 'tools', 'tests'];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-e2e',
  'dist-test-ssg-render',
  'custom-dist',
  '.output',
  'coverage',
]);
const EXCLUDED_PATH_PATTERNS: Array<(rel: string) => boolean> = [
  (rel) => rel === 'www' || rel.startsWith('www/app/data/'), // generated guide content
  (rel) => rel.startsWith('packages/element/__wtr__/'), // wtr browser universe (chai) — replaced by the browser-mode vitest project, not codemodded
  (rel) => /\.spec\.[jt]sx?$/.test(rel), // Playwright specs, not Deno tests
  (rel) => /(^|\/)consumer-packaged-/.test(rel), // tools/release consumer-sandbox templates
  (rel) => rel.endsWith('snapshot-prototype.ts'), // deno-run proof script, not a test
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']);

// name → [min args, max args, builder]
const ASSERT_TABLE: Record<string, { arity: [number, number]; build: (a: string[]) => string }> = {
  assertEquals: { arity: [2, 2], build: (a) => `expect(${a[0]}).toEqual(${a[1]})` },
  assert: { arity: [1, 1], build: (a) => `expect(${a[0]}).toBeTruthy()` },
  assertFalse: { arity: [1, 1], build: (a) => `expect(${a[0]}).toBeFalsy()` },
  assertStrictEquals: { arity: [2, 2], build: (a) => `expect(${a[0]}).toBe(${a[1]})` },
  assertNotEquals: { arity: [2, 2], build: (a) => `expect(${a[0]}).not.toEqual(${a[1]})` },
  assertNotStrictEquals: { arity: [2, 2], build: (a) => `expect(${a[0]}).not.toBe(${a[1]})` },
  assertStringIncludes: { arity: [2, 2], build: (a) => `expect(${a[0]}).toContain(${a[1]})` },
  assertArrayIncludes: {
    arity: [2, 2],
    build: (a) => `expect(${a[0]}).toEqual(expect.arrayContaining(${a[1]}))`,
  },
  assertExists: { arity: [1, 1], build: (a) => `expect(${a[0]}).toEqual(expect.anything())` },
  assertInstanceOf: { arity: [2, 2], build: (a) => `expect(${a[0]}).toBeInstanceOf(${a[1]})` },
  assertMatch: { arity: [2, 2], build: (a) => `expect(${a[0]}).toMatch(${a[1]})` },
  assertThrows: { arity: [1, 2], build: throwsBuilder(false) },
  assertRejects: { arity: [1, 2], build: throwsBuilder(true) },
};

function throwsBuilder(rejects: boolean) {
  return (a: string[]): string => {
    const chain = rejects ? '.rejects.toThrow' : '.toThrow';
    return a.length === 1 ? `expect(${a[0]})${chain}()` : `expect(${a[0]})${chain}(${a[1]})`;
  };
}

// DISCLOSED SEMANTIC DELTAS of assertEquals → expect().toEqual (verified
// empirically against the repo's vitest 5.0.2 + @std/assert, B3 review):
//   ±0            std EQUAL / vitest NOT-equal  — vitest stricter (fails loud)
//   NaN           both EQUAL                    — identical
//   {a:undefined} vs {}: std NOT-equal / vitest equal — vitest looser
//   same-shape objects of different constructors: std NOT-equal / vitest equal
//                  — vitest looser
// The two looser directions cannot silently weaken a pre-migration-green
// suite, and a repo-wide grep at the cutover found no migrated call site
// comparing ±0/NaN literals, undefined-key objects, or cross-class shapes.
const THROW_NAMES = new Set(['assertThrows', 'assertRejects']);
// --soft-throws table: std arg shapes (fn[, C[, msgIncludes[, message]]])
// pass through verbatim to the helpers
const SOFT_THROW_TABLE: Record<
  string,
  { arity: [number, number]; build: (a: string[]) => string }
> = {
  assertThrows: {
    arity: [1, 4],
    build: (a) => `assertThrowsIncludes(${a.join(', ')})`,
  },
  assertRejects: {
    arity: [1, 4],
    build: (a) => `assertRejectsIncludes(${a.join(', ')})`,
  },
};
const DROPPABLE_TEST_OPTS = new Set([
  'permissions',
  'sanitizeResources',
  'sanitizeOps',
  'sanitizeExit',
]);
const NET_APIS = ['serve', 'listen', 'listenTls', 'connect', 'upgradeWebSocket'];

type FileStats = {
  file: string;
  tests: number;
  testSkip: number;
  testSkipIf: number;
  testOnly: number;
  testRunIf: number;
  optsDropped: number;
  asserts: Record<string, number>;
  importRewritten: number;
  netCalls: string[];
  notes: string[];
  skipped: boolean; // true = file left untouched (manual batch)
};

// ── lexical scanning: code vs masked regions ──────────────────────────────

export function scanRegions(src: string): Array<{ start: number; end: number; code: boolean }> {
  const regions: Array<{ start: number; end: number; code: boolean }> = [];
  let i = 0;
  let codeStart = 0;
  const pushCode = (end: number) => {
    if (end > codeStart) regions.push({ start: codeStart, end, code: true });
  };
  const prevSignificant = (): string => {
    // walk back over CODE only — already-emitted mask regions (comments,
    // strings, templates, regexes) are skipped, so a `//` comment ending in
    // a backtick or bracket cannot poison the regex-vs-division decision
    let k = i - 1;
    while (k >= 0) {
      let skipped = false;
      for (let r = regions.length - 1; r >= 0; r--) {
        const reg = regions[r]!;
        if (reg.end <= k) break; // sorted: nothing earlier can contain k
        if (!reg.code && reg.start <= k) {
          k = reg.start - 1;
          skipped = true;
          break;
        }
      }
      if (skipped) continue;
      if (!/\s/.test(src[k]!)) return src[k]!;
      k--;
    }
    return '';
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      pushCode(i);
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      regions.push({ start: i, end: stop, code: false });
      i = stop;
      codeStart = i;
    } else if (c === '/' && src[i + 1] === '*') {
      pushCode(i);
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      regions.push({ start: i, end: stop, code: false });
      i = stop;
      codeStart = i;
    } else if (c === '"' || c === "'") {
      pushCode(i);
      const end = scanString(src, i, c);
      regions.push({ start: i, end, code: false });
      i = end;
      codeStart = i;
    } else if (c === '`') {
      pushCode(i);
      const end = scanTemplate(src, i);
      regions.push({ start: i, end, code: false });
      i = end;
      codeStart = i;
    } else if (c === '/' && isRegexStart(prevSignificant())) {
      pushCode(i);
      const end = scanRegex(src, i);
      regions.push({ start: i, end, code: false });
      i = end;
      codeStart = i;
    } else {
      i++;
    }
  }
  pushCode(src.length);
  return regions;
}

function isRegexStart(prev: string): boolean {
  if (prev === '') return true;
  return '([{,;=:!&|?+-*%~^<>'.includes(prev);
}

function scanString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i + 1;
    else i++;
  }
  return src.length;
}

function scanTemplate(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === '`') return i + 1;
    else if (src[i] === '$' && src[i + 1] === '{') i = scanInterpolation(src, i);
    else i++;
  }
  return src.length;
}

function scanInterpolation(src: string, start: number): number {
  let depth = 0;
  let i = start + 1; // at `{`
  while (i < src.length) {
    const c = src[i]!;
    if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
      i++;
    } else if (c === '"' || c === "'") i = scanString(src, i, c); // returns past the quote
    else if (c === '`') i = scanTemplate(src, i); // returns past the backtick
    else i++;
  }
  return src.length;
}

function scanRegex(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') i += 2;
    else if (c === '[') {
      inClass = true;
      i++;
    } else if (c === ']') {
      inClass = false;
      i++;
    } else if (c === '/' && !inClass) {
      i++;
      while (i < src.length && /[a-z]/.test(src[i]!)) i++; // flags
      return i;
    } else if (c === '\n') return i; // bail — was a division after all
    else i++;
  }
  return src.length;
}

/**
 * Is `index` inside a CODE (unmasked) region? Regions are sorted and
 * non-overlapping; the tester is stateless binary search so several scan
 * passes can query positions in any order.
 */
export function regionTester(regions: Array<{ start: number; end: number; code: boolean }>) {
  return (index: number): boolean => {
    let lo = 0;
    let hi = regions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (regions[mid]!.end <= index) lo = mid + 1;
      else hi = mid;
    }
    const r = regions[lo]!;
    return r.code && index >= r.start;
  };
}

// ── balanced scanning over the original source ────────────────────────────

export class Scanner {
  private src: string;
  private isCode: (i: number) => boolean;
  constructor(src: string, regions: Array<{ start: number; end: number; code: boolean }>) {
    this.src = src;
    this.isCode = regionTester(regions);
  }
  /** Index just past the balancing closer for the opener at `open`. */
  balanced(open: number): number {
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    let i = open;
    while (i < this.src.length) {
      if (!this.isCode(i)) {
        i++;
        continue;
      }
      const c = this.src[i]!;
      if (c === '(' || c === '[' || c === '{') stack.push(pairs[c]!);
      else if (c === ')' || c === ']' || c === '}') {
        const expect = stack.pop();
        if (expect === c) {
          if (stack.length === 0) return i + 1;
        } else if (stack.length === 0) {
          throw new Error(`unbalanced closer '${c}' at ${i}`);
        }
      }
      i++;
    }
    throw new Error(`unterminated '${this.src[open]}' at ${open}`);
  }
  /**
   * Top-level comma-separated args of the group opened at `openParen`.
   * `balancedEnd` is Scanner.balanced()'s return value: the index just past
   * the group's closing bracket. `text` is untrimmed so that offsets into it
   * align with absolute source positions via `start`.
   */
  args(
    openParen: number,
    balancedEnd: number,
  ): Array<{ text: string; start: number; end: number }> {
    const closeIdx = balancedEnd - 1; // the closing bracket itself
    const args: Array<{ text: string; start: number; end: number }> = [];
    let depth = 0;
    let angleDepth = 0;
    let prevCodeChar = '';
    let argStart = openParen + 1;
    for (let i = openParen + 1; i < closeIdx; i++) {
      if (!this.isCode(i)) continue;
      const c = this.src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (
        c === '<' &&
        /[A-Za-z0-9_$]/.test(prevCodeChar) &&
        this.src[i + 1] !== '=' &&
        !/\s/.test(this.src[i + 1] ?? ' ')
      ) {
        angleDepth++; // generic type argument: identifier + '<' — not '<=' nor 'a < b'
      } else if (c === '>' && angleDepth > 0 && prevCodeChar !== '=') {
        angleDepth--; // not '=>' — arrows never close a generic
      } else if (c === ',' && depth === 0 && angleDepth === 0) {
        // text stays UNTRIMMED: entry.start + offsets into text must index
        // the same characters (the object-form rewrite depends on this)
        args.push({ text: this.src.slice(argStart, i), start: argStart, end: i });
        argStart = i + 1;
      }
      if (!/\s/.test(c)) prevCodeChar = c;
    }
    const last = { text: this.src.slice(argStart, closeIdx), start: argStart, end: closeIdx };
    // a trailing comma yields an empty final arg — not a real argument
    if (last.text.trim() !== '' || args.length === 0) args.push(last);
    return args;
  }
}

class SkipFile extends Error {}

// ── transforms ────────────────────────────────────────────────────────────

type Edit = { start: number; end: number; replacement: string };

/** Narrow Deno.test edits: header only; the callback body is untouched. */
function rewriteDenoTest(
  src: string,
  scanner: Scanner,
  codeAt: (i: number) => boolean,
  stats: FileStats,
): Edit[] {
  const edits: Edit[] = [];
  const re = /Deno\.test\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const openParen = m.index + m[0].length - 1;
    if (!codeAt(openParen)) continue;
    const close = scanner.balanced(openParen);
    const args = scanner.args(openParen, close);
    if (args.length >= 1 && args[0]!.text.trimStart().startsWith('{')) {
      edits.push(...rewriteObjectForm(src, scanner, m.index, openParen, close, stats));
      continue;
    }
    if (args.length < 2) throw new SkipFile('manual: Deno.test without name+callback');
    const second = args[1]!;
    let variant = '';
    let secondDropped = false;
    if (second.text.trimStart().startsWith('{')) {
      if (args.length < 3) throw new SkipFile('manual: Deno.test opts object without a callback');
      const keys = topLevelKeys(second.text.trim());
      const unknown = keys.filter(
        (k) => !DROPPABLE_TEST_OPTS.has(k) && k !== 'ignore' && k !== 'only',
      );
      if (unknown.length > 0) throw new SkipFile(`manual: Deno.test opts (${unknown.join(', ')})`);
      const hasIgnore = /(^|[{\s])ignore\s*:\s*true/.test(second.text);
      const hasOnly = /(^|[{\s])only\s*:\s*true/.test(second.text);
      if (hasIgnore && hasOnly) throw new SkipFile('manual: Deno.test opts ignore+only together');
      if (hasIgnore) variant = '.skip';
      else if (hasOnly) variant = '.only';
      if (keys.every((k) => DROPPABLE_TEST_OPTS.has(k)) && !hasIgnore && !hasOnly) {
        stats.optsDropped++;
        secondDropped = true;
      }
    }
    // narrow edit 1: the Deno.test header itself
    edits.push({
      start: m.index,
      end: openParen,
      replacement: `test${variant}`,
    });
    // narrow edit 2: delete a dropped opts argument (opts + its trailing comma)
    if (secondDropped) {
      const third = args[2]!;
      edits.push({ start: second.start, end: third.start, replacement: '' });
    }
    if (variant === '.skip') stats.testSkip++;
    else if (variant === '.only') stats.testOnly++;
    else stats.tests++;
  }
  return edits;
}

/**
 * `Deno.test({ name, [ignore|only|droppables], fn })` — vitest's options
 * object does not carry `fn`, so this decomposes the registration into
 * `test(name, fn)` with disjoint, narrow deletions (the fn body itself is
 * never re-emitted, so assertion edits inside it cannot overlap).
 */
function rewriteObjectForm(
  src: string,
  scanner: Scanner,
  matchStart: number,
  openParen: number,
  closeParen: number,
  stats: FileStats,
): Edit[] {
  const braceOpen = openParen + 1;
  const braceClose = scanner.balanced(braceOpen) - 1; // index of the matching `}`
  const entries = scanner.args(braceOpen, braceClose + 1);
  const parseKey = (text: string): { key: string; method: boolean; async: boolean } | null => {
    // entry text may carry leading whitespace and line comments (a comment
    // between two object keys rides inside the following entry's span)
    const stripped = text.replace(/^\s*(\/\/[^\n]*\n\s*)*/, '');
    const km = /^(async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::|\()/.exec(stripped);
    if (!km) return stripped.trim() === 'fn' ? { key: 'fn', method: false, async: false } : null;
    return { key: km[2]!, method: stripped[km[0]!.length - 1] === '(', async: Boolean(km[1]) };
  };
  const parsed = entries.map((e) => ({ entry: e, parsed: parseKey(e.text) }));
  if (parsed.some((p) => p.parsed === null)) {
    throw new SkipFile('manual: Deno.test object form with an unparseable key');
  }
  const nameEntry = parsed.find((p) => p.parsed!.key === 'name');
  const fnEntry = parsed.find((p) => p.parsed!.key === 'fn');
  if (!nameEntry || !fnEntry) throw new SkipFile('manual: Deno.test object form without name/fn');
  if (fnEntry.entry !== parsed[parsed.length - 1]!.entry) {
    throw new SkipFile('manual: Deno.test object form with fn not the last key');
  }
  const unknown = parsed
    .map((p) => p.parsed!.key)
    .filter(
      (k) =>
        k !== 'name' && k !== 'fn' && !DROPPABLE_TEST_OPTS.has(k) && k !== 'ignore' && k !== 'only',
    );
  if (unknown.length > 0)
    throw new SkipFile(`manual: Deno.test object opts (${unknown.join(', ')})`);

  // ignore/only map to test.skip / test.only; a computed condition maps to
  // vitest's skipIf/runIf (the condition expression moves into the header)
  const ignoreEntry = parsed.find((p) => p.parsed!.key === 'ignore');
  const onlyEntry = parsed.find((p) => p.parsed!.key === 'only');
  if (ignoreEntry && onlyEntry)
    throw new SkipFile('manual: Deno.test object opts ignore+only together');
  const entryValue = (text: string): string => text.slice(text.indexOf(':') + 1).trim();
  let variant = '';
  if (ignoreEntry) {
    const val = entryValue(ignoreEntry.entry.text);
    variant = val === 'true' ? '.skip' : `.skipIf(${val})`;
  } else if (onlyEntry) {
    const val = entryValue(onlyEntry.entry.text);
    variant = val === 'true' ? '.only' : `.runIf(${val})`;
  }

  const edits: Edit[] = [];
  // deletion spans for whole entries other than name/fn, extended to swallow
  // the adjacent comma (forward to the next entry's start; backwards when last)
  const deletions: Array<[number, number]> = [];
  for (let k = 0; k < parsed.length; k++) {
    const p = parsed[k]!;
    if (p.parsed!.key !== 'name' && p.parsed!.key !== 'fn') {
      const next = parsed[k + 1];
      if (next) deletions.push([p.entry.start, next.entry.start]);
      else deletions.push([parsed[k - 1]!.entry.end, p.entry.end]);
    }
  }
  // `{` + `name:` key — the name value becomes test()'s first argument
  const nameText = nameEntry.entry.text;
  const nameColon = nameText.indexOf(':');
  const afterColon = nameText.slice(nameColon + 1);
  const nameExprStart =
    nameEntry.entry.start + nameColon + 1 + (afterColon.length - afterColon.trimStart().length);
  deletions.push([braceOpen, nameExprStart]);
  // `fn:` key (or method shorthand rename) — the function becomes arg 2
  const fnText = fnEntry.entry.text;
  const fnStripped = fnText.replace(/^\s*(\/\/[^\n]*\n\s*)*/, '');
  const fnCommentOffset = fnText.length - fnStripped.length;
  const fnColon = fnStripped.indexOf(':');
  if (fnEntry.parsed!.method) {
    const methodMatch = /^(async\s+)?fn\b/.exec(fnStripped);
    if (!methodMatch) throw new SkipFile('manual: Deno.test object fn method form not recognized');
    const identStart = fnEntry.entry.start + fnCommentOffset + methodMatch[0].indexOf('fn');
    edits.push({ start: identStart, end: identStart + 2, replacement: 'function fn' });
  } else {
    const fnExprStart = fnEntry.entry.start + fnCommentOffset + fnColon + 1;
    deletions.push([fnEntry.entry.start, fnExprStart]);
  }
  // the object's own closing brace — test()'s closing paren stays
  deletions.push([braceClose, braceClose + 1]);

  edits.push({ start: matchStart, end: openParen, replacement: `test${variant}` });
  for (const [start, end] of deletions) edits.push({ start, end, replacement: '' });
  if (variant === '.skip') stats.testSkip++;
  else if (variant === '.only') stats.testOnly++;
  else if (variant.startsWith('.skipIf')) stats.testSkipIf++;
  else if (variant.startsWith('.runIf')) stats.testRunIf++;
  else stats.tests++;
  if (parsed.some((p) => DROPPABLE_TEST_OPTS.has(p.parsed!.key))) stats.optsDropped++;
  return edits;
}

/** Top-level keys of an options object literal (shallow — quotes/depth aware). */
function topLevelKeys(optsText: string): string[] {
  const inner = optsText.slice(1, -1);
  const keys: string[] = [];
  let depth = 0;
  let tokenStart = 0;
  let i = 0;
  const flush = (end: number) => {
    const part = inner.slice(tokenStart, end).trim();
    const key = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(part)?.[1];
    if (key) keys.push(key);
  };
  while (i < inner.length) {
    const c = inner[i]!;
    if (c === '"' || c === "'") i = scanString(inner, i, c) - 1;
    else if (c === '`') i = scanTemplate(inner, i) - 1;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      flush(i);
      tokenStart = i + 1;
    }
    i++;
  }
  flush(inner.length);
  return keys;
}

function rewriteAssertCalls(
  src: string,
  scanner: Scanner,
  codeAt: (i: number) => boolean,
  importedNames: Set<string>,
  stats: FileStats,
  softHelperUsed: { value: boolean },
): Edit[] {
  const edits: Edit[] = [];
  const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src))) {
    const name = m[1]!;
    if (!ASSERT_TABLE[name] || !importedNames.has(name)) continue;
    const openParen = m.index + m[0].length - 1;
    if (!codeAt(openParen)) continue;
    if (SOFT_THROWS && THROW_NAMES.has(name)) {
      const closeSoft = scanner.balanced(openParen);
      const softArgs = scanner.args(openParen, closeSoft).map((a) => a.text.trim());
      edits.push({
        start: m.index,
        end: closeSoft,
        replacement: SOFT_THROW_TABLE[name]!.build(softArgs),
      });
      stats.asserts[name] = (stats.asserts[name] ?? 0) + 1;
      softHelperUsed.value = true;
      callRe.lastIndex = closeSoft;
      continue;
    }
    const close = scanner.balanced(openParen);
    const args = scanner.args(openParen, close);
    const [minArity, maxArity] = ASSERT_TABLE[name]!.arity;
    const isThrow = THROW_NAMES.has(name);
    // std's trailing message argument rides one past the table arity.
    // callArgs are trimmed: replacements are freshly emitted code with no
    // position math, so trimming is safe here (the object-form rewrite is
    // the only consumer that needs raw coordinates).
    let callArgs = args.map((a) => a.text.trim());
    let message = '';
    const where = `@ line ${src.slice(0, m.index).split('\n').length}`;
    if (isThrow) {
      if (args.length === maxArity + 1 && callArgs[maxArity] === 'undefined') {
        callArgs = callArgs.slice(0, maxArity); // explicit-undefined msgIncludes ≡ absent
      } else if (args.length > maxArity) {
        // `assertThrows(fn, C, msgIncludes, assertMsg)` — std's trailing
        // assertion message rides past msgIncludes. A literal-undefined
        // msgIncludes collapses to the 2-arg form + expect() message
        // (exactly equivalent, single invocation); a real msgIncludes has
        // no single-call vitest equivalent (substring+class) → manual.
        const stdMsg = args[args.length - 1]!.text;
        const msgIncludes = callArgs[maxArity]!;
        if (args.length === maxArity + 2 && msgIncludes === 'undefined') {
          callArgs = callArgs.slice(0, maxArity);
          message = stdMsg;
        } else {
          throw new SkipFile(
            `manual: ${name} with ${args.length} args ${where} — msgIncludes has no vitest one-liner`,
          );
        }
      }
    } else if (args.length === maxArity + 1) {
      message = callArgs[maxArity]!;
      callArgs = callArgs.slice(0, maxArity);
    } else if (args.length > maxArity + 1) {
      throw new SkipFile(`manual: ${name} arity ${args.length} ${where}`);
    }
    if (args.length < minArity) throw new SkipFile(`manual: ${name} arity ${args.length} ${where}`);

    let replacement = ASSERT_TABLE[name]!.build(callArgs);
    if (message) replacement = spliceExpectMessage(replacement, message);
    edits.push({ start: m.index, end: close, replacement });
    stats.asserts[name] = (stats.asserts[name] ?? 0) + 1;
    callRe.lastIndex = close;
  }
  return edits;
}

/** Relative specifier of tests/lib/vitest-asserts.ts from a repo file. */
function helperSpecifier(filePath: string): string {
  const rel = path.relative(
    path.dirname(path.resolve(filePath)),
    path.resolve('tests/lib/vitest-asserts.ts'),
  );
  const posix = rel.split(path.sep).join('/');
  return posix.startsWith('.') ? posix : `./${posix}`;
}

/** Insert the std trailing message as expect()'s optional 2nd argument. */
function spliceExpectMessage(replacement: string, message: string): string {
  const bodyScanner = new Scanner(replacement, scanRegions(replacement));
  const closeExpect = bodyScanner.balanced(replacement.indexOf('('));
  const closeIdx = closeExpect - 1; // index of expect's own ')'
  return `${replacement.slice(0, closeIdx)}, ${message}${replacement.slice(closeIdx)}`;
}

function rewriteImports(
  src: string,
  codeAt: (i: number) => boolean,
  usedNames: Set<string>,
  stats: FileStats,
  filePath: string,
  softHelperUsed: boolean,
): Edit[] {
  const edits: Edit[] = [];
  const names = [...usedNames].sort().join(', ');
  const vitestImport = usedNames.size > 0 ? `import { ${names} } from 'vitest';` : '';
  const helperImport = softHelperUsed
    ? `import { assertRejectsIncludes, assertThrowsIncludes } from '${helperSpecifier(filePath)}';`
    : '';
  const re = /import\s*(?:type\s*)?\{[^}]*\}\s*from\s*(['"])@std\/assert\1\s*;?/g;
  let m: RegExpExecArray | null;
  let seen = false;
  while ((m = re.exec(src))) {
    if (!codeAt(m.index)) continue;
    stats.importRewritten++;
    // first occurrence carries the vitest import; any further ones delete
    const block = [vitestImport, helperImport].filter(Boolean).join('\n');
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: seen ? '' : block,
    });
    seen = true;
  }
  if (!seen && (usedNames.size > 0 || helperImport)) {
    // Deno.test-only file (no @std/assert import): prepend at the top
    const block = [vitestImport, helperImport].filter(Boolean).join('\n');
    edits.push({ start: 0, end: 0, replacement: `${block}\n` });
  }
  return edits;
}

// ── per-file pipeline ─────────────────────────────────────────────────────

export function transformFile(filePath: string, relFile: string): FileStats | null {
  const src = fs.readFileSync(filePath, 'utf8');
  // Migration unit: a Deno.test registration, or a leftover @std/assert
  // import whose registration was already structurally converted by hand
  // (the B3 step-2 t.step restructures).
  if (!/Deno\.test\s*\(/.test(src) && !/from\s*['"]@std\/assert['"]/.test(src)) return null;

  const stats: FileStats = {
    file: relFile,
    tests: 0,
    testSkip: 0,
    testSkipIf: 0,
    testOnly: 0,
    testRunIf: 0,
    optsDropped: 0,
    asserts: {},
    importRewritten: 0,
    netCalls: [],
    notes: [],
    skipped: false,
  };

  // manual-batch gates, checked before any edit is attempted
  if (/\bt\s*\.\s*step\s*\(/.test(src)) {
    stats.notes.push(
      'manual: t.step sequential subtests — vitest 5.0.2 forbids test() inside a running test; needs describe + beforeEach restructure',
    );
    stats.skipped = true;
    return stats;
  }
  for (const api of NET_APIS) {
    const re = new RegExp(`\\bDeno\\.${api}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    const regions = scanRegions(src);
    const codeAt = regionTester(regions);
    while ((m = re.exec(src))) {
      if (codeAt(m.index)) {
        stats.netCalls.push(`Deno.${api}`);
        stats.notes.push(
          `manual: live Deno.${api} call — needs the node:http adaptation (residuals doc §5); registration/asserts still converted`,
        );
        break;
      }
    }
  }

  try {
    const regions = scanRegions(src);
    const codeAt = regionTester(regions);
    const scanner = new Scanner(src, regions);

    const importedNames = new Set<string>();
    const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(['"])@std\/assert\2/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(src))) {
      if (!codeAt(im.index)) continue;
      for (let raw of im[1]!.split(',')) {
        raw = raw.trim().replace(/^type\s+/, '');
        if (raw) importedNames.add(raw);
      }
    }
    for (const name of importedNames) {
      if (!ASSERT_TABLE[name]) {
        stats.notes.push(`manual: ${name} is not in the mapping table`);
        stats.skipped = true;
        return stats;
      }
    }
    // `= assertThrows(...)` AND `= await assertRejects(...)` both capture the
    // caught error; `.rejects.toThrow()` returns undefined, so any captured
    // use is a manual case (vitest has no throwing-assertion that hands back
    // the error value)
    const captureRe = /(?:=|return)\s*(?:await\s+)?assert(?:Throws|Rejects)\s*\(/g;
    if (!SOFT_THROWS) {
      let cm: RegExpExecArray | null;
      while ((cm = captureRe.exec(src))) {
        if (codeAt(cm.index)) {
          stats.notes.push('manual: assertThrows/assertRejects return value captured');
          stats.skipped = true;
          return stats;
        }
      }
    }
    const bareCallRe = /\b(assert[A-Za-z]*)\s*\(/g;
    let bm: RegExpExecArray | null;
    while ((bm = bareCallRe.exec(src))) {
      if (!codeAt(bm.index)) continue;
      const name = bm[1]!;
      if (ASSERT_TABLE[name] && !importedNames.has(name)) {
        stats.notes.push(`manual: ${name} called without a direct @std/assert import`);
        stats.skipped = true;
        return stats;
      }
    }

    const testEdits = rewriteDenoTest(src, scanner, codeAt, stats);
    const softHelperUsed = { value: false };
    const assertEdits = rewriteAssertCalls(
      src,
      scanner,
      codeAt,
      importedNames,
      stats,
      softHelperUsed,
    );
    // corruption guard: an @std/assert import whose calls were NOT rewritten
    // must never lose its import (that would leave undefined identifiers)
    if (importedNames.size > 0 && testEdits.length === 0 && assertEdits.length === 0) {
      throw new SkipFile('manual: @std/assert import present but no call was rewritten');
    }

    // vitest import names follow ACTUAL post-edit usage (the step-2
    // hand-restructures introduced describe/test before this codemod ran on
    // these files)
    const applyEdits = (base: string, list: Edit[]): string => {
      let out = base;
      for (let k = list.length - 1; k >= 0; k--) {
        const e = list[k]!;
        out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
      }
      return out;
    };
    const bodyWithoutImports = applyEdits(src, [...testEdits, ...assertEdits]);
    const bodyCodeAt = regionTester(scanRegions(bodyWithoutImports));
    const usedNames = new Set<string>();
    for (const name of ['test', 'describe', 'expect'] as const) {
      const usage = new RegExp(`\\b${name}\\s*\\(`, 'g');
      for (const um of bodyWithoutImports.matchAll(usage)) {
        if (bodyCodeAt(um.index)) {
          usedNames.add(name);
          break;
        }
      }
    }
    const importEdits = rewriteImports(
      src,
      codeAt,
      usedNames,
      stats,
      filePath,
      softHelperUsed.value,
    );

    const all = [...testEdits, ...assertEdits, ...importEdits].sort((a, b) => a.start - b.start);
    for (let k = 1; k < all.length; k++) {
      if (all[k]!.start < all[k - 1]!.end) throw new SkipFile('manual: overlapping rewrites');
    }
    const out = applyEdits(src, all);

    // audit: the transformed output must be free of codemod triggers
    const outRegions = scanRegions(out);
    const outCodeAt = regionTester(outRegions);
    for (const m2 of out.matchAll(/Deno\.test\s*\(/g)) {
      if (outCodeAt(m2.index)) throw new SkipFile('manual: Deno.test survived the rewrite');
    }
    for (const m2 of out.matchAll(/@std\/assert/g)) {
      if (outCodeAt(m2.index)) throw new SkipFile('manual: @std/assert survived the rewrite');
    }

    if (!DRY) fs.writeFileSync(filePath, out);
    return stats;
  } catch (error) {
    if (error instanceof SkipFile) {
      stats.notes.push(error.message);
      stats.skipped = true;
      return stats;
    }
    throw error;
  }
}

// ── target discovery ──────────────────────────────────────────────────────

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of ROOTS) walk(path.resolve(root), files);

  const results: FileStats[] = [];
  const excluded: string[] = [];
  for (const file of files) {
    const rel = path.relative('.', file);
    if (EXCLUDED_PATH_PATTERNS.some((match) => match(rel))) {
      let src: string;
      try {
        src = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (/Deno\.test\s*\(/.test(src)) excluded.push(rel);
      continue;
    }
    let stats: FileStats | null = null;
    try {
      stats = transformFile(file, rel);
    } catch (error) {
      console.error(`FAILED on ${rel}:`, error);
      process.exitCode = 1;
      return;
    }
    if (stats !== null) results.push(stats);
  }

  const changed = results.filter((r) => !r.skipped);
  const manual = results.filter((r) => r.skipped);
  const flagged = changed.filter((r) => r.notes.length > 0); // transformed AND flagged (net calls)
  const sum = (pick: (r: FileStats) => number) => changed.reduce((s, r) => s + pick(r), 0);

  console.log(`codemod-deno-test-to-vitest ${DRY ? '(dry)' : '(applied)'}`);
  console.log(
    `scanned ${files.length} files · ${results.length} candidates (Deno.test registration) · ` +
      `${changed.length} transformable (incl. ${flagged.length} flagged for net-call adaptation) · ` +
      `${manual.length} manual-batch · ${excluded.length} excluded by policy`,
  );
  console.log(
    `totals: ${sum((r) => r.tests)} test() · ${sum((r) => r.testSkip)} test.skip · ${sum((r) => r.testSkipIf)} test.skipIf · ` +
      `${sum((r) => r.testOnly)} test.only · ${sum((r) => r.testRunIf)} test.runIf · ` +
      `${sum((r) => r.optsDropped)} dropped permission/sanitize opts · ${sum((r) => r.importRewritten)} imports rewritten`,
  );

  console.log(`\n── per-file transform stats (${changed.length}) ──`);
  for (const r of changed) {
    const asserts = Object.entries(r.asserts)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    const flags = [
      r.testSkip > 0 ? `skip×${r.testSkip}` : '',
      r.testSkipIf > 0 ? `skipIf×${r.testSkipIf}` : '',
      r.testOnly > 0 ? `only×${r.testOnly}` : '',
      r.testRunIf > 0 ? `runIf×${r.testRunIf}` : '',
      r.optsDropped > 0 ? `optsDropped×${r.optsDropped}` : '',
      r.netCalls.length > 0 ? `net:${r.netCalls.join('+')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `  ${r.file}  tests:${r.tests}${flags ? ` ${flags}` : ''}${asserts ? `  [${asserts}]` : ''}`,
    );
  }

  console.log(`\n── manual batch (${manual.length}) ──`);
  for (const r of manual) {
    console.log(`  ${r.file}`);
    for (const note of r.notes) console.log(`    - ${note}`);
  }

  if (excluded.length > 0) {
    console.log(`\n── excluded by policy (${excluded.length}) ──`);
    for (const f of excluded) console.log(`  ${f}`);
  }

  if (DRY) console.log('\n(dry run — nothing written)');
}

// CLI guard: running as a program executes the codemod; importing as a module
// (e.g. for verification harnesses) only exposes the functions.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
