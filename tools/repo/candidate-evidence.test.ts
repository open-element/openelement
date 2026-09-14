/**
 * candidate-evidence unit tests: the aggregation/validation core must not
 * trust the artifact and must require the exact candidate proof set. Every
 * check recomputes hashes from real bytes and fails on a missing job, step,
 * consumer, browser, tarball key, manifest, or on mismatched SHA/tree/age.
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

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

type JobEntry = Parameters<typeof collectJobFailures>[0][number];

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validRollup() {
  return {
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
  };
}

interface Fixture {
  logs: Record<string, string>;
  jobs: JobEntry[];
  bundle: {
    sha: string;
    tree: string;
    generatedAt: string;
    jobs: Array<{
      job: string;
      result: string;
      steps: Array<{
        name: string;
        result: string;
        exitCode: number;
        logSource: string;
        logSha256: string;
      }>;
    }>;
    tarballs: Record<string, string>;
    tarballManifest: { path: string; sha256: string };
    packDiagnostics: { path: string; sha256: string };
    freshClone: { path: string; sha256: string };
    rollup: ReturnType<typeof validRollup>;
  };
  read: (path: string) => Promise<Uint8Array | null>;
}

async function fixture(): Promise<Fixture> {
  const logs: Record<string, string> = {};
  const jobs: JobEntry[] = [];
  const bundleJobs: Fixture['bundle']['jobs'] = [];
  for (const [jobName, steps] of Object.entries(REQUIRED_STEPS)) {
    const jobSteps = [];
    const bundleSteps = [];
    for (const name of steps) {
      const key = `${jobName}/${name}`;
      logs[key] = `${key} ok\n`;
      const hash = await sha256(logs[key]);
      jobSteps.push({
        name,
        command: ['deno'],
        startedAt: new Date().toISOString(),
        durationMs: 1,
        exitCode: 0,
        result: 'PASS' as const,
        logPath: `${name}.log`,
        logSha256: hash,
      });
      bundleSteps.push({
        name,
        result: 'PASS',
        exitCode: 0,
        logSource: `ci/${jobName}/${name}.log`,
        logSha256: hash,
        logPath: key,
      });
    }
    jobs.push({
      job: {
        schemaVersion: 1,
        job: jobName as JobEntry['job']['job'],
        sha: SHA,
        tree: TREE,
        trackedClean: true,
        result: 'PASS',
        steps: jobSteps,
        toolVersions: {},
        generatedAt: new Date().toISOString(),
      },
      read: (path) => {
        const key = `${jobName}/${path.replace(/\.log$/u, '')}`;
        const value = logs[key];
        return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
      },
    });
    bundleJobs.push({ job: jobName, result: 'PASS', steps: bundleSteps });
  }
  const manifests: Record<string, string> = {
    'tarball-manifest.json': '{}\n',
    'pack-diagnostics.json': '[]\n',
    'fresh-clone-manifest.json': '{}\n',
  };
  const bundle = {
    sha: SHA,
    tree: TREE,
    generatedAt: new Date().toISOString(),
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
    freshClone: {
      path: 'fresh-clone-manifest.json',
      sha256: await sha256(manifests['fresh-clone-manifest.json']),
    },
    rollup: validRollup(),
  };
  const read = (path: string) => {
    const match = /^ci\/([^/]+)\/(.+)\.log$/u.exec(path);
    if (match) {
      const value = logs[`${match[1]}/${match[2]}`];
      return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
    }
    if (path in logs) return Promise.resolve(new TextEncoder().encode(logs[path]));
    if (path in manifests) return Promise.resolve(new TextEncoder().encode(manifests[path]));
    return Promise.resolve(null);
  };
  return { logs, jobs, bundle, read };
}

Deno.test('collectJobFailures accepts the exact required job/step set', async () => {
  const { jobs } = await fixture();
  assertEquals(await collectJobFailures(jobs, SHA, TREE), []);
});

Deno.test('collectJobFailures rejects a missing job, duplicate job, and wrong SHA/tree', async () => {
  const { jobs } = await fixture();
  assert(
    (await collectJobFailures(jobs.slice(1), SHA, TREE)).some((f) =>
      f.includes('required job result missing')
    ),
  );
  assert(
    (await collectJobFailures([...jobs, jobs[0]], SHA, TREE)).some((f) =>
      f.includes('duplicate job result')
    ),
  );
  assert(
    (await collectJobFailures(jobs, 'c'.repeat(40), TREE)).some((f) => f.includes('sha')),
  );
  assert(
    (await collectJobFailures(jobs, SHA, 'd'.repeat(40))).some((f) => f.includes('tree')),
  );
});

Deno.test('collectJobFailures rejects a missing or failed required step', async () => {
  const { jobs } = await fixture();
  const cloneJobs = () =>
    jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));
  const tampered = cloneJobs();
  tampered[0].job.steps = tampered[0].job.steps.filter((step) => step.name !== 'lint');
  assert(
    (await collectJobFailures(tampered, SHA, TREE)).some((f) =>
      f.includes('required step missing: lint')
    ),
  );
  const failed = cloneJobs();
  failed[2].job.steps[0].result = 'FAIL';
  failed[2].job.steps[0].exitCode = 1;
  assert(
    (await collectJobFailures(failed, SHA, TREE)).some((f) => f.includes('packed/gate-packed')),
  );
});

Deno.test('collectRollupFailures requires the full consumer and browser set', () => {
  assertEquals(collectRollupFailures(validRollup()), []);
  // The prior fail-open behavior accepted one consumer and no browsers.
  assert(
    collectRollupFailures({
      artifactCheck: true,
      consumers: ['one'],
      siteE2e: { ran: true, projects: {}, failed: 0 },
    }).some((f) => f.includes('packed consumer missing')),
  );
  assert(
    collectRollupFailures({
      artifactCheck: true,
      consumers: [...REQUIRED_PACKED_CONSUMERS],
      siteE2e: { ran: true, failed: 0, projects: {} },
    }).some((f) => f.includes('Site E2E missing browser proof: chromium')),
  );
  const firefoxFailed = validRollup();
  firefoxFailed.siteE2e.projects.firefox.failed = 2;
  firefoxFailed.siteE2e.failed = 2;
  const failures = collectRollupFailures(firefoxFailed);
  assert(failures.some((f) => f.includes('Site E2E firefox failed=2')));
  assert(collectRollupFailures(undefined).length === 1);
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
  assertEquals(packedRollupFromLog('PASS tools/release#pack:dry-run').consumers, []);
});

Deno.test('collectBundleFailures accepts the exact proof set', async () => {
  const { bundle, read } = await fixture();
  assertEquals(
    await collectBundleFailures(bundle, { expectedSha: SHA, expectedTree: TREE, read }),
    [],
  );
});

Deno.test('collectBundleFailures rejects a minimal fake bundle', async () => {
  const read = () => Promise.resolve(null);
  const failures = await collectBundleFailures(
    {
      sha: SHA,
      tree: TREE,
      generatedAt: new Date().toISOString(),
      jobs: [],
      tarballs: { a: 'x', b: 'x', c: 'x', d: 'x' },
      rollup: {
        artifactCheck: false,
        consumers: ['one'],
        siteE2e: { ran: true, failed: 0, projects: {} },
      },
    },
    { expectedTree: TREE, read },
  );
  assert(failures.some((f) => f.includes('required job result missing')));
  assert(failures.some((f) => f.includes('tarball manifest must contain exactly')));
  assert(failures.some((f) => f.includes('packed consumer missing')));
  assert(failures.some((f) => f.includes('Site E2E missing browser proof')));
});

Deno.test('collectBundleFailures rejects tampering with jobs, steps, tarballs, manifests, SHA/tree/age', async () => {
  const base = await fixture();
  const cases: Array<[string, (b: Fixture['bundle']) => void, (f: string[]) => boolean]> = [
    ['missing job', (b) => {
      b.jobs = b.jobs.slice(1);
    }, (f) => f.some((x) => x.includes('required job result missing'))],
    ['missing step', (b) => {
      b.jobs[1].steps = b.jobs[1].steps.filter((s) => s.name !== 'gate-source');
    }, (f) => f.some((x) => x.includes('required step missing: gate-source'))],
    ['step fail', (b) => {
      b.jobs[2].steps[0].result = 'FAIL';
    }, (f) => f.some((x) => x.includes('packed/gate-packed'))],
    ['tarball key', (b) => {
      delete (b.tarballs as Record<string, string>)['@openelement/router'];
    }, (f) => f.some((x) => x.includes('tarball manifest must contain exactly'))],
    ['tarball hash', (b) => {
      b.tarballs['@openelement/ui'] = 'sha256:bad';
    }, (f) => f.some((x) => x.includes('missing or malformed sha256'))],
    ['consumer', (b) => {
      b.rollup.consumers = b.rollup.consumers.slice(1);
    }, (f) => f.some((x) => x.includes('packed consumer missing'))],
    ['site e2e', (b) => {
      b.rollup.siteE2e.ran = false;
    }, (f) => f.some((x) => x.includes('Site E2E did not run'))],
    ['chromium', (b) => {
      delete b.rollup.siteE2e.projects.chromium;
    }, (f) => f.some((x) => x.includes('missing browser proof: chromium'))],
    ['firefox', (b) => {
      delete b.rollup.siteE2e.projects.firefox;
    }, (f) => f.some((x) => x.includes('missing browser proof: firefox'))],
    ['webkit', (b) => {
      delete b.rollup.siteE2e.projects.webkit;
    }, (f) => f.some((x) => x.includes('missing browser proof: webkit'))],
    ['sha', (b) => {
      b.sha = 'c'.repeat(40);
    }, (f) => f.some((x) => x.includes('evidence sha'))],
    ['tree', (b) => {
      b.tree = 'd'.repeat(40);
    }, (f) => f.some((x) => x.includes('evidence tree'))],
    ['generatedAt', (b) => {
      b.generatedAt = 'not-a-date';
    }, (f) => f.some((x) => x.includes('generatedAt'))],
  ];
  for (const [label, mutate, expect] of cases) {
    const bundle = structuredClone(base.bundle);
    mutate(bundle);
    const failures = await collectBundleFailures(bundle, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: base.read,
    });
    assert(failures.length > 0 && expect(failures), `expected failure for ${label}`);
  }
});

Deno.test('collectBundleFailures rejects a stale bundle and manifest/hash tampering', async () => {
  const base = await fixture();
  const stale = structuredClone(base.bundle);
  assert(
    (await collectBundleFailures(stale, {
      expectedTree: TREE,
      read: base.read,
      now: Date.now() + 20 * 24 * 60 * 60 * 1000,
    })).some((f) => f.includes('retention window')),
  );
  assert(
    (await collectBundleFailures(base.bundle, {
      expectedTree: TREE,
      read: (path) =>
        path === 'tarball-manifest.json'
          ? Promise.resolve(new TextEncoder().encode('tampered'))
          : base.read(path),
    })).some((f) => f.includes('manifest hash mismatch')),
  );
  assert(
    (await collectBundleFailures(base.bundle, {
      expectedTree: TREE,
      read: (path) =>
        path === 'fresh-clone-manifest.json' ? Promise.resolve(null) : base.read(path),
    })).some((f) => f.includes('manifest missing')),
  );
});

Deno.test('collectJobFailures rejects an old-style fresh clone that skips source/release gates', async () => {
  const { jobs } = await fixture();
  const cloneJobs = () =>
    jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));
  const oldStyle = cloneJobs();
  const fresh = oldStyle.find((entry) => entry.job.job === 'fresh-clone');
  if (!fresh) throw new Error('fresh-clone fixture missing');
  fresh.job.steps = fresh.job.steps.filter((step) =>
    ['clone', 'git-checkout', 'install', 'task-check'].includes(step.name)
  );
  const failures = await collectJobFailures(oldStyle, SHA, TREE);
  assert(failures.some((f) => f.includes('required step missing: task-gate-source')));
  assert(failures.some((f) => f.includes('required step missing: task-release-check')));
});

Deno.test('collectJobFailures requires each specific fresh-clone gate step once', async () => {
  const { jobs } = await fixture();
  const cloneJobs = () =>
    jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));
  for (const missing of ['task-gate-source', 'task-release-check']) {
    const mutated = cloneJobs();
    const fresh = mutated.find((entry) => entry.job.job === 'fresh-clone');
    if (!fresh) throw new Error('fresh-clone fixture missing');
    fresh.job.steps = fresh.job.steps.filter((step) => step.name !== missing);
    assert(
      (await collectJobFailures(mutated, SHA, TREE)).some((f) =>
        f.includes(`required step missing: ${missing}`)
      ),
      `expected rejection when ${missing} is missing`,
    );
  }
  const duplicated = cloneJobs();
  const fresh = duplicated.find((entry) => entry.job.job === 'fresh-clone');
  if (!fresh) throw new Error('fresh-clone fixture missing');
  fresh.job.steps.push(structuredClone(fresh.job.steps[0]));
  assert(
    (await collectJobFailures(duplicated, SHA, TREE)).some((f) =>
      f.includes('required step duplicated')
    ),
  );
});

Deno.test('collectJobFailures rejects a non-zero fresh-clone gate step', async () => {
  const { jobs } = await fixture();
  const mutated = jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));
  const fresh = mutated.find((entry) => entry.job.job === 'fresh-clone');
  if (!fresh) throw new Error('fresh-clone fixture missing');
  const step = fresh.job.steps.find((candidate) => candidate.name === 'task-release-check');
  if (!step) throw new Error('task-release-check step missing');
  step.result = 'FAIL';
  step.exitCode = 1;
  assert(
    (await collectJobFailures(mutated, SHA, TREE)).some((f) =>
      f.includes('fresh-clone/task-release-check')
    ),
  );
});
