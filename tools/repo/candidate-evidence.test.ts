/**
 * candidate-evidence unit tests: the aggregation/validation core must not
 * trust the artifact. Every check recomputes hashes from real bytes and
 * fails on mismatched SHA/tree, missing logs, tampered manifests, and stale
 * evidence.
 */
import { assert, assertEquals } from '@std/assert';
import {
  collectBundleFailures,
  collectJobFailures,
  collectRollupFailures,
  packedRollupFromLog,
  sourceRollupFromLog,
} from './candidate-evidence.ts';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

type JobEntry = Parameters<typeof collectJobFailures>[0][number];
type JobRecord = JobEntry['job'];

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jobResult(
  job: JobRecord['job'],
  overrides: Partial<JobRecord> = {},
): JobRecord {
  return {
    schemaVersion: 1,
    job,
    sha: SHA,
    tree: TREE,
    trackedClean: true,
    result: 'PASS',
    steps: [],
    toolVersions: {},
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function passStep(name: string, logPath: string, logSha256: string): JobRecord['steps'][number] {
  return {
    name,
    command: ['deno', 'task'],
    startedAt: new Date().toISOString(),
    durationMs: 1,
    exitCode: 0,
    result: 'PASS',
    logPath,
    logSha256,
  };
}

Deno.test('collectJobFailures accepts four healthy jobs and flags each defect class', async () => {
  const logs: Record<string, string> = {};
  const healthy: JobEntry[] = [];
  for (const job of ['fast-checks', 'source-matrix', 'packed', 'fresh-clone'] as const) {
    const logPath = 'logs/step.log';
    logs[`${job}/${logPath}`] = `${job} ok\n`;
    healthy.push({
      job: jobResult(job, {
        steps: [passStep('step', logPath, await sha256(logs[`${job}/${logPath}`]))],
      }),
      read: (path) => {
        const value = logs[`${job}/${path}`];
        return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
      },
    });
  }
  assertEquals(await collectJobFailures(healthy, SHA, TREE), []);

  assert(
    (await collectJobFailures(healthy.slice(0, 3), SHA, TREE)).some((failure) =>
      failure.includes('required job result missing: fresh-clone')
    ),
  );

  const wrongSha = healthy.map((entry, index) =>
    index === 1 ? { ...entry, job: jobResult('source-matrix', { sha: 'c'.repeat(40) }) } : entry
  );
  assert(
    (await collectJobFailures(wrongSha, SHA, TREE)).some((failure) =>
      failure.includes('source-matrix: sha')
    ),
  );

  const failedStep = healthy.map((entry, index) =>
    index === 2
      ? {
        ...entry,
        job: jobResult('packed', {
          steps: [{
            ...passStep('gate-packed', 'logs/step.log', 'sha256:' + '0'.repeat(64)),
            exitCode: 1,
            result: 'FAIL',
          }],
        }),
      }
      : entry
  );
  assert(
    (await collectJobFailures(failedStep, SHA, TREE)).some((failure) =>
      failure.includes('packed/gate-packed: FAIL')
    ),
  );

  const tamperedLog = healthy.map((entry, index) =>
    index === 0
      ? {
        ...entry,
        read: () => Promise.resolve(new TextEncoder().encode('tampered\n')),
      }
      : entry
  );
  assert(
    (await collectJobFailures(tamperedLog, SHA, TREE)).some((failure) =>
      failure.includes('fast-checks/step: log hash mismatch')
    ),
  );
});

Deno.test('collectBundleFailures accepts a complete bundle and rejects tampering', async () => {
  const files: Record<string, string> = {
    'ci/fast-checks/logs/step.log': 'fast ok\n',
    'tarball-manifest.json': '{"@openelement/element":"sha256:x"}\n',
    'pack-diagnostics.json': '[]\n',
    'fresh-clone-manifest.json': '{}\n',
  };
  const read = (path: string) => {
    const value = files[path];
    return Promise.resolve(value === undefined ? null : new TextEncoder().encode(value));
  };
  const bundle = {
    sha: SHA,
    tree: TREE,
    generatedAt: new Date().toISOString(),
    jobs: [{
      job: 'fast-checks',
      result: 'PASS',
      steps: [{
        name: 'step',
        result: 'PASS',
        logSource: 'ci/fast-checks/logs/step.log',
        logSha256: await sha256(files['ci/fast-checks/logs/step.log']),
      }],
    }],
    tarballs: {
      '@openelement/element': 'sha256:1',
      '@openelement/router': 'sha256:2',
      '@openelement/create': 'sha256:3',
      '@openelement/ui': 'sha256:4',
    },
    rollup: {
      artifactCheck: true,
      consumers: [
        'tools/release#consumer:packaged',
        'tests/fixtures/third-party-web-components#smoke',
      ],
      siteE2e: { ran: true, browsers: ['chromium', 'firefox', 'webkit'] },
    },
    tarballManifest: {
      path: 'tarball-manifest.json',
      sha256: await sha256(files['tarball-manifest.json']),
    },
    packDiagnostics: {
      path: 'pack-diagnostics.json',
      sha256: await sha256(files['pack-diagnostics.json']),
    },
    freshClone: {
      path: 'fresh-clone-manifest.json',
      sha256: await sha256(files['fresh-clone-manifest.json']),
    },
  };
  assertEquals(
    await collectBundleFailures(bundle, { expectedSha: SHA, expectedTree: TREE, read }),
    [],
  );
  assert(
    (await collectBundleFailures(bundle, {
      expectedSha: 'c'.repeat(40),
      expectedTree: TREE,
      read,
    })).some((failure) => failure.includes('evidence sha')),
  );
  assert(
    (await collectBundleFailures(bundle, {
      expectedTree: 'd'.repeat(40),
      read,
    })).some((failure) => failure.includes('evidence tree')),
  );
  assert(
    (await collectBundleFailures(bundle, {
      expectedTree: TREE,
      read,
      now: Date.now() + 20 * 24 * 60 * 60 * 1000,
    })).some((failure) => failure.includes('retention window')),
  );
  assert(
    (await collectBundleFailures(bundle, {
      expectedTree: TREE,
      read: (path) =>
        path.endsWith('tarball-manifest.json')
          ? Promise.resolve(new TextEncoder().encode('tampered'))
          : read(path),
    })).some((failure) => failure.includes('manifest hash mismatch at tarball-manifest.json')),
  );
  assert(
    (await collectBundleFailures({ ...bundle, tarballs: {} }, {
      expectedTree: TREE,
      read,
    })).some((failure) => failure.includes('tarball hashes missing')),
  );
  assert(
    (await collectBundleFailures({ ...bundle, freshClone: undefined }, {
      expectedTree: TREE,
      read,
    })).some((failure) => failure.includes('required manifest reference missing')),
  );
});

Deno.test('rollup: packed log must prove the artifact scan and consumers', () => {
  const healthy = [
    'PASS tools/release#package-artifacts:check (13.7s)',
    'PASS tools/release#consumer:packaged (40.8s)',
    'PASS tests/fixtures/third-party-web-components#smoke (1.0s)',
  ].join('\n');
  const parsed = packedRollupFromLog(healthy);
  assertEquals(parsed.artifactCheck, true);
  assertEquals(parsed.consumers.length, 2);

  const noConsumers =
    'PASS tools/release#package-artifacts:check (13.7s)\nPASS tools/release#pack:dry-run (3.3s)';
  assertEquals(packedRollupFromLog(noConsumers).consumers, []);

  const noArtifact = 'PASS tools/release#consumer:packaged (40.8s)';
  assertEquals(packedRollupFromLog(noArtifact).artifactCheck, false);
});

Deno.test('rollup: Site E2E proof must come from the source gate log', () => {
  const ran = 'PASS apps/site#e2e:browsers (780.0s)\nchromium firefox webkit';
  assertEquals(sourceRollupFromLog(ran).siteE2e.ran, true);
  assertEquals(sourceRollupFromLog(ran).siteE2e.browsers, ['chromium', 'firefox', 'webkit']);
  assertEquals(sourceRollupFromLog('FAIL apps/site#e2e:browsers').siteE2e.ran, false);
});

Deno.test('rollup: aggregate fails when artifact, consumers, or Site E2E are missing', () => {
  assertEquals(
    collectRollupFailures({
      artifactCheck: true,
      consumers: ['tools/release#consumer:packaged'],
      siteE2e: { ran: true },
    }),
    [],
  );
  assertEquals(
    collectRollupFailures({ artifactCheck: false, consumers: ['x'], siteE2e: { ran: true } })
      .some((f) => f.includes('artifact scan')),
    true,
  );
  assertEquals(
    collectRollupFailures({ artifactCheck: true, consumers: [], siteE2e: { ran: true } })
      .some((f) => f.includes('consumer count is zero')),
    true,
  );
  assertEquals(
    collectRollupFailures({ artifactCheck: true, consumers: ['x'], siteE2e: { ran: false } })
      .some((f) => f.includes('Site E2E')),
    true,
  );
  assertEquals(collectRollupFailures(undefined).length, 1);
});

Deno.test('rollup: a copied healthy bundle without the rollup is rejected', async () => {
  const { ...rest } = {
    sha: SHA,
    tree: TREE,
    generatedAt: new Date().toISOString(),
    jobs: [],
    tarballs: {
      '@openelement/element': 'sha256:1',
      '@openelement/router': 'sha256:2',
      '@openelement/create': 'sha256:3',
      '@openelement/ui': 'sha256:4',
    },
  };
  const read = () => Promise.resolve(null);
  const failures = await collectBundleFailures(rest, { expectedTree: TREE, read });
  assertEquals(failures.some((f) => f.includes('rollup missing')), true);
});
