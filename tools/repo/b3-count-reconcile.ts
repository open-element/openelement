/**
 * B3 post-migration test-count reconciliation (mirror of the B3-0 baseline).
 *
 * Counts `test(`/`it(`/`test.skip`/`test.skipIf`/`test.only`/`test.runIf`
 * occurrences per formerly-Deno.test file, writes
 * .zcode/workflow-drafts/b3-post-counts.json, and prints a per-file delta
 * against .zcode/workflow-drafts/b3-pre-counts.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface FileCounts {
  tests: number;
  steps: number;
}

/** JSON shape of b3-pre-counts.json / b3-post-counts.json (the fields this tool reads/writes). */
interface CountReport {
  task: string;
  generatedAt: string;
  notes: string[];
  files: Record<string, FileCounts>;
  totals: { files: number; tests: number; steps: number };
  realTestTotals?: { files: number; tests: number; steps: number };
}

const { scanRegions, regionTester } = (await import(
  pathToFileURL(path.resolve('tools/repo/codemod-deno-test-to-vitest.ts')).href
)) as typeof import('./codemod-deno-test-to-vitest.ts');

const pre = JSON.parse(
  fs.readFileSync('.zcode/workflow-drafts/b3-pre-counts.json', 'utf8'),
) as CountReport;
const post: CountReport = {
  task: 'B3 post-migration counts (vitest surface)',
  generatedAt: new Date().toISOString(),
  notes: [
    'benchmarks baseline coverage: B3-0 pre-counts include benchmarks/micro/micro.test.ts (2) and benchmarks/jfb/harness.test.ts (10); both migrated 1:1 onto the vitest `benchmarks` project (12 tests green).',
  ],
  files: {},
  totals: { files: 0, tests: 0, steps: 0 },
};

/**
 * A printed delta is acceptable only when it is auto-classified as a
 * steps-flattening merge (pre.steps > 0 → describe/beforeEach containers)
 * or carries an explicit reason here. Anything else prints as UNEXPECTED and
 * fails the run — a genuine case loss must be fixed, never reconciled away.
 */
const KNOWN_DELTA_REASONS: Record<string, string> = {
  // The baseline rule counted raw /Deno\.test\(/ occurrences per file
  // (countingRules in b3-pre-counts.json), so the fixture string literal —
  // a fake package file written to prove the artifact scanner rejects
  // internal test paths — was counted as a test. Post counts code regions
  // only; the 25 real registrations map 1:1 onto 25 test() calls (name
  // lists verified equal, B3 补漏 review).
  'tools/release/check-package-artifacts.test.ts':
    'baseline overcount: raw-regex baseline counted a fixture string literal; post counts code regions only (25→25 registrations, 1:1)',
  // www/app/data is generated guide content: its Deno.test mentions are
  // product documentation for framework users' own projects, excluded from
  // the migration by the codemod's www/app/data path policy.
  'www/app/data/_generated-guide-data.ts':
    'generated guide content: Deno.test mentions are product documentation; excluded from migration by codemod path policy',
};

const deltas: Array<{ file: string; reason: string; pre: FileCounts; post?: FileCounts }> = [];
for (const [file, counts] of Object.entries(pre.files)) {
  let src: string | null = null;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    deltas.push({ file, reason: 'file deleted or renamed (see report)', pre: counts });
    continue;
  }
  // code-region counting: string/template/comment mentions (e.g. the fake
  // package fixtures that embed `Deno.test("internal", ...)` text) never
  // counted as tests under the deno runner and must not count now
  const codeAt = regionTester(scanRegions(src));
  let tests = 0;
  for (const m of src.matchAll(
    /(?<!\w)(?<!\.)(test|it)(?:\.(?:skip|skipIf|only|runIf|each))?\s*\(/g,
  )) {
    if (codeAt(m.index)) tests++;
  }
  const steps = (src.match(/\.step\s*\(/g) ?? []).length;
  post.files[file] = { tests, steps };
  post.totals.files++;
  post.totals.tests += tests;
  post.totals.steps += steps;
  if (tests !== counts.tests || steps !== counts.steps) {
    const reason =
      counts.steps > 0
        ? 'steps flattened into describe/beforeEach containers (vitest refuses test() inside a running test)'
        : (KNOWN_DELTA_REASONS[file] ??
          'UNEXPECTED — investigate before calling the migration complete');
    deltas.push({ file, reason, pre: counts, post: { tests, steps } });
  }
}
fs.writeFileSync('.zcode/workflow-drafts/b3-post-counts.json', JSON.stringify(post, null, 2));
console.log('post totals:', JSON.stringify(post.totals));
console.log(
  'pre totals:',
  JSON.stringify(pre.totals),
  '/ realTestTotals:',
  JSON.stringify(pre.realTestTotals),
);
console.log(`\ndeltas (${deltas.length}, each must carry an allow-listed reason):`);
let unexpected = 0;
for (const d of deltas) {
  const isUnexpected = d.reason.startsWith('UNEXPECTED');
  if (isUnexpected) unexpected++;
  console.log(`  [${isUnexpected ? 'UNEXPECTED' : 'ok'}] ${d.file}`);
  console.log(`      reason: ${d.reason}`);
  console.log(`      ${JSON.stringify({ pre: d.pre, post: d.post })}`);
}
if (unexpected > 0) {
  console.log(`\n${unexpected} UNEXPECTED delta(s) — real case loss; fix before cutover`);
  process.exitCode = 1;
}
