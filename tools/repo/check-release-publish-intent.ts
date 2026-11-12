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
 *     discovered over the API, never supplied; the exact thirteen job
 *     instances of the shared qualification definition — sha-guard plus the
 *     nine qualification IDs / twelve instances — must each appear once and
 *     conclude success; a missing or duplicated instance, an unexpected
 *     instance, a partial listing, or a failed/cancelled/skipped required
 *     instance ⇒ refusal). A real Base run is a DIFFERENT listing: the guard +
 *     four base jobs conclude success and the five heavy jobs appear once each
 *     by bare job ID, skipped, because a job skipped by its job-level `if:`
 *     never expands its matrix — ten instances, not thirteen. That exact shape
 *     is skipped as non-evidence (softly, with a notice); any other ten-instance
 *     listing is malformed and refused. The release-gate requirement, the
 *     pre-publish re-verification, publish-vs-repoint separation, and registry
 *     truthfulness (E404 = confirmed absent = the only publish candidate; any
 *     other query error — E403 included — is a refusal, never read as "not
 *     yet published") are also evaluated here.
 *
 * The negative matrix this harness evaluates:
 *   push to main → CI runs, no publish; merge/version-bump commit → no
 *   publish; CI success → no publish; CI failure → no publish;
 *   full-qualification dispatch → no publish; manual publish with wrong SHA →
 *   DENY; manual publish with missing CI evidence → DENY; manual publish with
 *   a skipped required job → DENY; manual publish with a Base-only dispatch
 *   (run-level green, heavy instances skipped) → DENY; manual publish with a
 *   complete thirteen-instance dispatch → ELIGIBLE, including when a newer
 *   Base-only dispatch also exists for the SHA; a newer failed Full attempt is
 *   never bypassed for an older green run; manual publish with a missing
 *   matrix leg, a duplicated instance, an unexpected instance or a non-success
 *   sha-guard → DENY; manual publish with a failed release gate → DENY; manual
 *   publish with all gates satisfied → ELIGIBLE (evaluated, never executed);
 *   manual repoint to an existing version → REPOINT ONLY; manual repoint to a
 *   nonexistent version → DENY. The post-publish read-back must keep
 *   `always()` so a failed publish still records registry-state forensics.
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
import {
  CI_BASE_LISTING,
  CI_BASE_TOTAL_RUN_INSTANCES,
  CI_GUARD_JOB,
  CI_QUALIFICATION_JOBS,
  CI_RUN_INSTANCES,
  CI_TOTAL_RUN_INSTANCES,
  deriveRunInstanceNames,
} from './ci-qualification.ts';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_RELEASE_WORKFLOW = join(repoRoot, '.github/workflows/autoflow-release.yml');
export const DEFAULT_CI_WORKFLOW = join(repoRoot, '.github/workflows/autoflow-ci.yml');
const WORKFLOWS_DIR = join(repoRoot, '.github/workflows');

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
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}

interface JobDoc {
  name?: unknown;
  needs?: string | string[];
  if?: string;
  steps?: StepDoc[];
  uses?: string;
  environment?: string;
  permissions?: Record<string, string>;
  strategy?: { matrix?: unknown };
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
    // The extracted steps may resolve checked-in tools through the workspace
    // (the qualification-contract CLI). GitHub provides this variable; the
    // harness points it at the real checkout while cwd stays the scratch repo.
    GITHUB_WORKSPACE: repoRoot,
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
  *jobs*)
    run_id=$(printf '%s' "$args" | sed -E 's#.*/actions/runs/([0-9]+)/jobs.*#\\1#')
    if [ -f "\${FAKE_GH_DIR}/jobs-\${run_id}.json" ]; then
      cat "\${FAKE_GH_DIR}/jobs-\${run_id}.json"
    else
      cat "\${FAKE_GH_DIR}/jobs.json"
    fi ;;
  *actions/runs/*)
    run_id=$(printf '%s' "$args" | sed -E 's#.*/actions/runs/([0-9]+).*#\\1#')
    if [ -f "\${FAKE_GH_DIR}/run-\${run_id}.json" ]; then
      cat "\${FAKE_GH_DIR}/run-\${run_id}.json"
    else
      cat "\${FAKE_GH_DIR}/run.json"
    fi ;;
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
  if in_list "$pkg" "\${FAKE_NPM_FORBIDDEN:-}"; then
    echo "npm error code E403" >&2
    echo "npm error 403 Forbidden - GET https://registry.npmjs.org/@openelement%2f$pkg" >&2
    exit 1
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
  npmForbidden: string[];
  npmMismatch: string[];
  logPath: string;
  setNpm(options: {
    present?: readonly string[];
    absent?: readonly string[];
    error?: readonly string[];
    forbidden?: readonly string[];
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
    npmForbidden: [],
    npmMismatch: [],
    logPath: npmLog,
    setNpm(options) {
      this.npmPresent = [...(options.present ?? [])];
      this.npmAbsent = [...(options.absent ?? [])];
      this.npmError = [...(options.error ?? [])];
      this.npmForbidden = [...(options.forbidden ?? [])];
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
    FAKE_NPM_FORBIDDEN: bin.npmForbidden.join(' '),
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

interface JobsFixture {
  /** Conclusion override keyed by the exact GitHub job-instance name. */
  overrides?: Readonly<Record<string, string>>;
  /** Exact instance names to omit. */
  drop?: readonly string[];
  /** Exact instance names to list a second time. */
  duplicate?: readonly string[];
  /** Extra instances not in the contract. */
  extra?: readonly { name: string; conclusion?: string }[];
  /** Override the API's total_count (for partial-listing fixtures). */
  totalCount?: number;
  /**
   * Instances from a partial "re-run failed jobs" action. Their latest
   * attempt is `run_attempt: 2`; with the workflow's explicit
   * `filter=latest`, the jobs listing still carries exactly one entry per
   * instance (thirteen), so the contract check accepts it. Without the
   * filter, superseded attempts would inflate the listing and the same run
   * would be refused.
   */
  rerun?: readonly string[];
}

function ciJobsJson(fixture: JobsFixture = {}): string {
  const jobs: Array<{ name: string; conclusion: string; run_attempt?: number }> = [];
  for (const name of CI_RUN_INSTANCES) {
    if (fixture.drop?.includes(name)) continue;
    jobs.push({
      name,
      conclusion: fixture.overrides?.[name] ?? 'success',
      ...(fixture.rerun?.includes(name) ? { run_attempt: 2 } : {}),
    });
  }
  for (const name of fixture.duplicate ?? []) {
    const source = jobs.find((job) => job.name === name);
    if (source) jobs.push({ ...source });
  }
  for (const entry of fixture.extra ?? []) {
    jobs.push({ name: entry.name, conclusion: entry.conclusion ?? 'success' });
  }
  return JSON.stringify({ total_count: fixture.totalCount ?? jobs.length, jobs });
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

  const evidenceRun = (
    runs: string,
    run: string | null,
    jobs: string | null,
    candidates: readonly { id: number; run: string; jobs: string }[] = [],
  ): ShellRun => {
    // Per-run fixtures model a SHA with several evidence runs (the production
    // candidate selector probes them in order). Shared run.json/jobs.json stay
    // the single-run fixture the older scenarios use.
    for (const file of readdirSync(ghDir)) {
      if (/^(?:run|jobs)-\d+\.json$/u.test(file)) rmSync(join(ghDir, file));
    }
    writeFileSync(join(ghDir, 'runs.json'), runs);
    for (const candidate of candidates) {
      writeFileSync(join(ghDir, `run-${candidate.id}.json`), candidate.run);
      writeFileSync(join(ghDir, `jobs-${candidate.id}.json`), candidate.jobs);
    }
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
  // The REAL Base listing (ten instances), built from the shared contract:
  // sha-guard + lint/test/e2e/pack success; e2e-full, bfcache,
  // node-serve-smoke, packed-consumer-matrix and fresh-install appear ONCE by
  // bare job ID, skipped, because a job skipped by its job-level `if:` never
  // expands its matrix. A 13-instance listing with eight expanded heavy legs is
  // NOT a real Base run and must be refused as malformed, not skipped.
  const baseJobsJson = (
    fixture: {
      overrides?: Readonly<Record<string, string>>;
      drop?: readonly string[];
      duplicate?: readonly string[];
      extra?: readonly { name: string; conclusion?: string }[];
    } = {},
  ): string => {
    const jobs: Array<{ name: string; conclusion: string }> = [];
    for (const entry of CI_BASE_LISTING) {
      if (fixture.drop?.includes(entry.name)) continue;
      jobs.push({
        name: entry.name,
        conclusion: fixture.overrides?.[entry.name] ?? entry.conclusion,
      });
    }
    for (const name of fixture.duplicate ?? []) {
      const source = jobs.find((job) => job.name === name);
      if (source) jobs.push({ ...source });
    }
    for (const entry of fixture.extra ?? []) {
      jobs.push({ name: entry.name, conclusion: entry.conclusion ?? 'success' });
    }
    return JSON.stringify({ total_count: jobs.length, jobs });
  };
  const baseDispatchJobs = (): string => baseJobsJson();
  // The old, wrong fixture shape: all thirteen Full instances present with the
  // eight expanded heavy legs marked skipped. Retained only as a negative: it
  // is not what GitHub lists for a Base run.
  const expandedHeavySkippedJobs = (): string => {
    const heavy = CI_QUALIFICATION_JOBS.filter((job) => job.lane === 'heavy').flatMap(
      (job) => job.instances,
    );
    return ciJobsJson({ overrides: Object.fromEntries(heavy.map((name) => [name, 'skipped'])) });
  };

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

  // ── 7. Every deviation from the exact qualification contract is refused ─
  // The contract is identity, not shape: each of the thirteen expected
  // instances must appear exactly once and conclude success. A missing matrix
  // leg, a duplicated leg, an unexpected job, a partial listing and a
  // non-success sha-guard are all separate negative rows.
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
    const successRun = JSON.stringify({ head_sha: headSha, conclusion: 'success' });
    // A partial re-run is still a complete qualification: the jobs listing
    // carries one latest attempt per instance (thirteen total), some at
    // run_attempt 2. The identity check must accept that just as it accepts a
    // first-attempt run; `filter=latest` in the workflow is what keeps the
    // superseded attempts out of this listing.
    const partialRerun = evidenceRun(
      pushRun,
      successRun,
      ciJobsJson({ rerun: ['lint', 'e2e-full (fixture-gates)'] }),
    );
    if (partialRerun.status !== 0) {
      problems.push(
        `a partial re-run's thirteen latest instances were refused: ${partialRerun.stderr.trim()}`,
      );
    }
    if (!partialRerun.output.includes('run_id=111')) {
      problems.push('the partial re-run did not record the discovered run id');
    }
    const cases: Array<{ label: string; run: string; jobs: string; marker: string }> = [
      {
        label: 'run conclusion failure',
        run: JSON.stringify({ head_sha: headSha, conclusion: 'failure' }),
        jobs: ciJobsJson(),
        marker: 'failure',
      },
      {
        label: 'skipped required job',
        run: successRun,
        jobs: ciJobsJson({ overrides: { lint: 'skipped' } }),
        marker: 'skipped',
      },
      {
        label: 'cancelled matrix leg',
        run: successRun,
        jobs: ciJobsJson({
          overrides: { 'packed-consumer-matrix (macos-latest)': 'cancelled' },
        }),
        marker: 'cancelled',
      },
      {
        label: 'missing required job (all instances)',
        run: successRun,
        jobs: ciJobsJson({ drop: ['fresh-install'] }),
        marker: 'qualification contract requires',
      },
      {
        label: 'missing matrix leg',
        run: successRun,
        jobs: ciJobsJson({
          drop: ['e2e-full (fixture-gates)'],
          extra: [{ name: 'rogue' }],
        }),
        marker: 'is missing',
      },
      {
        label: 'duplicate matrix instance',
        run: successRun,
        jobs: ciJobsJson({
          drop: ['node-serve-smoke (26)'],
          duplicate: ['node-serve-smoke (24)'],
        }),
        marker: 'appears 2 times',
      },
      {
        label: 'unexpected job instance',
        run: successRun,
        jobs: ciJobsJson({ drop: ['bfcache'], extra: [{ name: 'rogue' }] }),
        marker: 'unexpected CI job instance',
      },
      {
        label: 'non-success sha-guard',
        run: successRun,
        jobs: ciJobsJson({ overrides: { 'sha-guard': 'skipped' } }),
        marker: 'sha-guard',
      },
      {
        label: 'partial jobs listing',
        run: successRun,
        jobs: ciJobsJson({ totalCount: CI_TOTAL_RUN_INSTANCES + 1 }),
        marker: 'incomplete',
      },
    ];
    for (const testCase of cases) {
      const result = evidenceRun(pushRun, testCase.run, testCase.jobs);
      if (result.status === 0) problems.push(`${testCase.label} was accepted`);
      else if (!`${result.stdout}${result.stderr}`.includes(testCase.marker)) {
        problems.push(`${testCase.label} refusal does not mention '${testCase.marker}'`);
      }
    }
    return {
      observed:
        problems.length === 0
          ? 'DENY (exact identity: missing/duplicate/unexpected/non-success)'
          : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 7b. W4b dispatch evidence: the REAL Base listing is skipped, Full is
  // accepted ────────────────────────────────────────────────────────────────
  // A real Base run lists TEN instances (guard + four base jobs success, five
  // heavy job IDs skipped because a skipped job never expands its matrix) and
  // is run-level green. Neither the run conclusion nor "every non-success is
  // skipped" can carry the proof: the candidate selector must skip that exact
  // shape with a notice and keep probing, while a wrong-SHA dispatch, a
  // malformed listing, or a newer failed Full attempt refuses instead.
  scenario('manual-publish-base-dispatch-is-refused', 'DENY', () => {
    const problems: string[] = [];
    const baseRun = JSON.stringify({
      head_sha: headSha,
      conclusion: 'success',
      event: 'workflow_dispatch',
    });
    const expectDenied = (
      label: string,
      result: ShellRun,
      marker: string,
      { baseNotice = false }: { baseNotice?: boolean } = {},
    ): void => {
      const text = `${result.stdout}${result.stderr}`;
      if (result.status === 0) problems.push(`${label} was accepted`);
      if (!text.includes(marker)) problems.push(`${label} refusal does not mention '${marker}'`);
      if (baseNotice && !text.includes('Base-only')) {
        problems.push(`${label} was not recognised as the legal ten-instance Base listing`);
      }
      if (!baseNotice && text.includes('Base-only')) {
        problems.push(`${label} was wrongly skipped as Base evidence`);
      }
    };

    const baseOnly = evidenceRun(
      runsJson([{ id: 201, event: 'workflow_dispatch', created_at: '2026-11-12T00:00:00Z' }]),
      null,
      null,
      [{ id: 201, run: baseRun, jobs: baseDispatchJobs() }],
    );
    expectDenied('a real ten-instance Base dispatch', baseOnly, 'missing CI evidence', {
      baseNotice: true,
    });
    // The normal Base skip is a notice, not an error annotation. Only the
    // final "no evidence" refusal may be an error in the Base-only case.
    if (!baseOnly.stdout.includes('::notice::')) {
      problems.push('the Base-only skip did not emit a ::notice:: annotation');
    }

    // A malformed ten-instance listing: a base job skipped. It must be refused
    // as malformed, never swallowed as Base evidence.
    const baseJobSkipped = evidenceRun(
      runsJson([{ id: 206, event: 'workflow_dispatch', created_at: '2026-11-12T00:30:00Z' }]),
      null,
      null,
      [{ id: 206, run: baseRun, jobs: baseJobsJson({ overrides: { lint: 'skipped' } }) }],
    );
    expectDenied(
      'a base job skipped in a ten-instance listing',
      baseJobSkipped,
      'concluded skipped',
    );

    // Missing heavy placeholder + an unexpected job (still ten entries).
    const unexpected = evidenceRun(
      runsJson([{ id: 207, event: 'workflow_dispatch', created_at: '2026-11-12T00:45:00Z' }]),
      null,
      null,
      [
        {
          id: 207,
          run: baseRun,
          jobs: baseJobsJson({ drop: ['fresh-install'], extra: [{ name: 'rogue' }] }),
        },
      ],
    );
    expectDenied(
      'a ten-instance listing with an unexpected job',
      unexpected,
      'unexpected CI job instance',
    );

    // Duplicate base instance + a missing heavy placeholder (still ten entries).
    const duplicate = evidenceRun(
      runsJson([{ id: 208, event: 'workflow_dispatch', created_at: '2026-11-12T00:50:00Z' }]),
      null,
      null,
      [
        {
          id: 208,
          run: baseRun,
          jobs: baseJobsJson({ drop: ['fresh-install'], duplicate: ['lint'] }),
        },
      ],
    );
    expectDenied('a ten-instance listing with a duplicated job', duplicate, 'appears 2 times');

    // The old (unreal) thirteen-instance shape with eight expanded heavy legs
    // skipped must not be mistaken for a Base run.
    const expandedSkipped = evidenceRun(
      runsJson([{ id: 209, event: 'workflow_dispatch', created_at: '2026-11-12T00:55:00Z' }]),
      null,
      null,
      [{ id: 209, run: baseRun, jobs: expandedHeavySkippedJobs() }],
    );
    expectDenied(
      'the unreal thirteen-instance expanded-skip listing',
      expandedSkipped,
      'qualification contract',
    );

    // A newer malformed ten-instance run must not be skipped for an older Full.
    const malformedBeforeFull = evidenceRun(
      runsJson([
        { id: 210, event: 'workflow_dispatch', created_at: '2026-11-12T06:00:00Z' },
        { id: 202, event: 'workflow_dispatch', created_at: '2026-11-12T01:00:00Z' },
      ]),
      null,
      null,
      [
        {
          id: 210,
          run: baseRun,
          jobs: baseJobsJson({ overrides: { lint: 'skipped' } }),
        },
        { id: 202, run: baseRun, jobs: ciJobsJson() },
      ],
    );
    expectDenied(
      'a newer malformed ten-instance run before an older Full',
      malformedBeforeFull,
      'concluded skipped',
    );
    if (malformedBeforeFull.output.includes('run_id=202')) {
      problems.push('a newer malformed ten-instance run fell through to older Full evidence');
    }

    const wrongShaRun = JSON.stringify({
      head_sha: '2'.repeat(40),
      conclusion: 'success',
      event: 'workflow_dispatch',
    });
    const wrongSha = evidenceRun(
      runsJson([{ id: 204, event: 'workflow_dispatch', created_at: '2026-11-12T00:00:00Z' }]),
      null,
      null,
      [{ id: 204, run: wrongShaRun, jobs: ciJobsJson() }],
    );
    if (wrongSha.status === 0) {
      problems.push('a dispatch bound to another SHA was accepted');
    } else if (!`${wrongSha.stdout}${wrongSha.stderr}`.includes('bound to')) {
      problems.push('the wrong-SHA refusal does not name the binding mismatch');
    }
    // Candidate fallback must not walk past a newer Full-qualification
    // attempt that failed: an older green run may not mask the latest failure.
    const fullRun = JSON.stringify({
      head_sha: headSha,
      conclusion: 'success',
      event: 'workflow_dispatch',
    });
    const failedRun = JSON.stringify({
      head_sha: headSha,
      conclusion: 'failure',
      event: 'workflow_dispatch',
    });
    const failedFull = evidenceRun(
      runsJson([
        { id: 205, event: 'workflow_dispatch', created_at: '2026-11-12T05:00:00Z' },
        { id: 202, event: 'workflow_dispatch', created_at: '2026-11-12T01:00:00Z' },
      ]),
      null,
      null,
      [
        { id: 205, run: failedRun, jobs: ciJobsJson() },
        { id: 202, run: fullRun, jobs: ciJobsJson() },
      ],
    );
    if (failedFull.status === 0) {
      problems.push('a newer failed Full qualification was skipped for older green evidence');
    } else if (!`${failedFull.stdout}${failedFull.stderr}`.includes('failure')) {
      problems.push('the failed-Full refusal does not name the failed conclusion');
    }
    return {
      observed:
        problems.length === 0
          ? 'DENY (real Base skipped with a notice; malformed/wrong-SHA/failed-Full refused)'
          : 'NOT DENIED',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // A complete Full-qualification dispatch (all thirteen instances success) is
  // eligible. Candidate selection must also find it when a newer Base dispatch
  // exists: evidence is the SHA's contract-complete run, not the newest run.
  scenario('manual-publish-full-dispatch-is-eligible', 'ELIGIBLE', () => {
    const problems: string[] = [];
    const fullRun = JSON.stringify({
      head_sha: headSha,
      conclusion: 'success',
      event: 'workflow_dispatch',
    });
    const fullJobs = ciJobsJson();
    const onlyFull = evidenceRun(
      runsJson([{ id: 202, event: 'workflow_dispatch', created_at: '2026-11-12T01:00:00Z' }]),
      null,
      null,
      [{ id: 202, run: fullRun, jobs: fullJobs }],
    );
    if (onlyFull.status !== 0) {
      problems.push(`a full thirteen-instance dispatch was refused: ${onlyFull.stderr.trim()}`);
    } else if (!onlyFull.output.includes('run_id=202')) {
      problems.push('the full dispatch run id was not recorded');
    }
    const baseRun = JSON.stringify({
      head_sha: headSha,
      conclusion: 'success',
      event: 'workflow_dispatch',
    });
    const shadowed = evidenceRun(
      runsJson([
        { id: 203, event: 'workflow_dispatch', created_at: '2026-11-12T03:00:00Z' },
        { id: 202, event: 'workflow_dispatch', created_at: '2026-11-12T01:00:00Z' },
      ]),
      null,
      null,
      [
        { id: 203, run: baseRun, jobs: baseDispatchJobs() },
        { id: 202, run: fullRun, jobs: fullJobs },
      ],
    );
    if (shadowed.status !== 0) {
      problems.push(
        `a newer Base dispatch shadowed older Full evidence: ${shadowed.stderr.trim()}`,
      );
    } else if (!shadowed.output.includes('run_id=202')) {
      problems.push('the shadowed case did not record the Full run id');
    }
    if (!shadowed.stdout.includes('Base-only') || !shadowed.stdout.includes('::notice::')) {
      problems.push('the newer Base run was not skipped with a ::notice:: annotation');
    }
    if (`${shadowed.stdout}${shadowed.stderr}`.includes('::error::')) {
      problems.push('skipping a normal Base run emitted an error annotation');
    }
    const preferred = evidenceRun(
      runsJson([
        { id: 111, event: 'push', head_branch: 'main', created_at: '2026-11-12T04:00:00Z' },
        { id: 202, event: 'workflow_dispatch', created_at: '2026-11-12T01:00:00Z' },
      ]),
      null,
      null,
      [
        {
          id: 111,
          run: JSON.stringify({ head_sha: headSha, conclusion: 'success', event: 'push' }),
          jobs: ciJobsJson(),
        },
        { id: 202, run: fullRun, jobs: fullJobs },
      ],
    );
    if (preferred.status !== 0) {
      problems.push(`a valid dispatch plus push evidence was refused: ${preferred.stderr.trim()}`);
    } else if (!preferred.output.includes('run_id=202')) {
      problems.push('dispatch evidence was not preferred over the push run');
    }
    return {
      observed:
        problems.length === 0
          ? 'ELIGIBLE (a Full dispatch is evidence even with a newer Base run)'
          : 'NOT ELIGIBLE',
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
    forbidden?: readonly string[];
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
    // E403 is not E404: auth/token-scope refusals and rate limits must never be
    // read as a confirmed absence (nor as an existing version on the repoint
    // side). The publish path's own post-E403 registry re-check lives in
    // publish:npm; this row pins the workflow's classification of the same
    // answer.
    const forbiddenRun = detectRun({
      present: ['protocol', 'element', 'compiler', 'router', 'ui'],
      forbidden: ['create'],
    });
    if (forbiddenRun.status === 0) problems.push('an E403 was treated as a publish candidate');
    if (forbiddenRun.output.includes('already_published=false')) {
      problems.push('a publish set was emitted despite the E403');
    }
    for (const failure of ['error', 'forbidden'] as const) {
      bin.setNpm({ present: ['router'], [failure]: ['ui'] });
      writeFileSync(bin.logPath, '');
      const repointRun = runExtractedStep(
        release.doc,
        'repoint',
        'Re-point the channel tag',
        {
          OPERATION: 'repoint',
          TAG: 'alpha',
          INPUT_VERSION: VERSION,
          INPUT_PACKAGES: 'router,ui',
        },
        { cwd: scratch, pathPrefix: bin.dir, extraEnv: fakeEnv(bin, ghDir) },
      );
      if (repointRun.status === 0)
        problems.push(`repoint accepted an unverifiable registry answer (${failure})`);
      if (readNpmLog(bin).trim() !== '')
        problems.push(`repoint wrote a dist-tag after a query ${failure}`);
    }
    return {
      observed: problems.length === 0 ? 'DENY (error/E403 ≠ absent)' : 'NOT DENIED',
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

  // ── 14. One qualification definition, checked against the CI workflow ───
  // The release path consumes tools/repo/ci-qualification.ts; this scenario
  // re-derives the exact GitHub instance names from autoflow-ci.yml and fails
  // when the shared definition (or the workflow's consumption of it) drifts.
  scenario('qualification-contract-single-definition-matches-ci', 'NONE', () => {
    const problems: string[] = [];
    const derived = deriveRunInstanceNames(ci.doc.jobs ?? {});
    problems.push(...derived.problems);
    // The lane classification is a checked projection of the workflow too:
    // the four base jobs must not carry the full_qualification gate, and each
    // of the five heavy jobs must. A lane that drifts from autoflow-ci.yml
    // would make the ten-instance Base fixture and the release skip agree with
    // each other but disagree with CI.
    for (const job of CI_QUALIFICATION_JOBS) {
      const workflowJob = ci.doc.jobs?.[job.id];
      if (workflowJob === undefined) {
        problems.push(`contract job ${job.id} is absent from autoflow-ci.yml`);
        continue;
      }
      const heavyGate = /full_qualification\s*==\s*true/u.test(workflowJob.if ?? '');
      if (job.lane === 'heavy' && !heavyGate) {
        problems.push(`heavy job ${job.id} is not gated on full_qualification in autoflow-ci.yml`);
      }
      if (job.lane === 'base' && heavyGate) {
        problems.push(`base job ${job.id} is gated on full_qualification in autoflow-ci.yml`);
      }
    }
    const expected = [...CI_RUN_INSTANCES].sort();
    const observed = [...derived.instances].sort();
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      problems.push(
        `shared contract ${JSON.stringify(expected)} != CI workflow ${JSON.stringify(observed)}`,
      );
    }
    if (CI_TOTAL_RUN_INSTANCES !== 13) {
      problems.push(`the contract must require thirteen instances, got ${CI_TOTAL_RUN_INSTANCES}`);
    }
    const qualification = CI_QUALIFICATION_JOBS.flatMap((job) => job.instances);
    if (qualification.length !== 12) {
      problems.push(
        `the nine qualification IDs must expand to twelve instances, got ${qualification.length}`,
      );
    }
    if (CI_RUN_INSTANCES[0] !== CI_GUARD_JOB) {
      problems.push('the sha-guard instance must lead the required instance list');
    }
    // The Base listing is a distinct shape, not a Full listing with skipped
    // legs: ten instances, five success (guard + four base jobs) and five
    // job-level skipped heavy IDs. The matrix legs must NOT appear in it.
    if (CI_BASE_TOTAL_RUN_INSTANCES !== 10) {
      problems.push(
        `the real Base listing must contain ten instances, got ${CI_BASE_TOTAL_RUN_INSTANCES}`,
      );
    }
    if (CI_BASE_LISTING.length !== CI_BASE_TOTAL_RUN_INSTANCES) {
      problems.push(
        `the Base listing has ${CI_BASE_LISTING.length} entries but claims ${CI_BASE_TOTAL_RUN_INSTANCES} instances`,
      );
    }
    if (new Set(CI_BASE_LISTING.map((entry) => entry.name)).size !== CI_BASE_LISTING.length) {
      problems.push('the Base listing carries duplicate instance names');
    }
    const baseSuccess = CI_BASE_LISTING.filter((entry) => entry.conclusion === 'success');
    const baseSkipped = CI_BASE_LISTING.filter((entry) => entry.conclusion === 'skipped');
    if (baseSuccess.length !== 5 || baseSuccess[0]?.name !== CI_GUARD_JOB) {
      problems.push(
        `the Base listing must have five successes led by ${CI_GUARD_JOB}, got ${baseSuccess
          .map((entry) => entry.name)
          .join(',')}`,
      );
    }
    const heavyIds = CI_QUALIFICATION_JOBS.filter((job) => job.lane === 'heavy').map(
      (job) => job.id,
    );
    if (
      baseSkipped.length !== heavyIds.length ||
      baseSkipped.some((entry, index) => entry.name !== heavyIds[index])
    ) {
      problems.push(
        `the Base skipped instances must be the heavy job IDs ${heavyIds.join(',')}, got ${baseSkipped
          .map((entry) => entry.name)
          .join(',')}`,
      );
    }
    for (const leg of ['e2e-full (site-e2e)', 'node-serve-smoke (24)']) {
      if (CI_BASE_LISTING.some((entry) => entry.name === leg)) {
        problems.push(`the Base listing must not contain the expanded matrix leg '${leg}'`);
      }
    }
    if (new Set(CI_RUN_INSTANCES).size !== CI_RUN_INSTANCES.length) {
      problems.push('the shared contract carries duplicate instance names');
    }
    if (!CI_RUN_INSTANCES.includes(CI_GUARD_JOB)) {
      problems.push('the sha-guard instance is not required by the contract');
    }

    const evidenceStep = stepOf(
      jobOf(release.doc, 'ci-evidence'),
      'Discover the AutoFlow CI evidence',
    );
    const body = evidenceStep.run ?? '';
    if (!body.includes('ci-qualification.ts')) {
      problems.push('ci-evidence does not read the shared qualification definition');
    }
    if (!body.includes('/jobs?per_page=100&filter=latest')) {
      problems.push(
        'ci-evidence does not pin filter=latest on the jobs query; a partial re-run would ' +
          'list superseded attempts and the exact-identity check would refuse it',
      );
    }
    if (!body.includes('--slurpfile contract')) {
      problems.push('ci-evidence does not load the contract as a single jq definition');
    }
    if (/--arg required "/u.test(release.text)) {
      problems.push('the release workflow still carries a hand-maintained required job list');
    }
    for (const marker of [
      'is missing from run',
      ' times in run',
      'unexpected CI job instance',
      'qualification contract requires',
    ]) {
      if (!body.includes(marker)) {
        problems.push(`ci-evidence lacks the exact-identity marker '${marker}'`);
      }
    }
    return {
      observed:
        problems.length === 0
          ? 'ONE CONTRACT (13 Full + 10 Base instances derived from autoflow-ci.yml)'
          : 'CONTRACT DRIFT',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 15. Post-publish read-back keeps always() failure forensics ──────────
  // The registry read-back is evidence about what npm actually serves. It must
  // still run when the publish/alias steps failed (always()), so a partial or
  // failed publish leaves a tracked/readable registry record, and the artifact
  // upload must carry that record (never a silent "no files" pass). A red
  // read-back stays red: the step may not be continue-on-error.
  scenario('post-publish-readback-keeps-always-forensics', 'NONE', () => {
    const problems: string[] = [];
    const releaseJob = jobOf(release.doc, 'release');
    const readback = stepOf(releaseJob, 'Re-read the registry after the alias re-point');
    const readbackIf = readback.if ?? '';
    if (!/always\s*\(/u.test(readbackIf)) {
      problems.push('the registry read-back lost its always() guard');
    }
    if (!/steps\.check\.outputs\.already_published\s*!=\s*'true'/u.test(readbackIf)) {
      problems.push('the registry read-back lost its already-published guard');
    }
    if (readback['continue-on-error'] === true) {
      problems.push('the registry read-back is continue-on-error (a failed read would be green)');
    }
    if (!(readback.run ?? '').includes('sync:registry')) {
      problems.push('the read-back no longer runs sync:registry');
    }
    const upload = (releaseJob.steps ?? []).find((step) =>
      (step.name ?? '').includes('Upload the registry-synced release state'),
    );
    if (!upload) problems.push('the registry-state artifact upload is missing');
    else {
      if (!/always\s*\(/u.test(upload.if ?? '')) {
        problems.push('the registry-state artifact upload lost its always() guard');
      }
      if (upload.with?.['if-no-files-found'] !== 'error') {
        problems.push('the registry-state artifact upload no longer fails on missing files');
      }
      const paths = String(upload.with?.path ?? '');
      for (const path of [
        'docs/release/release-state.json',
        'www/app/data/version.ts',
        'www/app/data/_generated-release-line.ts',
      ]) {
        if (!paths.includes(path)) problems.push(`the artifact upload omits ${path}`);
      }
    }
    return {
      observed:
        problems.length === 0 ? 'READ-BACK ALWAYS RUNS, ARTIFACT FAILS CLOSED' : 'FORENSICS LOST',
      ok: problems.length === 0,
      detail: problems.join('; '),
    };
  });

  // ── 16. The kept release tooling surfaces are reused, not rebuilt ───────
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
