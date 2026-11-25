/**
 * REL-06 — one-command release preflight (dry-run by default).
 *
 * Composes, in order, everything that must hold before a tag/publish/Release:
 *
 *   1. toolchain pins (REL-04), the exact-SHA evidence binder (REL-01), and
 *      the historical archive verifier when auditing Alpha 15 (REL-03);
 *   2. the existing gate entry points, by their package.json script names (the
 *      single source of truth for commands) — check / test / verify:core /
 *      release:check / site:verify;
 *   3. the owner-gated qualification and publish dispatches, followed by npm
 *      and release read-back. Explicit Alpha 15 audits verify the local
 *      historical archive against the immutable Git record.
 *
 * Safety model: the default is a dry run that prints the plan and NEVER runs a
 * destructive action. Destructive steps (tag, publish, Release, asset upload,
 * dist-tag move) are refused in execute mode unless all of
 * `--authorize-destructive`, a matching `--confirm-sha` and the
 * `OPEN_ELEMENT_RELEASE_APPROVED=1` environment marker are present. Even
 * then the tool only prints them as authorized for the owner — it never
 * executes a publish; the Release workflow owns that through the
 * `openelement-release` environment.
 *
 * Nothing here is a hand-written table: every command is derived from pinned
 * paths, the tracked release record and the package.json scripts.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import {
  evaluateDocument,
  parseEvidenceDocument,
  RELEASE_PACKAGES,
  type EvidenceDocument,
} from './evidence-bind.ts';

const ALPHA15_VERSION = '1.0.0-alpha.15';
const ALPHA15_ARCHIVE = '.artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst';

/** Gate entry points: package.json script name -> why it runs. */
export const GATE_ENTRY_POINTS: readonly { script: string; purpose: string }[] = [
  { script: 'check', purpose: 'fmt + lint + typecheck + markdown lint' },
  { script: 'test', purpose: 'full vitest qualification (all projects)' },
  { script: 'verify:core', purpose: 'source gate + packed consumer gate' },
  { script: 'release:check', purpose: 'release train + registry truth + packed + publish dry-run' },
  { script: 'site:verify', purpose: 'Site build + every www check' },
];

export type StepKind = 'local-verify' | 'gate' | 'owner-gated' | 'read-back';

export interface PlanStep {
  id: string;
  title: string;
  kind: StepKind;
  /** Exact command, or null for an owner decision step. */
  command: string | null;
  /** True for any step that changes published state. */
  destructive: boolean;
  note: string;
}

export interface PlanInput {
  sha: string;
  version: string;
  tag: string;
  pullRequest: number | null;
  repository: string;
  codeqlRepository: string;
  releaseTag: string;
  archivePath: string;
  evidencePath: string;
}

/** The script names a plan can cite; fails closed if package.json lost one. */
export function missingGateScripts(packageJson: { scripts?: Record<string, string> }): string[] {
  const scripts = packageJson.scripts ?? {};
  return GATE_ENTRY_POINTS.filter((entry) => typeof scripts[entry.script] !== 'string').map(
    (entry) => entry.script,
  );
}

/** Build the ordered plan. Pure: no command is executed here. */
export function buildReleasePlan(input: PlanInput): PlanStep[] {
  const sha7 = input.sha.slice(0, 7);
  const steps: PlanStep[] = [];
  steps.push({
    id: 'toolchain-pins',
    title: 'Fixed toolchain pins agree',
    kind: 'local-verify',
    command: 'node tools/release/check-toolchain-pins.ts',
    destructive: false,
    note: 'node/pnpm/Playwright/Dockerfile vs package.json, .node-version, lockfile and CI workflows',
  });
  if (input.version === ALPHA15_VERSION) {
    steps.push({
      id: 'evidence-archive',
      title: 'Raw measurement package verified',
      kind: 'local-verify',
      command: `node tools/release/verify-evidence-archive.ts --archive ${input.archivePath}`,
      destructive: false,
      note: 'pinned digest, 503 member hashes, 86/22 assertions and JFB recomputation from a local historical archive',
    });
    return steps;
  }
  steps.push({
    id: 'evidence-bind-pr',
    title: 'PR evidence block bound (pre-merge)',
    kind: 'local-verify',
    command:
      `node tools/release/evidence-bind.ts --sha ${input.sha}` +
      (input.pullRequest ? ` --pr ${input.pullRequest}` : '') +
      ` --repo ${input.repository} --codeql-repo ${input.codeqlRepository} --tag ${input.tag}`,
    destructive: false,
    note: 'same contract without the push/main requirement; the checklist snippet for the PR body',
  });
  for (const entry of GATE_ENTRY_POINTS) {
    steps.push({
      id: `gate-${entry.script}`,
      title: `Gate: ${entry.script}`,
      kind: 'gate',
      command: `pnpm run ${entry.script}`,
      destructive: false,
      note: entry.purpose,
    });
  }
  steps.push({
    id: 'qualification-dispatch',
    title: 'Full qualification CI on the exact SHA',
    kind: 'owner-gated',
    command: `gh workflow run autoflow-ci.yml --repo ${input.repository} --ref main -f full_qualification=true -f expected_sha=${input.sha}`,
    destructive: false,
    note: 'wait for the Full qualification result and the Base main push on this SHA',
  });
  steps.push({
    id: 'evidence-bind',
    title: 'Exact-SHA release evidence bound',
    kind: 'local-verify',
    command:
      `node tools/release/evidence-bind.ts --sha ${input.sha}` +
      (input.pullRequest ? ` --pr ${input.pullRequest}` : '') +
      ` --repo ${input.repository} --codeql-repo ${input.codeqlRepository} --tag ${input.tag} --require-main-push --json --out /tmp/release-evidence/${sha7}-release-evidence.json`,
    destructive: false,
    note: 'checks the Full dispatch and main push on the candidate SHA, or one historical Full main push',
  });
  steps.push({
    id: 'publish',
    title: 'Publish dispatch (owner approval through the environment)',
    kind: 'owner-gated',
    command: `gh workflow run autoflow-release.yml --repo ${input.repository} --ref main -f operation=publish -f version=${input.version}`,
    destructive: true,
    note: 'runs after same-SHA Full qualification and main push evidence, plus the release gate and human environment approval',
  });
  steps.push({
    id: 'dist-tag-repoint',
    title: 'Channel dist-tag repair (only if the alias did not move)',
    kind: 'owner-gated',
    command: `gh workflow run autoflow-release.yml --repo ${input.repository} --ref main -f operation=repoint -f tag=alpha -f version=${input.version} -f packages=protocol,element,compiler,router,create,ui`,
    destructive: true,
    note: 'repair path only; the publish job re-points alpha itself, and this operation never publishes a version',
  });
  steps.push({
    id: 'readback-release',
    title: 'Read back the package Release',
    kind: 'read-back',
    command: `gh release view ${input.releaseTag} --repo ${input.repository}`,
    destructive: false,
    note: 'repeat for each shipped package tag; the following check verifies the dist-tags against npm',
  });
  steps.push({
    id: 'readback-registry',
    title: 'Registry truth read-back',
    kind: 'read-back',
    command: 'pnpm --dir tools/repo run release:registry-check',
    destructive: false,
    note: 'read-only npm queries; a drift or false common version fails',
  });
  return steps;
}

export interface Authorization {
  /** `--authorize-destructive` was passed. */
  authorized: boolean;
  /** `--confirm-sha` value: the operator names the SHA they mean. */
  confirmedSha: string | null;
  /** `OPEN_ELEMENT_RELEASE_APPROVED=1` marker. */
  approved: boolean;
}

export interface StepAssessment {
  refused: string[];
  authorizedForOwner: string[];
}

/**
 * Assess the owner-gated steps against an explicit authorization. In dry-run
 * (no execute flag) nothing is refused: refusal is about *proceeding*, and a
 * dry run only plans. In execute mode every destructive step must be
 * authorized, bound to the same SHA, and approved by the environment marker.
 */
export function assessOwnerGates(
  steps: readonly PlanStep[],
  sha: string,
  authorization: Authorization,
  execute: boolean,
): StepAssessment {
  const refused: string[] = [];
  const authorizedForOwner: string[] = [];
  if (!execute) return { refused, authorizedForOwner };
  for (const step of steps) {
    if (!step.destructive) continue;
    if (!authorization.authorized) {
      refused.push(`${step.id}: destructive step refused; pass --authorize-destructive`);
      continue;
    }
    if (authorization.confirmedSha !== sha) {
      refused.push(
        `${step.id}: --confirm-sha '${authorization.confirmedSha ?? '(missing)'}' is not the evidence SHA ${sha}`,
      );
      continue;
    }
    if (!authorization.approved) {
      refused.push(
        `${step.id}: OPEN_ELEMENT_RELEASE_APPROVED=1 is not set; owner approval is not recorded`,
      );
      continue;
    }
    authorizedForOwner.push(step.id);
  }
  return { refused, authorizedForOwner };
}

export interface LocalCheck {
  id: string;
  command: string;
  code: number;
  output: string;
}

type Runner = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultRunner: Runner = async (command, args) =>
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });

/** Run the read-only local verifiers (never a gate or an owner action). */
export async function runLocalChecks(
  input: PlanInput,
  runner: Runner = defaultRunner,
): Promise<LocalCheck[]> {
  const checks: LocalCheck[] = [];
  const runNode = async (id: string, args: string[]): Promise<void> => {
    const result = await runner(process.execPath, args);
    checks.push({
      id,
      command: `node ${args.join(' ')}`,
      code: result.code,
      output: `${result.stdout}${result.stderr}`.trim(),
    });
  };
  await runNode('toolchain-pins', ['tools/release/check-toolchain-pins.ts', '--json']);
  if (input.version === ALPHA15_VERSION) {
    await runNode('evidence-archive', [
      'tools/release/verify-evidence-archive.ts',
      '--archive',
      input.archivePath,
      '--json',
    ]);
  }
  return checks;
}

/** Assess a recorded evidence document (REL-01) as the release gate. */
export function assessEvidence(
  document: EvidenceDocument,
  sha: string,
): {
  qualified: boolean;
  refusals: string[];
  skips: string[];
} {
  const verdict = evaluateDocument(document, sha, true);
  return { qualified: verdict.qualified, refusals: verdict.refusals, skips: verdict.skips };
}

export interface PreflightReport {
  sha: string;
  version: string;
  tag: string;
  mode: 'dry-run' | 'execute';
  steps: PlanStep[];
  localChecks: LocalCheck[];
  evidence: { qualified: boolean; refusals: string[]; skips: string[] } | null;
  ownerGateRefusals: string[];
  authorizedForOwner: string[];
}

export function renderPreflight(report: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`OpenElement release preflight — ${report.mode}`);
  lines.push(`  candidate: ${report.sha}`);
  lines.push(`  version:   ${report.version}  (umbrella tag ${report.tag})`);
  lines.push('');
  if (report.localChecks.length > 0) {
    lines.push('Read-only local verification (run now):');
    for (const check of report.localChecks) {
      lines.push(`  ${check.code === 0 ? 'PASS' : 'FAIL'}  ${check.command}`);
      if (check.code !== 0) {
        for (const line of check.output.split('\n').slice(-6)) lines.push(`        ${line}`);
      }
    }
    lines.push('');
  }
  if (report.evidence) {
    lines.push(
      report.evidence.qualified
        ? 'Recorded evidence document: QUALIFIED.'
        : 'Recorded evidence document: NOT QUALIFIED — do not proceed.',
    );
    for (const refusal of report.evidence.refusals) lines.push(`  REFUSAL: ${refusal}`);
    for (const skip of report.evidence.skips) lines.push(`  SKIP: ${skip}`);
    lines.push('');
  }
  const headings: Record<StepKind, string> = {
    'local-verify': 'Read-only verification commands',
    gate: 'Gates (run by the Lead, serialized)',
    'owner-gated': 'Owner-gated actions (never executed by this tool)',
    'read-back': 'Read-backs after publication',
  };
  let kind: StepKind | undefined;
  for (const step of report.steps) {
    if (kind !== step.kind) {
      if (kind) lines.push('');
      kind = step.kind;
      lines.push(`${headings[kind]}:`);
    }
    const label = step.destructive
      ? report.mode === 'execute' && report.authorizedForOwner.includes(step.id)
        ? 'AUTHORIZED (owner applies)'
        : 'OWNER GATE'
      : step.kind === 'gate'
        ? 'GATE'
        : 'OK';
    lines.push(`  [${label}] ${step.title}`);
    if (step.command) lines.push(`      $ ${step.command}`);
    lines.push(`      ${step.note}`);
  }
  if (kind) lines.push('');
  if (report.ownerGateRefusals.length > 0) {
    lines.push('REFUSED destructive actions:');
    for (const refusal of report.ownerGateRefusals) lines.push(`  REFUSAL: ${refusal}`);
    lines.push('');
  }
  const localFailed = report.localChecks.some((check) => check.code !== 0);
  const evidenceFailed = report.evidence !== null && !report.evidence.qualified;
  const refused = report.ownerGateRefusals.length > 0;
  lines.push(
    localFailed || evidenceFailed || refused
      ? 'VERDICT: preflight FAILED — fix the findings above before any owner-gated step.'
      : report.mode === 'dry-run'
        ? 'VERDICT: plan ready. This was a dry run: no destructive action ran and none will unless the owner authorizes it.'
        : 'VERDICT: authorized steps are listed for the owner; this tool never publishes.',
  );
  return `${lines.join('\n')}\n`;
}

interface CliOptions {
  sha: string | null;
  version: string | null;
  tag: string | null;
  pr: number | null;
  repository: string;
  codeqlRepository: string | null;
  releaseTag: string | null;
  archive: string | null;
  evidence: string | null;
  runLocal: boolean;
  execute: boolean;
  authorizeDestructive: boolean;
  confirmSha: string | null;
  packages: readonly string[];
  json: boolean;
  out: string | null;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sha: null,
    version: null,
    tag: null,
    pr: null,
    repository: 'open-element/openelement',
    codeqlRepository: null,
    releaseTag: null,
    archive: null,
    evidence: null,
    runLocal: false,
    execute: false,
    authorizeDestructive: false,
    confirmSha: null,
    packages: RELEASE_PACKAGES,
    json: false,
    out: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--sha':
        options.sha = value();
        break;
      case '--version':
        options.version = value();
        break;
      case '--tag':
        options.tag = value();
        break;
      case '--pr':
        options.pr = Number(value());
        break;
      case '--repo':
        options.repository = value();
        break;
      case '--codeql-repo':
        options.codeqlRepository = value();
        break;
      case '--release-tag':
        options.releaseTag = value();
        break;
      case '--archive':
        options.archive = value();
        break;
      case '--evidence':
        options.evidence = value();
        break;
      case '--packages':
        options.packages = value()
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      case '--run-local':
        options.runLocal = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--authorize-destructive':
        options.authorizeDestructive = true;
        break;
      case '--confirm-sha':
        options.confirmSha = value();
        break;
      case '--json':
        options.json = true;
        break;
      case '--out':
        options.out = value();
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const USAGE = `usage: node tools/release/release-preflight.ts [--sha <sha>] [--version <v>] [--pr <n>]
       [--repo owner/name] [--codeql-repo owner/name] [--release-tag <tag>]
       (--repo is the repository whose runs/tag/Release are read — a fork for an
        unmerged candidate; --codeql-repo is the base repository for the PR merge ref)
       [--archive <path>] [--evidence <file>] [--run-local]
       [--execute --authorize-destructive --confirm-sha <sha>] [--json] [--out <file>]

Dry-run by default: prints the ordered plan (read-only verification, gates,
owner-gated actions, read-backs) and executes nothing. --run-local runs the
toolchain pin verifier and, for --version 1.0.0-alpha.15, the historical raw
measurement verifier. Alpha 15 audit mode is read-only and requires a local
archive. Other versions must match the checkout release state. --execute refuses
every destructive action unless --authorize-destructive, --confirm-sha and
OPEN_ELEMENT_RELEASE_APPROVED=1 are all present; even then the tool only prints
the steps for the owner and never publishes anything.`;

async function gitHead(): Promise<string> {
  const result = await defaultRunner('git', ['rev-parse', 'HEAD']);
  if (result.code !== 0) throw new Error('git rev-parse HEAD failed');
  return result.stdout.trim();
}

async function resolveVersion(root: string): Promise<string> {
  const raw = await readFile(join(root, 'docs/release/release-state.json'), 'utf8');
  const parsed = JSON.parse(raw) as { sourceVersion?: string };
  if (!parsed.sourceVersion) throw new Error('release-state.json carries no sourceVersion');
  return parsed.sourceVersion;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const root = process.cwd();
  const sha = options.sha ?? (await gitHead());
  const sourceVersion = await resolveVersion(root);
  const version = options.version ?? sourceVersion;
  if (options.version === ALPHA15_VERSION) {
    if (options.execute) throw new Error('Alpha 15 audit mode is read-only');
  } else if (version !== sourceVersion || version === ALPHA15_VERSION) {
    throw new Error(`Publish planning requires the current checkout release ${sourceVersion}`);
  }
  if (options.archive !== null && version !== ALPHA15_VERSION) {
    throw new Error('--archive applies only to --version 1.0.0-alpha.15');
  }
  const tag = options.tag ?? `v${version}`;
  const codeqlRepository = options.codeqlRepository ?? options.repository;
  const releaseTag = options.releaseTag ?? `element-v${version}`;
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const missingScripts = missingGateScripts(packageJson);
  if (missingScripts.length > 0) {
    throw new Error(`package.json is missing gate script(s): ${missingScripts.join(', ')}`);
  }
  const input: PlanInput = {
    sha,
    version,
    tag,
    pullRequest: options.pr,
    repository: options.repository,
    codeqlRepository,
    releaseTag,
    archivePath: options.archive ?? ALPHA15_ARCHIVE,
    evidencePath: options.evidence ?? '',
  };
  const steps = buildReleasePlan(input);
  const localChecks = options.runLocal ? await runLocalChecks(input) : [];
  let evidence: PreflightReport['evidence'] = null;
  if (options.evidence) {
    const document = parseEvidenceDocument(await readFile(options.evidence, 'utf8'));
    evidence = assessEvidence(document, sha);
  }
  const authorization: Authorization = {
    authorized: options.authorizeDestructive,
    confirmedSha: options.confirmSha,
    approved: process.env.OPEN_ELEMENT_RELEASE_APPROVED === '1',
  };
  const { refused, authorizedForOwner } = assessOwnerGates(
    steps,
    sha,
    authorization,
    options.execute,
  );
  const report: PreflightReport = {
    sha,
    version,
    tag,
    mode: options.execute ? 'execute' : 'dry-run',
    steps,
    localChecks,
    evidence,
    ownerGateRefusals: refused,
    authorizedForOwner,
  };
  const rendered = renderPreflight(report);
  if (options.out) await writeFile(options.out, rendered, 'utf8');
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : rendered);
  if (refused.length > 0) process.exitCode = 1;
  if (localChecks.some((check) => check.code !== 0)) process.exitCode = 1;
  if (evidence && !evidence.qualified) process.exitCode = 1;
}

export { USAGE };

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`release-preflight: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
}
