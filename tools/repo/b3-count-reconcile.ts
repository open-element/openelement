/**
 * B3 post-migration test-count reconciliation (mirror of the B3-0 baseline).
 *
 * Baseline: `tools/repo/b3-pre-counts.snapshot.json` — the COMMITTED record
 * of the pre-migration Deno.test static counts. Generation method
 * (reproducible): at the pre-migration tree (the parent of cutover commit
 * 869c959c6, "test(repo): migrate all Deno.test suites to vitest incl.
 * __wtr__ browser mode (B3)"), per formerly-Deno.test file:
 *
 *   tests = occurrences of /Deno\.test\(/
 *   steps = occurrences of /\.step\s*\(/
 *
 * The snapshot's own `countingRules` field carries the full recipe (regexes,
 * scope `*.ts` only, `.zcode/` excluded, .gitignore-respecting) and its
 * `notes` field carries the baseline's known caveats — the snapshot is
 * self-describing by design.
 *
 * This script recounts the vitest surface per file — CODE-REGION-SCOPED
 * `test(`/`it(` variants (string/template/comment mentions never counted)
 * plus `.step(` — writes `.artifacts/b3-post-counts.json`, and prints a
 * per-file delta against the snapshot. Run from the repository root.
 *
 * A delta is acceptable ONLY when the file has an explicit entry in
 * RECONCILED (reason + the exact expected post counts) or, for baseline
 * files that no longer exist, in DELETED_BASELINE_FILES. There are NO class
 * exemptions: steps-bearing files are enumerated per file with their
 * flattened mapping (the former blanket `steps > 0 ⇒ steps-flattened` rule
 * waved through any change, including a real case loss, in every one of the
 * 8 steps files), and any count outside its pinned shape is UNEXPECTED and
 * fails the run.
 *
 * Post-baseline files born inside the alpha8 train are enumerated in
 * TRAIN_NEW_FILES with pinned counts and the same fail-closed treatment —
 * a missing file or a drifted count is UNEXPECTED. Surfaces outside this
 * ledger's Deno.test-migration scope (www e2e, __wtr__ helpers, shared
 * harness modules) are recorded as census notes in the written post report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface FileCounts {
  tests: number;
  steps: number;
}

/** JSON shape of the snapshot / post report (the fields this tool reads/writes). */
interface CountReport {
  task: string;
  generatedAt: string;
  notes: string[];
  files: Record<string, FileCounts>;
  totals: { files: number; tests: number; steps: number };
  realTestTotals?: { files: number; tests: number; steps: number };
  trainNewFiles?: Record<string, FileCounts & { reason: string }>;
  countingRules?: string;
}

const REPO_ROOT = process.cwd();
const SNAPSHOT_PATH = path.join(import.meta.dirname, 'b3-pre-counts.snapshot.json');
const POST_PATH = path.join(REPO_ROOT, '.artifacts', 'b3-post-counts.json');

const { scanRegions, regionTester } = (await import(
  pathToFileURL(path.resolve(import.meta.dirname, 'codemod-deno-test-to-vitest.ts')).href
)) as typeof import('./codemod-deno-test-to-vitest.ts');

const pre = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as CountReport;
const post: CountReport = {
  task: 'B3 post-migration counts (vitest surface)',
  generatedAt: new Date().toISOString(),
  notes: [
    'benchmarks baseline coverage: B3-0 pre-counts include benchmarks/micro/micro.test.ts (2) and the in-repo js-framework-benchmark harness test file (10); both migrated 1:1 onto the vitest `benchmarks` project (12 tests green).',
    'benchmark-harness removal (owner ruling 2026-10-03): the in-repo js-framework-benchmark surface was deleted (upstream lane lives on the SisyphusZheng/web fork, PR #2104); the expected "file deleted" delta for the harness test file removes its 10 tests, leaving the 2 micro tests in the benchmarks project.',
    'alpha8 train unchanged-count rewrites (no delta, so no RECONCILED entry; census only): module-analysis 2→2 (expectations edited in place); signal-boundary 4→4 (title de-versioned: "1.0.0-alpha.1 declares exactly one shipped engine adapter" → "the package declares exactly one shipped engine adapter"); compiled-server/deferred-dsd-bridge 8→8; alias-utils 11→11 (title wording deno.json exports → package manifest exports); renderer-adapter 1→1 (byte+hash pins re-synced for the alpha8 emitted-comment restatement). vp-pack 13→14 and pack-surface 13→14 were already pinned in RECONCILED and re-verified ok.',
    'alpha8 train uncounted surfaces (outside the Deno.test-migration ledger scope; census only): the new shared harness/helper modules in element __tests__ (compiled-claim/claim-harness.ts, compiled-runtime/light-counter-harness.ts, compiled-runtime/pre-upgrade-helpers.ts, esm-subprocess.ts) carry 0 code-region test registrations; packages/element/__wtr__ contains 0 *.test.ts files and its helpers/tooling 0 code-region test registrations; www e2e specs were never Deno.test — train record 725→723 runner tests (3 assertion deletions; static spec census this run: 138→136 test( registrations, dsd-layers 6→5 and nested-ce 5→4).',
  ],
  files: {},
  totals: { files: 0, tests: 0, steps: 0 },
};

/**
 * Per-file reconciled deltas. Each entry pins the EXACT accepted post
 * counts: a delta matches only when tests and steps both equal `expect`.
 * Grouped by what happened, oldest first.
 */
const RECONCILED: Record<string, { reason: string; expect: FileCounts }> = {
  // ── steps flattening at migration time (per-file pinned mapping) ──
  // Nested t.step bodies merge into their parent test, so post.tests is
  // pre.tests + non-nested steps, pinned per file from the migration run.
  'packages/element/__tests__/compiled-element-v1.test.ts': {
    reason: 'steps flattened: 9 Deno.test + 39 t.step → 43 vitest test()',
    expect: { tests: 43, steps: 0 },
  },
  'packages/router/__tests__/build.test.ts': {
    reason: 'steps flattened: 7 + 14 → 15',
    expect: { tests: 15, steps: 0 },
  },
  'packages/router/__tests__/request-time-admission-parity.test.ts': {
    reason: 'steps flattened: 3 + 1 → 3',
    expect: { tests: 3, steps: 0 },
  },
  'packages/element/__tests__/part-program-v1-conformance.test.ts': {
    reason: 'steps flattened: 2 + 11 → 12',
    expect: { tests: 12, steps: 0 },
  },
  'packages/element/__tests__/v044-delivery/compiler-gate.test.ts': {
    reason: 'steps flattened: 2 + 2 → 3',
    expect: { tests: 3, steps: 0 },
  },
  'packages/router/__tests__/island-transform.test.ts': {
    reason: 'steps flattened: 2 + 12 → 12',
    expect: { tests: 12, steps: 0 },
  },
  'packages/router/__tests__/request-time-parity.test.ts': {
    reason: 'steps flattened: 1 + 29 → 29',
    expect: { tests: 29, steps: 0 },
  },
  'packages/router/__tests__/ssg-integration.test.ts': {
    reason: 'steps flattened: 1 + 5 → 5',
    expect: { tests: 5, steps: 0 },
  },
  // ── baseline counting caveats (raw-regex baseline vs code-region post) ──
  'tools/release/check-package-artifacts.test.ts': {
    // The baseline rule counted raw /Deno\.test\(/ occurrences per file
    // (countingRules in the snapshot), so the fixture string literal — a
    // fake package file written to prove the artifact scanner rejects
    // internal test paths — was counted as a test. Post counts code regions
    // only; the 25 real registrations map 1:1 onto 25 test() calls (name
    // lists verified equal, B3 补漏 review).
    reason:
      'baseline overcount: raw-regex baseline counted a fixture string literal; post counts code regions only (25→25 registrations, 1:1)',
    expect: { tests: 25, steps: 0 },
  },
  'www/app/data/_generated-guide-data.ts': {
    // www/app/data is generated guide content: its Deno.test mentions are
    // product documentation for framework users' own projects, excluded
    // from the migration by the codemod's www/app/data path policy.
    reason:
      'generated guide content: Deno.test mentions are product documentation; excluded from migration by codemod path policy',
    expect: { tests: 0, steps: 0 },
  },
  // ── post-cutover development drift (NOT migration losses; cited) ──
  'tools/repo/candidate-evidence.test.ts': {
    reason:
      'post-cutover growth +2: B4 lanes (b131ade79 CI task-surface swap; a50af9b9e toolVersions TypeScript record)',
    expect: { tests: 38, steps: 0 },
  },
  'packages/router/__tests__/app-config.test.ts': {
    reason: 'post-cutover growth +1: B1a regression coverage (ec19c19b8 explicit SEO omission)',
    expect: { tests: 30, steps: 0 },
  },
  'packages/create/__tests__/cli.test.ts': {
    reason:
      'post-cutover growth +1: B5 template-surface lanes (dc4e35bfe, 4880b47fb; b0b9860ad edited values only)',
    expect: { tests: 25, steps: 0 },
  },
  'tools/lib/vp-pack.test.ts': {
    reason:
      'post-cutover growth +1: dependency lane — the runtime extraction guard gains a fail-closed case ' +
      'for a relocated runtime-module-path helper (literal resolution base moved from cli/build-client.ts ' +
      'to vite/internal/runtime-module-path.ts)',
    expect: { tests: 14, steps: 0 },
  },
  'tools/release/pack-surface.test.ts': {
    reason:
      'post-cutover growth +1: ed0630c1e split the create Node-floor engine contract into its own ' +
      'pack-surface case (every retained package declares the Node 24.2 floor)',
    expect: { tests: 14, steps: 0 },
  },
  'tools/repo/check-ci-contracts.test.ts': {
    reason: 'post-cutover shrink −1: B4 CI swap / JFB removal lanes (b131ade79, 22ee3cf91)',
    expect: { tests: 20, steps: 0 },
  },
  'tools/release/non-interactive-permissions.test.ts': {
    reason: 'post-cutover shrink −1: release-lane node port completed (203935fac)',
    expect: { tests: 2, steps: 0 },
  },
  'tools/repo/coverage-summary.test.ts': {
    reason:
      'post-cutover growth +1: lcov path normalization at the coverage read boundary (d3a584346, normalizeLcovSourcePaths coverage)',
    expect: { tests: 11, steps: 0 },
  },
  // ── alpha8 train drift (uncommitted working tree at ledger time: the
  //    router/cleanup lanes had not landed as commits, so reasons cite the
  //    lane and the diff, not a SHA) ──
  'packages/router/__tests__/client-asset-manifest.test.ts': {
    reason:
      'alpha8 router-lane growth +4: client-asset-manifest module-id→chunk join coverage ' +
      '(join satisfied by a build-resolved id, fail-closed on an id the emitted graph does not confirm, ' +
      'query-suffix/separator normalization before the join, distinct declared specifiers resolved to one chunk)',
    expect: { tests: 27, steps: 0 },
  },
};

/**
 * Baseline files that no longer exist, each with its named deletion. A
 * missing file WITHOUT an entry here is UNEXPECTED — deletions are
 * enumerated, never class-approved. Entries may also record named
 * deletions of post-baseline train files (absent from the B3-0 snapshot):
 * the loop below consults this map only for missing BASELINE files, so a
 * post-baseline entry is the named-deletion record itself and carries no
 * enforcement.
 */
const DELETED_BASELINE_FILES: Record<string, string> = {
  'benchmarks/jfb/harness.test.ts':
    'deleted 22ee3cf91 — in-repo JFB benchmark surface removed (owner ruling; −10 tests, recorded in the snapshot notes)',
  'tools/repo/check-deno-floor.test.ts':
    'deleted b131ade79 — Deno floor check retired with .dvmrc (B4); the toolchain floor lives in engines/.node-version since',
  // ── alpha8 router lane: Deno import-map mechanism retired (uncommitted
  //    working tree at ledger time; each retired source file was verified
  //    absent: src/vite/internal/{jsonc,deno-import-map,workspace-alias,
  //    npm-specifier-plugin}.ts, src/internal/island-resolution.ts) ──
  'packages/router/__tests__/jsonc.test.ts':
    'deleted in the alpha8 router lane — mechanism retired: the JSONC reader existed for deno.json-style config and its only callers (deno-import-map + workspace-alias plugins) were removed with the Deno import-map mechanism (slop-scan P2 named deletion)',
  'packages/router/__tests__/workspace-alias-hijack.test.ts':
    'deleted in the alpha8 router lane — mechanism retired: the hijack guard pins the workspace-alias resolution layer, removed with the Deno import-map mechanism',
  'packages/router/__tests__/npm-specifier-plugin.test.ts':
    'deleted in the alpha8 router lane — mechanism retired: rewriteNpmSpecifiers unwrapped deno.json import-map `npm:` specs; the import map is gone',
  'packages/router/__tests__/island-resolution.test.ts':
    'deleted in the alpha8 router lane — mechanism retired: the island-resolution second resolver (src/internal/island-resolution.ts removed with it); post-baseline provenance — added 6a3202857 inside the alpha8 train, so it is absent from the B3-0 snapshot and this entry is the named-deletion record',
};

/**
 * Post-baseline files born inside the alpha8 train, absent from the B3-0
 * snapshot and therefore invisible to the per-file delta loop. Each is
 * pinned to its exact count with the same code-region counting and the
 * same fail-closed semantics as RECONCILED: a missing file or a count
 * outside its pinned shape is UNEXPECTED and fails the run.
 */
const TRAIN_NEW_FILES: Record<string, { reason: string; expect: FileCounts }> = {
  'packages/router/__tests__/node-http-abort.test.ts': {
    reason:
      'post-baseline file (added 0c03f63e4 with 3); alpha8 router lane +2 (3→5): client-disconnect abort coverage — a fully received POST body with a slow handler never aborts request.signal, a client destroyed after the body completed does',
    expect: { tests: 5, steps: 0 },
  },
  'tools/repo/check-dependency-age.test.ts': {
    reason:
      'post-baseline file (added 4edea0c93 with 7); alpha8 dependency lane +3 (7→10): fetchPublishTime fails closed when the exact version has no publish time (even with time.created) and on wrong-type publish-time metadata; parseCache discards caches predating the versioned format',
    expect: { tests: 10, steps: 0 },
  },
  'packages/router/__tests__/external-consumer-build.test.ts': {
    reason:
      'new in the alpha8 router lane (+3): external-consumer build attribution — both islands attribute to exactly one emitted chunk each, the client chunk bundles the browser condition and the alias target, the SSR bundle and prerendered HTML carry the import condition',
    expect: { tests: 3, steps: 0 },
  },
  'packages/element/__tests__/attribute-name-predicate.test.ts': {
    reason:
      'new in the alpha8 train (+4): isSafeAttributeName four-way unification regression coverage (owner ruling 2026-10-04) — grammar-valid-name parity across all faces, unsafe-name rejection parity, wire-validator face stays a string type guard over the canonical rule, head-injection import seam rejects forbidden-sink attribute names fail-closed',
    expect: { tests: 4, steps: 0 },
  },
};

const deltas: Array<{
  file: string;
  reason: string;
  pre: FileCounts;
  post?: FileCounts;
  ok: boolean;
}> = [];
let unexpected = 0;
for (const [file, counts] of Object.entries(pre.files)) {
  let src: string | null = null;
  try {
    src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  } catch {
    const reason = DELETED_BASELINE_FILES[file];
    const ok = reason !== undefined;
    if (!ok) unexpected++;
    deltas.push({
      file,
      reason: reason ?? 'UNEXPECTED — deleted without an entry in DELETED_BASELINE_FILES',
      pre: counts,
      ok,
    });
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
    const entry = RECONCILED[file];
    const matches =
      entry !== undefined && entry.expect.tests === tests && entry.expect.steps === steps;
    const ok = matches;
    if (!ok) unexpected++;
    deltas.push({
      file,
      reason: matches
        ? entry.reason
        : entry !== undefined
          ? `UNEXPECTED — pinned shape drifted: RECONCILED expects ${JSON.stringify(entry.expect)}`
          : 'UNEXPECTED — investigate before calling the migration complete',
      pre: counts,
      post: { tests, steps },
      ok,
    });
  }
}

// ── post-baseline train census (TRAIN_NEW_FILES): same counting, same
//    fail-closed pinning, reported alongside the baseline deltas ──
post.trainNewFiles = {};
for (const [file, entry] of Object.entries(TRAIN_NEW_FILES)) {
  let src: string | null = null;
  try {
    src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  } catch {
    unexpected++;
    deltas.push({
      file,
      reason: `UNEXPECTED — census file missing (pinned ${JSON.stringify(entry.expect)}): ${entry.reason}`,
      pre: entry.expect,
      ok: false,
    });
    continue;
  }
  const codeAt = regionTester(scanRegions(src));
  let tests = 0;
  for (const m of src.matchAll(
    /(?<!\w)(?<!\.)(test|it)(?:\.(?:skip|skipIf|only|runIf|each))?\s*\(/g,
  )) {
    if (codeAt(m.index)) tests++;
  }
  const steps = (src.match(/\.step\s*\(/g) ?? []).length;
  post.trainNewFiles[file] = { tests, steps, reason: entry.reason };
  const ok = tests === entry.expect.tests && steps === entry.expect.steps;
  if (!ok) unexpected++;
  deltas.push({
    file,
    reason: ok ? entry.reason : `UNEXPECTED — census drift: pinned ${JSON.stringify(entry.expect)}`,
    pre: entry.expect,
    post: { tests, steps },
    ok,
  });
}
fs.mkdirSync(path.dirname(POST_PATH), { recursive: true });
fs.writeFileSync(POST_PATH, JSON.stringify(post, null, 2));
console.log('post totals:', JSON.stringify(post.totals));
console.log(
  'pre totals:',
  JSON.stringify(pre.totals),
  '/ realTestTotals:',
  JSON.stringify(pre.realTestTotals),
);
console.log(`\ndeltas (${deltas.length}, each must match its pinned per-file entry):`);
for (const d of deltas) {
  console.log(`  [${d.ok ? 'ok' : 'UNEXPECTED'}] ${d.file}`);
  console.log(`      reason: ${d.reason}`);
  console.log(`      ${JSON.stringify({ pre: d.pre, post: d.post })}`);
}
if (unexpected > 0) {
  console.log(
    `\n${unexpected} UNEXPECTED delta(s) — a count moved outside its pinned shape; fix or re-pin with a cited reason`,
  );
  process.exitCode = 1;
}
