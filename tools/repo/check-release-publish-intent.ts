/**
 * Explicit-release-intent harness (Q-Release, WP3).
 *
 * Proves the owner policy — Continuous Integration · Explicit Release Intent ·
 * Automated Verified Publishing — without any real npm publish, tag or GitHub
 * Release. It reads .github/workflows/autoflow-release.yml (and the CI
 * workflow whose evidence the publish path consumes) and evaluates:
 *
 *   - the trigger surface: the only trigger is workflow_dispatch, so a push,
 *     a merge, a version-bump commit or an AutoFlow CI success can never
 *     enter the release path (the former `workflow_run` trigger is gone and
 *     no other workflow can invoke this one);
 *   - the guard conditions: the `operation` input (choice, required, no
 *     publish-implying default), the dispatch-guard refusal on empty/unknown
 *     operations, and the job-level `if:` chain (publish-side jobs only under
 *     an explicit operation=publish, repoint only under operation=repoint);
 *   - the extracted shell steps, executed under a fake `gh`/`npm` on PATH:
 *     main+SHA candidate binding, same-SHA CI evidence discovery (run
 *     discovered over the API, never supplied; a missing, failed, cancelled
 *     or skipped required CI job ⇒ refusal), the release-gate requirement,
 *     the pre-publish re-verification, publish-vs-repoint separation, and
 *     registry truthfulness (E404 = confirmed absent = the only publish
 *     candidate; any other query error is a refusal — never read as
 *     "not yet published").
 *
 * The negative matrix this harness evaluates:
 *   push to main → CI runs, no publish; merge/version-bump commit → no
 *   publish; CI success → no publish; CI failure → no publish;
 *   full-qualification dispatch → no publish; manual publish with wrong SHA →
 *   DENY; manual publish with missing CI evidence → DENY; manual publish with
 *   a skipped required job → DENY; manual publish with a failed release gate
 *   → DENY; manual publish with all gates satisfied → ELIGIBLE (evaluated,
 *   never executed); manual repoint to an existing version → REPOINT ONLY;
 *   manual repoint to a nonexistent version → DENY.
 *
 * The embedded condition evaluator deliberately supports only the operators
 * this workflow's guards use (&&, ||, ==, !=, !, parentheses, string
 * literals, true/false, always(), dotted refs). Anything else throws — the
 * harness fails closed instead of guessing.
 *
 * CLI:
 *   node tools/repo/check-release-publish-intent.ts [--scenario=<id>]
 *        [--release-workflow=<path>] [--ci-workflow=<path>]
 * Exit 0 = every evaluated scenario behaved as required; 1 = at least one
 * mismatch (also what a mutated workflow copy yields).
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { spawnCommandSync } from './node-command.ts';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_RELEASE_WORKFLOW = join(repoRoot, '.github/workflows/autoflow-release.yml');
export const DEFAULT_CI_WORKFLOW = join(repoRoot, '.github/workflows/autoflow-ci.yml');
const WORKFLOWS_DIR = join(repoRoot, '.github/workflows');

/** The nine qualification jobs of autoflow-ci.yml, minus the sha-guard. */
export const REQUIRED_CI_JOBS = [
  'lint',
  'test',
  'e2e',
  'pack',
  'e2e-full',
  'bfcache',
  'node-serve-smoke',
  'packed-consumer-matrix',
  'fresh-install',
] as const;

export type Expectation = 'DENY' | 'ELIGIBLE' | 'REPOINT_ONLY' | 'NONE';

export interface ScenarioOutcome {
  id: string;
  expectation: Expectation;
  observed: string;
  ok: boolean;
  detail: string;
}

interface StepDoc {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  uses?: string;
}

interface JobDoc {
  needs?: string | string[];
  if?: string;
  steps?: StepDoc[];
  uses?: string;
  environment?: string;
  permissions?: Record<string, string>;
}

interface WorkflowDoc {
  on?: Record<string, unknown>;
  jobs?: Record<string, JobDoc>;
}

// ---------------------------------------------------------------------------
// Guard-condition evaluator (scoped to the operators the workflow guards use)
// ---------------------------------------------------------------------------

export type ConditionValue = string | boolean;
export type ConditionContext = Record<string, ConditionValue>;

export class UnsupportedConditionError extends Error {}

function truthy(value: ConditionValue): boolean {
  return typeof value === 'boolean' ? value : value !== '' && value !== 'false';
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_.-]/u.test(ch);
}

/** Evaluate a workflow `if:` expression; unsupported syntax throws. */
export function evaluateCondition(expression: string, context: ConditionContext): boolean {
  let pos = 0;
  const error = (message: string): never => {
    throw new UnsupportedConditionError(`unsupported condition "${expression}": ${message}`);
  };
  const skip = (): void => {
    while (pos < expression.length && /\s/u.test(expression[pos]!)) pos += 1;
  };
  const parseAtom = (): ConditionValue => {
    skip();
    const ch = expression[pos];
    if (ch === undefined) error('unexpected end of expression');
    if (ch === "'") {
      const end = expression.indexOf("'", pos + 1);
      if (end < 0) error('unterminated string literal');
      const value = expression.slice(pos + 1, end);
      pos = end + 1;
      return value;
    }
    if (ch === '!') {
      pos += 1;
      return !truthy(parseAtom());
    }
    let end = pos;
    while (end < expression.length && isIdentChar(expression[end]!)) end += 1;
    if (end === pos) error(`unexpected character '${ch}'`);
    const name = expression.slice(pos, end);
    pos = end;
    if (name === 'always') {
      skip();
      if (expression[pos] === '(') {
        pos += 1;
        skip();
        if (expression[pos] !== ')') error('always() takes no arguments');
        pos += 1;
      }
      return true;
    }
    if (name === 'true') return true;
    if (name === 'false') return false;
    const value = context[name];
    if (value === undefined) error(`no scenario value for "${name}" (fail closed)`);
    return value;
  };
  const parseOperand = (): ConditionValue => {
    skip();
    if (expression[pos] === '(') {
      pos += 1;
      const value = parseOr();
      skip();
      if (expression[pos] !== ')') error('missing closing parenthesis');
      pos += 1;
      return value;
    }
    return parseAtom();
  };
  const parseComparison = (): boolean => {
    const left = parseOperand();
    skip();
    for (const operator of ['==', '!='] as const) {
      if (!expression.startsWith(operator, pos)) continue;
      pos += operator.length;
      const right = parseAtom();
      const same = left === right;
      return operator === '==' ? same : !same;
    }
    return truthy(left);
  };
  const parseAnd = (): boolean => {
    let value = parseComparison();
    skip();
    while (expression.startsWith('&&', pos)) {
      pos += 2;
      const right = parseComparison();
      value = value && right;
      skip();
    }
    return value;
  };
  const parseOr = (): boolean => {
    let value = parseAnd();
    skip();
    while (expression.startsWith('||', pos)) {
      pos += 2;
      const right = parseAnd();
      value = value || right;
      skip();
    }
    return value;
  };
  const result = parseOr();
  skip();
  if (pos !== expression.length) error(`trailing input at offset ${pos}`);
  return typeof result === 'boolean' ? result : truthy(result);
}

export function needsOf(job: JobDoc): string[] {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * GitHub job gating: a job whose needed job did not conclude success is
 * skipped unless its `if:` uses a status function (`always()` here) — the
 * pre-Q-Release `result == 'skipped'` bypass relied on `always()` and must
 * never be reintroduced.
 */
export function evaluateJob(job: JobDoc, context: ConditionContext): boolean {
  const expression = job.if;
  const usesStatusFunction = expression !== undefined && /always\s*\(/u.test(expression);
  if (!usesStatusFunction) {
    for (const need of needsOf(job)) {
      if (context[`needs.${need}.result`] !== 'success') return false;
    }
  }
  if (expression === undefined) return true;
  return evaluateCondition(expression, context);
}

// ---------------------------------------------------------------------------
// Workflow loading helpers
// ---------------------------------------------------------------------------

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadWorkflow(path: string): { text: string; doc: WorkflowDoc } {
  const text = readText(path);
  const parsed: unknown = parseYaml(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`harness: ${path} is not a YAML mapping`);
  }
  return { text, doc: parsed as WorkflowDoc };
}

function jobOf(doc: WorkflowDoc, name: string): JobDoc {
  const job = doc.jobs?.[name];
  if (!job) throw new Error(`harness: job "${name}" not found (fail closed)`);
  return job;
}

function stepOf(job: JobDoc, nameFragment: string): StepDoc {
  const step = (job.steps ?? []).find((candidate) => (candidate.name ?? '').includes(nameFragment));
  if (!step?.run) throw new Error(`harness: run step containing "${nameFragment}" not found`);
  return step;
}

// ---------------------------------------------------------------------------
// Extracted-step execution (fake `gh`/`npm` on PATH, real jq/sed present)
// ---------------------------------------------------------------------------

interface ShellRun {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

function runShellScript(
  script: string,
  options: { cwd: string; env: Record<string, string>; pathPrefix?: string },
): ShellRun {
  const dir = mkdtempSync(join(tmpdir(), 'oe-intent-step-'));
  const scriptPath = join(dir, 'step.sh');
  const outputPath = join(dir, 'github-output.txt');
  writeFileSync(scriptPath, `${script}\n`);
  writeFileSync(outputPath, '');
  const env: Record<string, string> = {
    ...options.env,
    GITHUB_OUTPUT: outputPath,
    GITHUB_REPOSITORY: 'openelement/openelement',
    PATH: `${options.pathPrefix ? `${options.pathPrefix}:` : ''}${process.env.PATH ?? ''}`,
  };
  // GitHub's default Linux shell is `bash -e {0}` — reproduce it exactly.
  const result = spawnCommandSync('bash', {
    args: ['-e', scriptPath],
    cwd: options.cwd,
    env,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  return {
    status: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    output: readFileSync(outputPath, 'utf8'),
  };
}

function runExtractedStep(
  doc: WorkflowDoc,
  jobName: string,
  stepFragment: string,
  values: Record<string, string>,
  options: { cwd: string; pathPrefix?: string; extraEnv?: Record<string, string> },
): ShellRun {
  const step = stepOf(jobOf(doc, jobName), stepFragment);
  const env: Record<string, string> = {};
  for (const key of Object.keys(step.env ?? {})) {
    const value = values[key];
    if (value === undefined) {
      throw new Error(
        `harness: step "${step.name}" reads env ${key} with no scenario value (fail closed)`,
      );
    }
    env[key] = value;
  }
  return runShellScript(step.run ?? '', {
    cwd: options.cwd,
    env: { ...env, ...options.extraEnv },
    ...(options.pathPrefix ? { pathPrefix: options.pathPrefix } : {}),
  });
}

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
case "$args" in
  *jobs*) cat "\${FAKE_GH_DIR}/jobs.json" ;;
  *actions/runs/*) cat "\${FAKE_GH_DIR}/run.json" ;;
  *workflows/autoflow-ci.yml/runs*) cat "\${FAKE_GH_DIR}/runs.json" ;;
  *) echo "fake gh: unexpected invocation: $args" >&2; exit 2 ;;
esac
`;

const FAKE_NPM = `#!/usr/bin/env bash
set -u
in_list() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$1" = "view" ]; then
  spec="$2"
  pkg=$(printf '%s' "$spec" | sed -E 's#^@openelement/([^@]+)@.*#\\1#')
  ver=$(printf '%s' "$spec" | sed -E 's#^@openelement/[^@]+@##')
  if in_list "$pkg" "\${FAKE_NPM_MISMATCH:-}"; then
    printf '%s\\n' "\${ver}-other"; exit 0
  fi
  if in_list "$pkg" "\${FAKE_NPM_PRESENT:-}"; then
    printf '%s\\n' "$ver"; exit 0
  fi
  if in_list "$pkg" "\${FAKE_NPM_ERROR:-}"; then
    echo "npm error code ENOTFOUND" >&2
    echo "npm error network request to https://registry.npmjs.org/@openelement/$pkg failed" >&2
    exit 1
  fi
  if in_list "$pkg" "\${FAKE_NPM_ABSENT:-}"; then
    echo "npm error code E404" >&2
    echo "npm error 404 Not Found - GET https://registry.npmjs.org/@openelement%2f$pkg - Not found" >&2
    exit 1
  fi
  echo "fake npm: unexpected view spec $spec" >&2
  exit 3
fi
if [ "$1" = "dist-tag" ] && [ "$2" = "add" ]; then
  printf 'dist-tag add %s %s\\n' "$3" "$4" >> "\${FAKE_NPM_LOG:?}"
  exit 0
fi
echo "fake npm: unexpected invocation: $*" >&2
exit 2
`;

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

interface FakeBin {
  dir: string;
  npmPresent: string[];
  npmAbsent: string[];
  npmError: string[];
  npmMismatch: string[];
  logPath: string;
  setNpm(options: {
    present?: readonly string[];
    absent?: readonly string[];
    error?: readonly string[];
    mismatch?: readonly string[];
  }): void;
}

function makeFakeBin(root: string): FakeBin {
  const dir = join(root, 'fake-bin');
  const ghDir = join(root, 'fake-gh');
  const npmLog = join(root, 'fake-npm.log');
  mkdirSync(dir, { recursive: true });
  mkdirSync(ghDir, { recursive: true });
  writeExecutable(join(dir, 'gh'), FAKE_GH);
  writeExecutable(join(dir, 'npm'), FAKE_NPM);
  return {
    dir,
    npmPresent: [],
    npmAbsent: [],
    npmError: [],
    npmMismatch: [],
    logPath: npmLog,
    setNpm(options) {
      this.npmPresent = [...(options.present ?? [])];
      this.npmAbsent = [...(options.absent ?? [])];
      this.npmError = [...(options.error ?? [])];
      this.npmMismatch = [...(options.mismatch ?? [])];
    },
  };
}

function fakeEnv(bin: FakeBin, ghDir: string): Record<string, string> {
  return {
    FAKE_GH_DIR: ghDir,
    FAKE_NPM_LOG: bin.logPath,
    FAKE_NPM_PRESENT: bin.npmPresent.join(' '),
    FAKE_NPM_ABSENT: bin.npmAbsent.join(' '),
    FAKE_NPM_ERROR: bin.npmError.join(' '),
    FAKE_NPM_MISMATCH: bin.npmMismatch.join(' '),
  };
}

function readNpmLog(bin: FakeBin): string {
  try {
    return readFileSync(bin.logPath, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Scenario fixtures
// ---------------------------------------------------------------------------

function ciJobsJson(overrides: Record<string, string> = {}, drop: readonly string[] = []): string {
  const jobs: Array<{ name: string; conclusion: string }> = [];
  for (const base of REQUIRED_CI_JOBS) {
    if (drop.includes(base)) continue;
    const conclusion = overrides[base] ?? 'success';
    if (base === 'node-serve-smoke') {
      jobs.push({ name: `${base} (24)`, conclusion }, { name: `${base} (26)`, conclusion });
    } else if (base === 'packed-consumer-matrix') {
      jobs.push(
        { name: `${base} (ubuntu-latest)`, conclusion },
        { name: `${base} (macos-latest)`, conclusion },
      );
    } else {
      jobs.push({ name: base, conclusion });
    }
  }
  return JSON.stringify({ total_count: jobs.length, jobs });
}

function runsJson(runs: ReadonlyArray<Record<string, string | number>>): string {
  return JSON.stringify({ workflow_runs: runs });
}

const VERSION = '1.0.0-alpha.15';

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

export interface HarnessPaths {
  releasePath?: string;
  ciPath?: string;
}

export function runMatrix(paths: HarnessPaths = {}): ScenarioOutcome[] {
  const release = loadWorkflow(paths.releasePath ?? DEFAULT_RELEASE_WORKFLOW);
  const ci = loadWorkflow(paths.ciPath ?? DEFAULT_CI_WORKFLOW);
  const scratch = mkdtempSync(join(tmpdir(), 'oe-release-intent-'));
  spawnCommandSync('git', { args: ['init', '-q'], cwd: scratch });
  spawnCommandSync('git', {
    args: [
      '-c',
      'user.email=harness@example.com',
      '-c',
      'user.name=harness',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'harness',
    ],
    cwd: scratch,
  });
  const headShaResult = spawnCommandSync('git', { args: ['rev-parse', 'HEAD'], cwd: scratch });
  const headSha = new TextDecoder().decode(headShaResult.stdout).trim();
  const bin = makeFakeBin(scratch);
  const ghDir = join(scratch, 'fake-gh');

  const outcomes: ScenarioOutcome[] = [];
  const scenario = (
    id: string,
    expectation: Expectation,
    evaluate: () => { observed: string; ok: boolean; detail?: string },
  ): void => {
    try {
      const { observed, ok, detail } = evaluate();
      outcomes.push({ id, expectation, observed, ok, detail: detail ?? '' });
    } catch (error) {
      outcomes.push({
        id,
        expectation,
        observed: 'HARNESS ERROR',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // ── 1. Trigger surface: no push/merge/CI-success path into a publish ────
  scenario('push-merge-ci-success-never-publish', 'NONE', () => {
    const problems: string[] = [];
    const triggersOf = (doc: WorkflowDoc): string[] => Object.keys(doc.on ?? {});
    const releaseTriggers = triggersOf(release.doc);
    if (releaseTriggers.length !== 1 || releaseTriggers[0] !== 'workflow_dispatch') {
      problems.push(`release triggers ${JSON.stringify(releaseTriggers)} != [workflow_dispatch]`);
    }
    const releaseFile = paths.releasePath ?? DEFAULT_RELEASE_WORKFLOW;
    for (const file of readdirSync(WORKFLOWS_DIR)) {
      const path = join(WORKFLOWS_DIR, file);
      if (path === releaseFile) continue;
      const text = readText(path);
      if (/autoflow-release/u.test(text)) problems.push(`${file} references autoflow-release.yml`);
      if (/gh\s+workflow\s+run/u.test(text)) problems.push(`${file} can dispatch another workflow`);
    }
    for (const [name, job] of Object.entries(release.doc.jobs ?? {})) {
      if ((job.if ?? '').includes('workflow_run')) {
        problems.push(`job ${name} reads github.event.workflow_run`);
      }
    }
    const ciTriggers = triggersOf(ci.doc);
    if (!ciTriggers.includes('push') || !ciTriggers.includes('workflow_dispatch')) {
      problems.push(`CI triggers changed unexpectedly: ${JSON.stringify(ciTriggers)}`);
    }
    return {
      observed: problems.length === 0 ? 'NO RELEASE PATH OUTSIDE DISPATCH' : 'REGRESSION',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 2. Full-qualification dispatch cannot publish ───────────────────────
  scenario('full-qualification-dispatch-never-publish', 'NONE', () => {
    const problems: string[] = [];
    const dispatchBlock = (release.doc.on?.workflow_dispatch ?? {}) as {
      inputs?: Record<string, unknown>;
    };
    if (dispatchBlock.inputs?.full_qualification !== undefined) {
      problems.push('release must not accept a full_qualification input');
    }
    if (/autoflow-release|workflow_run/u.test(ci.text)) {
      problems.push('CI references the release workflow or workflow_run');
    }
    const releaseJob = jobOf(release.doc, 'release');
    const baseContext = {
      'github.event_name': 'workflow_dispatch',
      'inputs.operation': 'publish',
      'needs.dispatch-guard.result': 'success',
      'needs.release-gate.result': 'success',
    };
    if (!evaluateJob(releaseJob, baseContext)) {
      problems.push('release job does not run under an all-green publish dispatch');
    }
    if (evaluateJob(releaseJob, { ...baseContext, 'inputs.operation': '' })) {
      problems.push('release job runs without an explicit operation');
    }
    return {
      observed: problems.length === 0 ? 'NO RELEASE PATH FROM A QUALIFICATION' : 'REGRESSION',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 3. CI failure cannot publish (no auto path exists at all) ───────────
  scenario('ci-failure-never-publish', 'NONE', () => {
    const problems: string[] = [];
    const onJson = JSON.stringify(release.doc.on ?? {});
    if (onJson.includes('workflow_run')) problems.push('workflow_run trigger present');
    for (const [name, job] of Object.entries(release.doc.jobs ?? {})) {
      if ((job.if ?? '').includes('workflow_run')) {
        problems.push(`job ${name} still gates on a CI run event`);
      }
    }
    if (release.text.includes('github.event.workflow_run')) {
      problems.push('a workflow_run expression survived');
    }
    return {
      observed: problems.length === 0 ? 'NO AUTO PATH' : 'REGRESSION',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 4. Empty/unknown operation fails closed ─────────────────────────────
  scenario('operation-missing-or-unknown-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const dispatchBlock = (release.doc.on?.workflow_dispatch ?? {}) as {
      inputs?: Record<
        string,
        { default?: unknown; required?: unknown; type?: unknown; options?: unknown }
      >;
    };
    const operationInput = dispatchBlock.inputs?.operation;
    if (!operationInput) problems.push('no operation input declared');
    else {
      if (operationInput.required !== true) problems.push('operation must be required');
      if (operationInput.type !== 'choice') problems.push('operation must be a choice input');
      if (
        !Array.isArray(operationInput.options) ||
        operationInput.options.join(',') !== 'repoint,publish'
      ) {
        problems.push(
          `operation options must be exactly repoint,publish, got ${JSON.stringify(operationInput.options)}`,
        );
      }
      if ('default' in operationInput) {
        problems.push('operation must not declare a default');
      }
      if ((operationInput.options as unknown[])[0] === 'publish') {
        problems.push('the initial choice must not be publish');
      }
    }
    for (const operation of ['', 'deploy', 'PUBLISH', '  ']) {
      const run = runExtractedStep(
        release.doc,
        'dispatch-guard',
        'Require an explicit',
        { OPERATION: operation },
        { cwd: scratch },
      );
      if (run.status === 0) problems.push(`operation '${operation}' was accepted`);
    }
    for (const operation of ['publish', 'repoint']) {
      const run = runExtractedStep(
        release.doc,
        'dispatch-guard',
        'Require an explicit',
        { OPERATION: operation },
        { cwd: scratch },
      );
      if (run.status !== 0) problems.push(`operation '${operation}' was refused`);
    }
    return {
      observed: problems.length === 0 ? 'DENY (guard exit 1)' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 5. Publish dispatch with a wrong SHA is refused ─────────────────────
  scenario('manual-publish-wrong-sha-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const blessed = { DISPATCH_REF: 'refs/heads/main', DISPATCH_SHA: headSha };
    const runGood = runExtractedStep(
      release.doc,
      'ci-evidence',
      'Verify the dispatched candidate',
      blessed,
      { cwd: scratch },
    );
    if (runGood.status !== 0) problems.push(`main@HEAD was refused: ${runGood.stderr.trim()}`);
    for (const [label, values] of [
      ['wrong SHA', { ...blessed, DISPATCH_SHA: '0'.repeat(40) }],
      ['non-main ref', { ...blessed, DISPATCH_REF: 'refs/heads/release-window' }],
    ] as const) {
      const run = runExtractedStep(
        release.doc,
        'ci-evidence',
        'Verify the dispatched candidate',
        values,
        { cwd: scratch },
      );
      if (run.status === 0) problems.push(`${label} was accepted`);
    }
    return {
      observed: problems.length === 0 ? 'DENY on mismatch' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  const evidenceRun = (runs: string, run: string | null, jobs: string | null): ShellRun => {
    writeFileSync(join(ghDir, 'runs.json'), runs);
    if (run !== null) writeFileSync(join(ghDir, 'run.json'), run);
    if (jobs !== null) writeFileSync(join(ghDir, 'jobs.json'), jobs);
    return runExtractedStep(
      release.doc,
      'ci-evidence',
      'Discover the AutoFlow CI evidence',
      {
        GH_TOKEN: 'fake-token',
        REPOSITORY: 'openelement/openelement',
        CANDIDATE_SHA: headSha,
      },
      { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
    );
  };
  const pushRun = runsJson([
    { id: 111, event: 'push', head_branch: 'main', created_at: '2026-10-13T00:00:00Z' },
  ]);

  // ── 6. Missing CI evidence is refused ───────────────────────────────────
  scenario('manual-publish-missing-ci-evidence-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const noRun = evidenceRun(runsJson([]), null, null);
    if (noRun.status === 0) problems.push('a dispatch with no CI run was accepted');
    if (!`${noRun.stdout}${noRun.stderr}`.includes('missing CI evidence')) {
      problems.push('the refusal does not name the missing CI evidence');
    }
    const wrongShaRun = evidenceRun(
      pushRun,
      JSON.stringify({ head_sha: '1'.repeat(40), conclusion: 'success' }),
      ciJobsJson(),
    );
    if (wrongShaRun.status === 0) problems.push('a CI run bound to another SHA was accepted');
    return {
      observed: problems.length === 0 ? 'DENY (missing evidence)' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 7. Failed/skipped/cancelled/missing CI jobs are refused ─────────────
  scenario('manual-publish-with-non-success-ci-job-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const green = evidenceRun(
      pushRun,
      JSON.stringify({ head_sha: headSha, conclusion: 'success' }),
      ciJobsJson(),
    );
    if (green.status !== 0) problems.push(`a fully green run was refused: ${green.stderr.trim()}`);
    if (!green.output.includes('run_id=111'))
      problems.push('the discovered run id was not recorded');
    const cases: Array<[string, string | null, string | null, string]> = [
      [
        'run conclusion failure',
        JSON.stringify({ head_sha: headSha, conclusion: 'failure' }),
        ciJobsJson(),
        'failure',
      ],
      [
        'skipped required job',
        JSON.stringify({ head_sha: headSha, conclusion: 'success' }),
        ciJobsJson({ lint: 'skipped' }),
        'skipped',
      ],
      [
        'cancelled required job',
        JSON.stringify({ head_sha: headSha, conclusion: 'success' }),
        ciJobsJson({ 'packed-consumer-matrix': 'cancelled' }),
        'cancelled',
      ],
      [
        'missing required job',
        JSON.stringify({ head_sha: headSha, conclusion: 'success' }),
        ciJobsJson({}, ['fresh-install']),
        'missing',
      ],
    ];
    for (const [label, run, jobs, marker] of cases) {
      const result = evidenceRun(pushRun, run, jobs);
      if (result.status === 0) problems.push(`${label} was accepted`);
      else if (!`${result.stdout}${result.stderr}`.includes(marker)) {
        problems.push(`${label} refusal does not mention '${marker}'`);
      }
    }
    return {
      observed:
        problems.length === 0 ? 'DENY (skipped ≠ success, missing = refusal)' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 8. A failed or skipped release gate blocks publishing ───────────────
  scenario('manual-publish-with-failed-release-gate-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const releaseJob = jobOf(release.doc, 'release');
    const base = {
      'github.event_name': 'workflow_dispatch',
      'inputs.operation': 'publish',
      'needs.dispatch-guard.result': 'success',
    };
    if (evaluateJob(releaseJob, { ...base, 'needs.release-gate.result': 'failure' })) {
      problems.push('a failed gate left the release job runnable');
    }
    if (evaluateJob(releaseJob, { ...base, 'needs.release-gate.result': 'skipped' })) {
      problems.push('a skipped gate left the release job runnable');
    }
    if (!evaluateJob(releaseJob, { ...base, 'needs.release-gate.result': 'success' })) {
      problems.push('a successful gate did not leave the release job runnable');
    }
    const gateIf = releaseJob.if ?? '';
    if (/result\s*==\s*'skipped'/u.test(gateIf)) {
      problems.push("the release job still carries a `result == 'skipped'` bypass");
    }
    if (/always\s*\(/u.test(gateIf)) {
      problems.push('the release job bypasses needs-gating with always()');
    }
    return {
      observed: problems.length === 0 ? 'DENY unless the gate succeeded' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 9. All gates satisfied ⇒ ELIGIBLE (never executed here) ─────────────
  scenario('manual-publish-all-gates-satisfied-is-eligible', 'ELIGIBLE', () => {
    const problems: string[] = [];
    const releaseJob = jobOf(release.doc, 'release');
    const context = {
      'github.event_name': 'workflow_dispatch',
      'inputs.operation': 'publish',
      'needs.dispatch-guard.result': 'success',
      'needs.release-gate.result': 'success',
      'steps.check.outputs.already_published': 'false',
    };
    if (!evaluateJob(releaseJob, context))
      problems.push('release job is not eligible when all gates pass');
    const publishStep = stepOf(releaseJob, 'Publish to npm');
    if (!publishStep.if) problems.push('the publish step has no guard');
    else if (!evaluateCondition(publishStep.if, context)) {
      problems.push('the publish step guard refuses a fresh publish');
    }
    if (!(publishStep.run ?? '').includes('publish:npm')) {
      problems.push('the publish step does not run publish:npm');
    }
    return {
      observed:
        problems.length === 0 ? 'ELIGIBLE (no publish executed by this harness)' : 'NOT ELIGIBLE',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 10. Repoint to an existing version: dist-tag writes only ────────────
  scenario('manual-repoint-existing-version-repoints-only', 'REPOINT_ONLY', () => {
    const problems: string[] = [];
    const repointJob = jobOf(release.doc, 'repoint');
    for (const step of repointJob.steps ?? []) {
      const body = step.run ?? '';
      if (/\bnpm\s+publish\b|publish:npm|--provenance\b/u.test(body)) {
        problems.push(`repoint step "${step.name}" can publish`);
      }
      if (/\bgh\s+release\b/u.test(body))
        problems.push(`repoint step "${step.name}" can create a Release`);
      if (/\bgit\s+tag\b/u.test(body))
        problems.push(`repoint step "${step.name}" can create a tag`);
    }
    const publishContext = {
      'github.event_name': 'workflow_dispatch',
      'inputs.operation': 'publish',
      'needs.dispatch-guard.result': 'success',
    };
    if (evaluateJob(repointJob, publishContext))
      problems.push('repoint runs under operation=publish');
    bin.setNpm({ present: ['router', 'ui'] });
    writeFileSync(bin.logPath, '');
    const run = runExtractedStep(
      release.doc,
      'repoint',
      'Re-point the channel tag',
      { OPERATION: 'repoint', TAG: 'alpha', INPUT_VERSION: VERSION, INPUT_PACKAGES: 'router,ui' },
      { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
    );
    if (run.status !== 0) problems.push(`a valid repoint was refused: ${run.stderr.trim()}`);
    const log = readNpmLog(bin).trim().split('\n').filter(Boolean);
    const expected = [
      `dist-tag add @openelement/router@${VERSION} alpha`,
      `dist-tag add @openelement/ui@${VERSION} alpha`,
    ];
    if (JSON.stringify(log.sort()) !== JSON.stringify(expected.sort())) {
      problems.push(`repoint issued unexpected registry writes: ${JSON.stringify(log)}`);
    }
    return {
      observed: problems.length === 0 ? 'REPOINT ONLY (dist-tag writes)' : 'NOT SEPARATED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 11. Repoint to a nonexistent version is refused before any write ────
  scenario('manual-repoint-nonexistent-version-is-refused', 'DENY', () => {
    const problems: string[] = [];
    for (const [label, options] of [
      ['absent version', { present: ['router'], absent: ['ui'] }],
      ['unverifiable query', { present: ['router'], error: ['ui'] }],
      ['mismatched registry answer', { present: ['router'], mismatch: ['ui'] }],
    ] as const) {
      bin.setNpm(options);
      writeFileSync(bin.logPath, '');
      const run = runExtractedStep(
        release.doc,
        'repoint',
        'Re-point the channel tag',
        { OPERATION: 'repoint', TAG: 'alpha', INPUT_VERSION: VERSION, INPUT_PACKAGES: 'router,ui' },
        { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
      );
      if (run.status === 0) problems.push(`${label} was accepted`);
      if (readNpmLog(bin).trim() !== '') problems.push(`${label} still wrote a dist-tag`);
    }
    bin.setNpm({ present: ['router', 'ui'] });
    writeFileSync(bin.logPath, '');
    const missingInputs = runExtractedStep(
      release.doc,
      'repoint',
      'Re-point the channel tag',
      { OPERATION: 'repoint', TAG: 'alpha', INPUT_VERSION: VERSION, INPUT_PACKAGES: '' },
      { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
    );
    if (missingInputs.status === 0)
      problems.push('a repoint without a package subset was accepted');
    if (readNpmLog(bin).trim() !== '') problems.push('a refused repoint still wrote a dist-tag');
    return {
      observed: problems.length === 0 ? 'DENY (no side effect)' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  const detectRun = (options: {
    present?: readonly string[];
    absent?: readonly string[];
    error?: readonly string[];
    mismatch?: readonly string[];
  }): ShellRun => {
    bin.setNpm(options);
    return runExtractedStep(
      release.doc,
      'release',
      'Detect the per-package publish set',
      { VERSION, INPUT_PACKAGES: '' },
      { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
    );
  };

  // ── 12. Registry query errors are never read as "not yet published" ─────
  scenario('registry-error-is-never-absent', 'DENY', () => {
    const problems: string[] = [];
    const errorRun = detectRun({
      present: ['protocol', 'element', 'compiler', 'router', 'ui'],
      error: ['create'],
    });
    if (errorRun.status === 0) problems.push('a network error was treated as a publish candidate');
    if (errorRun.output.includes('already_published=false')) {
      problems.push('a publish set was emitted despite the query error');
    }
    bin.setNpm({ present: ['router'], error: ['ui'] });
    writeFileSync(bin.logPath, '');
    const repointRun = runExtractedStep(
      release.doc,
      'repoint',
      'Re-point the channel tag',
      { OPERATION: 'repoint', TAG: 'alpha', INPUT_VERSION: VERSION, INPUT_PACKAGES: 'router,ui' },
      { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
    );
    if (repointRun.status === 0) problems.push('repoint accepted an unverifiable registry answer');
    if (readNpmLog(bin).trim() !== '')
      problems.push('repoint wrote a dist-tag after a query error');
    return {
      observed: problems.length === 0 ? 'DENY (error ≠ absent)' : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 13. Confirmed-absent (E404) is the only publish candidate ───────────
  scenario('confirmed-absent-version-is-a-publish-candidate', 'ELIGIBLE', () => {
    const problems: string[] = [];
    const partial = detectRun({
      present: ['protocol', 'element', 'compiler', 'router', 'create'],
      absent: ['ui'],
    });
    if (partial.status !== 0) problems.push(`E404 handling failed: ${partial.stderr.trim()}`);
    if (
      !partial.output.includes('already_published=false') ||
      !partial.output.includes('packages=ui')
    ) {
      problems.push(
        `confirmed-absent package did not become the publish set: ${partial.output.trim()}`,
      );
    }
    const allAbsent = detectRun({
      absent: ['protocol', 'element', 'compiler', 'router', 'create', 'ui'],
    });
    if (allAbsent.status !== 0) problems.push(`all-absent run failed: ${allAbsent.stderr.trim()}`);
    const allPresent = detectRun({
      present: ['protocol', 'element', 'compiler', 'router', 'create', 'ui'],
    });
    if (!allPresent.output.includes('already_published=true')) {
      problems.push('an already-published version was not skipped');
    }
    const mismatch = detectRun({
      present: ['protocol', 'element', 'compiler', 'router', 'ui'],
      mismatch: ['create'],
    });
    if (mismatch.status === 0) problems.push('a mismatched registry answer was published over');
    return {
      observed: problems.length === 0 ? 'ELIGIBLE (confirmed-absent only)' : 'FORWARD',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 14. The required CI job list matches the CI workflow ────────────────
  scenario('required-ci-job-list-matches-the-ci-workflow', 'NONE', () => {
    const problems: string[] = [];
    const ciJobs = Object.keys(ci.doc.jobs ?? {})
      .filter((name) => name !== 'sha-guard')
      .sort();
    const match = /--arg required "([^"]+)"/u.exec(release.text);
    if (!match) problems.push('the release workflow declares no required CI job list');
    else {
      const declared = match[1]!.split(' ').filter(Boolean).sort();
      if (JSON.stringify(declared) !== JSON.stringify(ciJobs)) {
        problems.push(`declared ${JSON.stringify(declared)} != CI jobs ${JSON.stringify(ciJobs)}`);
      }
    }
    return {
      observed: problems.length === 0 ? 'NINE JOBS MATCH' : 'DRIFT',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 15. The kept release tooling surfaces are reused, not rebuilt ───────
  scenario('release-surfaces-reused', 'NONE', () => {
    const problems: string[] = [];
    // Literal markers, matched with includes(): the check asks "is this kept
    // surface present in the workflow text", which is substring semantics —
    // regexes here only added unanchored-pattern risk for no behavior.
    const markers: Array<[string, string]> = [
      ['openelement-release environment', 'environment: openelement-release'],
      ['npm OIDC trusted publishing', 'id-token: write'],
      ['publish:npm step', 'publish:npm'],
      ['registry sync', 'sync:registry'],
      ['per-package GitHub Releases', 'gh release create'],
      ['npm registry url', 'registry.npmjs.org'],
      ['pack surface check', 'pack-surface:check'],
      ['post-publish consumers', 'published-consumers.yml'],
      ['version validation tooling', 'check-release-version.ts'],
    ];
    for (const [label, marker] of markers) {
      if (!release.text.includes(marker)) problems.push(`missing kept surface: ${label}`);
    }
    const environments = release.text.match(/environment: openelement-release/gu)?.length ?? 0;
    if (environments < 2)
      problems.push('publish and repoint must both keep the environment approval');
    return {
      observed: problems.length === 0 ? 'REUSED' : 'MISSING SURFACES',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  rmSync(scratch, { recursive: true, force: true });
  return outcomes;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatOutcome(outcome: ScenarioOutcome): string {
  const status = outcome.ok ? 'OK  ' : 'FAIL';
  const detail = outcome.detail ? ` — ${outcome.detail}` : '';
  return `${status} ${outcome.id}: expected ${outcome.expectation}, observed ${outcome.observed}${detail}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const entry = args.find((arg) => arg.startsWith(`--${name}=`));
    return entry?.slice(`--${name}=`.length);
  };
  const releasePath = flag('release-workflow');
  const ciPath = flag('ci-workflow');
  const scenarioId = flag('scenario');
  const outcomes = runMatrix({
    ...(releasePath ? { releasePath } : {}),
    ...(ciPath ? { ciPath } : {}),
  });
  const selected = scenarioId ? outcomes.filter((outcome) => outcome.id === scenarioId) : outcomes;
  if (selected.length === 0) {
    console.error(
      `unknown scenario "${scenarioId}"; known: ${outcomes.map((outcome) => outcome.id).join(', ')}`,
    );
    process.exit(2);
  }
  for (const outcome of selected) console.log(formatOutcome(outcome));
  const failed = selected.filter((outcome) => !outcome.ok);
  console.log(
    `release-intent matrix: ${selected.length - failed.length}/${selected.length} scenario(s) behaved as required.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

if (import.meta.main) main();
