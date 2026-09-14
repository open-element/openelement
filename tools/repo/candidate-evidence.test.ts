/**
 * candidate-evidence adversarial tests.
 *
 * The validator is the release trust boundary: it must reject evidence that
 * omits or forges step metadata, pairs a required step name with a different
 * command, or carries a self-consistent but false fresh-clone sidecar. Every
 * forgery reproduced against the pre-fix validator is a checked-in regression
 * here, and a fully valid bundle must still pass.
 */
import { assert, assertEquals } from '@std/assert';
import {
  collectBundleFailures,
  collectJobFailures,
  collectRollupFailures,
  packedRollupFromLog,
  REQUIRED_PACKAGE_TARBALLS,
  REQUIRED_PACKED_CONSUMERS,
  REQUIRED_SITE_BROWSERS,
  REQUIRED_STEPS,
} from './candidate-evidence.ts';
import { FRESH_CLONE_ISOLATION, freshCloneCommands, JOB_NAMES } from './candidate-steps.ts';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const CLONE_DIR = '/tmp/oe-fresh-clone';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function freshCommands(name: string): string[] {
  switch (name) {
    case 'clone':
      return freshCloneCommands.clone('/repo', CLONE_DIR);
    case 'git-checkout':
      return freshCloneCommands.checkout(CLONE_DIR, SHA);
    case 'install':
      return freshCloneCommands.install('deno');
    case 'task-check':
      return freshCloneCommands.check('deno');
    case 'task-gate-source':
      return freshCloneCommands.gateSource('deno');
    case 'task-release-check':
      return freshCloneCommands.releaseCheck('deno');
    default:
      throw new Error(`no fresh command for ${name}`);
  }
}

function staticCommands(job: string, name: string): string[] {
  const table: Record<string, Record<string, string[]>> = {
    'fast-checks': {
      'fmt-check': ['deno', 'fmt', '--check'],
      lint: ['deno', 'lint'],
      markdown: ['deno', 'task', '--cwd', 'tools/repo', 'lint:markdown'],
      typecheck: ['deno', 'task', 'typecheck'],
    },
    'source-matrix': {
      'gate-source': ['deno', 'task', '--cwd', 'tools/repo', 'gate:source'],
    },
    packed: {
      'gate-packed': ['deno', 'task', '--cwd', 'tools/release', 'gate:packed'],
      'publish-npm-dry-run': ['deno', 'task', '--cwd', 'tools/release', 'publish:npm:dry-run'],
    },
  };
  const command = table[job]?.[name];
  if (!command) throw new Error(`no static command for ${job}/${name}`);
  return [...command];
}

interface RawStep {
  name: string;
  command: unknown;
  startedAt: unknown;
  durationMs: unknown;
  result: unknown;
  exitCode: unknown;
  logPath: string;
  logSha256: string;
}

interface Fixture {
  logs: Record<string, string>;
  manifests: Record<string, string>;
  jobs: Array<{ job: Record<string, unknown>; read: (path: string) => Promise<Uint8Array | null> }>;
  bundle: Record<string, unknown>;
  bundleRead: (path: string) => Promise<Uint8Array | null>;
}

async function fixture(): Promise<Fixture> {
  const logs: Record<string, string> = {};
  const manifests: Record<string, string> = {
    'tarball-manifest.json': '{}\n',
    'pack-diagnostics.json': '[]\n',
  };
  const jobs: Fixture['jobs'] = [];
  const bundleJobs: Array<Record<string, unknown>> = [];
  const generatedAt = new Date().toISOString();
  const baseTime = Date.parse(generatedAt) - 60_000;
  let tick = 0;
  for (const job of JOB_NAMES) {
    const rawSteps: RawStep[] = [];
    const bundleSteps: Array<Record<string, unknown>> = [];
    for (const name of REQUIRED_STEPS[job]) {
      const command = job === 'fresh-clone' ? freshCommands(name) : staticCommands(job, name);
      const key = `${job}/${name}`;
      logs[key] = `${key} ok\n`;
      const hash = await sha256(logs[key]);
      const startedAt = new Date(baseTime + (tick++) * 1000).toISOString();
      rawSteps.push({
        name,
        command,
        startedAt,
        durationMs: 5,
        result: 'PASS',
        exitCode: 0,
        logPath: `logs/${name}.log`,
        logSha256: hash,
      });
      bundleSteps.push({
        name,
        command,
        startedAt,
        durationMs: 5,
        result: 'PASS',
        exitCode: 0,
        logSource: `ci/${job}/logs/${name}.log`,
        logSha256: hash,
      });
    }
    const extras = job === 'fresh-clone' ? { isolation: FRESH_CLONE_ISOLATION } : {};
    jobs.push({
      job: {
        schemaVersion: 1,
        job,
        sha: SHA,
        tree: TREE,
        trackedClean: true,
        result: 'PASS',
        steps: rawSteps,
        toolVersions: {},
        extras,
        generatedAt,
      },
      read: (path) => {
        const value = logs[`${job}/${path.replace(/^logs\//u, '').replace(/\.log$/u, '')}`];
        return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
      },
    });
    bundleJobs.push({ job, result: 'PASS', generatedAt, extras, steps: bundleSteps });
  }
  const bundle: Record<string, unknown> = {
    schemaVersion: 1,
    sha: SHA,
    tree: TREE,
    trackedClean: true,
    jobs: bundleJobs,
    tarballs: Object.fromEntries(
      REQUIRED_PACKAGE_TARBALLS.map((name, index) => [name, `sha256:${String(index).repeat(64)}`]),
    ),
    tarballManifest: {
      path: 'tarball-manifest.json',
      sha256: await sha256(manifests['tarball-manifest.json']),
    },
    packDiagnostics: {
      path: 'pack-diagnostics.json',
      sha256: await sha256(manifests['pack-diagnostics.json']),
    },
    rollup: {
      artifactCheck: true,
      consumers: [...REQUIRED_PACKED_CONSUMERS],
      siteE2e: {
        ran: true,
        passed: 3 * REQUIRED_SITE_BROWSERS.length,
        failed: 0,
        skipped: 0,
        projects: Object.fromEntries(
          REQUIRED_SITE_BROWSERS.map((browser) => [browser, { passed: 3, failed: 0, skipped: 0 }]),
        ),
      },
    },
    requiredOk: true,
    generatedAt,
  };
  const bundleRead = (path: string) => {
    const match = /^ci\/([^/]+)\/logs\/(.+)\.log$/u.exec(path);
    if (match) {
      const value = logs[`${match[1]}/${match[2]}`];
      return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
    }
    const manifest = manifests[path];
    return Promise.resolve(manifest === undefined ? null : new TextEncoder().encode(manifest));
  };
  return { logs, manifests, jobs, bundle, bundleRead };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneJobs(jobs: Fixture['jobs']): Fixture['jobs'] {
  return jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));
}

function bundleJob(bundle: Record<string, unknown>, name: string): Record<string, unknown> {
  const job = (bundle.jobs as Array<Record<string, unknown>>).find((entry) => entry.job === name);
  if (!job) throw new Error(`bundle job ${name} missing`);
  return job;
}

async function bundleFailures(bundle: Record<string, unknown>, fixtureValue: Fixture) {
  return await collectBundleFailures(bundle, {
    expectedSha: SHA,
    expectedTree: TREE,
    read: fixtureValue.bundleRead,
  });
}

Deno.test('valid bundle and job evidence pass the strict contract', async () => {
  const f = await fixture();
  assertEquals(await bundleFailures(f.bundle, f), []);
  assertEquals(await collectJobFailures(f.jobs as never, SHA, TREE), []);
});

Deno.test('missing step metadata is rejected (the pre-fix fail-open case)', async () => {
  const f = await fixture();
  const bundle = clone(f.bundle);
  for (const job of bundle.jobs as Array<Record<string, unknown>>) {
    for (const step of job.steps as Array<Record<string, unknown>>) {
      delete step.command;
      delete step.startedAt;
      delete step.durationMs;
      delete step.exitCode;
    }
  }
  const failures = await bundleFailures(bundle, f);
  assert(failures.some((failure) => failure.includes('command (argv) must be an array')));
  assert(failures.some((failure) => failure.includes('startedAt must be an ISO-8601 timestamp')));
  assert(
    failures.some((failure) => failure.includes('durationMs must be a non-negative safe integer')),
  );
  assert(failures.some((failure) => failure.includes('exitCode must be the integer 0')));
});

Deno.test('required step names are bound to their canonical argv', async () => {
  const f = await fixture();
  for (
    const wrong of [
      ['deno', 'task', 'check'],
      ['deno', 'task', 'wrong-task'],
      [],
      [''],
      'deno task check',
    ]
  ) {
    const bundle = clone(f.bundle);
    for (const step of bundleJob(bundle, 'fresh-clone').steps as Array<Record<string, unknown>>) {
      if (['task-gate-source', 'task-release-check'].includes(step.name as string)) {
        step.command = wrong;
      }
    }
    const failures = await bundleFailures(bundle, f);
    assert(
      failures.length > 0,
      `expected rejection for forged command ${JSON.stringify(wrong)}`,
    );
  }
});

Deno.test('fresh-clone isolation must match the canonical disclosure', async () => {
  const f = await fixture();
  for (
    const isolation of [
      undefined,
      {},
      { ...FRESH_CLONE_ISOLATION, denoDir: 'reused from workspace' },
      { ...FRESH_CLONE_ISOLATION, extra: 'field' },
    ]
  ) {
    const bundle = clone(f.bundle);
    const fresh = bundleJob(bundle, 'fresh-clone');
    if (isolation === undefined) delete fresh.extras;
    else fresh.extras = { isolation };
    assert((await bundleFailures(bundle, f)).length > 0, 'expected isolation rejection');
  }
});

Deno.test('invalid timestamps, durations, and exit codes are rejected', async () => {
  const f = await fixture();
  const cases: Array<[string, unknown, string]> = [
    ['startedAt', 'not-a-date', 'startedAt'],
    ['startedAt', '', 'startedAt'],
    ['durationMs', Number.NaN, 'durationMs'],
    ['durationMs', Number.POSITIVE_INFINITY, 'durationMs'],
    ['durationMs', -1, 'durationMs'],
    ['durationMs', 0.5, 'durationMs'],
    ['durationMs', '1', 'durationMs'],
    ['exitCode', undefined, 'exitCode'],
    ['exitCode', '0', 'exitCode'],
    ['exitCode', 1, 'exitCode'],
    ['exitCode', 0.5, 'exitCode'],
  ];
  for (const [field, value, label] of cases) {
    const bundle = clone(f.bundle);
    const step = (bundleJob(bundle, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
    if (value === undefined) delete step[field];
    else step[field] = value;
    const failures = await bundleFailures(bundle, f);
    assert(
      failures.some((failure) => failure.includes(label)),
      `expected rejection for ${field}=${String(value)}`,
    );
  }
});

Deno.test('timestamp ordering and bounds are enforced', async () => {
  const f = await fixture();
  const future = clone(f.bundle);
  const futureStep = (bundleJob(future, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
  futureStep.startedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert(
    (await bundleFailures(future, f)).some((x) => x.includes('after the evidence generatedAt')),
  );

  const reordered = clone(f.bundle);
  const steps = bundleJob(reordered, 'fast-checks').steps as Array<Record<string, unknown>>;
  steps[0].startedAt = new Date(Date.now() + 60_000).toISOString();
  assert((await bundleFailures(reordered, f)).some((x) => x.includes('out of order')));
});

Deno.test('unknown, duplicate, and missing steps are rejected', async () => {
  const f = await fixture();
  const unknown = clone(f.bundle);
  (bundleJob(unknown, 'fast-checks').steps as Array<Record<string, unknown>>).push({
    ...(bundleJob(unknown, 'fast-checks').steps as Array<Record<string, unknown>>)[0],
    name: 'extra-step',
  });
  assert((await bundleFailures(unknown, f)).some((x) => x.includes('unknown step')));

  const duplicate = clone(f.bundle);
  const duplicateSteps = bundleJob(duplicate, 'fast-checks').steps as Array<
    Record<string, unknown>
  >;
  duplicateSteps.push(clone(duplicateSteps[0]));
  assert((await bundleFailures(duplicate, f)).some((x) => x.includes('duplicate step')));

  const missing = clone(f.bundle);
  bundleJob(missing, 'fast-checks').steps =
    (bundleJob(missing, 'fast-checks').steps as Array<Record<string, unknown>>).filter(
      (step) => step.name !== 'lint',
    );
  assert((await bundleFailures(missing, f)).some((x) => x.includes('required step missing: lint')));
});

Deno.test('missing, duplicate, and unknown jobs are rejected', async () => {
  const f = await fixture();
  const missing = clone(f.bundle);
  missing.jobs = (missing.jobs as Array<Record<string, unknown>>).filter(
    (job) => job.job !== 'packed',
  );
  assert(
    (await bundleFailures(missing, f)).some((x) =>
      x.includes('required job result missing: packed')
    ),
  );

  const duplicate = clone(f.bundle);
  const jobs = duplicate.jobs as Array<Record<string, unknown>>;
  jobs.push(clone(jobs[0]));
  assert((await bundleFailures(duplicate, f)).some((x) => x.includes('duplicate job result')));

  const unknown = clone(f.bundle);
  (unknown.jobs as Array<Record<string, unknown>>).push({
    ...clone((unknown.jobs as Array<Record<string, unknown>>)[0]),
    job: 'unknown-job',
  });
  assert((await bundleFailures(unknown, f)).some((x) => x.includes('unknown job result')));
});

Deno.test('SHA, tree, age, and requiredOk invariants are enforced', async () => {
  const f = await fixture();
  for (
    const [label, mutate] of [
      ['evidence sha', (b: Record<string, unknown>) => {
        b.sha = 'c'.repeat(40);
      }],
      ['evidence tree', (b: Record<string, unknown>) => {
        b.tree = 'd'.repeat(40);
      }],
      ['generatedAt', (b: Record<string, unknown>) => {
        b.generatedAt = 'not-a-date';
      }],
      ['requiredOk', (b: Record<string, unknown>) => {
        b.requiredOk = false;
      }],
    ] as const
  ) {
    const bundle = clone(f.bundle);
    mutate(bundle);
    assert(
      (await bundleFailures(bundle, f)).some((failure) => failure.includes(label)),
      `expected rejection for ${label}`,
    );
  }
  const stale = clone(f.bundle);
  assert(
    (await collectBundleFailures(stale, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: f.bundleRead,
      now: Date.now() + 20 * 24 * 60 * 60 * 1000,
    })).some((failure) => failure.includes('retention window')),
  );
});

Deno.test('log path traversal, wrong prefix, missing logs, and hash mismatch are rejected', async () => {
  const f = await fixture();
  for (
    const badPath of [
      '../secrets.log',
      '/etc/passwd.log',
      'ci/fast-checks/other/x.log',
      'logs/x.log',
    ]
  ) {
    const bundle = clone(f.bundle);
    const step = (bundleJob(bundle, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
    step.logSource = badPath;
    assert((await bundleFailures(bundle, f)).length > 0, `expected rejection for ${badPath}`);
  }
  const missing = clone(f.bundle);
  const missingStep =
    (bundleJob(missing, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
  missingStep.logSource = 'ci/fast-checks/logs/does-not-exist.log';
  assert((await bundleFailures(missing, f)).some((x) => x.includes('log missing')));

  const tampered = clone(f.bundle);
  const tamperedStep =
    (bundleJob(tampered, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
  tamperedStep.logSha256 = `sha256:${'0'.repeat(64)}`;
  assert((await bundleFailures(tampered, f)).some((x) => x.includes('log hash mismatch')));

  const malformed = clone(f.bundle);
  const malformedStep =
    (bundleJob(malformed, 'fast-checks').steps as Array<Record<string, unknown>>)[0];
  malformedStep.logSha256 = 'sha256:XYZ';
  assert((await bundleFailures(malformed, f)).some((x) => x.includes('sha256:<64 lowercase hex>')));
});

Deno.test('tarball keys, hashes, and manifest references are strict', async () => {
  const f = await fixture();
  const missing = clone(f.bundle);
  delete (missing.tarballs as Record<string, string>)['@openelement/router'];
  assert((await bundleFailures(missing, f)).some((x) => x.includes('must contain exactly')));

  const extra = clone(f.bundle);
  (extra.tarballs as Record<string, string>)['@evil/fake'] = `sha256:${'f'.repeat(64)}`;
  assert((await bundleFailures(extra, f)).some((x) => x.includes('must contain exactly')));

  const badHash = clone(f.bundle);
  (badHash.tarballs as Record<string, string>)['@openelement/ui'] = 'sha256:bad';
  assert((await bundleFailures(badHash, f)).some((x) => x.includes('missing or malformed sha256')));

  const badManifest = clone(f.bundle);
  badManifest.tarballManifest = {
    path: 'tarball-manifest.json',
    sha256: `sha256:${'0'.repeat(64)}`,
  };
  assert(
    (await bundleFailures(badManifest, f)).some((x) => x.includes('tarballManifest hash mismatch')),
  );

  const missingManifest = clone(f.bundle);
  missingManifest.packDiagnostics = {
    path: 'pack-diagnostics.json',
    sha256: `sha256:${'0'.repeat(64)}`,
  };
  assert((await bundleFailures(missingManifest, f)).some((x) => x.includes('packDiagnostics')));
});

Deno.test('rollup requires the exact consumer set and a green three-browser Site proof', async () => {
  const f = await fixture();
  const noConsumer = clone(f.bundle);
  (noConsumer.rollup as { consumers: string[] }).consumers = ['one'];
  assert((await bundleFailures(noConsumer, f)).some((x) => x.includes('packed consumer missing')));

  const allSkipped = clone(f.bundle);
  const site = (allSkipped.rollup as { siteE2e: Record<string, unknown> }).siteE2e;
  site.passed = 0;
  site.skipped = 3 * REQUIRED_SITE_BROWSERS.length;
  site.projects = Object.fromEntries(
    REQUIRED_SITE_BROWSERS.map((browser) => [browser, { passed: 0, failed: 0, skipped: 3 }]),
  );
  const skippedFailures = await bundleFailures(allSkipped, f);
  assert(skippedFailures.some((x) => x.includes('skipped=3')));
  assert(skippedFailures.some((x) => x.includes('passed=0')));

  const totalsMismatch = clone(f.bundle);
  (totalsMismatch.rollup as { siteE2e: { passed: number } }).siteE2e.passed += 1;
  assert((await bundleFailures(totalsMismatch, f)).some((x) => x.includes('total passed=')));
});

Deno.test('collectRollupFailures reports missing artifact scan and consumers', () => {
  assert(collectRollupFailures(undefined).length === 1);
  const failures = collectRollupFailures({ artifactCheck: false, consumers: [] });
  assert(failures.some((x) => x.includes('artifact scan did not run')));
  assert(failures.some((x) => x.includes('packed consumer missing')));
});

Deno.test('packedRollupFromLog derives the artifact scan and consumers from the gate log', () => {
  const healthy = [
    'PASS tools/release#package-artifacts:check (13.7s)',
    ...REQUIRED_PACKED_CONSUMERS.map((consumer) => `PASS ${consumer} (40.8s)`),
  ].join('\n');
  const parsed = packedRollupFromLog(healthy);
  assertEquals(parsed.artifactCheck, true);
  assertEquals(parsed.consumers.length, REQUIRED_PACKED_CONSUMERS.length);
  assertEquals(packedRollupFromLog('PASS tools/release#pack:dry-run').artifactCheck, false);
});

Deno.test('collectJobFailures rejects old-style and wrong-command fresh clones', async () => {
  const f = await fixture();
  const oldStyle = cloneJobs(f.jobs);
  const fresh = oldStyle.find((entry) =>
    (entry.job as Record<string, unknown>).job === 'fresh-clone'
  )!;
  (fresh.job as { steps: Array<{ name: string }> }).steps =
    (fresh.job as { steps: Array<{ name: string }> }).steps.filter((step) =>
      ['clone', 'git-checkout', 'install', 'task-check'].includes(step.name)
    );
  const failures = await collectJobFailures(oldStyle as never, SHA, TREE);
  assert(failures.some((x) => x.includes('required step missing: task-gate-source')));
  assert(failures.some((x) => x.includes('required step missing: task-release-check')));

  const wrongCommand = cloneJobs(f.jobs);
  const wrongFresh = wrongCommand.find((entry) =>
    (entry.job as Record<string, unknown>).job === 'fresh-clone'
  )!;
  for (
    const step of (wrongFresh.job as { steps: Array<{ name: string; command: string[] }> }).steps
  ) {
    if (step.name === 'task-gate-source') step.command = ['deno', 'task', 'check'];
  }
  assert(
    (await collectJobFailures(wrongCommand as never, SHA, TREE)).some((x) =>
      x.includes('task-gate-source')
    ),
  );
});
