/**
 * check-browser-entry-graph.ts — the M10-P1 browser-entry module-graph checker.
 *
 * Reads one or more `oe-browser-entry-graph.json` artifacts emitted by the
 * router client build (`packages/router/src/vite/internal/browser-entry-graph.ts`)
 * and evaluates the frozen P1 predicate on each: no production browser entry
 * LOADS the generic Part Program executor's six entry modules.
 *
 * Read-only by construction: it opens the artifact files it is given, prints a
 * verdict, and exits. It writes nothing, has no registry state, and — on
 * purpose — no embedded app list, no `--all`, no baseline, no allowlist, no
 * `--update`, and no severity/scope flag. Which production apps are covered is
 * a claim of the evidence record, not of this tool; the tool judges exactly
 * the artifacts it is handed and refuses to claim completeness for anything
 * else.
 *
 * The verdict is RECOMPUTED from the artifact's emitted chunk facts by the
 * shared evaluator (the writer's summary is only cross-checked for
 * self-consistency, never trusted). Consequences, all fail-closed:
 *
 * - missing file, unreadable JSON, foreign/older schema, `status:
 *   "incomplete"`, malformed fields, absolute/query/backslash ids, dangling
 *   chunk references, unreachable chunks, ambiguous module/chunk attribution,
 *   an unparsed entry/chunk facade, a drifted executor-entry table, or a
 *   summary that disagrees with the chunk facts → `UNPROVEN`, exit 2. Evidence
 *   cannot be claimed from an artifact that cannot carry it.
 * - at least one executor-entry module in the loaded set → `VIOLATED`, exit 1.
 * - otherwise → `MET`, exit 0 for that artifact.
 *
 * Report-only categories (executor support, server-private, authoring,
 * generated-leaf surface) and parsed-only executor residues are printed and
 * carried into `--json`, but they never change the verdict.
 *
 * Exit codes: 0 = every supplied artifact MET; 1 = at least one VIOLATED;
 * 2 = no VIOLATED artifact but at least one UNPROVEN (including a missing or
 * unreadable artifact), or a CLI usage error.
 *
 * Threat model — what this checker can and cannot say:
 *
 * - The artifact is TRUSTED BUILD OUTPUT, not authenticated JSON. Recomputing
 *   the predicate and cross-checking the writer's summary catches writer bugs,
 *   truncated/partial captures, a structurally inconsistent chunk table, and
 *   non-canonical id spellings (empty segments, `.`/`..`, trailing `/`) that
 *   would otherwise bypass the exact-identity gate by accident.
 * - It cannot authenticate provenance: an actor able to write the artifact can
 *   write a coherent MET document (all chunk facts, summary and canonical ids
 *   agreeing), and nothing in this read-only checker detects that. Do not read
 *   a green checker run as an authentication of the input; the trust comes
 *   from the build/CI provenance and the evidence record's exact-SHA, clean
 *   tree and artifact hash.
 * - The writer never fails or re-codes a build; instrumentation problems are
 *   surfaced here as UNPROVEN, not as a build-policy change.
 *
 * Usage:
 *   node tools/repo/check-browser-entry-graph.ts <artifact.json...> [--json]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  type BrowserEntryGraphEvaluation,
  type BrowserEntryGraphVerdict,
  evaluateBrowserEntryGraphArtifact,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';

/** One artifact's checker result, as printed and as serialized by `--json`. */
export interface BrowserEntryGraphCheckResult {
  /** The artifact path exactly as the caller supplied it. */
  path: string;
  verdict: BrowserEntryGraphVerdict;
  /** Stable UNPROVEN cause (null for MET/VIOLATED). */
  reason: string | null;
  /** Human sentence naming normalized ids only (null when not applicable). */
  detail: string | null;
  violations: BrowserEntryGraphEvaluation['violations'];
  diagnostics: BrowserEntryGraphEvaluation['diagnostics'];
  parsedOnlyExecutorResidues: string[];
  loadedModuleCount: number;
  chunkCount: number;
  islandCount: number;
  gateListDigest: string | null;
}

/** The deterministic `--json` document (no timestamps, no absolute paths of its own). */
export interface BrowserEntryGraphCheckReport {
  format: 'openelement.browser-entry-graph-check/1';
  artifacts: BrowserEntryGraphCheckResult[];
  /** 0 = all MET; 1 = any VIOLATED; 2 = any UNPROVEN / usage error. */
  exitCode: 0 | 1 | 2;
  summary: { met: number; violated: number; unproven: number };
}

/** Output sink, injectable so the tools tests can assert exact text. */
export interface BrowserEntryGraphCheckerIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The process working directory (artifact paths resolve against it, like any CLI). */
  cwd: string;
}

/** The CLI usage line (there are no flags beyond `--json`). */
export const BROWSER_ENTRY_GRAPH_USAGE =
  'usage: node tools/repo/check-browser-entry-graph.ts <artifact.json...> [--json]';

/**
 * Map per-artifact verdicts to the process exit code. Violations dominate (a
 * proven VIOLATED artifact is evidence of a violation regardless of the other
 * artifacts); an implicit artifact always blocks a MET claim; zero artifacts is
 * a usage error (2), never a vacuous pass.
 */
function summarizeExitCode(results: readonly BrowserEntryGraphCheckResult[]): 0 | 1 | 2 {
  if (results.length === 0) return 2;
  if (results.some((result) => result.verdict === 'VIOLATED')) return 1;
  if (results.some((result) => result.verdict === 'UNPROVEN')) return 2;
  return 0;
}

/** Read + evaluate one artifact file. Missing/unreadable/malformed all stay UNPROVEN. */
async function checkArtifact(
  artifactPath: string,
  cwd: string,
): Promise<BrowserEntryGraphCheckResult> {
  const absolutePath = resolve(cwd, artifactPath);
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch {
    return {
      path: artifactPath,
      verdict: 'UNPROVEN',
      reason: 'artifact-missing',
      detail: 'the artifact file cannot be read',
      violations: [],
      diagnostics: { executorSupport: [], serverPrivate: [], authoring: [], leafSurface: [] },
      parsedOnlyExecutorResidues: [],
      loadedModuleCount: 0,
      chunkCount: 0,
      islandCount: 0,
      gateListDigest: null,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      path: artifactPath,
      verdict: 'UNPROVEN',
      reason: 'artifact-not-json',
      detail: 'the artifact file is not valid JSON',
      violations: [],
      diagnostics: { executorSupport: [], serverPrivate: [], authoring: [], leafSurface: [] },
      parsedOnlyExecutorResidues: [],
      loadedModuleCount: 0,
      chunkCount: 0,
      islandCount: 0,
      gateListDigest: null,
    };
  }
  const evaluation = evaluateBrowserEntryGraphArtifact(value);
  return {
    path: artifactPath,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    detail: evaluation.detail,
    violations: evaluation.violations,
    diagnostics: evaluation.diagnostics,
    parsedOnlyExecutorResidues: evaluation.parsedOnlyExecutorResidues,
    loadedModuleCount: evaluation.loadedModuleCount,
    chunkCount: evaluation.chunkCount,
    islandCount: evaluation.islandCount,
    gateListDigest: evaluation.gateListDigest,
  };
}

/** Human-readable verdict block for one artifact. */
function formatHumanResult(result: BrowserEntryGraphCheckResult): string[] {
  const lines: string[] = [];
  const label = result.verdict;
  if (label === 'MET') {
    lines.push(
      `MET       ${result.path} (${result.loadedModuleCount} loaded module(s), ` +
        `${result.chunkCount} chunk(s), ${result.islandCount} island(s))`,
    );
  } else if (label === 'VIOLATED') {
    lines.push(
      `VIOLATED  ${result.path} — ${result.violations.length} executor-entry module(s) loaded ` +
        `in the browser entry graph`,
    );
    for (const violation of result.violations) {
      const islands =
        violation.islands.length === 0 ? 'entry-level' : `islands: ${violation.islands.join(', ')}`;
      lines.push(`  loaded ${violation.moduleId}`);
      lines.push(`    chunk: ${violation.chunkFile} (${islands})`);
    }
  } else {
    lines.push(`UNPROVEN  ${result.path} — ${result.reason ?? 'unknown'}`);
    if (result.detail !== null) lines.push(`  ${result.detail}`);
    lines.push('  an artifact that cannot carry the claim cannot produce evidence');
  }
  if (label !== 'UNPROVEN') {
    const diagnostics = result.diagnostics;
    lines.push(
      `  report-only: executorSupport ${diagnostics.executorSupport.length}, ` +
        `serverPrivate ${diagnostics.serverPrivate.length}, ` +
        `authoring ${diagnostics.authoring.length}, ` +
        `leafSurface ${diagnostics.leafSurface.length}; ` +
        `parsed-only executor residues ${result.parsedOnlyExecutorResidues.length}`,
    );
    if (diagnostics.executorSupport.length > 0) {
      lines.push(`  executorSupport: ${diagnostics.executorSupport.join(', ')}`);
    }
    if (diagnostics.serverPrivate.length > 0) {
      lines.push(`  serverPrivate: ${diagnostics.serverPrivate.join(', ')}`);
    }
    if (diagnostics.authoring.length > 0) {
      lines.push(`  authoring: ${diagnostics.authoring.join(', ')}`);
    }
    if (result.parsedOnlyExecutorResidues.length > 0) {
      lines.push(
        `  parsed-only executor residues: ${result.parsedOnlyExecutorResidues.join(', ')}`,
      );
    }
  }
  return lines;
}

/**
 * Run the checker. Exported (not just a main block) so the tools test suite can
 * pin usage errors, exit-code mapping and JSON shape without a subprocess, and
 * one spawned CLI test can pin the real process contract.
 */
export async function runBrowserEntryGraphCheck(
  argv: readonly string[],
  io: BrowserEntryGraphCheckerIo,
): Promise<number> {
  const artifactPaths: string[] = [];
  let json = false;
  for (const argument of argv) {
    if (argument === '--') {
      // `pnpm run browser-graph:check -- <args>` appends a literal `--`
      // separator; it is a CLI convention, not a flag this tool defines.
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument.startsWith('-')) {
      io.stderr(
        `check-browser-entry-graph: unknown flag "${argument}"\n${BROWSER_ENTRY_GRAPH_USAGE}\n`,
      );
      return 2;
    }
    artifactPaths.push(argument);
  }
  if (artifactPaths.length === 0) {
    io.stderr(`check-browser-entry-graph: no artifact supplied\n${BROWSER_ENTRY_GRAPH_USAGE}\n`);
    return 2;
  }

  const results: BrowserEntryGraphCheckResult[] = [];
  for (const artifactPath of artifactPaths) {
    results.push(await checkArtifact(artifactPath, io.cwd));
  }
  const exitCode = summarizeExitCode(results);

  if (json) {
    const report: BrowserEntryGraphCheckReport = {
      format: 'openelement.browser-entry-graph-check/1',
      artifacts: results,
      exitCode,
      summary: {
        met: results.filter((result) => result.verdict === 'MET').length,
        violated: results.filter((result) => result.verdict === 'VIOLATED').length,
        unproven: results.filter((result) => result.verdict === 'UNPROVEN').length,
      },
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return exitCode;
  }

  const lines: string[] = [];
  for (const result of results) lines.push(...formatHumanResult(result));
  lines.push(
    `browser-entry-graph: ${results.length} artifact(s) — ` +
      `${results.filter((result) => result.verdict === 'MET').length} MET, ` +
      `${results.filter((result) => result.verdict === 'VIOLATED').length} VIOLATED, ` +
      `${results.filter((result) => result.verdict === 'UNPROVEN').length} UNPROVEN`,
  );
  lines.push(
    exitCode === 0
      ? 'verdict: MET (the supplied artifacts load no generic executor entry — this is not an app-completeness claim)'
      : exitCode === 1
        ? 'verdict: VIOLATED (at least one artifact loads a generic executor entry)'
        : 'verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)',
  );
  io.stdout(`${lines.join('\n')}\n`);
  return exitCode;
}

/** The real-process IO. */
const processIo: BrowserEntryGraphCheckerIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
};

if (import.meta.main) {
  process.exitCode = await runBrowserEntryGraphCheck(process.argv.slice(2), processIo);
}
