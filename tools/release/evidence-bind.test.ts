import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CI_BASE_LISTING, CI_RUN_INSTANCES } from '../repo/ci-qualification.ts';
import {
  collectEvidence,
  createFixtureSource,
  evaluateDocument,
  jobBaseId,
  parseArgs,
  renderChecklist,
  type EvidenceFixtures,
  type RawJob,
  type RawRun,
} from './evidence-bind.ts';
import { assessEvidence } from './release-preflight.ts';

const SHA = 'ef5da43e45d887b214841a99c26d3f8d2dac358b';
const OTHER_SHA = '8f0e22c03053ebbdb81cb82e88810b3054c238b2';

function rawRun(overrides: Partial<RawRun> & { id: number }): RawRun {
  return {
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: SHA,
    created_at: '2026-10-19T09:00:00Z',
    updated_at: '2026-10-19T09:40:00Z',
    html_url: `https://github.com/open-element/openelement/actions/runs/${overrides.id}`,
    ...overrides,
  };
}

const QUALIFICATION_RUN_ID = 39219887454;
const CANCELLED_RUN_ID = 39214493482;
const FAILED_RUN_ID = 39216159302;
const MAIN_PUSH_ID = 39217777777;
const BASE_DISPATCH_ID = 39219999999;
let nextJobId = 0;

/** The nine required job IDs / twelve instances, plus the sha-guard. */
function job(name: string, conclusion: string | null = 'success'): RawJob {
  return {
    id: ++nextJobId,
    name,
    status: conclusion ? 'completed' : 'in_progress',
    conclusion,
    started_at: '2026-10-19T09:00:00Z',
    completed_at: conclusion ? '2026-10-19T09:05:00Z' : null,
    html_url: 'https://github.com/open-element/openelement/actions/runs/1/job/1',
  };
}

const QUALIFICATION_JOBS = CI_RUN_INSTANCES.map((name) => job(name));
const BASE_JOBS = CI_BASE_LISTING.map(({ name, conclusion }) => job(name, conclusion));

function baseFixtures(overrides: Partial<EvidenceFixtures> = {}): EvidenceFixtures {
  return {
    runs: [
      rawRun({ id: CANCELLED_RUN_ID, conclusion: 'cancelled', created_at: '2026-10-19T06:00:00Z' }),
      rawRun({ id: FAILED_RUN_ID, conclusion: 'failure', created_at: '2026-10-19T07:00:00Z' }),
      rawRun({ id: QUALIFICATION_RUN_ID, run_attempt: 1, created_at: '2026-10-19T08:00:00Z' }),
    ],
    runDetails: {
      [String(QUALIFICATION_RUN_ID)]: rawRun({ id: QUALIFICATION_RUN_ID }),
    },
    jobs: {
      [String(QUALIFICATION_RUN_ID)]: { total_count: 13, jobs: QUALIFICATION_JOBS },
    },
    artifacts: {
      [String(QUALIFICATION_RUN_ID)]: { total_count: 0, artifacts: [] },
    },
    codeql: {
      ref: 'refs/pull/1611/merge',
      alerts: [
        {
          number: 4236,
          state: 'fixed',
          created_at: '2026-10-17T00:00:00Z',
          updated_at: '2026-10-18T05:10:34Z',
          html_url: 'https://github.com/open-element/openelement/security/code-scanning/4236',
          rule: {
            id: 'js/bad-code-sanitization',
            severity: 'error',
            security_severity_level: 'high',
          },
          tool: { name: 'CodeQL' },
          most_recent_instance: { ref: 'refs/pull/1611/merge' },
        },
        {
          number: 4238,
          state: 'open',
          created_at: '2026-10-18T00:00:00Z',
          updated_at: '2026-10-18T06:00:00Z',
          html_url: 'https://github.com/open-element/openelement/security/code-scanning/4238',
          rule: {
            id: 'js/bad-code-sanitization',
            severity: 'error',
            security_severity_level: 'medium',
          },
          tool: { name: 'CodeQL' },
          most_recent_instance: { ref: 'refs/pull/1611/merge' },
        },
        {
          number: 4241,
          state: 'open',
          created_at: '2026-10-18T00:00:00Z',
          updated_at: '2026-10-18T06:00:00Z',
          html_url: 'https://github.com/open-element/openelement/security/code-scanning/4241',
          rule: { id: 'js/trivial-conditional', severity: 'warning' },
          tool: { name: 'CodeQL' },
          most_recent_instance: { ref: 'refs/pull/1611/merge' },
        },
      ],
    },
    tags: { 'v1.0.0-alpha.15': null },
    releases: { 'v1.0.0-alpha.15': null },
    distTags: {
      '@openelement/protocol': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
      '@openelement/element': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
      '@openelement/compiler': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
      '@openelement/router': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
      '@openelement/create': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
      '@openelement/ui': { distTags: { alpha: '1.0.0-alpha.14', latest: '1.0.0-alpha.14' } },
    },
    ...overrides,
  };
}

async function collect(
  fixtures: EvidenceFixtures,
  opts: { sha?: string; pr?: number | null; requireMainPush?: boolean } = {},
) {
  return await collectEvidence({
    source: createFixtureSource(fixtures, 'fixtures test'),
    sha: opts.sha ?? SHA,
    repository: 'open-element/openelement',
    requireMainPush: opts.requireMainPush,
    pullRequest: opts.pr === undefined ? 1611 : opts.pr,
    tag: 'v1.0.0-alpha.15',
    packages: [
      '@openelement/protocol',
      '@openelement/element',
      '@openelement/compiler',
      '@openelement/router',
      '@openelement/create',
      '@openelement/ui',
    ],
    now: '2026-10-19T12:00:00Z',
  });
}

test('evidence-bind: selects the exact-SHA successful push/main run and passes', async () => {
  const { document, verdict } = await collect(baseFixtures());
  expect(verdict.qualified).toEqual(true);
  expect(verdict.refusals).toEqual([]);
  expect(document.ci.qualificationRunId).toEqual(QUALIFICATION_RUN_ID);
  expect(document.ci.runs).toHaveLength(3);
  expect(document.ci.jobs).toHaveLength(13);
  expect(document.ci.artifactListingTotal).toEqual(0);
  expect(document.codeql.ref).toEqual('refs/pull/1611/merge');
});

test('evidence-bind: a cancelled run is history, never qualification', async () => {
  const { document, verdict } = await collect(baseFixtures());
  const snippet = renderChecklist(document, verdict);
  expect(snippet).toContain('### Qualification CI (never a cancelled or failed run)');
  expect(snippet).toContain(`[${QUALIFICATION_RUN_ID}]`);
  expect(snippet).toContain('History (NOT qualification)');
  expect(snippet).toContain(`[${CANCELLED_RUN_ID}]`);
  expect(snippet).toContain(`[${FAILED_RUN_ID}]`);
  // The cancelled run must not be presented as the qualification pointer.
  const qualificationPointer = snippet
    .split('\n')
    .find((line) => line.startsWith('- Run [') && line.includes(`[${CANCELLED_RUN_ID}]`));
  expect(qualificationPointer).toBeUndefined();
});

test('evidence-bind: a cancelled-only history refuses the candidate', async () => {
  const fixtures = baseFixtures({
    runs: [rawRun({ id: CANCELLED_RUN_ID, conclusion: 'cancelled' })],
  });
  const { verdict, document } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('satisfies the qualification contract');
  expect(verdict.refusals.join('\n')).toContain('cancelled');
  expect(renderChecklist(document, verdict)).toContain('**NOT QUALIFIED**');
});

test('evidence-bind: a run bound to another SHA refuses instead of being reused', async () => {
  const fixtures = baseFixtures({ runs: [rawRun({ id: 1, head_sha: OTHER_SHA })] });
  const { verdict } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('is bound to');
  expect(verdict.refusals.join('\n')).toContain('not the candidate');
});

test('evidence-bind: any non-success required job instance refuses', async () => {
  const jobs = QUALIFICATION_JOBS.map((entry) =>
    entry.name === 'e2e-full (fixture-gates)' ? { ...entry, conclusion: 'failure' } : entry,
  );
  const fixtures = baseFixtures({
    jobs: { [String(QUALIFICATION_RUN_ID)]: { total_count: 13, jobs } },
  });
  const { verdict } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('e2e-full (fixture-gates) concluded failure');
});

test('evidence-bind: a missing required instance and a partial listing both refuse', async () => {
  const missing = QUALIFICATION_JOBS.filter((entry) => entry.name !== 'node-serve-smoke (26)');
  const { verdict } = await collect(
    baseFixtures({
      jobs: { [String(QUALIFICATION_RUN_ID)]: { total_count: 12, jobs: missing } },
    }),
  );
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain(
    'required CI job instance node-serve-smoke (26) is missing',
  );

  const { verdict: partial } = await collect(
    baseFixtures({
      jobs: { [String(QUALIFICATION_RUN_ID)]: { total_count: 13, jobs: missing } },
    }),
  );
  expect(partial.refusals.join('\n')).toContain('is incomplete (12/13)');
});

test.each([
  {
    label: 'missing guard',
    jobs: QUALIFICATION_JOBS.filter((entry) => entry.name !== 'sha-guard'),
    findings: ['required CI job instance sha-guard is missing'],
  },
  {
    label: 'duplicate matrix instance replacing another',
    jobs: QUALIFICATION_JOBS.map((entry) =>
      entry.name === 'node-serve-smoke (26)' ? { ...entry, name: 'node-serve-smoke (24)' } : entry,
    ),
    findings: ['node-serve-smoke (26) is missing', 'node-serve-smoke (24) appears 2 times'],
  },
])('evidence-bind: collection and re-read reject a $label', async ({ jobs, findings }) => {
  const { verdict } = await collect(
    baseFixtures({
      jobs: { [String(QUALIFICATION_RUN_ID)]: { total_count: jobs.length, jobs } },
    }),
  );
  expect(verdict.qualified).toBe(false);
  const { document } = await collect(baseFixtures());
  const validJobs = new Map(document.ci.jobs.map((entry) => [entry.id, entry]));
  document.ci.jobs = jobs.map((entry) => ({ ...validJobs.get(entry.id)!, name: entry.name }));
  document.ci.jobListingTotal = jobs.length;
  const rechecked = evaluateDocument(document, SHA);
  expect(rechecked.qualified).toBe(false);
  for (const finding of findings) {
    expect(verdict.refusals.join('\n')).toContain(finding);
    expect(rechecked.refusals.join('\n')).toContain(finding);
  }
});

function splitFixtures(mainPush: RawRun = rawRun({ id: MAIN_PUSH_ID })): EvidenceFixtures {
  const base = baseFixtures();
  return {
    ...base,
    runs: [
      mainPush,
      rawRun({
        id: BASE_DISPATCH_ID,
        event: 'workflow_dispatch',
        created_at: '2026-10-19T12:00:00Z',
      }),
      rawRun({
        id: QUALIFICATION_RUN_ID,
        event: 'workflow_dispatch',
        created_at: '2026-10-19T10:00:00Z',
      }),
    ],
    jobs: {
      ...base.jobs,
      [String(MAIN_PUSH_ID)]: { total_count: BASE_JOBS.length, jobs: BASE_JOBS },
      [String(BASE_DISPATCH_ID)]: { total_count: BASE_JOBS.length, jobs: BASE_JOBS },
    },
  };
}

test('evidence-bind: release evidence pairs Full dispatch and Base main push at the same SHA', async () => {
  const { document, verdict } = await collect(splitFixtures(), { requireMainPush: true });
  expect(verdict.qualified, verdict.refusals.join('\n')).toBe(true);
  expect(document.ci.qualificationRunId).toBe(QUALIFICATION_RUN_ID);
  expect(document.ci.mainPush?.runId).toBe(MAIN_PUSH_ID);
  expect(evaluateDocument(document, SHA).qualified).toBe(true);
  expect(assessEvidence(document, SHA).qualified).toBe(true);
  expect(renderChecklist(document, verdict)).toContain(`Main push [${MAIN_PUSH_ID}]`);
});

test('evidence-bind: a historical Full main push supplies both release proofs', async () => {
  const { document, verdict } = await collect(baseFixtures(), { requireMainPush: true });
  expect(verdict.qualified).toBe(true);
  expect(document.ci.qualificationRunId).toBe(QUALIFICATION_RUN_ID);
  expect(document.ci.mainPush).toBeNull();
  expect(assessEvidence(document, SHA).qualified).toBe(true);
});

test('evidence-bind: release evidence rejects a failed or cross-SHA main push', async () => {
  for (const mainPush of [
    rawRun({ id: MAIN_PUSH_ID, conclusion: 'failure' }),
    rawRun({ id: MAIN_PUSH_ID, head_sha: OTHER_SHA }),
  ]) {
    const { verdict } = await collect(splitFixtures(mainPush), { requireMainPush: true });
    expect(verdict.qualified).toBe(false);
    expect(verdict.refusals.join('\n')).toContain('no successful push/main CI evidence');
  }
});

test('evidence-bind: preflight rejects an otherwise valid PR-only document and tampered main push jobs', async () => {
  const pr = await collect(splitFixtures());
  expect(pr.verdict.qualified).toBe(true);
  expect(assessEvidence(pr.document, SHA).refusals.join('\n')).toContain(
    'no successful push/main CI evidence',
  );

  const { document } = await collect(splitFixtures(), { requireMainPush: true });
  document.ci.mainPush!.jobs = document.ci.mainPush!.jobs.filter(
    (entry) => entry.name !== 'sha-guard',
  );
  expect(evaluateDocument(document, SHA).refusals.join('\n')).toContain(
    'required CI job instance sha-guard is missing',
  );
});

test.each(['failed', 'malformed'] as const)(
  'evidence-bind: a newer %s dispatch blocks older Full release evidence',
  async (kind) => {
    const fixtures = splitFixtures();
    const baseRun = fixtures.runs!.find((run) => run.id === BASE_DISPATCH_ID)!;
    const malformed = BASE_JOBS.filter((entry) => entry.name !== 'sha-guard');
    if (kind === 'failed') baseRun.conclusion = 'failure';
    else
      fixtures.jobs![String(BASE_DISPATCH_ID)] = { total_count: malformed.length, jobs: malformed };
    const finding = kind === 'failed' ? 'concluded failure' : 'sha-guard is missing';

    const pr = await collect(fixtures);
    expect(pr.verdict.qualified).toBe(true);
    const release = await collect(fixtures, { requireMainPush: true });
    expect(release.verdict.qualified).toBe(false);
    expect(release.verdict.refusals.join('\n')).toContain(finding);

    const { document } = await collect(splitFixtures(), { requireMainPush: true });
    if (kind === 'failed') {
      document.ci.runs.find((run) => run.id === BASE_DISPATCH_ID)!.conclusion = 'failure';
    } else {
      const proof = document.ci.skippedBaseRuns!.find((entry) => entry.runId === BASE_DISPATCH_ID)!;
      proof.jobs = proof.jobs.filter((entry) => entry.name !== 'sha-guard');
      proof.jobListingTotal = proof.jobs.length;
    }
    expect(evaluateDocument(document, SHA).refusals.join('\n')).toContain(finding);
  },
);

test.each(['unqueried', 'partial'] as const)(
  'evidence-bind: %s artifact listings fail collection and re-read',
  async (kind) => {
    const fixtures = splitFixtures();
    if (kind === 'unqueried') delete fixtures.artifacts;
    else fixtures.artifacts![String(QUALIFICATION_RUN_ID)] = { total_count: 1, artifacts: [] };
    const { document, verdict } = await collect(fixtures, { requireMainPush: true });
    expect(verdict.qualified).toBe(false);
    const rechecked = evaluateDocument(document, SHA);
    expect(rechecked.qualified).toBe(false);
    expect(rechecked.refusals.join('\n')).toContain('CI artifacts');
  },
);

test('evidence-bind: saved query failures cannot qualify during a re-read', async () => {
  const fixtures = splitFixtures();
  delete fixtures.codeql;
  delete fixtures.tags;
  delete fixtures.releases;
  const { document, verdict } = await collect(fixtures, { requireMainPush: true });
  expect(verdict.qualified).toBe(false);
  const rechecked = evaluateDocument(document, SHA);
  expect(rechecked.qualified).toBe(false);
  expect(rechecked.skips.join('\n')).toContain('fixture-missing: codeql');
  expect(rechecked.skips.join('\n')).toContain('fixture-missing: tags');
  expect(rechecked.skips.join('\n')).toContain('fixture-missing: releases');
});

test('evidence-bind: JSON output is accepted by both CLI readers and their verdict is recomputed', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'openelement-evidence-'));
  const run = (program: string, args: string[]) =>
    spawnSync(process.execPath, [program, ...args], {
      cwd: join(import.meta.dirname, '../..'),
      encoding: 'utf8',
    });
  const binder = 'tools/release/evidence-bind.ts';
  const preflight = 'tools/release/release-preflight.ts';
  try {
    const fixturesPath = join(workdir, 'fixtures.json');
    const outputPath = join(workdir, 'created-by-binder', 'evidence.json');
    await writeFile(fixturesPath, JSON.stringify(splitFixtures()));
    const collected = run(binder, [
      '--fixtures',
      fixturesPath,
      '--sha',
      SHA,
      '--pr',
      '1611',
      '--tag',
      'v1.0.0-alpha.15',
      '--repo',
      'open-element/openelement',
      '--require-main-push',
      '--json',
      '--out',
      outputPath,
    ]);
    expect(collected.status, collected.stderr).toBe(0);
    const output = await readFile(outputPath, 'utf8');
    expect(output).toBe(collected.stdout);
    const envelope = JSON.parse(output);
    expect(envelope.verdict.qualified).toBe(true);

    const check = (path: string) =>
      run(binder, ['--check', path, '--sha', SHA, '--require-main-push', '--json']);
    const assess = (path: string) =>
      run(preflight, ['--evidence', path, '--sha', SHA, '--version', '1.0.0-alpha.15', '--json']);
    const raw = join(workdir, 'raw.json');
    await writeFile(raw, JSON.stringify(envelope.document));
    for (const path of [outputPath, raw]) {
      expect(JSON.parse(check(path).stdout).verdict.qualified).toBe(true);
      expect(JSON.parse(assess(path).stdout).evidence.qualified).toBe(true);
    }

    envelope.document.ci.artifactListingTotal = null;
    await writeFile(outputPath, JSON.stringify(envelope));
    const refusedCheck = check(outputPath);
    const refusedPreflight = assess(outputPath);
    expect(refusedCheck.status).toBe(1);
    expect(refusedPreflight.status).toBe(1);
    expect(JSON.parse(refusedCheck.stdout).verdict.qualified).toBe(false);
    expect(JSON.parse(refusedPreflight.stdout).evidence.qualified).toBe(false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('evidence-bind: an unknown CI job refuses until the contract is updated', async () => {
  const jobs = [...QUALIFICATION_JOBS, job('new-lane')];
  const { verdict } = await collect(
    baseFixtures({ jobs: { [String(QUALIFICATION_RUN_ID)]: { total_count: 14, jobs } } }),
  );
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('new-lane');
});

test('evidence-bind: a CodeQL answer for the wrong ref refuses', async () => {
  const fixtures = baseFixtures({ codeql: { ref: 'refs/heads/main', alerts: [] } });
  const { verdict } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toMatch(/CodeQL answer is for refs\/heads\/main/);
});

test('evidence-bind: open alerts are recorded as notes, never as a silent zero', async () => {
  const { document, verdict } = await collect(baseFixtures());
  expect(verdict.notes.join('\n')).toContain('#4238 (medium, js/bad-code-sanitization)');
  expect(verdict.notes.join('\n')).toContain('#4241 (warning, js/trivial-conditional)');
  const snippet = renderChecklist(document, verdict);
  expect(snippet).toContain('bad-code-sanitization');
  expect(snippet).toContain('disposition for each is required (REL-02)');
});

test('evidence-bind: a tag pointing at another SHA refuses', async () => {
  const fixtures = baseFixtures({ tags: { 'v1.0.0-alpha.15': OTHER_SHA } });
  const { verdict } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('points at');
});

test('evidence-bind: an unqueried dimension is a loud skip, never a silent pass', async () => {
  const fixtures = baseFixtures();
  delete fixtures.distTags;
  const { verdict, document } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.skips.join('\n')).toMatch(/fixture-missing: distTags/);
  expect(renderChecklist(document, verdict)).toContain('SKIP (not evidence of passing)');
});

test('evidence-bind: offline dist-tags skip loudly and cannot qualify', async () => {
  const fixtures = baseFixtures({
    distTags: { '@openelement/router': { error: 'ENOTFOUND registry.npmjs.org' } },
  });
  const { verdict } = await collect(fixtures);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.skips.join('\n')).toContain('offline');
});

test('evidence-bind: check mode refuses a recorded cancelled run as qualification', async () => {
  const { document } = await collect(baseFixtures());
  const doctored = { ...document, ci: { ...document.ci, qualificationRunId: CANCELLED_RUN_ID } };
  const verdict = evaluateDocument(doctored, SHA);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('cancelled');
});

test('evidence-bind: check mode refuses a SHA mismatch against the expected candidate', async () => {
  const { document } = await collect(baseFixtures());
  const verdict = evaluateDocument(document, OTHER_SHA);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('not the expected candidate');
});

test('evidence-bind: check mode refuses a job instance that turned non-success', async () => {
  const { document } = await collect(baseFixtures());
  const doctored = {
    ...document,
    ci: {
      ...document.ci,
      jobs: document.ci.jobs.map((entry) =>
        entry.name === 'test' ? { ...entry, conclusion: 'timed_out' } : entry,
      ),
    },
  };
  const verdict = evaluateDocument(doctored, SHA);
  expect(verdict.qualified).toEqual(false);
  expect(verdict.refusals.join('\n')).toContain('required CI job test concluded timed_out');
});

test('evidence-bind: the checklist carries every required job ID and instance count', async () => {
  const { document, verdict } = await collect(baseFixtures());
  const snippet = renderChecklist(document, verdict);
  const required: [string, string][] = [
    ['lint', '1/1'],
    ['test', '1/1'],
    ['e2e', '1/1'],
    ['pack', '1/1'],
    ['e2e-full', '2/2'],
    ['bfcache', '1/1'],
    ['node-serve-smoke', '2/2'],
    ['packed-consumer-matrix', '2/2'],
    ['fresh-install', '1/1'],
  ];
  for (const [id, count] of required) {
    const expected = '\u0060' + id + '\u0060 (' + count + ')';
    expect(snippet).toContain(expected);
  }
  expect(snippet).toContain('none (listing total: 0)');
});

test('evidence-bind: job instance labels are split from the base job ID', () => {
  expect(jobBaseId('e2e-full (site-e2e)')).toEqual('e2e-full');
  expect(jobBaseId('node-serve-smoke (24)')).toEqual('node-serve-smoke');
  expect(jobBaseId('lint')).toEqual('lint');
});

test('evidence-bind: argument parsing accepts the evidence flags and rejects unknown ones', () => {
  const parsed = parseArgs(['--sha', SHA, '--pr', '1611', '--fixtures', '/tmp/f.json', '--json']);
  expect(parsed.sha).toEqual(SHA);
  expect(parsed.pullRequest).toEqual(1611);
  expect(parsed.fixtures).toEqual('/tmp/f.json');
  expect(parsed.json).toEqual(true);
  expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
});
