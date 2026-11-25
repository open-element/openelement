import { expect, test } from 'vitest';
import {
  assessEvidence,
  assessOwnerGates,
  buildReleasePlan,
  missingGateScripts,
  parseArgs,
  renderPreflight,
  runLocalChecks,
  type PlanInput,
  type PreflightReport,
} from './release-preflight.ts';
import type { EvidenceDocument } from './evidence-bind.ts';

const SHA = 'ef5da43e45d887b214841a99c26d3f8d2dac358b';

const input: PlanInput = {
  sha: SHA,
  version: '1.0.0-alpha.15',
  tag: 'v1.0.0-alpha.15',
  pullRequest: 1611,
  repository: 'SisyphusZheng/openelement',
  codeqlRepository: 'open-element/openelement',
  releaseTag: 'element-v1.0.0-alpha.15',
  archivePath: '.artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst',
  evidencePath: '',
};

test('release-preflight: the plan composes every gate entry point by script name', () => {
  const plan = buildReleasePlan(input);
  const gateCommands = plan.filter((step) => step.kind === 'gate').map((step) => step.command);
  expect(gateCommands).toEqual([
    'pnpm run check',
    'pnpm run test',
    'pnpm run verify:core',
    'pnpm run release:check',
    'pnpm run site:verify',
  ]);
});

test('release-preflight: the plan binds the evidence to the exact SHA', () => {
  const plan = buildReleasePlan(input);
  const binder = plan.find((step) => step.id === 'evidence-bind')!;
  expect(binder.command).toContain(SHA);
  expect(binder.command).toContain('--require-main-push');
  expect(binder.command).toContain(
    `--json --out /tmp/release-evidence/${SHA.slice(0, 7)}-release-evidence.json`,
  );
  expect(binder.command).toContain('--codeql-repo open-element/openelement');
  const prBinder = plan.find((step) => step.id === 'evidence-bind-pr')!;
  expect(prBinder.command).not.toContain('--require-main-push');
  const dispatch = plan.find((step) => step.id === 'qualification-dispatch')!;
  expect(dispatch.command).toContain(`--repo ${input.repository} --ref main`);
  expect(dispatch.command).toContain(`-f expected_sha=${SHA}`);
  expect(plan.indexOf(dispatch)).toBeLessThan(plan.indexOf(binder));
});

test('release-preflight: every published-state change is an owner-gated step', () => {
  const plan = buildReleasePlan(input);
  const destructive = plan.filter((step) => step.destructive).map((step) => step.id);
  expect(destructive).toEqual([
    'handoff-prerelease',
    'publish',
    'release-asset',
    'dist-tag-repoint',
  ]);
  for (const step of plan.filter((item) => item.destructive)) {
    expect(step.kind).toEqual('owner-gated');
    expect(step.command).not.toBeNull();
  }
});

test('release-preflight: the read-backs re-verify the published archive bytes', () => {
  const plan = buildReleasePlan(input);
  const readback = plan.find((step) => step.id === 'readback-asset')!;
  expect(readback.command).toContain('gh release download');
  expect(readback.command).toContain('verify-evidence-archive.ts');
});

test('release-preflight: a dry run refuses nothing and never authorizes an action', () => {
  const plan = buildReleasePlan(input);
  const dry = assessOwnerGates(
    plan,
    SHA,
    { authorized: false, confirmedSha: null, approved: false },
    false,
  );
  expect(dry.refused).toEqual([]);
  expect(dry.authorizedForOwner).toEqual([]);
});

test('release-preflight: execute mode refuses every destructive step without authorization', () => {
  const plan = buildReleasePlan(input);
  const assessment = assessOwnerGates(
    plan,
    SHA,
    { authorized: false, confirmedSha: null, approved: false },
    true,
  );
  expect(assessment.refused).toHaveLength(4);
  expect(assessment.refused.join('\n')).toContain('handoff-prerelease: destructive step refused');
});

test('release-preflight: execute mode refuses a mismatched confirm-sha', () => {
  const plan = buildReleasePlan(input);
  const assessment = assessOwnerGates(
    plan,
    SHA,
    { authorized: true, confirmedSha: 'f'.repeat(40), approved: true },
    true,
  );
  expect(assessment.refused.join('\n')).toContain('is not the evidence SHA');
  expect(assessment.authorizedForOwner).toEqual([]);
});

test('release-preflight: execute mode refuses without the environment approval marker', () => {
  const plan = buildReleasePlan(input);
  const assessment = assessOwnerGates(
    plan,
    SHA,
    { authorized: true, confirmedSha: SHA, approved: false },
    true,
  );
  expect(assessment.refused.join('\n')).toContain('OPEN_ELEMENT_RELEASE_APPROVED=1');
});

test('release-preflight: execute mode authorizes exactly the owner steps when everything matches', () => {
  const plan = buildReleasePlan(input);
  const assessment = assessOwnerGates(
    plan,
    SHA,
    { authorized: true, confirmedSha: SHA, approved: true },
    true,
  );
  expect(assessment.refused).toEqual([]);
  expect(assessment.authorizedForOwner).toEqual([
    'handoff-prerelease',
    'publish',
    'release-asset',
    'dist-tag-repoint',
  ]);
});

test('release-preflight: an unqualified recorded evidence document fails the preflight', () => {
  const document = {
    schemaVersion: 1,
    collectedAt: '2026-10-19T12:00:00Z',
    candidate: {
      sha: SHA,
      repository: 'open-element/openelement',
      pullRequest: 1611,
      tag: 'v1.0.0-alpha.15',
      packages: [],
      workflow: 'autoflow-ci.yml',
      requireMainPush: false,
    },
    ci: {
      origin: 'fixtures',
      runs: [
        {
          id: 39214493482,
          attempt: 1,
          status: 'completed',
          conclusion: 'cancelled',
          event: 'workflow_dispatch',
          headBranch: 'alpha15',
          headSha: SHA,
          createdAt: '2026-10-19T06:00:00Z',
          updatedAt: '2026-10-19T06:10:00Z',
          htmlUrl: '',
        },
      ],
      qualificationRunId: 39214493482,
      selectionBasis: null,
      rejectedRuns: [],
      jobs: [],
      jobListingTotal: null,
      artifacts: [],
      artifactListingTotal: null,
    },
    codeql: { origin: 'fixtures', ref: '', queriedAt: null, alerts: [], error: null },
    registry: { origin: 'fixtures', queriedAt: null, packages: [], error: null },
    git: {
      origin: 'fixtures',
      tag: { name: 'v1.0.0-alpha.15', sha: null, exists: false },
      release: { tag: 'v1.0.0-alpha.15', exists: false, createdAt: null, htmlUrl: null },
    },
  } as unknown as EvidenceDocument;
  const assessment = assessEvidence(document, SHA);
  expect(assessment.qualified).toEqual(false);
  expect(assessment.refusals.join('\n')).toContain('cancelled');
});

test('release-preflight: a missing gate script is a hard refusal, not a skipped gate', () => {
  expect(missingGateScripts({ scripts: {} })).toEqual([
    'check',
    'test',
    'verify:core',
    'release:check',
    'site:verify',
  ]);
  const complete = Object.fromEntries(
    ['check', 'test', 'verify:core', 'release:check', 'site:verify'].map((name) => [name, 'x']),
  );
  expect(missingGateScripts({ scripts: complete })).toEqual([]);
});

test('release-preflight: runLocalChecks runs only the read-only verifiers', async () => {
  const calls: string[][] = [];
  const checks = await runLocalChecks(input, (command, args) => {
    calls.push([command, ...args]);
    return Promise.resolve({ code: 0, stdout: 'ok', stderr: '' });
  });
  expect(checks.map((check) => check.id)).toEqual(['toolchain-pins', 'evidence-archive']);
  for (const call of calls) expect(call[0]).toContain('node');
  expect(checks.every((check) => check.code === 0)).toEqual(true);
});

function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    sha: SHA,
    version: '1.0.0-alpha.15',
    tag: 'v1.0.0-alpha.15',
    mode: 'dry-run',
    steps: buildReleasePlan(input),
    localChecks: [],
    evidence: null,
    ownerGateRefusals: [],
    authorizedForOwner: [],
    ...overrides,
  };
}

test('release-preflight: the dry-run rendering says nothing destructive ran', () => {
  const rendered = renderPreflight(report());
  expect(rendered).toContain('OpenElement release preflight — dry-run');
  expect(rendered).toContain('This was a dry run: no destructive action ran');
  expect(rendered).toContain('[OWNER GATE] Publish dispatch');
  expect(rendered).toContain('[GATE] Gate: release:check');
  const dispatch = rendered.indexOf('Full qualification CI on the exact SHA');
  const evidence = rendered.indexOf('Exact-SHA release evidence bound');
  expect(dispatch).toBeGreaterThanOrEqual(0);
  expect(evidence).toBeGreaterThan(dispatch);
  expect(rendered.indexOf('Publish dispatch')).toBeGreaterThan(evidence);
});

test('release-preflight: the execute rendering lists the refusals', () => {
  const rendered = renderPreflight(
    report({
      mode: 'execute',
      ownerGateRefusals: ['publish: destructive step refused; pass --authorize-destructive'],
    }),
  );
  expect(rendered).toContain('REFUSED destructive actions');
  expect(rendered).toContain('VERDICT: preflight FAILED');
});

test('release-preflight: argument parsing defaults to a dry run on the tracked version', () => {
  const parsed = parseArgs(['--pr', '1611', '--run-local']);
  expect(parsed.execute).toEqual(false);
  expect(parsed.runLocal).toEqual(true);
  expect(parsed.pr).toEqual(1611);
  expect(parsed.repository).toEqual('open-element/openelement');
  expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
});
