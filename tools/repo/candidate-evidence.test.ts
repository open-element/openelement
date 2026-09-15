/**
 * candidate-evidence adversarial tests (schema v2).
 *
 * The validator is the release trust boundary: this suite builds one fully
 * valid bundle, proves it is accepted, and then mutates every contract field —
 * top-level identity/lifecycle fields, job identity/time/toolchain, step
 * argv/cwd/timing, fresh-clone path binding, tarball bytes, pack diagnostics,
 * and aggregate counts — requiring explicit rejection for each. Every forgery
 * reported by the round-2 review is a regression here.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  carryPackedTarballs,
  collectBundleFailures,
  collectJobFailures,
  collectPackedTarballFailures,
  collectRollupFailures,
  packedRollupFromLog,
  REQUIRED_PACKAGE_TARBALLS,
  REQUIRED_PACKED_CONSUMERS,
  REQUIRED_SITE_BROWSERS,
  REQUIRED_STEPS,
  stageTarballEvidence,
} from './candidate-evidence.ts';
import {
  CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  cleanProofArgv,
  cleanProofLine,
  EVIDENCE_ROLES,
  findStepContract,
  FRESH_CLONE_ISOLATION,
  freshCloneCommands,
  JOB_NAMES,
  materializeEvidencePath,
  normalizeEvidencePath,
} from './candidate-steps.ts';
import { createDeterministicTarGz } from '../lib/deterministic-tar.ts';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const VERSION = '1.0.0-alpha.1';
const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const TOOL_VERSIONS = {
  deno: '2.9.0',
  v8: '13.9.0',
  typescript: '6.0.3',
  node: 'v24.18.0',
  npm: '11.16.0',
  os: 'linux/x64',
  playwrightBrowsers: { chromium: '1217', firefox: '1511', webkit: '2272' },
};

function stepArgv(job: string, name: string): string[] {
  if (name.startsWith('workspace-clean-')) {
    const phase = name.endsWith('before') ? 'before' : 'after';
    return ['deno', ...cleanProofArgv(SHA, TREE, phase).slice(1)];
  }
  if (job === 'fresh-clone') {
    switch (name) {
      case 'clone':
        return freshCloneCommands.clone();
      case 'git-checkout':
        return freshCloneCommands.checkout(SHA);
      case 'install':
        return freshCloneCommands.install('deno');
      case 'task-check':
        return freshCloneCommands.check('deno');
      case 'task-gate-source':
        return freshCloneCommands.gateSource('deno');
      case 'task-release-check':
        return freshCloneCommands.releaseCheck('deno');
      default:
        throw new Error(`no fresh argv for ${name}`);
    }
  }
  const staticTable: Record<string, Record<string, string[]>> = {
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
  const command = staticTable[job]?.[name];
  if (!command) throw new Error(`no static argv for ${job}/${name}`);
  return [...command];
}

interface Fixture {
  logs: Record<string, string>;
  archives: Record<string, Uint8Array>;
  manifests: Record<string, string>;
  jobs: Array<{ job: Record<string, unknown>; read: (path: string) => Promise<Uint8Array | null> }>;
  bundle: Record<string, unknown>;
  read: (path: string) => Promise<Uint8Array | null>;
}

async function fixture(): Promise<Fixture> {
  const logs: Record<string, string> = {};
  const archives: Record<string, Uint8Array> = {};
  const manifests: Record<string, string> = {};
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const short = name.replace('@openelement/', '');
    archives[`tarballs/openelement-${short}-${VERSION}.tgz`] = await createDeterministicTarGz([{
      path: 'package/package.json',
      data: encoder.encode(JSON.stringify({ name, version: VERSION })),
    }]);
  }
  const tarballs: Record<string, string> = {};
  const tarballFiles: Record<string, string> = {};
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const short = name.replace('@openelement/', '');
    tarballFiles[name] = `tarballs/openelement-${short}-${VERSION}.tgz`;
    tarballs[name] = await sha256BytesLocal(
      archives[`tarballs/openelement-${short}-${VERSION}.tgz`],
    );
  }
  const packDiagnostics = [...REQUIRED_PACKAGE_TARBALLS].sort().map((pkg) => ({
    package: pkg,
    errors: 0,
    unexpectedWarnings: 0,
    knownUpstreamPrivateWarnings: 1,
    publicDeclarations: 1,
    declarationClosure: 1,
  }));
  manifests['tarball-manifest.json'] = JSON.stringify(tarballs, null, 2) + '\n';
  manifests['pack-diagnostics.json'] = JSON.stringify(packDiagnostics, null, 2) + '\n';

  const generatedAt = new Date().toISOString();
  const baseTime = Date.parse(generatedAt) - 600_000;
  let tick = 0;
  const jobs: Fixture['jobs'] = [];
  const bundleJobs: Array<Record<string, unknown>> = [];
  for (const job of JOB_NAMES) {
    const rawSteps: Array<Record<string, unknown>> = [];
    const bundleSteps: Array<Record<string, unknown>> = [];
    for (const name of REQUIRED_STEPS[job]) {
      const command = stepArgv(job, name);
      const cwd = findStepContract(job, name)!.cwd;
      const key = `${job}/${name}`;
      const phase = name.endsWith('before') ? 'before' : name.endsWith('after') ? 'after' : '';
      logs[key] = name.startsWith('workspace-clean-')
        ? `${cleanProofLine(SHA, TREE, phase as 'before' | 'after')}\n`
        : `${key} ok\n`;
      const hash = await sha256(logs[key]);
      const startedAt = new Date(baseTime + (tick++) * 1000).toISOString();
      rawSteps.push({
        name,
        command,
        cwd,
        startedAt,
        durationMs: 5,
        exitCode: 0,
        result: 'PASS',
        logPath: `logs/${name}.log`,
        logSha256: hash,
      });
      bundleSteps.push({
        name,
        command,
        cwd,
        startedAt,
        durationMs: 5,
        exitCode: 0,
        result: 'PASS',
        logSource: `ci/${job}/logs/${name}.log`,
        logSha256: hash,
      });
    }
    const extras = job === 'fresh-clone'
      ? { isolation: FRESH_CLONE_ISOLATION }
      : job === 'packed'
      ? {
        packageVersion: VERSION,
        tarballs,
        tarballFiles,
        packDiagnostics,
        artifactCheck: true,
        consumers: [...REQUIRED_PACKED_CONSUMERS],
      }
      : job === 'source-matrix'
      ? {
        siteE2e: {
          ran: true,
          passed: 3 * REQUIRED_SITE_BROWSERS.length,
          failed: 0,
          skipped: 0,
          projects: Object.fromEntries(
            REQUIRED_SITE_BROWSERS.map((
              browser,
            ) => [browser, { passed: 3, failed: 0, skipped: 0 }]),
          ),
        },
      }
      : {};
    const jobRecord = {
      schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
      job,
      sha: SHA,
      tree: TREE,
      trackedClean: true,
      result: 'PASS',
      generatedAt,
      toolVersions: TOOL_VERSIONS,
      steps: rawSteps,
      extras,
    };
    jobs.push({
      job: jobRecord,
      read: (path) => {
        if (path in archives) return Promise.resolve(archives[path]);
        const value = logs[`${job}/${path.replace(/^logs\//u, '').replace(/\.log$/u, '')}`];
        return Promise.resolve(value === undefined ? null : encoder.encode(value));
      },
    });
    bundleJobs.push({
      schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
      job,
      sha: SHA,
      tree: TREE,
      trackedClean: true,
      result: 'PASS',
      generatedAt,
      toolVersions: TOOL_VERSIONS,
      steps: bundleSteps,
      extras,
    });
  }
  const bundle: Record<string, unknown> = {
    schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    sha: SHA,
    tree: TREE,
    generatedAt,
    result: 'PASS',
    trackedClean: true,
    requiredOk: true,
    toolVersions: TOOL_VERSIONS,
    packageVersion: VERSION,
    aggregate: {
      inputs: [...JOB_NAMES],
      recomputedLogHashes: REQUIRED_STEPS_REDUCED(),
    },
    jobs: bundleJobs,
    tarballs,
    tarballFiles,
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
  };
  const read = (path: string) => {
    const match = /^ci\/([^/]+)\/logs\/(.+)\.log$/u.exec(path);
    if (match) {
      const value = logs[`${match[1]}/${match[2]}`];
      return Promise.resolve(value === undefined ? null : encoder.encode(value));
    }
    if (path in archives) return Promise.resolve(archives[path]);
    const manifest = manifests[path];
    return Promise.resolve(manifest === undefined ? null : encoder.encode(manifest));
  };
  return { logs, archives, manifests, jobs, bundle, read };
}

function REQUIRED_STEPS_REDUCED(): number {
  return JOB_NAMES.reduce((sum, job) => sum + REQUIRED_STEPS[job].length, 0);
}

Deno.test('packed tarballs travel with job evidence and are hash-checked on aggregation', async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    const recorded = `${root}/recorded`;
    const aggregated = `${root}/aggregated`;
    await Deno.mkdir(source);
    const packages = [{ name: '@openelement/example', version: VERSION }];
    const archive = `${source}/openelement-example-${VERSION}.tgz`;
    await Deno.writeFile(archive, encoder.encode('release archive bytes'));

    const first = await stageTarballEvidence(packages, () => archive, recorded);
    assertEquals(first.files, {
      '@openelement/example': `tarballs/openelement-example-${VERSION}.tgz`,
    });
    const carried = `${recorded}/${first.files['@openelement/example']}`;
    const second = await stageTarballEvidence(
      packages,
      () => carried,
      aggregated,
      first.hashes,
    );
    assertEquals(second, first);
    assertEquals(
      await Deno.readFile(`${aggregated}/${second.files['@openelement/example']}`),
      encoder.encode('release archive bytes'),
    );

    await assertRejects(
      () =>
        stageTarballEvidence(packages, () => carried, aggregated, {
          '@openelement/example': `sha256:${'0'.repeat(64)}`,
        }),
      Error,
      'Candidate tarball hash mismatch',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function validPackedStore(version = VERSION) {
  const archives = new Map<string, Uint8Array>();
  const tarballs: Record<string, string> = {};
  const tarballFiles: Record<string, string> = {};
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const short = name.replace('@openelement/', '');
    const path = `tarballs/openelement-${short}-${version}.tgz`;
    const bytes = await createDeterministicTarGz([{
      path: 'package/package.json',
      data: encoder.encode(JSON.stringify({ name, version })),
    }]);
    archives.set(path, bytes);
    tarballFiles[name] = path;
    tarballs[name] = await sha256BytesLocal(bytes);
  }
  const extras = {
    packageVersion: version,
    tarballs,
    tarballFiles,
    packDiagnostics: [],
    artifactCheck: true,
    consumers: [...REQUIRED_PACKED_CONSUMERS],
  };
  const read = (path: string) => Promise.resolve(archives.get(path) ?? null);
  return { extras, archives, read };
}

Deno.test('valid packed evidence capsule validates and carries without the workspace', async () => {
  const { extras, archives, read } = await validPackedStore();
  assertEquals(await collectPackedTarballFailures(extras, { read }), []);
  const outDir = await Deno.makeTempDir();
  try {
    // ponytail: the guard simulates an aggregate runner with no producer
    // workspace — any packages/* fallback throws (upgrade: prove it with the
    // real aggregate CLI after deleting packages tgz files).
    const guarded = (path: string) => {
      if (!path.startsWith('tarballs/')) throw new Error(`workspace fallback: ${path}`);
      return read(path);
    };
    const carried = await carryPackedTarballs(extras, guarded, outDir);
    assertEquals(carried.tarballs, extras.tarballs);
    assertEquals(carried.tarballFiles, extras.tarballFiles);
    assertEquals(carried.packageVersion, VERSION);
    for (const path of Object.values(extras.tarballFiles)) {
      const expected = archives.get(path);
      assert(expected !== undefined);
      assertEquals(await Deno.readFile(`${outDir}/${path}`), expected);
    }
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('tarball map equality ignores key insertion order', async () => {
  // Producer stages in workspace order; the aggregator composes in
  // REQUIRED_PACKAGE_TARBALLS order. Identical maps must validate.
  const f = await shared();
  const bundle = clone(f.bundle);
  const reversed = Object.fromEntries(
    Object.entries(bundle.tarballFiles as Record<string, string>).reverse(),
  );
  bundle.tarballFiles = reversed;
  (bundleJob(bundle, 'packed').extras as Record<string, unknown>).tarballFiles = Object.fromEntries(
    Object.entries(reversed).reverse(),
  );
  assertEquals(await failuresFor(bundle, f), []);
});

Deno.test('packed validation fails when the archive bytes are missing', async () => {
  const { extras } = await validPackedStore();
  const read = (_path: string) => Promise.resolve(null);
  const failures = await collectPackedTarballFailures(extras, { read });
  assert(
    failures.some((failure) => failure.includes('archive missing')),
    failures.join(' | '),
  );
  const outDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => carryPackedTarballs(extras, read, outDir),
      Error,
      'packed tarball missing',
    );
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('packed validation fails when archive bytes are tampered', async () => {
  const { extras, archives } = await validPackedStore();
  const victim = REQUIRED_PACKAGE_TARBALLS[0];
  const path = extras.tarballFiles[victim];
  const original = archives.get(path);
  assert(original !== undefined);
  const tampered = new Uint8Array(original);
  tampered[0] ^= 0xff;
  const tamperedRead = (candidate: string) =>
    Promise.resolve(candidate === path ? tampered : archives.get(candidate) ?? null);
  const failures = await collectPackedTarballFailures(extras, { read: tamperedRead });
  assert(
    failures.some((failure) => failure.includes('sha256')),
    failures.join(' | '),
  );
  const outDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => carryPackedTarballs(extras, tamperedRead, outDir),
      Error,
      'hash mismatch',
    );
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('packed validation rejects every path-traversal vector', async () => {
  const vectors = [
    '../../packages/foo.tgz',
    '../foo.tgz',
    'tarballs/../foo.tgz',
    '/tmp/foo.tgz',
    'C:\\foo.tgz',
  ];
  for (const vector of vectors) {
    const { extras, read } = await validPackedStore();
    extras.tarballFiles[REQUIRED_PACKAGE_TARBALLS[0]] = vector;
    const failures = await collectPackedTarballFailures(extras, { read });
    assert(
      failures.some((failure) => failure.includes('tarballFiles')),
      `expected path rejection for ${vector}; got ${failures.join(' | ')}`,
    );
  }
});

Deno.test('packed validation rejects a missing package from the exact set', async () => {
  const { extras, read } = await validPackedStore();
  delete extras.tarballs['@openelement/ui'];
  delete extras.tarballFiles['@openelement/ui'];
  const failures = await collectPackedTarballFailures(extras, { read });
  assert(
    failures.some((failure) => failure.includes('must contain exactly')),
    failures.join(' | '),
  );
  assert(
    failures.some((failure) => failure.includes('must map exactly')),
    failures.join(' | '),
  );
  const outDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => carryPackedTarballs(extras, read, outDir),
      Error,
      'must contain exactly',
    );
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('packed validation rejects an unknown extra package', async () => {
  const { extras, read } = await validPackedStore();
  extras.tarballs['@openelement/fake'] = `sha256:${'1'.repeat(64)}`;
  extras.tarballFiles['@openelement/fake'] = `tarballs/openelement-fake-${VERSION}.tgz`;
  const failures = await collectPackedTarballFailures(extras, { read });
  assert(
    failures.some((failure) => failure.includes('must contain exactly')),
    failures.join(' | '),
  );
  const outDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => carryPackedTarballs(extras, read, outDir),
      Error,
      'must contain exactly',
    );
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test('packed validation rejects divergent package versions', async () => {
  const { extras, archives } = await validPackedStore();
  const victim = '@openelement/router';
  const driftedVersion = '1.0.0-alpha.2';
  const drifted = await createDeterministicTarGz([{
    path: 'package/package.json',
    data: encoder.encode(JSON.stringify({ name: victim, version: driftedVersion })),
  }]);
  const path = extras.tarballFiles[victim];
  archives.set(path, drifted);
  extras.tarballs[victim] = await sha256BytesLocal(drifted);
  const read = (candidate: string) => Promise.resolve(archives.get(candidate) ?? null);
  const failures = await collectPackedTarballFailures(extras, { read });
  assert(
    failures.some((failure) => failure.includes('package version')),
    failures.join(' | '),
  );
});

async function sha256BytesLocal(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function bundleJob(bundle: Record<string, unknown>, name: string): Record<string, unknown> {
  const job = (bundle.jobs as Array<Record<string, unknown>>).find((entry) => entry.job === name);
  if (!job) throw new Error(`bundle job ${name} missing`);
  return job;
}

function bundleStep(bundle: Record<string, unknown>, job: string, name: string) {
  const step = (bundleJob(bundle, job).steps as Array<Record<string, unknown>>).find((entry) =>
    entry.name === name
  );
  if (!step) throw new Error(`step ${job}/${name} missing`);
  return step;
}

async function failuresFor(bundle: Record<string, unknown>, f: Fixture) {
  return await collectBundleFailures(bundle, {
    expectedSha: SHA,
    expectedTree: TREE,
    read: f.read,
  });
}

let cached: Fixture | undefined;
async function shared(): Promise<Fixture> {
  cached ??= await fixture();
  return cached;
}

Deno.test('valid schema-v2 bundle and jobs pass the strict contract', async () => {
  const f = await shared();
  assertEquals(await failuresFor(clone(f.bundle), f), []);
  assertEquals(
    await collectJobFailures(
      f.jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read })) as never,
      SHA,
      TREE,
    ),
    [],
  );
});

Deno.test('top-level identity and lifecycle fields are strict', async () => {
  const f = await shared();
  const cases: Array<[string, (b: Record<string, unknown>) => void, string]> = [
    ['result-FAIL', (b) => {
      b.result = 'FAIL';
    }, 'result'],
    ['result-missing', (b) => {
      delete b.result;
    }, 'result'],
    ['trackedClean-false', (b) => {
      b.trackedClean = false;
    }, 'trackedClean'],
    ['trackedClean-missing', (b) => {
      delete b.trackedClean;
    }, 'trackedClean'],
    ['requiredOk-false', (b) => {
      b.requiredOk = false;
    }, 'requiredOk'],
    ['requiredOk-missing', (b) => {
      delete b.requiredOk;
    }, 'requiredOk'],
    ['schemaVersion-1', (b) => {
      b.schemaVersion = 1;
    }, 'schemaVersion'],
    ['schemaVersion-999', (b) => {
      b.schemaVersion = 999;
    }, 'schemaVersion'],
    ['schemaVersion-missing', (b) => {
      delete b.schemaVersion;
    }, 'schemaVersion'],
    ['toolVersions-missing', (b) => {
      delete b.toolVersions;
    }, 'toolVersions'],
    ['toolVersions-bad-type', (b) => {
      b.toolVersions = 'nope';
    }, 'toolVersions'],
    ['packageVersion-missing', (b) => {
      delete b.packageVersion;
    }, 'packageVersion'],
    ['packageVersion-bad', (b) => {
      b.packageVersion = 'latest';
    }, 'packageVersion'],
    ['unknown-field', (b) => {
      b.extra = true;
    }, 'unknown fields'],
    ['sha-short', (b) => {
      b.sha = 'abc';
    }, 'sha'],
    ['generatedAt-bad', (b) => {
      b.generatedAt = 'not-a-date';
    }, 'generatedAt'],
  ];
  for (const [label, mutate, expected] of cases) {
    const bundle = clone(f.bundle);
    mutate(bundle);
    assert(
      (await failuresFor(bundle, f)).some((failure) => failure.includes(expected)),
      `expected rejection for ${label}`,
    );
  }
});

Deno.test('job identity, time, and toolchain fields are strict', async () => {
  const f = await shared();
  const cases: Array<[string, (job: Record<string, unknown>) => void, string]> = [
    ['schemaVersion', (j) => {
      j.schemaVersion = 1;
    }, 'schemaVersion'],
    ['trackedClean', (j) => {
      j.trackedClean = false;
    }, 'trackedClean'],
    ['trackedClean-missing', (j) => {
      delete j.trackedClean;
    }, 'trackedClean'],
    ['result', (j) => {
      j.result = 'FAIL';
    }, 'result'],
    ['generatedAt-bad', (j) => {
      j.generatedAt = 'not-a-date';
    }, 'generatedAt'],
    ['generatedAt-missing', (j) => {
      delete j.generatedAt;
    }, 'generatedAt'],
    ['toolVersions-missing', (j) => {
      delete j.toolVersions;
    }, 'toolVersions'],
    ['unknown-field', (j) => {
      j.extra = 1;
    }, 'unknown job fields'],
    ['sha', (j) => {
      j.sha = 'c'.repeat(40);
    }, 'sha'],
    ['tree', (j) => {
      j.tree = 'd'.repeat(40);
    }, 'tree'],
  ];
  for (const [label, mutate, expected] of cases) {
    const bundle = clone(f.bundle);
    mutate(bundleJob(bundle, 'fast-checks'));
    const failures = await failuresFor(bundle, f);
    assert(
      failures.some((failure) => failure.includes(expected)),
      `expected rejection for job ${label}; got ${failures.join(' | ')}`,
    );
  }
  const staleBundle = clone(f.bundle);
  staleBundle.generatedAt = new Date(Date.parse(f.bundle.generatedAt as string) - 60_000)
    .toISOString();
  assert(
    (await failuresFor(staleBundle, f)).some((x) => x.includes('after the bundle generatedAt')),
  );

  const lateStep = clone(f.bundle);
  const step = bundleStep(lateStep, 'fast-checks', 'fmt-check');
  step.startedAt = new Date(Date.now() - 1000).toISOString();
  step.durationMs = 60 * 60 * 1000;
  assert(
    (await failuresFor(lateStep, f)).some((x) => x.includes('step ends after the job generatedAt')),
  );
});

Deno.test('aggregate must match the actual job and step set', async () => {
  const f = await shared();
  for (
    const [label, mutate, expected] of [
      ['missing', (b: Record<string, unknown>) => {
        delete b.aggregate;
      }, 'aggregate'],
      ['zero', (b: Record<string, unknown>) => {
        (b.aggregate as Record<string, unknown>).recomputedLogHashes = 0;
      }, 'recomputedLogHashes'],
      ['inputs-missing', (b: Record<string, unknown>) => {
        (b.aggregate as Record<string, unknown>).inputs = [];
      }, 'aggregate.inputs'],
      ['inputs-reordered', (b: Record<string, unknown>) => {
        (b.aggregate as Record<string, unknown>).inputs = [...JOB_NAMES].reverse();
      }, 'aggregate.inputs'],
      ['unknown-field', (b: Record<string, unknown>) => {
        (b.aggregate as Record<string, unknown>).extra = 1;
      }, 'aggregate has unknown fields'],
    ] as const
  ) {
    const bundle = clone(f.bundle);
    mutate(bundle);
    assert(
      (await failuresFor(bundle, f)).some((failure) => failure.includes(expected)),
      `expected rejection for aggregate ${label}`,
    );
  }
});

Deno.test('tarball bytes, files, and manifest are cross-verified', async () => {
  const f = await shared();
  const zeroed = clone(f.bundle);
  for (const key of Object.keys(zeroed.tarballs as Record<string, string>)) {
    (zeroed.tarballs as Record<string, string>)[key] = `sha256:${'0'.repeat(64)}`;
  }
  assert((await failuresFor(zeroed, f)).some((x) => x.includes('archive sha256')));

  const missingKey = clone(f.bundle);
  delete (missingKey.tarballs as Record<string, string>)['@openelement/router'];
  assert(
    (await failuresFor(missingKey, f)).some((x) => x.includes('tarballs must contain exactly')),
  );

  const extraKey = clone(f.bundle);
  (extraKey.tarballs as Record<string, string>)['@evil/fake'] = `sha256:${'1'.repeat(64)}`;
  assert((await failuresFor(extraKey, f)).some((x) => x.includes('tarballs must contain exactly')));

  const missingFile = clone(f.bundle);
  delete (missingFile.tarballFiles as Record<string, string>)['@openelement/ui'];
  assert(
    (await failuresFor(missingFile, f)).some((x) => x.includes('tarballFiles must map exactly')),
  );

  const badPath = clone(f.bundle);
  (badPath.tarballFiles as Record<string, string>)['@openelement/ui'] = '../escape.tgz';
  assert((await failuresFor(badPath, f)).some((x) => x.includes('tarballFiles.@openelement/ui')));

  const emptyManifest = clone(f.bundle);
  emptyManifest.tarballManifest = {
    path: 'tarball-manifest.json',
    sha256: await sha256('{}\n'),
  };
  assert(
    (await collectBundleFailures(emptyManifest, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: (path) =>
        path === 'tarball-manifest.json' ? Promise.resolve(encoder.encode('{}\n')) : f.read(path),
    })).some((x) => x.includes('contents must equal')),
  );

  const threeWay = clone(f.bundle);
  (bundleJob(threeWay, 'packed').extras as Record<string, unknown>).tarballs = {
    ...(f.bundle.tarballs as Record<string, string>),
    '@openelement/element': `sha256:${'f'.repeat(64)}`,
  };
  assert((await failuresFor(threeWay, f)).some((x) => x.includes('extras.tarballs')));

  const diagnosticsDrift = clone(f.bundle);
  (bundleJob(diagnosticsDrift, 'packed').extras as Record<string, unknown>).packDiagnostics = [];
  assert(
    (await failuresFor(diagnosticsDrift, f)).some((x) => x.includes('extras.packDiagnostics')),
  );
});

Deno.test('tarball package name and version come from the archive bytes', async () => {
  const f = await shared();
  const wrongVersion = clone(f.bundle);
  wrongVersion.packageVersion = '9.9.9';
  assert((await failuresFor(wrongVersion, f)).some((x) => x.includes('package version')));
  const wrongName = clone(f.bundle);
  const bytes = await createDeterministicTarGz([{
    path: 'package/package.json',
    data: encoder.encode(JSON.stringify({ name: '@evil/wrong', version: VERSION })),
  }]);
  assert(
    (await collectBundleFailures(wrongName, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: (path) =>
        path === 'tarballs/openelement-element-1.0.0-alpha.1.tgz'
          ? Promise.resolve(bytes)
          : f.read(path),
    })).some((x) => x.includes('package name')),
  );
});

Deno.test('pack diagnostics are parsed and cross-checked', async () => {
  const f = await shared();
  const emptyDiagnostics = clone(f.bundle);
  emptyDiagnostics.packDiagnostics = {
    path: 'pack-diagnostics.json',
    sha256: await sha256('{}\n'),
  };
  assert(
    (await collectBundleFailures(emptyDiagnostics, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: (path) =>
        path === 'pack-diagnostics.json' ? Promise.resolve(encoder.encode('{}\n')) : f.read(path),
    })).some((x) => x.includes('must be an array')),
  );

  for (
    const [label, mutate, expected] of [
      ['wrong-package', (entries: Array<Record<string, unknown>>) => {
        entries[0].package = '@evil/fake';
      }, 'must list exactly'],
      ['errors', (entries: Array<Record<string, unknown>>) => {
        entries[0].errors = 1;
      }, 'errors must be 0'],
      ['unexpected', (entries: Array<Record<string, unknown>>) => {
        entries[0].unexpectedWarnings = 1;
      }, 'unexpectedWarnings must be 0'],
      ['negative-closure', (entries: Array<Record<string, unknown>>) => {
        entries[0].declarationClosure = -1;
      }, 'declarationClosure'],
      ['string-declarations', (entries: Array<Record<string, unknown>>) => {
        entries[0].publicDeclarations = '1';
      }, 'publicDeclarations'],
    ] as const
  ) {
    const diagnostics = REQUIRED_PACKAGE_TARBALLS.map((pkg) => ({
      package: pkg,
      errors: 0,
      unexpectedWarnings: 0,
      knownUpstreamPrivateWarnings: 1,
      publicDeclarations: 1,
      declarationClosure: 1,
    })) as Array<Record<string, unknown>>;
    mutate(diagnostics);
    const content = JSON.stringify(diagnostics) + '\n';
    const bundle = clone(f.bundle);
    bundle.packDiagnostics = { path: 'pack-diagnostics.json', sha256: await sha256(content) };
    assert(
      (await collectBundleFailures(bundle, {
        expectedSha: SHA,
        expectedTree: TREE,
        read: (path) =>
          path === 'pack-diagnostics.json'
            ? Promise.resolve(encoder.encode(content))
            : f.read(path),
      })).some((x) => x.includes(expected)),
      `expected rejection for diagnostics ${label}`,
    );
  }
});

Deno.test('step argv, cwd, timing, and logs are strict', async () => {
  const f = await shared();
  const cases: Array<[string, (b: Record<string, unknown>) => void, string]> = [
    ['command-wrong-task', (b) => {
      bundleStep(b, 'fresh-clone', 'task-gate-source').command = ['deno', 'task', 'check'];
    }, 'task-gate-source'],
    ['command-empty-argv', (b) => {
      bundleStep(b, 'fast-checks', 'lint').command = [];
    }, 'argv'],
    ['command-empty-element', (b) => {
      bundleStep(b, 'fast-checks', 'lint').command = [''];
    }, 'argv'],
    ['cwd-wrong', (b) => {
      bundleStep(b, 'fast-checks', 'lint').cwd = EVIDENCE_ROLES.clone;
    }, 'cwd must be'],
    ['cwd-missing', (b) => {
      delete bundleStep(b, 'fast-checks', 'lint').cwd;
    }, 'cwd'],
    ['startedAt-bad', (b) => {
      bundleStep(b, 'fast-checks', 'lint').startedAt = 'nope';
    }, 'startedAt'],
    ['duration-fraction', (b) => {
      bundleStep(b, 'fast-checks', 'lint').durationMs = 0.5;
    }, 'durationMs'],
    ['exitCode-missing', (b) => {
      delete bundleStep(b, 'fast-checks', 'lint').exitCode;
    }, 'exitCode'],
    ['exitCode-nonzero', (b) => {
      bundleStep(b, 'fast-checks', 'lint').exitCode = 1;
    }, 'exitCode'],
    ['result-fail', (b) => {
      bundleStep(b, 'fast-checks', 'lint').result = 'FAIL';
    }, 'result'],
    ['log-path-traversal', (b) => {
      bundleStep(b, 'fast-checks', 'lint').logSource = '../../etc/passwd.log';
    }, 'log path'],
    ['log-hash', (b) => {
      bundleStep(b, 'fast-checks', 'lint').logSha256 = `sha256:${'0'.repeat(64)}`;
    }, 'log hash mismatch'],
    ['clean-line-missing', (b) => {
      const step = bundleStep(b, 'fast-checks', 'workspace-clean-before');
      step.logSha256 = `sha256:${'2'.repeat(64)}`;
    }, 'log hash mismatch'],
  ];
  for (const [label, mutate, expected] of cases) {
    const bundle = clone(f.bundle);
    mutate(bundle);
    assert(
      (await failuresFor(bundle, f)).some((failure) => failure.includes(expected)),
      `expected rejection for ${label}`,
    );
  }

  // A clean-proof log without the canonical PASS line is rejected even when
  // its hash matches.
  const noLine = clone(f.bundle);
  const content = 'clean-proof FAIL phase=before\n';
  const step = bundleStep(noLine, 'fast-checks', 'workspace-clean-before');
  step.logSha256 = await sha256(content);
  assert(
    (await collectBundleFailures(noLine, {
      expectedSha: SHA,
      expectedTree: TREE,
      read: (path) =>
        path === 'ci/fast-checks/logs/workspace-clean-before.log'
          ? Promise.resolve(encoder.encode(content))
          : f.read(path),
    })).some((x) => x.includes('missing the canonical clean-proof PASS line')),
  );

  const missingStep = clone(f.bundle);
  (bundleJob(missingStep, 'fast-checks').steps as Array<unknown>) =
    (bundleJob(missingStep, 'fast-checks').steps as Array<Record<string, unknown>>).filter((
      entry,
    ) => entry.name !== 'workspace-clean-after');
  assert((await failuresFor(missingStep, f)).some((x) => x.includes('required step missing')));

  const duplicateStep = clone(f.bundle);
  const steps = bundleJob(duplicateStep, 'packed').steps as Array<Record<string, unknown>>;
  steps.push(clone(steps[0]));
  assert((await failuresFor(duplicateStep, f)).some((x) => x.includes('duplicate step')));

  const unknownStep = clone(f.bundle);
  (bundleJob(unknownStep, 'packed').steps as Array<Record<string, unknown>>).push({
    ...(bundleJob(unknownStep, 'packed').steps as Array<Record<string, unknown>>)[0],
    name: 'extra-step',
  });
  assert((await failuresFor(unknownStep, f)).some((x) => x.includes('unknown step')));
});

Deno.test('fresh-clone path binding rejects every decoy', async () => {
  const f = await shared();
  const cases: Array<[string, (b: Record<string, unknown>) => void, string]> = [
    ['clone-source-decoy', (b) => {
      bundleStep(b, 'fresh-clone', 'clone').command = [
        'git',
        'clone',
        '--no-hardlinks',
        '$DECOY',
        EVIDENCE_ROLES.clone,
      ];
    }, 'clone'],
    ['clone-destination-decoy', (b) => {
      bundleStep(b, 'fresh-clone', 'clone').command = [
        'git',
        'clone',
        '--no-hardlinks',
        EVIDENCE_ROLES.source,
        '/tmp/decoy-clone',
      ];
    }, 'clone'],
    ['checkout-other-dir', (b) => {
      bundleStep(b, 'fresh-clone', 'git-checkout').command = [
        'git',
        '-C',
        '/tmp/decoy-clone',
        'checkout',
        SHA,
      ];
    }, 'git-checkout must run against'],
    ['later-cwd-decoy', (b) => {
      bundleStep(b, 'fresh-clone', 'install').cwd = '/tmp/decoy-clone';
    }, 'cwd must be'],
    ['isolation-missing', (b) => {
      delete (bundleJob(b, 'fresh-clone').extras as Record<string, unknown>).isolation;
    }, 'isolation'],
    ['isolation-drifted', (b) => {
      ((bundleJob(b, 'fresh-clone').extras as Record<string, unknown>).isolation as Record<
        string,
        unknown
      >)
        .denoDir = '/workspace/.deno';
    }, 'denoDir'],
    ['isolation-extra', (b) => {
      ((bundleJob(b, 'fresh-clone').extras as Record<string, unknown>).isolation as Record<
        string,
        unknown
      >)
        .extra = 'field';
    }, 'unknown fields'],
  ];
  for (const [label, mutate, expected] of cases) {
    const bundle = clone(f.bundle);
    mutate(bundle);
    assert(
      (await failuresFor(bundle, f)).some((failure) => failure.includes(expected)),
      `expected rejection for ${label}`,
    );
  }
});

Deno.test('job-name, SHA/tree, and duplicate/unknown jobs are rejected', async () => {
  const f = await shared();
  const missing = clone(f.bundle);
  missing.jobs = (missing.jobs as Array<Record<string, unknown>>).filter((job) =>
    job.job !== 'packed'
  );
  assert(
    (await failuresFor(missing, f)).some((x) => x.includes('required job result missing: packed')),
  );

  const duplicate = clone(f.bundle);
  const jobs = duplicate.jobs as Array<Record<string, unknown>>;
  jobs.push(clone(jobs[0]));
  assert((await failuresFor(duplicate, f)).some((x) => x.includes('duplicate job result')));

  const unknown = clone(f.bundle);
  (unknown.jobs as Array<Record<string, unknown>>).push({
    ...clone((unknown.jobs as Array<Record<string, unknown>>)[0]),
    job: 'unknown-job',
  });
  assert((await failuresFor(unknown, f)).some((x) => x.includes('unknown job result')));

  const wrongSha = clone(f.bundle);
  wrongSha.sha = 'c'.repeat(40);
  assert((await failuresFor(wrongSha, f)).some((x) => x.includes('evidence sha')));
});

Deno.test('collectJobFailures rejects old-style and decoy fresh clones', async () => {
  const f = await shared();
  const cloneJobs = () =>
    f.jobs.map((entry) => ({ job: structuredClone(entry.job), read: entry.read }));

  const oldStyle = cloneJobs();
  const fresh = oldStyle.find((entry) => entry.job.job === 'fresh-clone');
  if (!fresh) throw new Error('fresh fixture missing');
  fresh.job.steps = (fresh.job.steps as Array<{ name: string }>).filter((step) =>
    ['clone', 'git-checkout', 'install', 'task-check', 'task-gate-source', 'task-release-check']
      .includes(step.name)
  );
  assert(
    (await collectJobFailures(oldStyle as never, SHA, TREE)).some((x) =>
      x.includes('required step missing: workspace-clean-before')
    ),
  );

  const decoy = cloneJobs();
  const decoyFresh = decoy.find((entry) => entry.job.job === 'fresh-clone');
  if (!decoyFresh) throw new Error('fresh fixture missing');
  const checkout = (decoyFresh.job.steps as Array<Record<string, unknown>>).find((step) =>
    step.name === 'git-checkout'
  );
  if (!checkout) throw new Error('git-checkout fixture missing');
  (checkout.command as string[])[2] = '/tmp/decoy-clone';
  assert(
    (await collectJobFailures(decoy as never, SHA, TREE)).some((x) =>
      x.includes('git-checkout must run against')
    ),
  );

  const failed = cloneJobs();
  const failedFresh = failed.find((entry) => entry.job.job === 'fresh-clone');
  if (!failedFresh) throw new Error('fresh fixture missing');
  const release = (failedFresh.job.steps as Array<Record<string, unknown>>).find((step) =>
    step.name === 'task-release-check'
  );
  if (!release) throw new Error('release fixture missing');
  release.result = 'FAIL';
  release.exitCode = 1;
  assert(
    (await collectJobFailures(failed as never, SHA, TREE)).some((x) =>
      x.includes('task-release-check')
    ),
  );
});

Deno.test('evidence roles materialize back to real paths before spawning', () => {
  const mapping = [
    ['/work/repo', EVIDENCE_ROLES.source],
    ['/tmp/x', EVIDENCE_ROLES.temp],
    ['/tmp/x/repo', EVIDENCE_ROLES.clone],
  ] as const;
  assertEquals(materializeEvidencePath(EVIDENCE_ROLES.source, mapping), '/work/repo');
  assertEquals(
    materializeEvidencePath(`${EVIDENCE_ROLES.clone}/tools/repo/clean-proof.ts`, mapping),
    '/tmp/x/repo/tools/repo/clean-proof.ts',
  );
  assertEquals(materializeEvidencePath('git', mapping), 'git');
  assertEquals(
    normalizeEvidencePath('/tmp/x/repo/deno-dir', mapping),
    `${EVIDENCE_ROLES.clone}/deno-dir`,
  );
});

Deno.test('rollup checks are unchanged and strict', () => {
  assertEquals(collectRollupFailures(undefined).length, 1);
  const failures = collectRollupFailures({ artifactCheck: false, consumers: [] });
  assert(failures.some((x) => x.includes('artifact scan did not run')));
  assert(failures.some((x) => x.includes('packed consumer missing')));
  const healthy = {
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
  assertEquals(collectRollupFailures(healthy), []);
  const skipped = clone(healthy);
  skipped.siteE2e.skipped = 3;
  skipped.siteE2e.passed = 0;
  skipped.siteE2e.projects = Object.fromEntries(
    REQUIRED_SITE_BROWSERS.map((browser) => [browser, { passed: 0, failed: 0, skipped: 1 }]),
  );
  assert(collectRollupFailures(skipped).some((x) => x.includes('skipped=1')));
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
